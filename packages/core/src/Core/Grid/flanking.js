/**
 * PF2E REMASTERED — FLANKING GEOMETRY (HEADLESS CORE)
 *
 * Two creatures flank a target when both are able to attack it in melee and
 * they occupy opposite sides or opposite corners of the target's square.
 *
 * For a Medium target on a 5-ft grid this reduces to:
 *   - both creatures are adjacent (orthogonally or diagonally);
 *   - both are within the default 5-ft melee reach;
 *   - neither is defeated;
 *   - the direction from the target to each creature is exactly opposite.
 *
 * Example (target T, attackers A):
 *
 *   A . . . A        A . T . A        A . .
 *   . . T . .   or   . . . . .   or   . T .
 *   . . . . .        . . . . .        . . A   (diagonal corners)
 *
 * The result is pure geometry. Whether the target actually becomes Off-Guard
 * is decided by the Strike action, because a target that already has the
 * Off-Guard condition must not receive the penalty twice.
 *
 * `gridMap` is optional but, when supplied, target and attacker cells must be
 * inside its bounds. This keeps the check honest on partial battlefields.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Grid/grid-math.js"),
      require("../Grid/distance.js"),
      require("../Rules/weapon-traits.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Flanking = factory(
      root.PF2e.Core.Grid,
      root.PF2e.Core.Distance3D,
      root.PF2e.Core.Rules.WeaponTraits,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Grid,
  Distance3D,
  WeaponTraits,
) {
  "use strict";

  const DEFAULT_REACH_FEET = 5;

  function assertUnit(unit, label) {
    if (
      unit === null ||
      typeof unit !== "object" ||
      !Number.isInteger(unit.x) ||
      !Number.isInteger(unit.y)
    ) {
      throw new TypeError(label + " must be a positioned combatant with integer x and y.");
    }
  }

  function assertAllies(allies) {
    if (allies === undefined || allies === null) {
      return [];
    }
    if (!Array.isArray(allies)) {
      throw new TypeError("allies must be an array of combatants.");
    }
    return allies;
  }

  function normalizeReach(reachFeet) {
    const reach = reachFeet === undefined ? DEFAULT_REACH_FEET : reachFeet;
    if (!Number.isInteger(reach) || reach <= 0 || reach % 5 !== 0) {
      throw new RangeError("reachFeet must be a positive multiple of 5.");
    }
    return reach;
  }

  function isDefeated(unit) {
    return unit.isDefeated === true || unit.currentHP === 0;
  }

  function sameCreature(a, b) {
    if (a === b) {
      return true;
    }
    return a.id !== undefined && b.id !== undefined && a.id === b.id;
  }

  function isHostileTo(unit, target) {
    if (unit.alliance === undefined || target.alliance === undefined) {
      return true;
    }
    return unit.alliance !== target.alliance;
  }

  function inBounds(gridMap, unit) {
    if (!gridMap || typeof gridMap.isInBounds !== "function") {
      return true;
    }
    return Grid.occupiedCellsOf(unit).every(function (cell) {
      return gridMap.isInBounds(cell.x, cell.y);
    });
  }

  function sign(value) {
    if (value === 0) {
      return 0;
    }
    return value > 0 ? 1 : -1;
  }

  /**
   * Direction from `target` to `unit` on the square grid.
   * Each component is -1, 0, or 1.
   *
   * @param {{x:number,y:number}} target
   * @param {{x:number,y:number}} unit
   * @returns {{x:number,y:number}}
   */
  function directionFrom(target, unit) {
    return {
      x: sign(unit.x - target.x),
      y: sign(unit.y - target.y),
    };
  }

  function isOppositeDirection(a, b) {
    return a.x === -b.x && a.y === -b.y && !(a.x === 0 && a.y === 0);
  }

  /**
   * Axis-aligned bounds of a creature's whole footprint, in grid coordinates.
   * A 1x1 creature at (5,5) has bounds x 5..6, y 5..6; a 2x2 Large creature
   * anchored at (5,5) has bounds x 5..7, y 5..7.
   *
   * @param {object} unit
   * @returns {{left:number,top:number,right:number,bottom:number}}
   */
  function footprintBounds(unit) {
    const cells = Grid.occupiedCellsOf(unit);
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const cell of cells) {
      if (cell.x < left) left = cell.x;
      if (cell.y < top) top = cell.y;
      if (cell.x > right) right = cell.x;
      if (cell.y > bottom) bottom = cell.y;
    }
    return { left: left, top: top, right: right + 1, bottom: bottom + 1 };
  }

  /**
   * Centre of the creature's whole footprint, used as the endpoint of the
   * flanking line (mirrors Foundry's `mechanicalBounds` centre).
   *
   * @param {object} unit
   * @returns {{x:number,y:number}}
   */
  function footprintCenter(unit) {
    const bounds = footprintBounds(unit);
    return {
      x: (bounds.left + bounds.right) / 2,
      y: (bounds.top + bounds.bottom) / 2,
    };
  }

  function cross(origin, a, b) {
    return (
      (a.x - origin.x) * (b.y - origin.y) -
      (a.y - origin.y) * (b.x - origin.x)
    );
  }

  function onSegment(a, b, point) {
    return (
      point.x >= Math.min(a.x, b.x) &&
      point.x <= Math.max(a.x, b.x) &&
      point.y >= Math.min(a.y, b.y) &&
      point.y <= Math.max(a.y, b.y)
    );
  }

  /**
   * Inclusive segment intersection. Endpoint/corner touches count, which is
   * required for "opposite corners" flanking.
   *
   * @param {{x:number,y:number}} a
   * @param {{x:number,y:number}} b
   * @param {{x:number,y:number}} c
   * @param {{x:number,y:number}} d
   * @returns {boolean}
   */
  function segmentsIntersect(a, b, c, d) {
    const d1 = cross(c, d, a);
    const d2 = cross(c, d, b);
    const d3 = cross(a, b, c);
    const d4 = cross(a, b, d);

    if (
      ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
    ) {
      return true;
    }
    if (d1 === 0 && onSegment(c, d, a)) return true;
    if (d2 === 0 && onSegment(c, d, b)) return true;
    if (d3 === 0 && onSegment(a, b, c)) return true;
    if (d4 === 0 && onSegment(a, b, d)) return true;
    return false;
  }

  /**
   * Whether two potential flankers lie on opposite sides of the target's whole
   * footprint. The line between their footprint centres must cross both the
   * left and right edges, or both the top and bottom edges. This is the same
   * rule Foundry PF2e uses in `TokenPF2e#onOppositeSides` and correctly treats
   * Large/Huge/Gargantuan targets whose anchor cell is not their centre.
   *
   * @param {object} target
   * @param {object} attacker
   * @param {object} ally
   * @returns {boolean}
   */
  function onOppositeSides(target, attacker, ally) {
    const bounds = footprintBounds(target);
    const centerA = footprintCenter(attacker);
    const centerB = footprintCenter(ally);

    const left = {
      a: { x: bounds.left, y: bounds.top },
      b: { x: bounds.left, y: bounds.bottom },
    };
    const right = {
      a: { x: bounds.right, y: bounds.top },
      b: { x: bounds.right, y: bounds.bottom },
    };
    const top = {
      a: { x: bounds.left, y: bounds.top },
      b: { x: bounds.right, y: bounds.top },
    };
    const bottom = {
      a: { x: bounds.left, y: bounds.bottom },
      b: { x: bounds.right, y: bounds.bottom },
    };

    const crosses = function (side) {
      return segmentsIntersect(centerA, centerB, side.a, side.b);
    };

    return (
      (crosses(left) && crosses(right)) ||
      (crosses(top) && crosses(bottom))
    );
  }

  /**
   * Adjacent means one square in any of the eight directions. Combined with the
   * distance check this covers orthogonal and diagonal 5-ft reach.
   */
  function isAdjacent(target, unit) {
    const dx = Math.abs(unit.x - target.x);
    const dy = Math.abs(unit.y - target.y);
    return Math.max(dx, dy) === 1;
  }

  /**
   * Per-creature melee reach. An explicit option overrides every creature;
   * otherwise each one uses its own weapon reach (including `reach`).
   */
  function reachOf(unit, overrideFeet) {
    if (overrideFeet !== undefined) {
      return normalizeReach(overrideFeet);
    }
    if (typeof unit.getReachFeet === "function") {
      return normalizeReach(unit.getReachFeet());
    }
    if (unit.traits !== undefined) {
      return normalizeReach(WeaponTraits.getReachFeet(unit.traits));
    }
    return DEFAULT_REACH_FEET;
  }

  /**
   * A creature can flank if it is within its own melee reach of the target.
   * Each flanker is measured with its own reach, so a 10-ft reach weapon can
   * flank from two squares away.
   */
  function canReach(target, unit, overrideFeet) {
    // Reach-aware: a 10-ft reach can flank from the second diagonal square,
    // which the raw 5-10-5 distance reports as 15 ft.
    return Distance3D.canReach(target, unit, reachOf(unit, overrideFeet));
  }

  /**
   * Opposing creatures that actually flank `target`. The attacker is included
   * implicitly and does not need to appear in `allies`, but passing the full
   * roster is safe.
   *
   * @param {object} target
   * @param {object} attacker
   * @param {object[]} allies
   * @param {object} [gridMap]
   * @param {{reachFeet?: number}} [options]
   * @returns {object[]}
   */
  function getFlankingAllies(target, attacker, allies, gridMap, options) {
    assertUnit(target, "target");
    assertUnit(attacker, "attacker");
    const roster = assertAllies(allies);
    const opts = options || {};
    const reachOverride = opts.reachFeet;

    if (isDefeated(target) || isDefeated(attacker)) {
      return [];
    }
    if (sameCreature(target, attacker) || !isHostileTo(attacker, target)) {
      return [];
    }
    if (!inBounds(gridMap, target) || !inBounds(gridMap, attacker)) {
      return [];
    }
    if (!canReach(target, attacker, reachOverride)) {
      return [];
    }

    const attackerDirection = directionFrom(target, attacker);
    if (attackerDirection.x === 0 && attackerDirection.y === 0) {
      return [];
    }

    const flankers = [];
    for (const ally of roster) {
      if (ally === null || typeof ally !== "object") {
        continue;
      }
      if (!Number.isInteger(ally.x) || !Number.isInteger(ally.y)) {
        continue;
      }
      if (sameCreature(ally, attacker) || sameCreature(ally, target)) {
        continue;
      }
      if (isDefeated(ally) || !isHostileTo(ally, target)) {
        continue;
      }
      if (!inBounds(gridMap, ally) || !canReach(target, ally, reachOverride)) {
        continue;
      }

      if (onOppositeSides(target, attacker, ally)) {
        flankers.push(ally);
      }
    }

    return flankers;
  }

  /**
   * @param {object} target
   * @param {object} attacker
   * @param {object[]} allies
   * @param {object} [gridMap]
   * @param {{reachFeet?: number}} [options]
   * @returns {boolean}
   */
  function isFlanked(target, attacker, allies, gridMap, options) {
    return getFlankingAllies(target, attacker, allies, gridMap, options).length > 0;
  }

  return Object.freeze({
    DEFAULT_REACH_FEET: DEFAULT_REACH_FEET,
    directionFrom: directionFrom,
    isOppositeDirection: isOppositeDirection,
    footprintBounds: footprintBounds,
    footprintCenter: footprintCenter,
    segmentsIntersect: segmentsIntersect,
    onOppositeSides: onOppositeSides,
    isAdjacent: isAdjacent,
    getFlankingAllies: getFlankingAllies,
    isFlanked: isFlanked,
  });
});
