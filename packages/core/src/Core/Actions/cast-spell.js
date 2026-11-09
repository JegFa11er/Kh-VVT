/**
 * PF2E REMASTERED — CAST A SPELL (HEADLESS CORE)
 *
 * One unified casting action for the Phase 12 foundation:
 *
 *   Attack spell (type "attack")
 *     - is an attack roll, so it uses the caster's current MAP and increments
 *       attacksThisTurn;
 *     - targets a Concealed/Hidden creature only after the visibility flat
 *       check;
 *     - rolls d20 + spellAttackBonus against the target's AC;
 *     - a critical success doubles the rolled damage before the target's IWR.
 *
 *   Save spell (type "save")
 *     - never uses or increments MAP;
 *     - every target (one target, or every living combatant inside a Burst)
 *       rolls the spell's save against the caster's spell DC;
 *     - damage follows the Basic Saving Throw contract and is then applied
 *       through the target's IWR pipeline.
 *
 * A spell with the "manipulate" trait provokes Reactive Strike before it
 * resolves. A critical reaction or a lethal reaction disrupts the cast: the
 * action cost is spent but no spell attack/save is made.
 *
 * All dice are injected by the host. Invalid attempts spend nothing.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Rules/spells.js"),
      require("../Grid/aoe.js"),
      require("../Rules/checks.js"),
      require("../Rules/damage.js"),
      require("../Rules/modifiers.js"),
      require("../Entities/conditions.js"),
      require("./strike.js"),
      require("./reactive-strike.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Actions = root.PF2e.Core.Actions || {};
    root.PF2e.Core.Actions.CastSpell = factory(
      root.PF2e.Core.Rules.Spells,
      root.PF2e.Core.Grid.AoE,
      root.PF2e.Core.Rules.Checks,
      root.PF2e.Core.Rules.Damage,
      root.PF2e.Core.Rules.Modifiers,
      root.PF2e.Core.Conditions,
      root.PF2e.Core.Actions.Strike,
      root.PF2e.Core.Actions.ReactiveStrike,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Spells,
  AoE,
  Checks,
  Damage,
  Modifiers,
  Conditions,
  Strike,
  ReactiveStrike,
) {
  "use strict";

  const CAST_SPELL_REASONS = Object.freeze({
    NO_ACTIONS: "no-actions",
    UNCONSCIOUS: "unconscious",
    DEFEATED: "defeated",
    INVALID_SPELL: "invalid-spell",
    INVALID_TARGET: "invalid-target",
    TARGET_DEFEATED: "target-defeated",
    TARGET_UNDETECTED: "target-undetected",
    INVALID_AREA: "invalid-area",
    DISRUPTED: "disrupted",
    NO_SPELL_SLOTS: "no-spell-slots",
    NO_FOCUS_POINTS: "no-focus-points",
    RESTRAINED_ACTION_BLOCKED: "restrained-action-blocked",
    GRABBED_MANIPULATE_FAILED: "grabbed-manipulate-failed",
  });

  const DEFAULT_ACTION_COST = 2;
  const DEFAULT_SAVE_TYPE = "reflex";
  const DEFAULT_AC = 10;

  function assertInteger(value, label) {
    if (!Number.isInteger(value)) {
      throw new TypeError(label + " must be an integer; received " + String(value) + ".");
    }
  }

  function assertCombatant(combatant, label) {
    if (
      combatant === null ||
      typeof combatant !== "object" ||
      !Number.isInteger(combatant.x) ||
      !Number.isInteger(combatant.y)
    ) {
      throw new TypeError(label + " must be a positioned Combatant.");
    }
  }

  function spellIdOf(spell) {
    return spell !== null && spell !== undefined && spell.id !== undefined
      ? spell.id
      : null;
  }

  /**
   * Spell rank in PF2e Remastered terms. `rank` is canonical; `level` is
   * accepted as the legacy alias. Spells without either field are free
   * (innate focus-like effects and the existing Phase 12 fixtures).
   *
   * @param {object} spell
   * @returns {number|null}
   */
  function spellRankOf(spell) {
    const rank = spell.rank === undefined ? spell.level : spell.rank;
    if (rank === undefined || rank === null) {
      return null;
    }
    if (!Number.isInteger(rank) || rank < 0) {
      throw new RangeError("spell.rank must be a non-negative integer.");
    }
    return rank;
  }

  /**
   * Validate the spellcasting resource required by a spell before anything is
   * spent. Resource precedence in the Remastered rules:
   *
   *   cantrip -> free (never a slot and never a Focus Point);
   *   focus    -> 1 Focus Point, no spell slot;
   *   rank     -> 1 spell slot of that rank.
   *
   * @param {object} caster
   * @param {object} spell
   * @returns {{ok:boolean,type:string,rank?:number,reason?:string}}
   */
  function resolveSpellResource(caster, spell) {
    if (Spells.hasTrait(spell, "cantrip")) {
      return { ok: true, type: "none" };
    }

    if (Spells.hasTrait(spell, "focus")) {
      const pool =
        typeof caster.getFocusPoints === "function"
          ? caster.getFocusPoints()
          : caster.focusPoints;
      const current =
        pool !== null && pool !== undefined && Number.isInteger(pool.current)
          ? pool.current
          : 0;
      if (current <= 0) {
        return {
          ok: false,
          type: "focus",
          reason: CAST_SPELL_REASONS.NO_FOCUS_POINTS,
        };
      }
      return { ok: true, type: "focus" };
    }

    const rank = spellRankOf(spell);
    if (rank === null) {
      return { ok: true, type: "none" };
    }

    let slot = null;
    if (typeof caster.getSpellSlot === "function") {
      slot = caster.getSpellSlot(rank);
    } else if (caster.spellSlots && caster.spellSlots[rank]) {
      slot = caster.spellSlots[rank];
    }
    if (slot === null || !Number.isInteger(slot.current) || slot.current <= 0) {
      return {
        ok: false,
        type: "slot",
        rank: rank,
        reason: CAST_SPELL_REASONS.NO_SPELL_SLOTS,
      };
    }
    return { ok: true, type: "slot", rank: rank };
  }

  /**
   * Decrement the validated resource. Real Combatants expose the pool helpers;
   * the direct fallback keeps lightweight host objects working.
   *
   * @param {object} caster
   * @param {object} resource result of resolveSpellResource
   * @returns {{type:string,spent:number,rank?:number,remaining?:number}}
   */
  function consumeSpellResource(caster, resource) {
    if (resource.type === "focus") {
      if (typeof caster.spendFocusPoint === "function") {
        const spent = caster.spendFocusPoint(1);
        return { type: "focus", spent: 1, remaining: spent.remaining };
      }
      if (caster.focusPoints && Number.isInteger(caster.focusPoints.current)) {
        caster.focusPoints.current -= 1;
        return {
          type: "focus",
          spent: 1,
          remaining: caster.focusPoints.current,
        };
      }
      return { type: "focus", spent: 1, remaining: 0 };
    }

    if (resource.type === "slot") {
      if (typeof caster.spendSpellSlot === "function") {
        const spent = caster.spendSpellSlot(resource.rank);
        return {
          type: "slot",
          spent: 1,
          rank: resource.rank,
          remaining: spent.remaining,
        };
      }
      if (caster.spellSlots && caster.spellSlots[resource.rank]) {
        caster.spellSlots[resource.rank].current -= 1;
        return {
          type: "slot",
          spent: 1,
          rank: resource.rank,
          remaining: caster.spellSlots[resource.rank].current,
        };
      }
      return { type: "slot", spent: 1, rank: resource.rank, remaining: 0 };
    }

    return { type: "none", spent: 0 };
  }

  /**
   * Pick the target recorded on a sustained-spell entry.
   *
   * @param {object} options
   * @param {object} plan
   * @returns {object|null}
   */
  function sustainedTargetOf(options, plan) {
    if (options.target !== undefined && options.target !== null) {
      return options.target;
    }
    if (plan !== null && plan !== undefined) {
      if (plan.target !== undefined && plan.target !== null) {
        return plan.target;
      }
      if (Array.isArray(plan.targets) && plan.targets.length > 0) {
        return plan.targets[0];
      }
    }
    return null;
  }

  /**
   * Register a just-cast sustained spell on the caster. It lasts until the end
   * of the caster's next turn: `encounter.round + 1`.
   *
   * @param {object} caster
   * @param {object} spell
   * @param {object|null} target
   * @param {object} [encounter]
   * @returns {object|null} the active-spell record, or null
   */
  function registerSustainedSpell(caster, spell, target, encounter) {
    if (!Spells.hasTrait(spell, "sustained")) {
      return null;
    }
    if (typeof caster.addSustainedSpell !== "function") {
      return null;
    }
    const round =
      encounter !== null &&
      encounter !== undefined &&
      Number.isInteger(encounter.round)
        ? encounter.round
        : Number.isInteger(caster.encounterRound)
          ? caster.encounterRound
          : 0;
    return caster.addSustainedSpell(spell, target, round + 1);
  }

  /**
   * A spell is a hostile stealth-breaking action when it makes an attack that
   * deals damage or when it requires a saving throw. Utility/attack spells with
   * no damage and no save do not reveal the caster.
   *
   * @param {object} spell
   * @returns {boolean}
   */
  function spellBreaksStealth(spell) {
    if (spell === null || typeof spell !== "object") {
      return false;
    }
    if (spell.type === Spells.SPELL_TYPES.SAVE) {
      return true;
    }
    return (
      spell.type === Spells.SPELL_TYPES.ATTACK &&
      resolveDamageSpec(spell) !== null
    );
  }

  /**
   * @param {object} caster
   * @param {object} result
   * @returns {object}
   */
  function applyHostileReveal(caster, result) {
    if (!spellBreaksStealth(result.spell)) {
      return result;
    }
    const reveal =
      typeof Conditions.revealAfterHostileAction === "function"
        ? Conditions.revealAfterHostileAction(caster)
        : { removed: [], visibility: Conditions.getVisibility(caster) };
    result.revealed = reveal.removed.length > 0;
    result.revealedConditions = reveal.removed.map(function (condition) {
      return condition.slug || condition.name;
    });
    result.visibilityAfter = reveal.visibility;
    return result;
  }

  function normalizeCost(spell) {
    const cost = spell.cost === undefined ? DEFAULT_ACTION_COST : spell.cost;
    if (!Number.isInteger(cost) || cost < 1 || cost > 3) {
      throw new RangeError("spell.cost must be an integer from 1 to 3.");
    }
    return cost;
  }

  function normalizeSpellType(spell) {
    if (spell === null || typeof spell !== "object") {
      throw new TypeError("spell must be a spell definition object.");
    }
    if (spell.type !== Spells.SPELL_TYPES.ATTACK && spell.type !== Spells.SPELL_TYPES.SAVE) {
      throw new RangeError('spell.type must be "attack" or "save".');
    }
    return spell.type;
  }

  function spellAttackBonusOf(caster) {
    return Number.isInteger(caster.spellAttackBonus) ? caster.spellAttackBonus : 0;
  }

  function spellDCOf(caster) {
    if (Number.isInteger(caster.spellDC)) {
      return caster.spellDC;
    }
    return 10 + spellAttackBonusOf(caster);
  }

  function targetACOf(target) {
    return Number.isInteger(target.ac) ? target.ac : DEFAULT_AC;
  }

  function isDead(combatant) {
    return (
      combatant.isDefeated === true ||
      (Number.isInteger(combatant.currentHP) && combatant.currentHP <= 0)
    );
  }

  function sameCreature(a, b) {
    if (a === b) {
      return true;
    }
    return (
      a !== null &&
      b !== null &&
      a !== undefined &&
      b !== undefined &&
      a.id !== undefined &&
      b.id !== undefined &&
      a.id === b.id
    );
  }

  const AREA_TYPES = Object.freeze(["burst", "cone", "line", "emanation"]);

  function areaSizeFeet(area) {
    if (area.radiusFeet !== undefined) {
      return area.radiusFeet;
    }
    if (area.radius !== undefined) {
      return area.radius;
    }
    if (area.lengthFeet !== undefined) {
      return area.lengthFeet;
    }
    return area.length;
  }

  function resolveAreaDirection(options, area, caster) {
    if (options.direction !== undefined && options.direction !== null) {
      return options.direction;
    }
    if (area.direction !== undefined && area.direction !== null) {
      return area.direction;
    }
    const origin = options.origin;
    if (
      origin !== null &&
      typeof origin === "object" &&
      Number.isInteger(origin.x) &&
      Number.isInteger(origin.y)
    ) {
      const dx = origin.x - caster.x;
      const dy = origin.y - caster.y;
      if (dx !== 0 || dy !== 0) {
        return { x: dx, y: dy };
      }
    }
    return null;
  }

  function normalizeDirectionOrNull(direction) {
    if (direction === null || direction === undefined) {
      return null;
    }
    try {
      return AoE.normalizeDirection(direction);
    } catch (error) {
      return null;
    }
  }

  /**
   * Spell damage contract: a formula string or `{ formula, type }` object.
   *
   * @param {object} spell
   * @returns {{formula:string,type:string}|null}
   */
  function resolveDamageSpec(spell) {
    if (spell.damage === undefined || spell.damage === null) {
      return null;
    }
    return Damage.parseDamageSpec(spell.damage, spell.damageType);
  }

  function rollSpellDamage(spell, rollDamageDie) {
    const spec = resolveDamageSpec(spell);
    if (spec === null) {
      return null;
    }
    return Damage.rollDamage({
      formula: spec.formula,
      type: spec.type,
      rollDie: rollDamageDie,
    });
  }

  /**
   * Effective save modifier through the shared typed-modifier resolver
   * (Frightened and other save-scoped conditions included).
   *
   * @param {object} target
   * @param {string} saveType
   * @returns {number}
   */
  function resolveSaveModifier(target, saveType) {
    const base =
      typeof target.getSaveModifier === "function"
        ? target.getSaveModifier(saveType)
        : target.saves && Number.isInteger(target.saves[saveType])
          ? target.saves[saveType]
          : 0;
    const modifiers =
      typeof target.getSaveModifiers === "function"
        ? target.getSaveModifiers(saveType)
        : [];
    return Modifiers.resolveModifiers(base, modifiers).total;
  }

  function incrementAttacks(caster) {
    caster.attacksThisTurn = Number.isInteger(caster.attacksThisTurn)
      ? caster.attacksThisTurn + 1
      : 1;
    return caster.attacksThisTurn;
  }

  /**
   * Resolve the manipulate-trait Reactive Strike window, mirroring the ranged
   * Strike flow. The caster's reach geometry is supplied by Reactive Strike.
   *
   * @param {object} options
   * @param {object} caster
   * @param {object} spell
   * @returns {{disrupted:boolean,reactions:object[],threats:object[]}}
   */
  function resolveManipulateReactions(options, caster, spell) {
    if (!Spells.hasTrait(spell, "manipulate")) {
      return { disrupted: false, reactions: [], threats: [] };
    }
    const combatants = Array.isArray(options.combatants)
      ? options.combatants
      : [];
    if (combatants.length === 0 || !ReactiveStrike) {
      return { disrupted: false, reactions: [], threats: [] };
    }

    const cell =
      caster.position !== undefined && caster.position !== null
        ? caster.position
        : { x: caster.x, y: caster.y };

    const threats = ReactiveStrike.findThreatenedEnemies({
      mover: caster,
      cell: cell,
      combatants: combatants,
      reachFeet: options.reactionReachFeet,
    });

    const reactions = [];
    let disrupted = false;

    for (const threat of threats) {
      const reaction = ReactiveStrike.performReactiveStrike({
        attacker: threat,
        target: caster,
        map: options.map,
        combatants: combatants,
        allies: options.allies,
        rollD20:
          typeof options.rollReactionD20 === "function"
            ? options.rollReactionD20
            : options.rollD20,
        rollDamageDie:
          typeof options.rollReactionDamageDie === "function"
            ? options.rollReactionDamageDie
            : options.rollDamageDie,
        rollDie:
          typeof options.rollReactionDie === "function"
            ? options.rollReactionDie
            : options.rollDie,
      });
      reactions.push(reaction);

      if (
        reaction.ok === true &&
        (reaction.critical === true || isDead(caster))
      ) {
        disrupted = true;
        break;
      }
    }

    return { disrupted: disrupted, reactions: reactions, threats: threats };
  }

  /**
   * Determine the target list before any action is spent.
   *
   * @param {object} options
   * @param {object} caster
   * @param {object} spell
   * @returns {object} a validation result with `ok` and, on success, targets
   */
  function buildTargetPlan(options, caster, spell) {
    const type = spell.type;

    if (type === Spells.SPELL_TYPES.ATTACK) {
      const target = options.target;
      if (target === undefined || target === null || target === caster || sameCreature(target, caster)) {
        return { ok: false, reason: CAST_SPELL_REASONS.INVALID_TARGET };
      }
      if (isDead(target)) {
        return { ok: false, reason: CAST_SPELL_REASONS.TARGET_DEFEATED };
      }
      const visibility = Conditions.getVisibility(target);
      if (visibility.undetected) {
        return {
          ok: false,
          reason: CAST_SPELL_REASONS.TARGET_UNDETECTED,
          visibility: visibility,
        };
      }
      return { ok: true, targets: [target], target: target };
    }

    // Save spell: an area overrides single-target selection. Burst, cone,
    // line, and emanation all share the canonical Phase 16 geometry; only the
    // anchor/direction differ.
    if (spell.area !== undefined && spell.area !== null) {
      const area = spell.area;
      const areaType = area.type === undefined ? "burst" : String(area.type).toLowerCase();
      if (AREA_TYPES.indexOf(areaType) === -1) {
        return {
          ok: false,
          reason: CAST_SPELL_REASONS.INVALID_AREA,
          areaType: areaType,
        };
      }

      const sizeFeet = areaSizeFeet(area);
      if (
        !Number.isInteger(sizeFeet) ||
        sizeFeet < 0 ||
        sizeFeet % 5 !== 0
      ) {
        return {
          ok: false,
          reason: CAST_SPELL_REASONS.INVALID_AREA,
          radiusFeet: sizeFeet,
          lengthFeet: sizeFeet,
        };
      }

      const roster =
        Array.isArray(options.combatants) && options.combatants.length > 0
          ? options.combatants
          : options.target !== undefined && options.target !== null
            ? [options.target]
            : [];

      let cells;
      let anchor;
      let direction = null;

      if (areaType === "emanation") {
        anchor = { x: caster.x, y: caster.y };
        cells = AoE.getEmanationCells(caster, sizeFeet, options.map);
      } else if (areaType === "burst") {
        let origin = options.origin;
        if (
          origin === undefined &&
          options.target !== undefined &&
          options.target !== null
        ) {
          origin = { x: options.target.x, y: options.target.y };
        }
        if (
          origin === null ||
          typeof origin !== "object" ||
          !Number.isInteger(origin.x) ||
          !Number.isInteger(origin.y)
        ) {
          return { ok: false, reason: CAST_SPELL_REASONS.INVALID_AREA };
        }
        anchor = { x: origin.x, y: origin.y };
        cells = AoE.getBurstCells(anchor, sizeFeet, options.map);
      } else {
        direction = normalizeDirectionOrNull(
          resolveAreaDirection(options, area, caster),
        );
        if (direction === null) {
          return { ok: false, reason: CAST_SPELL_REASONS.INVALID_AREA };
        }
        anchor = { x: caster.x, y: caster.y };
        cells =
          areaType === "cone"
            ? AoE.getConeCells(anchor, direction, sizeFeet, options.map)
            : AoE.getLineCells(
                anchor,
                direction,
                sizeFeet,
                area.widthFeet === undefined ? 5 : area.widthFeet,
                options.map,
              );
      }

      const targets = AoE.getTargetsInArea(cells, roster);

      return {
        ok: true,
        targets: targets,
        cells: cells,
        area: {
          type: areaType,
          origin: anchor,
          direction: direction,
          radiusFeet: areaType === "line" ? undefined : sizeFeet,
          lengthFeet: areaType === "line" || areaType === "cone" ? sizeFeet : undefined,
          cells: cells,
        },
      };
    }

    const target = options.target;
    if (target === undefined || target === null) {
      return { ok: false, reason: CAST_SPELL_REASONS.INVALID_TARGET };
    }
    if (isDead(target)) {
      return { ok: false, reason: CAST_SPELL_REASONS.TARGET_DEFEATED };
    }
    return { ok: true, targets: [target], target: target };
  }

  /**
   * Attack spell resolution. MAP is used and consumed because the spell has
   * the attack trait.
   */
  function resolveAttackSpell(options, caster, spell, cost, reactionPhase) {
    const target = options.target;
    const mapPenalty =
      typeof caster.getMultipleAttackPenalty === "function"
        ? caster.getMultipleAttackPenalty(spell.agile === true)
        : 0;

    const visibility = Conditions.getVisibility(target);
    let flatCheck = null;
    if (visibility.condition && visibility.flatCheckDC !== null) {
      flatCheck = Strike.rollVisibilityFlatCheck(
        options,
        visibility.flatCheckDC,
        visibility.condition,
      );
      if (!flatCheck.passed) {
        caster.spendActions(cost);
        incrementAttacks(caster);
        const missResult = {
          targetId: target.id,
          targetName: target.name,
          type: "attack",
          automaticMiss: true,
          flatCheck: flatCheck,
          visibility: visibility,
          hit: false,
          critical: false,
          degree: null,
          damage: null,
          damageDealt: 0,
          hpBefore: Number.isInteger(target.currentHP) ? target.currentHP : null,
          hpAfter: Number.isInteger(target.currentHP) ? target.currentHP : null,
          targetDefeated: target.isDefeated === true,
        };
        return {
          ok: true,
          spell: spell,
          spellId: spellIdOf(spell),
          casterId: caster.id,
          type: "attack",
          results: [missResult],
          automaticMiss: true,
          targetId: target.id,
          hit: false,
          critical: false,
          degree: null,
          attacksThisTurn: caster.attacksThisTurn,
          mapPenalty: mapPenalty,
          actionsLeft: caster.actionsRemaining,
          reactionStrikes: reactionPhase.reactions,
          reactionThreats: reactionPhase.threats,
        };
      }
    }

    const attackModifiers = Strike.collectAttackModifiers(caster, mapPenalty);
    const attackResolution = Modifiers.resolveModifiers(
      spellAttackBonusOf(caster),
      attackModifiers,
    );
    const defenseModifiers = Strike.collectDefenseModifiers(
      target,
      false,
      null,
      false,
    );
    const defenseResolution = Modifiers.resolveModifiers(
      targetACOf(target),
      defenseModifiers,
    );

    const d20 = Strike.rollAttack(options);
    const check = Checks.evaluateCheck({
      d20: d20,
      modifier: attackResolution.total,
      dc: defenseResolution.total,
    });

    const hit =
      check.degree === Checks.DEGREES.SUCCESS ||
      check.degree === Checks.DEGREES.CRITICAL_SUCCESS;
    const critical = check.degree === Checks.DEGREES.CRITICAL_SUCCESS;

    const hpBefore = Number.isInteger(target.currentHP) ? target.currentHP : null;
    let rolledDamage = null;
    let applied = null;
    let damageDealt = 0;

    if (hit) {
      rolledDamage = rollSpellDamage(spell, options.rollDamageDie);
      if (rolledDamage !== null) {
        const amount = critical ? rolledDamage.total * 2 : rolledDamage.total;
        if (amount > 0) {
          applied = target.takeDamage(amount, {
            type: rolledDamage.type,
            isCrit: critical,
          });
          damageDealt =
            applied.damageApplied === undefined ? amount : applied.damageApplied;
        }
      }
    }

    caster.spendActions(cost);
    incrementAttacks(caster);

    const result = {
      targetId: target.id,
      targetName: target.name,
      type: "attack",
      flatCheck: flatCheck,
      visibility: visibility,
      attackRoll: d20,
      d20: d20,
      attackBonus: spellAttackBonusOf(caster),
      attackModifier: attackResolution.total,
      attackModifiers: attackResolution.effectiveModifiers,
      mapPenalty: mapPenalty,
      total: check.total,
      dc: defenseResolution.total,
      targetAC: defenseResolution.total,
      targetACBase: targetACOf(target),
      degree: check.degree,
      isNatural20: check.isNatural20,
      isNatural1: check.isNatural1,
      hit: hit,
      critical: critical,
      damageRoll: rolledDamage,
      damage: rolledDamage,
      damageDealt: damageDealt,
      hpBefore: hpBefore,
      hpAfter: Number.isInteger(target.currentHP) ? target.currentHP : null,
      targetDefeated: target.isDefeated === true,
      iwr: applied === null ? null : applied.iwr,
    };

    return {
      ok: true,
      spell: spell,
      spellId: spellIdOf(spell),
      casterId: caster.id,
      type: "attack",
      results: [result],
      // Convenience mirrors for single-target callers and the combat log.
      targetId: target.id,
      attackRoll: d20,
      degree: check.degree,
      hit: hit,
      critical: critical,
      damage: rolledDamage,
      damageDealt: damageDealt,
      hpBefore: hpBefore,
      hpAfter: result.hpAfter,
      targetDefeated: result.targetDefeated,
      attacksThisTurn: caster.attacksThisTurn,
      mapPenalty: mapPenalty,
      actionsLeft: caster.actionsRemaining,
      reactionStrikes: reactionPhase.reactions,
      reactionThreats: reactionPhase.threats,
    };
  }

  /**
   * Save spell resolution: one damage roll, one independent save per target.
   */
  function resolveSaveSpell(options, caster, spell, cost, plan, reactionPhase) {
    const saveType = Spells.normalizeSaveType(
      spell.saveType === undefined ? DEFAULT_SAVE_TYPE : spell.saveType,
    );
    const saveDC = spellDCOf(caster);
    const rolledDamage = rollSpellDamage(spell, options.rollDamageDie);
    const rawDamage = rolledDamage === null ? 0 : rolledDamage.total;

    const results = [];
    for (const target of plan.targets) {
      if (isDead(target)) {
        continue;
      }

      const d20 = Strike.rollAttack(options);
      const saveModifier = resolveSaveModifier(target, saveType);
      const save = Spells.evaluateBasicSave({
        saveRoll: d20,
        saveModifier: saveModifier,
        saveDC: saveDC,
        rawDamage: rawDamage,
      });

      const hpBefore = Number.isInteger(target.currentHP) ? target.currentHP : null;
      let applied = null;
      if (save.damage > 0) {
        applied = target.takeDamage(save.damage, {
          type: rolledDamage === null ? "untyped" : rolledDamage.type,
          isCrit:
            save.degree === Checks.DEGREES.CRITICAL_FAILURE,
        });
      }

      results.push({
        targetId: target.id,
        targetName: target.name,
        type: "save",
        saveType: saveType,
        d20: d20,
        saveRoll: d20,
        saveModifier: saveModifier,
        saveTotal: d20 + saveModifier,
        saveDC: saveDC,
        degree: save.degree,
        isNatural20: save.isNatural20,
        isNatural1: save.isNatural1,
        damageMultiplier: save.damageMultiplier,
        rawDamage: rawDamage,
        damage: save.damage,
        finalDamage: save.damage,
        damageDealt: applied === null ? 0 : applied.damageApplied,
        hpBefore: hpBefore,
        hpAfter: Number.isInteger(target.currentHP) ? target.currentHP : null,
        targetDefeated: target.isDefeated === true,
        iwr: applied === null ? null : applied.iwr,
      });
    }

    caster.spendActions(cost);

    return {
      ok: true,
      spell: spell,
      spellId: spellIdOf(spell),
      casterId: caster.id,
      type: "save",
      saveType: saveType,
      spellDC: saveDC,
      rawDamage: rawDamage,
      results: results,
      area: plan.area === undefined ? null : plan.area,
      actionsLeft: caster.actionsRemaining,
      reactionStrikes: reactionPhase.reactions,
      reactionThreats: reactionPhase.threats,
    };
  }

  /**
   * Cast one spell.
   *
   * @param {{
   *   caster: object,
   *   spell: object,
   *   target?: object,
   *   origin?: {x:number,y:number},
   *   combatants?: object[],
   *   map?: object,
   *   rollD20?: () => number,
   *   rollDamageDie?: (sides:number) => number,
   *   rollDie?: (sides:number) => number,
   *   rollFlatCheck?: () => number,
   *   rollReactionD20?: () => number,
   *   rollReactionDamageDie?: (sides:number) => number,
   *   reactionReachFeet?: number
   * }} options
   * @returns {object}
   */
  function performCastSpell(options) {
    const opts = options || {};
    const caster = opts.caster;
    const spell = opts.spell;

    assertCombatant(caster, "caster");
    if (typeof caster.spendActions !== "function") {
      throw new TypeError("Cast a Spell requires a Combatant with an action pool.");
    }

    const type = normalizeSpellType(spell);
    const cost = normalizeCost(spell);

    // Traits of this cast, used by the Grabbed/Restrained gates. An attack
    // spell is an attack-trait action; a spell with the manipulate trait
    // (i.e. not Subtle) is a manipulate action.
    const actionTraits = [];
    if (Spells.hasTrait(spell, "manipulate")) {
      actionTraits.push("manipulate");
    }
    if (type === Spells.SPELL_TYPES.ATTACK) {
      actionTraits.push("attack");
    }

    if (typeof caster.canAct === "function") {
      const canAct = caster.canAct({
        traits: actionTraits,
        action: "cast-spell",
      });
      if (!canAct.ok) {
        let reason = CAST_SPELL_REASONS.UNCONSCIOUS;
        if (canAct.reason === "defeated") {
          reason = CAST_SPELL_REASONS.DEFEATED;
        } else if (canAct.reason === "restrained-action-blocked") {
          reason = CAST_SPELL_REASONS.RESTRAINED_ACTION_BLOCKED;
        }
        return {
          ok: false,
          reason: reason,
          canActReason: canAct.reason,
          spell: spell,
          spellId: spellIdOf(spell),
          casterId: caster.id,
          results: [],
        };
      }
    } else if (isDead(caster) || (caster.hasCondition && caster.hasCondition("unconscious"))) {
      return {
        ok: false,
        reason: isDead(caster)
          ? CAST_SPELL_REASONS.DEFEATED
          : CAST_SPELL_REASONS.UNCONSCIOUS,
        spell: spell,
        spellId: spellIdOf(spell),
        casterId: caster.id,
        results: [],
      };
    }

    const actionsRemaining = Number.isInteger(caster.actionsRemaining)
      ? caster.actionsRemaining
      : 0;
    if (actionsRemaining < cost) {
      return {
        ok: false,
        reason: CAST_SPELL_REASONS.NO_ACTIONS,
        spell: spell,
        spellId: spellIdOf(spell),
        casterId: caster.id,
        requiredActions: cost,
        actionsRemaining: actionsRemaining,
        results: [],
      };
    }

    // Validate spellcasting resources before dice or targeting. A rejected
    // cast costs no slot, no Focus Point, and no action.
    const resource = resolveSpellResource(caster, spell);
    if (!resource.ok) {
      return {
        ok: false,
        reason: resource.reason,
        resourceType: resource.type,
        rank: resource.rank === undefined ? null : resource.rank,
        spell: spell,
        spellId: spellIdOf(spell),
        casterId: caster.id,
        results: [],
      };
    }

    // Validate targeting and area geometry before provoking reactions or
    // spending dice. A rejected cast costs nothing.
    const plan = buildTargetPlan(opts, caster, spell);
    if (!plan.ok) {
      return Object.assign(
        {
          ok: false,
          spell: spell,
          spellId: spellIdOf(spell),
          casterId: caster.id,
          results: [],
        },
        plan,
      );
    }

    // Grabbed: a manipulate action needs a successful DC 5 flat check or the
    // action is lost ("grabbed-manipulate-failed"). The action cost is spent;
    // the spell itself was never cast, so no slot/Focus Point is consumed.
    if (typeof caster.resolveGrabbedManipulate === "function") {
      const grabCheck = caster.resolveGrabbedManipulate({
        traits: actionTraits,
        d20: opts.d20,
        rollFlatCheck: opts.rollFlatCheck,
        rollD20: opts.rollD20,
        rollDie: opts.rollDie,
      });
      if (grabCheck.required && !grabCheck.passed) {
        caster.spendActions(cost);
        return {
          ok: false,
          reason: CAST_SPELL_REASONS.GRABBED_MANIPULATE_FAILED,
          flatCheck: grabCheck.flatCheck,
          spell: spell,
          spellId: spellIdOf(spell),
          casterId: caster.id,
          results: [],
          actionsLeft: caster.actionsRemaining,
        };
      }
    }

    // A manipulate spell provokes before any attack/save is resolved.
    const reactionPhase = resolveManipulateReactions(opts, caster, spell);
    if (reactionPhase.disrupted) {
      caster.spendActions(cost);
      // A disrupted cast loses the prepared spell/focus, matching PF2e's
      // "the spell is disrupted" outcome.
      const disruptedResourceCost = consumeSpellResource(caster, resource);
      return {
        ok: false,
        disrupted: true,
        reason: CAST_SPELL_REASONS.DISRUPTED,
        spell: spell,
        spellId: spellIdOf(spell),
        casterId: caster.id,
        results: [],
        resourceCost: disruptedResourceCost,
        reactionStrikes: reactionPhase.reactions,
        reactionStrike:
          reactionPhase.reactions.length > 0
            ? reactionPhase.reactions[reactionPhase.reactions.length - 1]
            : null,
        reactionThreats: reactionPhase.threats,
        casterDefeated: caster.isDefeated === true,
        actionsLeft: caster.actionsRemaining,
      };
    }

    const resourceCost = consumeSpellResource(caster, resource);

    let result;
    if (type === Spells.SPELL_TYPES.ATTACK) {
      result = resolveAttackSpell(opts, caster, spell, cost, reactionPhase);
    } else {
      result = resolveSaveSpell(opts, caster, spell, cost, plan, reactionPhase);
    }

    result.resourceCost = resourceCost;
    const sustained = registerSustainedSpell(
      caster,
      spell,
      sustainedTargetOf(opts, plan),
      opts.encounter,
    );
    if (sustained !== null) {
      result.sustainedSpell = sustained;
    }
    return applyHostileReveal(caster, result);
  }

  return Object.freeze({
    CAST_SPELL_REASONS: CAST_SPELL_REASONS,
    DEFAULT_ACTION_COST: DEFAULT_ACTION_COST,
    DEFAULT_SAVE_TYPE: DEFAULT_SAVE_TYPE,
    spellRankOf: spellRankOf,
    resolveSpellResource: resolveSpellResource,
    consumeSpellResource: consumeSpellResource,
    registerSustainedSpell: registerSustainedSpell,
    resolveDamageSpec: resolveDamageSpec,
    rollSpellDamage: rollSpellDamage,
    resolveSaveModifier: resolveSaveModifier,
    buildTargetPlan: buildTargetPlan,
    performCastSpell: performCastSpell,
  });
});
