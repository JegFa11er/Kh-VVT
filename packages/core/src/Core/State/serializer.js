/**
 * PF2E REMASTERED — COMBAT STATE SERIALIZATION (HEADLESS CORE)
 *
 * Deterministic save/restore for a complete encounter:
 *   - Encounter clock, active combatant, initiative queue and registration;
 *   - GridMap bounds, walls, terrain classes, hazardous cells, illumination;
 *   - Every Combatant (HP, position, equipment, conditions, afflictions,
 *     spell resources, sustained spells, action/reaction pools, IWR, ...);
 *   - Hazards (armed/broken state, HP, trigger area, reaction profile).
 *
 * `serializeCombatState` returns a pure JSON object. `deserializeCombatState`
 * rebuilds live `Encounter`, `GridMap`, `Combatant`, and `Hazard` instances
 * with all methods intact, ready to continue combat.
 *
 * The round-trip contract is exact: serializing a deserialized state produces
 * a deep-equal object.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Encounter/encounter.js"),
      require("../Grid/grid-map.js"),
      require("../Entities/combatant.js"),
      require("../Entities/hazard.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.State = root.PF2e.Core.State || {};
    root.PF2e.Core.State.Serializer = factory(
      root.PF2e.Core.Encounter,
      root.PF2e.Core.GridMap,
      root.PF2e.Core.Combatant,
      root.PF2e.Core.Hazard,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Encounter,
  GridMap,
  Combatant,
  Hazard,
) {
  "use strict";

  const SERIALIZATION_VERSION = 1;

  function assertObject(value, label) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError(label + " must be an object.");
    }
    return value;
  }

  /**
   * Deep-copy plain authored data (spell definitions, inventory records,
   * reactions). Functions and undefined values are dropped, matching JSON.
   *
   * @param {*} value
   * @returns {*}
   */
  function clonePlain(value) {
    if (value === null || typeof value !== "object") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(clonePlain);
    }
    const result = {};
    for (const key of Object.keys(value)) {
      if (value[key] === undefined) {
        continue;
      }
      result[key] = clonePlain(value[key]);
    }
    return result;
  }

  function itemId(item) {
    if (item === null || item === undefined) {
      return null;
    }
    if (typeof item === "string") {
      return item;
    }
    return typeof item.id === "string" ? item.id : null;
  }

  function sortedCells(cells) {
    return (cells || [])
      .map(function (cell) {
        return { x: cell.x, y: cell.y };
      })
      .sort(function (a, b) {
        return a.y - b.y || a.x - b.x;
      });
  }

  // ------------------------------------------------------------- serialization

  function serializeCondition(condition) {
    return {
      name: condition.name,
      value: condition.value === undefined ? null : condition.value,
      sourceId: condition.sourceId === undefined ? null : condition.sourceId,
      expiresOnSourceTurn:
        condition.expiresOnSourceTurn === undefined
          ? null
          : condition.expiresOnSourceTurn,
      duration: condition.duration === undefined ? null : condition.duration,
      durationOrigin:
        condition.durationOrigin === undefined
          ? null
          : condition.durationOrigin,
      appliedRound:
        condition.appliedRound === undefined ? null : condition.appliedRound,
    };
  }

  function serializeCombatant(combatant) {
    assertObject(combatant, "combatant");
    const hands =
      combatant.hands !== null && typeof combatant.hands === "object"
        ? combatant.hands
        : { mainHand: null, offHand: null };
    const weapon =
      combatant.weapon !== null && typeof combatant.weapon === "object"
        ? combatant.weapon
        : {};

    return {
      id: combatant.id,
      name: combatant.name,
      alliance: combatant.alliance,
      allianceExplicit: combatant.allianceExplicit === true,
      initiative: combatant.initiative,
      initiativeRoll: Number.isInteger(combatant.initiativeRoll)
        ? combatant.initiativeRoll
        : null,
      initiativeStatistic:
        typeof combatant.initiativeStatistic === "string"
          ? combatant.initiativeStatistic
          : null,
      initiativeModifier: Number.isInteger(combatant.initiativeModifier)
        ? combatant.initiativeModifier
        : null,
      x: combatant.x,
      y: combatant.y,
      elevation: combatant.elevation,
      speedFeet: combatant.speedFeet,
      maxActions: combatant.maxActions,
      actionsRemaining: combatant.actionsRemaining,
      maxReactions: combatant.maxReactions,
      reactionsRemaining: combatant.reactionsRemaining,
      diagonalStepsThisTurn: combatant.diagonalStepsThisTurn,
      maxHP: combatant.maxHP,
      currentHP: combatant.currentHP,
      ac: combatant.ac,
      attackBonus: combatant.attackBonus,
      spellAttackBonus: combatant.spellAttackBonus,
      spellDC: combatant.spellDC,
      spells: clonePlain(combatant.spells),
      spellSlots: combatant.getSpellSlots(),
      focusPoints: combatant.getFocusPoints(),
      activeSustainedSpells: combatant.getActiveSustainedSpells().map(
        function (entry) {
          return {
            id: entry.id,
            spellId: entry.spellId === undefined ? null : entry.spellId,
            spell: clonePlain(entry.spell),
            targetId: itemId(entry.target),
            expiresAtRound:
              entry.expiresAtRound === undefined ? null : entry.expiresAtRound,
          };
        },
      ),
      saves: combatant.getSaves(),
      skills: combatant.getSkills(),
      damage: {
        formula: combatant.damage,
        type: combatant.damageType,
      },
      traits: combatant.getTraits(),
      immunities: clonePlain(combatant.immunities),
      weaknesses: clonePlain(combatant.weaknesses),
      resistances: clonePlain(combatant.resistances),
      agile: combatant.agile,
      attacksThisTurn: combatant.attacksThisTurn,
      isDefeated: combatant.isDefeated === true,
      conditions: combatant.getConditions().map(serializeCondition),
      persistentDamage: clonePlain(combatant.getPersistentDamage()),
      afflictions: clonePlain(combatant.getAfflictions()),
      turnNumber: combatant.turnNumber,
      encounterRound: combatant.encounterRound,
      size: combatant.size,
      senses: combatant.getSenses(),
      isLoaded: combatant.isLoaded,
      rangeIncrement:
        weapon.rangeIncrement === undefined ? null : weapon.rangeIncrement,
      reload: weapon.reload === undefined ? 0 : weapon.reload,
      volley: weapon.volley === undefined ? null : weapon.volley,
      inventory: clonePlain(combatant.inventory),
      shield:
        combatant.shield === null || combatant.shield === undefined
          ? null
          : clonePlain(combatant.shield),
      hands: {
        mainHand: itemId(hands.mainHand),
        offHand: itemId(hands.offHand),
      },
    };
  }

  function serializeMap(map) {
    assertObject(map, "map");
    const illumination = []
      .concat(
        map.getIlluminationCells(GridMap.ILLUMINATION_LEVELS.DIM),
        map.getIlluminationCells(GridMap.ILLUMINATION_LEVELS.DARKNESS),
      )
      .map(function (cell) {
        return {
          x: cell.x,
          y: cell.y,
          level: map.getIllumination(cell.x, cell.y),
        };
      })
      .sort(function (a, b) {
        return a.y - b.y || a.x - b.x;
      });

    return {
      cols: map.cols,
      rows: map.rows,
      blocked: sortedCells(map.getBlockedCells()),
      difficult: sortedCells(map.getDifficultTerrainCells()),
      greaterDifficult: sortedCells(map.getGreaterDifficultTerrainCells()),
      hazardous: map.getHazardousCells().map(function (cell) {
        return { x: cell.x, y: cell.y, damage: cell.damage, type: cell.type };
      }),
      illumination: illumination,
    };
  }

  function serializeHazard(hazard) {
    assertObject(hazard, "hazard");
    return {
      id: hazard.id,
      name: hazard.name,
      stealthDC: hazard.stealthDC,
      disableDC: hazard.disableDC,
      disableSkill: hazard.disableSkill,
      hp: hazard.hp,
      maxHP: hazard.maxHP,
      hardness: hazard.hardness,
      brokenThreshold: hazard.brokenThreshold,
      isBroken: hazard.isBroken === true,
      isArmed: hazard.isArmed === true,
      reset: hazard.reset === true,
      triggerArea: hazard.getTriggerArea(),
      reaction: hazard.getReaction(),
    };
  }

  function serializeEncounter(encounter) {
    assertObject(encounter, "encounter");
    const order =
      typeof encounter.getOrder === "function"
        ? encounter.getOrder()
        : encounter.combatants.slice();
    const active =
      typeof encounter.activeCombatant !== "undefined"
        ? encounter.activeCombatant
        : null;
    const orderIds = new Set(
      order.map(function (combatant) {
        return combatant.id;
      }),
    );
    const registration =
      encounter.registration instanceof Map
        ? Array.from(encounter.registration.keys()).filter(function (id) {
            return orderIds.has(id);
          })
        : Array.from(orderIds);

    return {
      round: encounter.round,
      turnIndex: encounter.activeCombatantIndex,
      started: encounter.started === true,
      over: encounter.over === true,
      activeCombatantIndex: encounter.activeCombatantIndex,
      activeCombatantId: active ? active.id : null,
      order: order.map(function (combatant) {
        return combatant.id;
      }),
      registrationOrder: registration.slice(),
    };
  }

  /**
   * Snapshot the complete combat state as a pure JSON object.
   *
   * @param {{
   *   encounter: object,
   *   map?: object,
   *   combatants?: object[],
   *   hazards?: object[]
   * }} options
   * @returns {object}
   */
  function serializeCombatState(options) {
    const opts = options || {};
    const encounter = assertObject(opts.encounter, "encounter");
    const combatants = Array.isArray(opts.combatants)
      ? opts.combatants
      : typeof encounter.getOrder === "function"
        ? encounter.getOrder()
        : encounter.combatants;
    const hazards = opts.hazards === undefined ? [] : opts.hazards;
    if (!Array.isArray(hazards)) {
      throw new TypeError("hazards must be an array.");
    }

    return {
      version: SERIALIZATION_VERSION,
      encounter: serializeEncounter(encounter),
      map: opts.map === undefined || opts.map === null ? null : serializeMap(opts.map),
      combatants: combatants.map(serializeCombatant),
      hazards: hazards.map(serializeHazard),
    };
  }

  // ----------------------------------------------------------- deserialization

  function deserializeMap(data) {
    if (data === null || data === undefined) {
      return null;
    }
    assertObject(data, "map");

    const terrain = [];
    for (const cell of data.difficult || []) {
      terrain.push({ x: cell.x, y: cell.y, type: GridMap.TERRAIN_TYPES.DIFFICULT });
    }
    for (const cell of data.greaterDifficult || []) {
      terrain.push({
        x: cell.x,
        y: cell.y,
        type: GridMap.TERRAIN_TYPES.GREATER_DIFFICULT,
      });
    }

    return new GridMap({
      cols: data.cols,
      rows: data.rows,
      blocked: data.blocked || [],
      terrain: terrain,
      hazardous: data.hazardous || [],
      illumination: data.illumination || [],
    });
  }

  function deserializeCombatant(data, options) {
    const opts = options || {};
    assertObject(data, "combatant state");

    const sustained = Array.isArray(data.activeSustainedSpells)
      ? data.activeSustainedSpells.map(function (entry) {
          return {
            id: entry.id,
            spellId: entry.spellId === undefined ? null : entry.spellId,
            spell: clonePlain(entry.spell),
            target: null,
            expiresAtRound:
              entry.expiresAtRound === undefined ? null : entry.expiresAtRound,
          };
        })
      : [];

    const combatant = new Combatant({
      id: data.id,
      name: data.name,
      // Preserve "no authored alliance" fixtures exactly.
      alliance:
        data.allianceExplicit === false ? undefined : data.alliance,
      initiative: data.initiative,
      x: data.x,
      y: data.y,
      elevation: data.elevation,
      speedFeet: data.speedFeet,
      maxActions: data.maxActions,
      actionsRemaining: data.actionsRemaining,
      maxReactions: data.maxReactions,
      reactionsRemaining: data.reactionsRemaining,
      diagonalStepsThisTurn: data.diagonalStepsThisTurn,
      maxHP: data.maxHP,
      currentHP: data.currentHP,
      ac: data.ac,
      attackBonus: data.attackBonus,
      spellAttackBonus: data.spellAttackBonus,
      spellDC: data.spellDC,
      spells: clonePlain(data.spells || []),
      spellSlots: clonePlain(data.spellSlots || {}),
      focusPoints: clonePlain(data.focusPoints || { max: 0, current: 0 }),
      activeSustainedSpells: sustained,
      saves: clonePlain(data.saves || {}),
      skills: clonePlain(data.skills || {}),
      damage: clonePlain(data.damage),
      traits: Array.isArray(data.traits) ? data.traits.slice() : [],
      immunities: clonePlain(data.immunities || []),
      weaknesses: clonePlain(data.weaknesses || []),
      resistances: clonePlain(data.resistances || []),
      agile: data.agile,
      attacksThisTurn: data.attacksThisTurn,
      turnNumber: data.turnNumber,
      encounterRound: data.encounterRound,
      size: data.size,
      senses: clonePlain(data.senses || []),
      isLoaded: data.isLoaded,
      rangeIncrement:
        data.rangeIncrement === null ? undefined : data.rangeIncrement,
      reload: data.reload,
      volley: data.volley === null ? undefined : data.volley,
      inventory: clonePlain(data.inventory || []),
      shield:
        data.shield === null || data.shield === undefined
          ? undefined
          : clonePlain(data.shield),
      hands: clonePlain(data.hands || { mainHand: null, offHand: null }),
      afflictions: clonePlain(data.afflictions || []),
      persistentDamage: clonePlain(data.persistentDamage || []),
      eventBus: opts.eventBus || null,
    });

    combatant.initiativeRoll = Number.isInteger(data.initiativeRoll)
      ? data.initiativeRoll
      : null;
    combatant.initiativeStatistic =
      typeof data.initiativeStatistic === "string"
        ? data.initiativeStatistic
        : null;
    combatant.initiativeModifier = Number.isInteger(data.initiativeModifier)
      ? data.initiativeModifier
      : null;
    combatant.isDefeated =
      data.isDefeated === undefined
        ? data.currentHP <= 0
        : data.isDefeated === true;
    // The constructor auto-adopts the first shield in the inventory. Preserve
    // an explicitly shield-less combatant.
    if (data.shield === null || data.shield === undefined) {
      combatant.shield = null;
    }

    // Conditions are replayed with their exact round metadata. The constructor
    // cannot carry `appliedRound` through its generic condition normalizer.
    for (const condition of data.conditions || []) {
      combatant.addCondition(
        condition.name,
        condition.value === null ? undefined : condition.value,
        {
          sourceId:
            condition.sourceId === null ? undefined : condition.sourceId,
          expiresOnSourceTurn:
            condition.expiresOnSourceTurn === null
              ? undefined
              : condition.expiresOnSourceTurn,
          duration:
            condition.duration === null ? undefined : condition.duration,
          durationOrigin:
            condition.durationOrigin === null
              ? undefined
              : condition.durationOrigin,
          round:
            condition.appliedRound === null
              ? undefined
              : condition.appliedRound,
        },
      );
    }

    return combatant;
  }

  function linkSustainedSpellTargets(combatants, stateCombatants) {
    const byId = new Map();
    for (const combatant of combatants) {
      byId.set(combatant.id, combatant);
    }
    for (let index = 0; index < stateCombatants.length; index += 1) {
      const data = stateCombatants[index];
      const combatant = byId.get(data.id);
      if (combatant === undefined) {
        continue;
      }
      const entries = data.activeSustainedSpells || [];
      for (const entry of combatant.activeSustainedSpells) {
        const source = entries.find(function (candidate) {
          return candidate.id === entry.id;
        });
        if (source === undefined) {
          continue;
        }
        entry.target =
          source.targetId === null || source.targetId === undefined
            ? null
            : byId.get(source.targetId) || null;
      }
    }
  }

  function deserializeEncounter(data, combatants, options) {
    const opts = options || {};
    assertObject(data, "encounter state");
    if (!Array.isArray(combatants) || combatants.length === 0) {
      throw new TypeError("deserializeEncounter requires combatants.");
    }

    const encounter = new Encounter({
      combatants: combatants,
      eventBus: opts.eventBus || null,
    });
    const byId = new Map();
    for (const combatant of combatants) {
      byId.set(combatant.id, combatant);
    }

    if (Array.isArray(data.registrationOrder)) {
      const registration = new Map();
      let next = 0;
      for (const id of data.registrationOrder) {
        if (byId.has(id) && !registration.has(id)) {
          registration.set(id, next);
          next += 1;
        }
      }
      for (const combatant of combatants) {
        if (!registration.has(combatant.id)) {
          registration.set(combatant.id, next);
          next += 1;
        }
      }
      encounter.registration = registration;
    }

    if (Array.isArray(data.order)) {
      const ordered = [];
      for (const id of data.order) {
        const combatant = byId.get(id);
        if (combatant !== undefined && ordered.indexOf(combatant) === -1) {
          ordered.push(combatant);
        }
      }
      if (ordered.length === combatants.length) {
        encounter.combatants = ordered;
      }
    }

    encounter.round = Number.isInteger(data.round) ? data.round : 0;
    encounter.started = data.started === true;
    encounter.over = data.over === true;

    let activeIndex = Number.isInteger(data.activeCombatantIndex)
      ? data.activeCombatantIndex
      : Number.isInteger(data.turnIndex)
        ? data.turnIndex
        : -1;
    if (activeIndex < 0 && typeof data.activeCombatantId === "string") {
      activeIndex = encounter.combatants.findIndex(function (combatant) {
        return combatant.id === data.activeCombatantId;
      });
    }
    if (
      activeIndex < 0 ||
      activeIndex >= encounter.combatants.length ||
      !encounter.started
    ) {
      encounter.activeCombatantIndex = encounter.started ? activeIndex : -1;
    } else {
      encounter.activeCombatantIndex = activeIndex;
    }
    if (encounter.activeCombatantIndex >= encounter.combatants.length) {
      encounter.activeCombatantIndex = -1;
    }

    encounter._attachBus();
    return encounter;
  }

  function deserializeHazard(data, options) {
    const opts = options || {};
    assertObject(data, "hazard state");
    return new Hazard(
      Object.assign({}, clonePlain(data), {
        eventBus: opts.eventBus || null,
      }),
    );
  }

  /**
   * Rebuild a live combat state from a serialized snapshot.
   *
   * @param {object|string} jsonState
   * @param {{eventBus?:object}} [options]
   * @returns {{encounter:object, map:object|null, combatants:object[], hazards:object[]}}
   */
  function deserializeCombatState(jsonState, options) {
    const opts = options || {};
    const state =
      typeof jsonState === "string" ? JSON.parse(jsonState) : jsonState;
    assertObject(state, "combat state");
    if (!Array.isArray(state.combatants) || state.combatants.length === 0) {
      throw new TypeError("Combat state requires a non-empty combatants array.");
    }

    const map = deserializeMap(state.map);
    const combatants = state.combatants.map(function (data) {
      return deserializeCombatant(data, opts);
    });
    linkSustainedSpellTargets(combatants, state.combatants);
    const encounter = deserializeEncounter(state.encounter, combatants, opts);
    const hazards = (state.hazards || []).map(function (data) {
      return deserializeHazard(data, opts);
    });

    return {
      encounter: encounter,
      map: map,
      combatants: encounter.getOrder(),
      hazards: hazards,
    };
  }

  return Object.freeze({
    SERIALIZATION_VERSION: SERIALIZATION_VERSION,
    clonePlain: clonePlain,
    serializeCombatant: serializeCombatant,
    serializeMap: serializeMap,
    serializeHazard: serializeHazard,
    serializeEncounter: serializeEncounter,
    serializeCombatState: serializeCombatState,
    deserializeCombatant: deserializeCombatant,
    deserializeMap: deserializeMap,
    deserializeHazard: deserializeHazard,
    deserializeEncounter: deserializeEncounter,
    deserializeCombatState: deserializeCombatState,
  });
});
