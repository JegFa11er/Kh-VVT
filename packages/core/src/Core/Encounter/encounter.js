/**
 * PF2E REMASTERED — ENCOUNTER / INITIATIVE ENGINE (HEADLESS CORE)
 *
 * Owns the initiative order, the active combatant, and the round counter.
 *
 * Rules implemented:
 *   - Combatants act in descending initiative order.
 *   - `rollInitiative()` performs the PF2e skill check (d20 + Perception or
 *     Stealth) and sorts with canonical tie-breaking: enemies before allies,
 *     then the higher base statistic modifier, then stable registration order.
 *   - Starting an encounter sets round 1 and resets every combatant's turn.
 *   - Advancing past the last combatant increments the round and wraps to the
 *     first combatant.
 *   - Every newly active combatant gets resetTurn() before acting.
 *   - The outgoing combatant gets endTurn() so timed conditions such as
 *     Frightened decay at the correct moment.
 *   - Defeated combatants remain in the roster but are skipped by the turn
 *     cycle. When no living combatant remains, activeCombatant becomes null.
 *
 * No presentation state and no combat math live here.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../Entities/conditions.js"),
      require("./initiative.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.Encounter = factory(
      root.PF2e.Core.Conditions,
      root.PF2e.Core.Initiative,
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Conditions,
  Initiative,
) {
  "use strict";

  function assertCombatants(combatants) {
    if (!Array.isArray(combatants) || combatants.length === 0) {
      throw new TypeError("Encounter requires a non-empty combatants array.");
    }

    const ids = new Set();
    for (const combatant of combatants) {
      if (combatant === null || typeof combatant !== "object") {
        throw new TypeError("Every combatant must be an object.");
      }
      if (typeof combatant.id !== "string" || combatant.id.trim() === "") {
        throw new TypeError("Every combatant must have a non-empty string id.");
      }
      if (typeof combatant.resetTurn !== "function") {
        throw new TypeError("Every combatant must implement resetTurn().");
      }
      if (!Number.isInteger(combatant.initiative)) {
        throw new TypeError("Every combatant must have an integer initiative.");
      }
      if (ids.has(combatant.id)) {
        throw new RangeError("Duplicate combatant id: " + combatant.id + ".");
      }
      ids.add(combatant.id);
    }
  }

  function sortStable(combatants, registration) {
    if (Initiative && typeof Initiative.sortInitiative === "function") {
      return Initiative.sortInitiative(combatants, registration);
    }
    return combatants.slice().sort(function (a, b) {
      return fallbackCompareInitiative(a, b, registration);
    });
  }

  // -------------------------------------------------- browser compatibility
  // The legacy HTML entry points load encounter.js without the newer
  // initiative.js module. These fallbacks keep the headless sort deterministic
  // there; Node always uses the canonical Initiative module.

  function fallbackRegistrationIndex(combatant, registration) {
    if (registration instanceof Map && registration.has(combatant.id)) {
      return registration.get(combatant.id);
    }
    if (Number.isInteger(combatant.initiativeOrder)) {
      return combatant.initiativeOrder;
    }
    return Number.MAX_SAFE_INTEGER;
  }

  function fallbackModifier(combatant) {
    if (Number.isInteger(combatant.initiativeModifier)) {
      return combatant.initiativeModifier;
    }
    const statistic =
      typeof combatant.initiativeStatistic === "string"
        ? combatant.initiativeStatistic
        : "perception";
    if (typeof combatant.getSkillModifier === "function") {
      const value = combatant.getSkillModifier(statistic);
      return Number.isInteger(value) ? value : 0;
    }
    if (
      combatant.skills !== null &&
      typeof combatant.skills === "object" &&
      Number.isInteger(combatant.skills[statistic])
    ) {
      return combatant.skills[statistic];
    }
    return 0;
  }

  function fallbackCompareInitiative(a, b, registration) {
    const aTotal = Number.isInteger(a.initiative) ? a.initiative : 0;
    const bTotal = Number.isInteger(b.initiative) ? b.initiative : 0;
    if (aTotal !== bTotal) {
      return bTotal - aTotal;
    }
    const aPriority = a.alliance === "enemy" ? 0 : 1;
    const bPriority = b.alliance === "enemy" ? 0 : 1;
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }
    const aModifier = fallbackModifier(a);
    const bModifier = fallbackModifier(b);
    if (aModifier !== bModifier) {
      return bModifier - aModifier;
    }
    const aIndex = fallbackRegistrationIndex(a, registration);
    const bIndex = fallbackRegistrationIndex(b, registration);
    if (aIndex !== bIndex) {
      return aIndex - bIndex;
    }
    return String(a.id) < String(b.id)
      ? -1
      : String(a.id) > String(b.id)
        ? 1
        : 0;
  }

  function fallbackRollInitiative(combatants, options) {
    const opts = options || {};
    const entries = [];
    const rolls = {};
    for (let index = 0; index < combatants.length; index += 1) {
      const combatant = combatants[index];
      let statistic = "perception";
      if (
        typeof combatant.initiativeStatistic === "string" &&
        combatant.initiativeStatistic.trim() !== ""
      ) {
        statistic = combatant.initiativeStatistic.trim().toLowerCase();
      } else if (
        combatant.startsInCover === true ||
        combatant.startsHidden === true ||
        combatant.startsFromStealth === true ||
        combatant.fromCover === true ||
        combatant.inCover === true ||
        combatant.fromStealth === true ||
        combatant.fromHide === true ||
        combatant.hidden === true ||
        combatant.concealed === true ||
        combatant.undetected === true ||
        (typeof combatant.hasCondition === "function" &&
          ["concealed", "hidden", "undetected"].some(function (name) {
            return combatant.hasCondition(name);
          }))
      ) {
        statistic = "stealth";
      }
      if (
        typeof opts.statistic === "string" &&
        opts.statistic.trim() !== ""
      ) {
        statistic = opts.statistic.trim().toLowerCase();
      }

      const modifier =
        typeof combatant.getSkillModifier === "function"
          ? combatant.getSkillModifier(statistic)
          : 0;
      let d20;
      if (
        opts.rolls !== null &&
        typeof opts.rolls === "object" &&
        !Array.isArray(opts.rolls) &&
        Number.isInteger(opts.rolls[combatant.id])
      ) {
        d20 = opts.rolls[combatant.id];
      } else if (
        Array.isArray(opts.rolls) &&
        Number.isInteger(opts.rolls[index])
      ) {
        d20 = opts.rolls[index];
      } else if (typeof opts.rollD20 === "function") {
        d20 = opts.rollD20(combatant, index);
      } else if (typeof opts.rollDie === "function") {
        d20 = opts.rollDie(20);
      } else {
        d20 = 1 + Math.floor(Math.random() * 20);
      }
      if (!Number.isInteger(d20) || d20 < 1 || d20 > 20) {
        throw new RangeError("Initiative d20 must be between 1 and 20.");
      }

      combatant.initiative = d20 + modifier;
      combatant.initiativeRoll = d20;
      combatant.initiativeStatistic = statistic;
      combatant.initiativeModifier = modifier;
      entries.push({
        combatantId: combatant.id,
        combatantName: combatant.name,
        d20: d20,
        modifier: modifier,
        statistic: statistic,
        total: combatant.initiative,
        alliance: combatant.alliance,
      });
      rolls[combatant.id] = d20;
    }
    return { entries: entries, order: sortStable(combatants), rolls: rolls };
  }

  class Encounter {
    constructor(options) {
      const opts = options || {};
      assertCombatants(opts.combatants);

      this.eventBus = opts.eventBus || opts.bus || null;
      // Stable registration order is captured once and preserved across every
      // re-sort. It is the final tie-breaker for equal initiatives.
      this.registration = new Map();
      for (const combatant of opts.combatants) {
        this._register(combatant);
      }

      this.combatants = sortStable(opts.combatants.slice(), this.registration);
      this.round = 0;
      this.activeCombatantIndex = -1;
      this.started = false;
      this.over = false;
      this._attachBus();
    }

    /**
     * Record a combatant's stable registration index. Existing entries are
     * never overwritten, so a re-sort cannot change the tie-break order.
     *
     * @param {object} combatant
     * @returns {number} the registration index
     */
    _register(combatant) {
      if (!this.registration.has(combatant.id)) {
        this.registration.set(combatant.id, this.registration.size);
      }
      return this.registration.get(combatant.id);
    }

    /**
     * Attach the optional event bus to every combatant so damage/condition
     * events reach the same subscribers as turn events.
     *
     * @returns {Encounter}
     */
    _attachBus() {
      if (!this.eventBus) {
        return this;
      }
      for (const combatant of this.combatants) {
        if (combatant !== null && typeof combatant.setEventBus === "function") {
          combatant.setEventBus(this.eventBus);
        }
      }
      return this;
    }

    /**
     * Dispatch an optional core event.
     *
     * @param {string} eventType
     * @param {object} payload
     * @returns {number} number of listeners invoked
     */
    _emit(eventType, payload) {
      if (!this.eventBus || typeof this.eventBus.emit !== "function") {
        return 0;
      }
      return this.eventBus.emit(eventType, payload);
    }

    /**
     * Attach or replace the combat event bus.
     *
     * @param {object|null} bus
     * @returns {Encounter}
     */
    setEventBus(bus) {
      this.eventBus = bus || null;
      this._attachBus();
      return this;
    }

    get activeCombatant() {
      if (!this.started || this.activeCombatantIndex < 0) {
        return null;
      }
      return this.combatants[this.activeCombatantIndex] || null;
    }

    get isStarted() {
      return this.started;
    }

    get isOver() {
      // Combat ends when the battle has no remaining opposition: either every
      // combatant is defeated, or every living combatant belongs to one and the
      // same `alliance`. A one-sided wipe therefore reports victory immediately
      // instead of waiting for the surviving side to idle out the round cap.
      if (this.over) {
        return true;
      }
      const living = this.livingCombatants;
      if (living.length === 0) {
        return true;
      }
      const firstAlliance = living[0].alliance;
      return living.every(function (combatant) {
        return combatant.alliance === firstAlliance;
      });
    }

    get livingCombatants() {
      return this.combatants.filter(function (combatant) {
        return !Encounter.isDefeated(combatant);
      });
    }

    static isDefeated(combatant) {
      return combatant.isDefeated === true || combatant.currentHP === 0;
    }

    /** First living index at or after startIndex, or -1. */
    _findLivingFrom(startIndex) {
      const length = this.combatants.length;
      for (let step = 0; step < length; step += 1) {
        const index = (startIndex + step) % length;
        if (!Encounter.isDefeated(this.combatants[index])) {
          return index;
        }
      }
      return -1;
    }

    /**
     * @returns {object|null} the first living combatant, or null if none
     */
    startEncounter() {
      this._attachBus();
      this.combatants = sortStable(this.combatants, this.registration);
      this.round = 1;
      this._syncRound();
      for (const combatant of this.combatants) {
        // Starting an encounter is not the end of anyone's turn. Conditions
        // must not tick here.
        combatant.resetTurn({ tickConditions: false, round: this.round });
      }
      this.started = true;

      const index = this._findLivingFrom(0);
      if (index === -1) {
        this.activeCombatantIndex = -1;
        this.over = true;
        this._emit("round:started", { round: this.round });
        this._emit("turn:changed", {
          round: this.round,
          index: -1,
          previousId: null,
          activeId: null,
          activeName: null,
          wrapped: false,
        });
        return null;
      }

      this.activeCombatantIndex = index;
      this.over = false;
      const active = this.activeCombatant;
      this._emit("round:started", { round: this.round });
      this._emit("turn:changed", {
        round: this.round,
        index: index,
        previousId: null,
        activeId: active.id,
        activeName: active.name,
        wrapped: false,
      });
      return active;
    }

    /**
     * Roll initiative for the roster and begin the encounter.
     *
     * `rolls` may be an object keyed by combatant id (`{ valeros: 14 }`), an
     * array of d20 faces in roster order, or a callback. Omitted rolls fall
     * back to `rollD20`, `rollDie(20)`, then Math.random.
     *
     * After rolling, the queue is sorted with the canonical PF2e tie-breaks,
     * round 1 starts, and the first living combatant becomes active.
     *
     * @param {{
     *   combatants?: object[],
     *   rolls?: Object<string,number>|number[]|Function,
     *   rollD20?: Function,
     *   rollDie?: Function,
     *   statistic?: string,
     *   statistics?: Object<string,string>,
     *   stealth?: boolean
     * }} [options]
     * @returns {{active:object|null, round:number, order:object[], entries:object[], rolls:Object<string,number>}}
     */
    rollInitiative(options) {
      const opts = options || {};
      const roster = Array.isArray(opts.combatants)
        ? opts.combatants.slice()
        : this.combatants.slice();
      assertCombatants(roster);
      for (const combatant of roster) {
        this._register(combatant);
      }

      const report =
        Initiative && typeof Initiative.rollInitiative === "function"
          ? Initiative.rollInitiative(
              roster,
              Object.assign({}, opts, { registration: this.registration }),
            )
          : fallbackRollInitiative(roster, opts);
      this.combatants = roster;
      const active = this.startEncounter();

      return {
        active: active,
        round: this.round,
        order: this.getOrder(),
        entries: report.entries,
        rolls: report.rolls,
      };
    }

    /**
     * Advance the initiative pointer. Wrapping past the last combatant starts
     * the next round. The incoming active combatant always gets a fresh turn.
     *
     * The outgoing combatant's endTurn() resolves Frightened decay,
     * persistent damage, "end"-origin round durations, and affliction saves.
     * The incoming combatant's resetTurn() expires "start"-origin durations
     * and applies the Stunned/Slowed action tax. Optional die callbacks are
     * forwarded so a host/test can keep the tick deterministic.
     *
     * @param {{rollDie?:Function,rollDamageDie?:Function,rollD20?:Function,rollFlatCheck?:Function,rollAfflictionSave?:Function,afflictionD20?:number}} [options]
     * @returns {{
     *   active: object,
     *   previous: object | null,
     *   round: number,
     *   wrapped: boolean,
     *   index: number,
     *   conditionTick: object|null,
     *   persistentTick: object|null,
     *   durationExpiry: object[],
     *   afflictionTick: object|null
     * }}
     */
    nextTurn(options) {
      if (!this.started) {
        const active = this.startEncounter();
        return {
          active: active,
          previous: null,
          round: this.round,
          wrapped: false,
          index: this.activeCombatantIndex,
          conditionTick: null,
          persistentTick: null,
          durationExpiry: [],
          afflictionTick: null,
          releasedGrapples: [],
          expiredSustainedSpells: [],
        };
      }

      const previous = this.activeCombatant;
      // Round-based durations are stamped and checked against this clock.
      this._syncRound();
      // A defeated grappler cannot maintain a hold. Clean up before the next
      // creature acts so no stale Grabbed/Restrained state survives the death.
      const releasedGrapples = this.releaseGrapplesFromDefeated();
      const endTurnOptions = Object.assign({}, options || {}, {
        combatants: this.combatants,
        round: this.round,
      });
      const endTurnResult =
        previous && typeof previous.endTurn === "function"
          ? previous.endTurn(endTurnOptions)
          : null;
      const conditionTick = endTurnResult;
      const persistentTick =
        endTurnResult && endTurnResult.persistentTick
          ? endTurnResult.persistentTick
          : null;
      if (endTurnResult && Array.isArray(endTurnResult.releasedGrapples)) {
        for (const entry of endTurnResult.releasedGrapples) {
          releasedGrapples.push(entry);
        }
      }
      const expiredSustainedSpells =
        endTurnResult && Array.isArray(endTurnResult.expiredSustainedSpells)
          ? endTurnResult.expiredSustainedSpells
          : [];
      const length = this.combatants.length;
      let index = this.activeCombatantIndex;
      let wrapped = false;
      let nextIndex = -1;

      // Step forward until a living combatant is found. Passing the end of the
      // order advances the round exactly once, even when many defeated
      // combatants are skipped.
      for (let step = 0; step < length; step += 1) {
        index += 1;
        if (index >= length) {
          index = 0;
          this.round += 1;
          wrapped = true;
        }
        if (!Encounter.isDefeated(this.combatants[index])) {
          nextIndex = index;
          break;
        }
      }

      if (nextIndex === -1) {
        this.activeCombatantIndex = -1;
        this.over = true;
        if (wrapped) {
          this._emit("round:started", { round: this.round });
        }
        this._emit("turn:changed", {
          round: this.round,
          index: -1,
          previousId: previous ? previous.id : null,
          activeId: null,
          activeName: null,
          wrapped: wrapped,
        });
        return {
          active: null,
          previous: previous,
          round: this.round,
          wrapped: wrapped,
          index: -1,
          conditionTick: conditionTick,
          persistentTick: persistentTick,
          durationExpiry:
            endTurnResult && Array.isArray(endTurnResult.durationExpiry)
              ? endTurnResult.durationExpiry
              : [],
          afflictionTick:
            endTurnResult && endTurnResult.afflictionTick
              ? endTurnResult.afflictionTick
              : null,
          releasedGrapples: releasedGrapples,
          expiredSustainedSpells: expiredSustainedSpells,
        };
      }

      this.activeCombatantIndex = nextIndex;
      this.over = false;
      // The round may have advanced during the wrap. Stamp the new round on
      // every combatant before the incoming turn's duration checks.
      this._syncRound();

      const active = this.activeCombatant;
      // The outgoing combatant already received its end-of-turn tick above.
      active.resetTurn({ tickConditions: false, round: this.round });

      if (wrapped) {
        this._emit("round:started", { round: this.round });
      }
      this._emit("turn:changed", {
        round: this.round,
        index: this.activeCombatantIndex,
        previousId: previous ? previous.id : null,
        activeId: active.id,
        activeName: active.name,
        wrapped: wrapped,
      });

      return {
        active: active,
        previous: previous,
        round: this.round,
        wrapped: wrapped,
        index: this.activeCombatantIndex,
        conditionTick: conditionTick,
        persistentTick: persistentTick,
        durationExpiry:
          endTurnResult && Array.isArray(endTurnResult.durationExpiry)
            ? endTurnResult.durationExpiry
            : [],
        afflictionTick:
          endTurnResult && endTurnResult.afflictionTick
            ? endTurnResult.afflictionTick
            : null,
        releasedGrapples: releasedGrapples,
        expiredSustainedSpells: expiredSustainedSpells,
      };
    }

    /**
     * Keep every combatant's `encounterRound` in sync with the encounter
     * clock so `addCondition(..., { duration })` can stamp the application
     * round without the caller having to pass it.
     *
     * @returns {Encounter}
     */
    _syncRound() {
      for (const combatant of this.combatants) {
        if (combatant !== null && typeof combatant === "object") {
          combatant.encounterRound = this.round;
        }
      }
      return this;
    }

    /**
     * Break all grapples maintained by defeated combatants. Called at the
     * start of nextTurn so a slain grappler cannot keep a victim immobilized.
     *
     * @returns {{combatant:object,combatantId:string,combatantName:string,removed:object[]}[]}
     */
    releaseGrapplesFromDefeated() {
      const released = [];
      for (const combatant of this.combatants) {
        if (!Encounter.isDefeated(combatant)) {
          continue;
        }
        const entries = Conditions.releaseGrapplesBySource(
          this.combatants,
          combatant.id,
        );
        for (const entry of entries) {
          released.push(entry);
        }
      }
      return released;
    }

    /**
     * @param {object|string} combatantOrId
     * @returns {boolean}
     */
    isActive(combatantOrId) {
      const active = this.activeCombatant;
      if (!active) {
        return false;
      }
      if (typeof combatantOrId === "string") {
        return active.id === combatantOrId;
      }
      return active === combatantOrId || active.id === combatantOrId.id;
    }

    /**
     * @returns {object[]} initiative order, highest first (copy)
     */
    getOrder() {
      return this.combatants.slice();
    }

    /**
     * Index of a combatant in the current order, or -1.
     *
     * @param {object|string} combatantOrId
     * @returns {number}
     */
    indexOf(combatantOrId) {
      const id =
        typeof combatantOrId === "string" ? combatantOrId : combatantOrId.id;
      return this.combatants.findIndex(function (combatant) {
        return combatant.id === id;
      });
    }
  }

  return Encounter;
});
