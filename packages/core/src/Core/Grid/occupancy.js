/**
 * PF2E REMASTERED — CREATURE OCCUPANCY (HEADLESS CORE)
 *
 * Translates combatant factions into the two cell sets used by pathfinding:
 *
 *   blockedCells      — enemies of the mover; the search cannot enter them.
 *   passThroughCells  — allies of the mover; the search may cross them but
 *                       must not end the move there.
 *
 * Creature occupancy does not feed the diagonal corner rule; only solid map
 * obstacles do. This keeps the "block-any" policy about walls, not bodies.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Occupancy = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ALLIANCES = Object.freeze({
    PLAYER: "player",
    ENEMY: "enemy",
  });

  function assertCombatant(combatant, label) {
    if (
      combatant === null ||
      typeof combatant !== "object" ||
      !Number.isInteger(combatant.x) ||
      !Number.isInteger(combatant.y)
    ) {
      throw new TypeError(label + " must be a positioned combatant.");
    }
  }

  function allianceOf(combatant) {
    return combatant.alliance === undefined ? ALLIANCES.PLAYER : combatant.alliance;
  }

  function cellKey(cell) {
    return cell.x + "," + cell.y;
  }

  function copyCell(cell) {
    return { x: cell.x, y: cell.y };
  }

  /**
   * Every cell a creature occupies. Medium (or unauthored) creatures use a
   * single cell; Large/Huge creatures expose a 2x2/3x3 footprint.
   *
   * @param {object} combatant
   * @returns {{x:number,y:number}[]}
   */
  function occupiedCellsOf(combatant) {
    if (typeof combatant.getOccupiedCells === "function") {
      return combatant.getOccupiedCells();
    }
    return [{ x: combatant.x, y: combatant.y }];
  }

  function footprintOf(combatant) {
    if (typeof combatant.getFootprint === "function") {
      return combatant.getFootprint();
    }
    return 1;
  }

  /**
   * Build occupancy sets for one mover.
   *
   * @param {object[]} combatants
   * @param {object} mover
   * @returns {{blockedCells: {x:number,y:number}[], passThroughCells: {x:number,y:number}[]}}
   */
  function buildOccupancy(combatants, mover) {
    if (!Array.isArray(combatants)) {
      throw new TypeError("combatants must be an array.");
    }
    assertCombatant(mover, "mover");

    const moverAlliance = allianceOf(mover);
    const moverCellKeys = new Set(occupiedCellsOf(mover).map(cellKey));
    const blockedCells = [];
    const passThroughCells = [];

    for (const combatant of combatants) {
      assertCombatant(combatant, "combatant");
      if (combatant === mover) {
        continue;
      }
      if (combatant.id !== undefined && combatant.id === mover.id) {
        continue;
      }
      if (combatant.x === mover.x && combatant.y === mover.y) {
        continue;
      }

      const target = allianceOf(combatant) === moverAlliance
        ? passThroughCells
        : blockedCells;
      for (const cell of occupiedCellsOf(combatant)) {
        if (moverCellKeys.has(cellKey(cell))) {
          continue;
        }
        target.push(copyCell(cell));
      }
    }

    return Object.freeze({
      blockedCells: Object.freeze(blockedCells),
      passThroughCells: Object.freeze(passThroughCells),
    });
  }

  /**
   * Whether a creature's entire footprint can occupy the square anchored at
   * (x, y) without entering a wall/out-of-bounds cell or another living
   * creature. Used by movement validation and Stride.
   *
   * @param {number} x top-left anchor column
   * @param {number} y top-left anchor row
   * @param {object} combatant moving creature
   * @param {object} gridMap GridMap instance
   * @param {object[]} [allCombatants]
   * @returns {boolean}
   */
  function canOccupySpace(x, y, combatant, gridMap, allCombatants) {
    assertCombatant(combatant, "combatant");
    if (!gridMap || typeof gridMap.isBlocked !== "function") {
      throw new TypeError("canOccupySpace requires a GridMap.");
    }

    const others = Array.isArray(allCombatants) ? allCombatants : [];
    const footprint = footprintOf(combatant);

    for (let dx = 0; dx < footprint; dx += 1) {
      for (let dy = 0; dy < footprint; dy += 1) {
        const checkX = x + dx;
        const checkY = y + dy;

        // 1. Bounds and walls.
        if (gridMap.isBlocked(checkX, checkY)) {
          return false;
        }

        // 2. Other living creatures (never the mover itself).
        const occupiedByOther = others.some(function (candidate) {
          if (candidate === null || typeof candidate !== "object") {
            return false;
          }
          if (candidate === combatant) {
            return false;
          }
          if (
            combatant.id !== undefined &&
            candidate.id !== undefined &&
            candidate.id === combatant.id
          ) {
            return false;
          }
          if (candidate.isDefeated === true) {
            return false;
          }
          return occupiedCellsOf(candidate).some(function (cell) {
            return cell.x === checkX && cell.y === checkY;
          });
        });

        if (occupiedByOther) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * @param {{x:number,y:number}[]} cells
   * @param {{x:number,y:number}} cell
   * @returns {boolean}
   */
  function containsCell(cells, cell) {
    return cells.some(function (candidate) {
      return candidate.x === cell.x && candidate.y === cell.y;
    });
  }

  return Object.freeze({
    ALLIANCES: ALLIANCES,
    buildOccupancy: buildOccupancy,
    containsCell: containsCell,
    occupiedCellsOf: occupiedCellsOf,
    footprintOf: footprintOf,
    canOccupySpace: canOccupySpace,
  });
});
