/**
 * PF2E REMASTERED — COMBAT EVENT BUS (HEADLESS CORE)
 *
 * Presentation-free pub/sub bridge between the rules core and any future
 * renderer, combat log, or integration layer. The core never imports View and
 * never assumes a listener exists: emitting without subscribers is a no-op.
 *
 * Standard event types are frozen in `EVENT_TYPES`. Listeners receive the
 * payload exactly as the core emitted it; `Combatant`/`Encounter`/`Hazard`
 * enrich their payloads with stable ids so a consumer never has to guess.
 *
 * Listener errors are captured in `errors` instead of interrupting combat.
 * This keeps one broken presentation callback from aborting a rules pipeline.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.Core = root.PF2e.Core || {};
    root.PF2e.Core.State = root.PF2e.Core.State || {};
    const api = factory();
    root.PF2e.Core.State.CombatEventBus = api.CombatEventBus;
    root.PF2e.Core.State.EventBus = api.EventBus;
    root.PF2e.Core.State.EVENT_TYPES = api.EVENT_TYPES;
    root.PF2e.Core.State.EVENT_TYPE_VALUES = api.EVENT_TYPE_VALUES;
    root.PF2e.Core.State.WILDCARD = api.WILDCARD;
    root.PF2e.Core.State.defaultBus = api.defaultBus;
    root.PF2e.Core.State.globalBus = api.globalBus;
    root.PF2e.Core.State.createEventBus = api.createEventBus;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const EVENT_TYPES = Object.freeze({
    COMBATANT_DAMAGED: "combatant:damaged",
    COMBATANT_MOVED: "combatant:moved",
    CONDITION_ADDED: "condition:added",
    CONDITION_REMOVED: "condition:removed",
    HAZARD_TRIGGERED: "hazard:triggered",
    HAZARD_DISABLED: "hazard:disabled",
    TURN_CHANGED: "turn:changed",
    ROUND_STARTED: "round:started",
    REACTION_TRIGGERED: "reaction:triggered",
  });

  const EVENT_TYPE_VALUES = Object.freeze(
    Object.keys(EVENT_TYPES).map(function (key) {
      return EVENT_TYPES[key];
    }),
  );

  const WILDCARD = "*";

  function assertEventType(eventType) {
    if (typeof eventType !== "string" || eventType.trim() === "") {
      throw new TypeError("eventType must be a non-empty string.");
    }
    return eventType.trim();
  }

  function assertCallback(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("callback must be a function.");
    }
    return callback;
  }

  class CombatEventBus {
    constructor(options) {
      const opts = options || {};
      this.listeners = new Map();
      this.errors = [];
      this.recordHistory = opts.recordHistory === true;
      this.history = [];
      this._sequence = 0;
    }

    /**
     * Subscribe to an event type. Returns an unsubscribe function so callers
     * can release a listener without keeping the original pair.
     *
     * @param {string} eventType event name or "*" for every event
     * @param {Function} callback
     * @returns {() => boolean}
     */
    on(eventType, callback) {
      const type = assertEventType(eventType);
      const listener = assertCallback(callback);
      if (!this.listeners.has(type)) {
        this.listeners.set(type, []);
      }
      this.listeners.get(type).push(listener);
      const bus = this;
      return function unsubscribe() {
        return bus.off(type, listener);
      };
    }

    /**
     * Remove every registration of a callback for one event type. Omitting the
     * callback clears the whole event type.
     *
     * @param {string} eventType
     * @param {Function} [callback]
     * @returns {boolean} true when at least one listener was removed
     */
    off(eventType, callback) {
      const type = assertEventType(eventType);
      const existing = this.listeners.get(type);
      if (existing === undefined) {
        return false;
      }
      if (callback === undefined) {
        this.listeners.delete(type);
        return existing.length > 0;
      }
      const listener = assertCallback(callback);
      const remaining = existing.filter(function (candidate) {
        return candidate !== listener;
      });
      if (remaining.length === existing.length) {
        return false;
      }
      if (remaining.length === 0) {
        this.listeners.delete(type);
      } else {
        this.listeners.set(type, remaining);
      }
      return true;
    }

    /**
     * Dispatch an event to every subscriber of that type and to wildcard
     * listeners. Listener exceptions are recorded in `errors` and do not stop
     * the remaining listeners.
     *
     * @param {string} eventType
     * @param {*} [payload]
     * @returns {number} number of callbacks invoked
     */
    emit(eventType, payload) {
      const type = assertEventType(eventType);
      this._sequence += 1;

      if (this.recordHistory) {
        this.history.push({
          sequence: this._sequence,
          type: type,
          payload: payload,
        });
      }

      const callbacks = [];
      const direct = this.listeners.get(type);
      if (direct !== undefined) {
        callbacks.push.apply(callbacks, direct);
      }
      const wildcard = this.listeners.get(WILDCARD);
      if (wildcard !== undefined) {
        callbacks.push.apply(callbacks, wildcard);
      }

      for (const callback of callbacks) {
        try {
          callback(payload, type);
        } catch (error) {
          this.errors.push({
            type: type,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
      return callbacks.length;
    }

    /**
     * Remove listeners. With no argument the whole bus is cleared.
     *
     * @param {string} [eventType]
     * @returns {CombatEventBus}
     */
    clear(eventType) {
      if (eventType === undefined) {
        this.listeners.clear();
        return this;
      }
      this.listeners.delete(assertEventType(eventType));
      return this;
    }

    /**
     * @param {string} eventType
     * @returns {number}
     */
    listenerCount(eventType) {
      const type = assertEventType(eventType);
      const list = this.listeners.get(type);
      return list === undefined ? 0 : list.length;
    }

    /**
     * @param {string} eventType
     * @returns {boolean}
     */
    hasListeners(eventType) {
      return this.listenerCount(eventType) > 0;
    }

    /** Reset captured listener errors (history is preserved). */
    clearErrors() {
      this.errors.length = 0;
      return this;
    }

    /** Clear recorded history (used by long-running hosts). */
    clearHistory() {
      this.history.length = 0;
      this._sequence = 0;
      return this;
    }
  }

  function createEventBus(options) {
    return new CombatEventBus(options);
  }

  // Convenience singleton for hosts that want one process-wide bus. Core
  // objects still accept an explicit bus so tests and multiple encounters can
  // stay isolated.
  const defaultBus = new CombatEventBus();

  return Object.freeze({
    CombatEventBus: CombatEventBus,
    EventBus: CombatEventBus,
    EVENT_TYPES: EVENT_TYPES,
    EVENT_TYPE_VALUES: EVENT_TYPE_VALUES,
    WILDCARD: WILDCARD,
    defaultBus: defaultBus,
    globalBus: defaultBus,
    createEventBus: createEventBus,
  });
});
