/**
 * Phase 19 — Initiative Engine, Combat State Serialization & Event Bus.
 *
 * Deterministic suite: every die face is injected, so tie-breaking,
 * round-trip restoration, and event payloads are reproducible.
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Encounter/encounter.js"),
      require("../../src/Core/Encounter/initiative.js"),
      require("../../src/Core/Grid/grid-map.js"),
      require("../../src/Core/Entities/hazard.js"),
      require("../../src/Core/Actions/strike.js"),
      require("../../src/Core/Actions/stride.js"),
      require("../../src/Core/Rules/modifiers.js"),
      require("../../src/Core/State/event-bus.js"),
      require("../../src/Core/State/serializer.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/State — Initiative, Serialization & Event Bus",
      register: factory(
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Encounter,
        root.PF2e.Core.Initiative,
        root.PF2e.Core.GridMap,
        root.PF2e.Core.Hazard,
        root.PF2e.Core.Actions.Strike,
        root.PF2e.Core.Actions.Stride,
        root.PF2e.Core.Rules.Modifiers,
        root.PF2e.Core.State,
        root.PF2e.Core.State.Serializer,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Combatant,
  Encounter,
  Initiative,
  GridMap,
  Hazard,
  Strike,
  Stride,
  Modifiers,
  EventBusModule,
  Serializer,
) {
  "use strict";

  const CombatEventBus = EventBusModule.CombatEventBus;
  const EVENT_TYPES = EventBusModule.EVENT_TYPES;

function makeCombatant(overrides) {
  return new Combatant(
    Object.assign(
      {
        id: "combatant",
        name: "Combatant",
        alliance: "player",
        initiative: 0,
        x: 0,
        y: 0,
        speedFeet: 25,
        maxActions: 3,
        maxHP: 20,
        currentHP: 20,
        ac: 15,
        attackBonus: 5,
        skills: { perception: 0, stealth: 0, athletics: 0, acrobatics: 0 },
        saves: { fortitude: 0, reflex: 0, will: 0 },
      },
      overrides || {},
    ),
  );
}

function ids(combatants) {
  return combatants.map(function (combatant) {
    return combatant.id;
  });
}

function effectiveAC(combatant) {
  const modifiers = Strike.collectDefenseModifiers(
    combatant,
    false,
    null,
    false,
  );
  return Modifiers.resolveModifiers(combatant.ac, modifiers);
}

function makeMap() {
  const map = new GridMap({ cols: 12, rows: 12 });
  map.setBlocked(4, 4, true);
  map.setBlocked(4, 5, true);
  map.setDifficultTerrain(5, 5, true);
  map.setTerrain(6, 6, "greater-difficult");
  map.setHazardous(7, 7, { damage: "1d6", type: "fire" });
  map.setIllumination(8, 8, "dim");
  map.setIllumination(9, 9, "darkness");
  return map;
}

function makeShield(overrides) {
  return Object.assign(
    {
      id: "steel-shield",
      name: "Steel Shield",
      type: "shield",
      hardness: 5,
      hp: 12,
      maxHP: 20,
      brokenThreshold: 10,
      acBonus: 2,
      speedPenalty: 0,
    },
    overrides || {},
  );
}

function makeLongsword() {
  return {
    id: "longsword",
    name: "Longsword",
    type: "weapon",
    damage: { formula: "1d8", type: "slashing" },
    traits: ["versatile-p"],
  };
}

  return function registerPhase19Tests(t) {
  // ------------------------------------------------------- initiative engine

  t.test("initiative is d20 + Perception by default", function () {
    const valeros = makeCombatant({
      id: "valeros",
      skills: { perception: 7, stealth: 2 },
    });
    const merisiel = makeCombatant({
      id: "merisiel",
      skills: { perception: 5, stealth: 10 },
    });
    const encounter = new Encounter({ combatants: [valeros, merisiel] });

    const result = encounter.rollInitiative({
      rolls: { valeros: 12, merisiel: 9 },
    });

    t.assertEqual(valeros.initiative, 19);
    t.assertEqual(valeros.initiativeRoll, 12);
    t.assertEqual(valeros.initiativeModifier, 7);
    t.assertEqual(valeros.initiativeStatistic, "perception");
    t.assertEqual(merisiel.initiative, 14);
    t.assertEqual(result.entries.length, 2);
    t.assertEqual(result.rolls.valeros, 12);
    t.assertDeepEqual(ids(result.order), ["valeros", "merisiel"]);
    t.assertEqual(encounter.round, 1);
    t.assertEqual(result.active.id, "valeros");
  });

  t.test("an enemy wins an equal initiative against an ally", function () {
    const player = makeCombatant({
      id: "valeros",
      alliance: "player",
      skills: { perception: 4 },
    });
    const enemy = makeCombatant({
      id: "goblin",
      alliance: "enemy",
      skills: { perception: 2 },
    });
    // Registration order is player first; enemy must still win the tie.
    const encounter = new Encounter({ combatants: [player, enemy] });

    const result = encounter.rollInitiative({
      rolls: { valeros: 8, goblin: 10 },
    });

    t.assertEqual(player.initiative, 12);
    t.assertEqual(enemy.initiative, 12);
    t.assertDeepEqual(ids(result.order), ["goblin", "valeros"]);
    t.assertEqual(result.active.id, "goblin");
  });

  t.test("same-alliance tie is won by the higher base statistic modifier", function () {
    const lowModifier = makeCombatant({
      id: "low-modifier",
      skills: { perception: 2 },
    });
    const highModifier = makeCombatant({
      id: "high-modifier",
      skills: { perception: 4 },
    });
    // Both totals are 12, but the higher base Perception acts first.
    const encounter = new Encounter({
      combatants: [lowModifier, highModifier],
    });

    const result = encounter.rollInitiative({
      rolls: { "low-modifier": 10, "high-modifier": 8 },
    });

    t.assertEqual(lowModifier.initiative, 12);
    t.assertEqual(highModifier.initiative, 12);
    t.assertDeepEqual(ids(result.order), ["high-modifier", "low-modifier"]);
  });

  t.test("absolute tie preserves stable registration order", function () {
    const first = makeCombatant({ id: "first", skills: { perception: 3 } });
    const second = makeCombatant({ id: "second", skills: { perception: 3 } });
    const encounter = new Encounter({ combatants: [first, second] });

    const result = encounter.rollInitiative({
      rolls: { first: 11, second: 11 },
    });

    t.assertDeepEqual(ids(result.order), ["first", "second"]);
  });

  t.test("Stealth is used when the creature starts hidden or in cover", function () {
    const hidden = makeCombatant({
      id: "rogue",
      skills: { perception: 1, stealth: 9 },
    });
    hidden.addCondition("hidden");

    const inCover = makeCombatant({
      id: "ranger",
      skills: { perception: 2, stealth: 6 },
    });
    inCover.startsInCover = true;

    const encounter = new Encounter({ combatants: [hidden, inCover] });
    const result = encounter.rollInitiative({
      rolls: { rogue: 10, ranger: 10 },
    });

    t.assertEqual(hidden.initiativeStatistic, "stealth");
    t.assertEqual(hidden.initiative, 19);
    t.assertEqual(inCover.initiativeStatistic, "stealth");
    t.assertEqual(inCover.initiative, 16);
    t.assertEqual(result.active.id, "rogue");
  });

  t.test("an explicit statistic override forces Perception or Stealth", function () {
    const combatant = makeCombatant({
      id: "scout",
      skills: { perception: 8, stealth: 1 },
    });
    combatant.addCondition("hidden");

    const encounter = new Encounter({ combatants: [combatant] });
    encounter.rollInitiative({
      rolls: { scout: 10 },
      statistics: { scout: "perception" },
    });

    t.assertEqual(combatant.initiativeStatistic, "perception");
    t.assertEqual(combatant.initiative, 18);
    t.assertEqual(Initiative.DEFAULT_STATISTIC, "perception");
  });

  t.test("authored equal initiative uses the same tie-break chain", function () {
    const player = makeCombatant({
      id: "player",
      alliance: "player",
      initiative: 10,
    });
    const enemy = makeCombatant({
      id: "enemy",
      alliance: "enemy",
      initiative: 10,
    });
    const encounter = new Encounter({ combatants: [player, enemy] });

    t.assertDeepEqual(ids(encounter.getOrder()), ["enemy", "player"]);
  });

  t.test("rollInitiative accepts array rolls in roster order", function () {
    const a = makeCombatant({ id: "a", skills: { perception: 0 } });
    const b = makeCombatant({ id: "b", skills: { perception: 0 } });
    const encounter = new Encounter({ combatants: [a, b] });

    const result = encounter.rollInitiative({ rolls: [4, 17] });

    t.assertEqual(a.initiative, 4);
    t.assertEqual(b.initiative, 17);
    t.assertDeepEqual(ids(result.order), ["b", "a"]);
  });

  // --------------------------------------------------------- event bus core

  t.test("combatant:damaged delivers the resolved damage payload", function () {
    const bus = new CombatEventBus();
    const combatant = makeCombatant({
      id: "valeros",
      name: "Valeros",
      maxHP: 20,
      currentHP: 20,
      eventBus: bus,
    });
    const seen = [];
    const unsubscribe = bus.on(EVENT_TYPES.COMBATANT_DAMAGED, function (payload) {
      seen.push(payload);
    });

    const result = combatant.takeDamage(7, { type: "fire" });

    t.assertEqual(seen.length, 1);
    t.assertEqual(seen[0].combatantId, "valeros");
    t.assertEqual(seen[0].combatantName, "Valeros");
    t.assertEqual(seen[0].amount, 7);
    t.assertEqual(seen[0].damageType, "fire");
    t.assertEqual(seen[0].damageTaken, 7);
    t.assertEqual(seen[0].currentHP, 13);
    t.assertEqual(seen[0].isDefeated, false);
    t.assertEqual(result.currentHP, 13);

    unsubscribe();
    combatant.takeDamage(3, { type: "fire" });
    t.assertEqual(seen.length, 1, "unsubscribe stops delivery");
  });

  t.test("condition and reaction events are dispatched with stable ids", function () {
    const bus = new CombatEventBus();
    const combatant = makeCombatant({ id: "goblin", eventBus: bus });
    const added = [];
    const removed = [];
    const reactions = [];
    bus.on(EVENT_TYPES.CONDITION_ADDED, function (payload) {
      added.push(payload);
    });
    bus.on(EVENT_TYPES.CONDITION_REMOVED, function (payload) {
      removed.push(payload);
    });
    bus.on(EVENT_TYPES.REACTION_TRIGGERED, function (payload) {
      reactions.push(payload);
    });

    combatant.addCondition("frightened", 2);
    combatant.removeCondition("frightened");
    combatant.spendReaction(1, { type: "shield-block", damage: 9 });

    t.assertEqual(added.length, 1);
    t.assertEqual(added[0].name, "frightened");
    t.assertEqual(added[0].value, 2);
    t.assertEqual(removed.length, 1);
    t.assertEqual(removed[0].name, "frightened");
    t.assertEqual(reactions.length, 1);
    t.assertEqual(reactions[0].reactionType, "shield-block");
    t.assertEqual(reactions[0].reactionsLeft, 0);
  });

  t.test("Encounter propagates its bus and emits round/turn events", function () {
    const bus = new CombatEventBus();
    const a = makeCombatant({ id: "a", initiative: 20 });
    const b = makeCombatant({ id: "b", initiative: 10 });
    const encounter = new Encounter({ combatants: [a, b], bus: bus });
    const turns = [];
    const rounds = [];
    const damage = [];
    bus.on(EVENT_TYPES.TURN_CHANGED, function (payload) {
      turns.push(payload);
    });
    bus.on(EVENT_TYPES.ROUND_STARTED, function (payload) {
      rounds.push(payload);
    });
    bus.on(EVENT_TYPES.COMBATANT_DAMAGED, function (payload) {
      damage.push(payload);
    });

    encounter.startEncounter();
    encounter.nextTurn();
    encounter.nextTurn(); // wraps to round 2

    t.assertEqual(rounds.length, 2);
    t.assertEqual(rounds[0].round, 1);
    t.assertEqual(rounds[1].round, 2);
    t.assertEqual(turns.length, 3);
    t.assertEqual(turns[1].previousId, "a");
    t.assertEqual(turns[1].activeId, "b");
    t.assertEqual(turns[2].activeId, "a");
    t.assertEqual(turns[2].wrapped, true);

    // The Encounter attached the bus to every combatant.
    a.takeDamage(2, { type: "fire" });
    t.assertEqual(damage.length, 1);
    t.assertEqual(damage[0].combatantId, "a");
  });

  t.test("hazard events report triggering and disabling", function () {
    const bus = new CombatEventBus();
    const trap = new Hazard({
      id: "spike-trap",
      name: "Spike Trap",
      hp: 10,
      maxHP: 12,
      hardness: 4,
      brokenThreshold: 6,
      isArmed: true,
      triggerArea: [{ x: 3, y: 3 }],
      reaction: { trigger: "enter", formula: "1d6", type: "piercing" },
      eventBus: bus,
    });
    const target = makeCombatant({ id: "victim", maxHP: 30, currentHP: 30 });
    const triggered = [];
    const disabled = [];
    bus.on(EVENT_TYPES.HAZARD_TRIGGERED, function (payload) {
      triggered.push(payload);
    });
    bus.on(EVENT_TYPES.HAZARD_DISABLED, function (payload) {
      disabled.push(payload);
    });

    trap.trigger(target, { rollDie: function () { return 4; } });
    t.assertEqual(triggered.length, 1);
    t.assertEqual(triggered[0].hazardId, "spike-trap");
    t.assertEqual(triggered[0].targetId, "victim");
    t.assertEqual(target.currentHP, 26);

    trap.arm();
    trap.takeDamage(6); // 4 HP -> broken and disarmed
    t.assertEqual(disabled.length, 1);
    t.assertEqual(disabled[0].reason, "broken");
  });

  t.test("off, clear, wildcard, and listener errors are handled", function () {
    const bus = new CombatEventBus();
    let direct = 0;
    let wildcard = 0;
    const callback = function () {
      direct += 1;
    };
    bus.on("custom:event", callback);
    bus.on("*", function () {
      wildcard += 1;
    });
    bus.on("custom:event", function () {
      throw new Error("listener failure");
    });

    bus.emit("custom:event", { ok: true });
    t.assertEqual(direct, 1);
    t.assertEqual(wildcard, 1);
    t.assertEqual(bus.errors.length, 1);
    t.assertTrue(bus.hasListeners("custom:event"));

    t.assertTrue(bus.off("custom:event", callback));
    bus.emit("custom:event");
    t.assertEqual(direct, 1, "off removes the callback");
    t.assertEqual(wildcard, 2);

    bus.clear();
    t.assertEqual(bus.listenerCount("custom:event"), 0);
    t.assertEqual(bus.listenerCount("*"), 0);
  });

  t.test("combatant:moved reports the path, cost, and action spend", function () {
    const bus = new CombatEventBus();
    const map = new GridMap({ cols: 6, rows: 6 });
    const mover = makeCombatant({
      id: "mover",
      x: 1,
      y: 1,
      eventBus: bus,
    });
    const moved = [];
    bus.on(EVENT_TYPES.COMBATANT_MOVED, function (payload) {
      moved.push(payload);
    });

    const result = Stride.performStride({
      combatant: mover,
      map: map,
      destination: { x: 3, y: 1 },
    });

    t.assertTrue(result.ok);
    t.assertEqual(moved.length, 1);
    t.assertEqual(moved[0].combatantId, "mover");
    t.assertEqual(moved[0].movementType, "stride");
    t.assertEqual(moved[0].actionsSpent, 1);
    t.assertEqual(moved[0].actionsLeft, 2);
    t.assertEqual(moved[0].costFeet, 10);
    t.assertEqual(moved[0].from.x, 1);
    t.assertEqual(moved[0].to.x, 3);
    t.assertEqual(moved[0].path.length, 3);
  });

  // ------------------------------------------------------ state serialization

  t.test("combat state survives a JSON round-trip and can continue combat", function () {
    const map = makeMap();

    const valeros = makeCombatant({
      id: "valeros",
      name: "Valeros",
      alliance: "player",
      x: 3,
      y: 3,
      elevation: 5,
      maxHP: 30,
      currentHP: 30,
      ac: 18,
      attackBonus: 9,
      damage: { formula: "1d8+4", type: "slashing" },
      saves: { fortitude: 9, reflex: 6, will: 5 },
      skills: { athletics: 10, acrobatics: 6, stealth: 2, perception: 7 },
      traits: ["reach", "backstabber", "deadly-d8"],
      inventory: [makeLongsword(), makeShield()],
      hands: { mainHand: "longsword", offHand: "steel-shield" },
      shield: makeShield(),
      spellSlots: { 1: { max: 2, current: 2 } },
      focusPoints: { max: 2, current: 2 },
      spells: [
        {
          id: "bless",
          name: "Bless",
          cost: 2,
          type: "save",
          traits: ["sustained", "mental"],
          saveType: "will",
          basic: false,
        },
      ],
    });

    const merisiel = makeCombatant({
      id: "merisiel",
      name: "Merisiel",
      alliance: "enemy",
      x: 4,
      y: 3,
      maxHP: 20,
      currentHP: 20,
      ac: 16,
      attackBonus: 8,
      damage: { formula: "1d6+2", type: "piercing" },
      saves: { fortitude: 5, reflex: 9, will: 6 },
      skills: { athletics: 4, acrobatics: 9, stealth: 10, perception: 8 },
    });

    const trap = new Hazard({
      id: "spike-trap",
      name: "Spike Trap",
      stealthDC: 20,
      disableDC: 18,
      disableSkill: "thievery",
      hp: 10,
      maxHP: 12,
      hardness: 4,
      brokenThreshold: 6,
      isArmed: true,
      reset: true,
      triggerArea: [{ x: 5, y: 3 }],
      reaction: {
        trigger: "enter",
        formula: "2d6",
        type: "piercing",
        saveType: "reflex",
        saveDC: 16,
      },
    });
    const brokenTrap = new Hazard({
      id: "broken-trap",
      name: "Broken Trap",
      hp: 3,
      maxHP: 10,
      hardness: 2,
      brokenThreshold: 5,
      isBroken: true,
      isArmed: false,
      triggerArea: [{ x: 6, y: 3 }],
      reaction: { trigger: "enter", formula: "1d4", type: "fire" },
    });

    const encounter = new Encounter({ combatants: [valeros, merisiel] });
    encounter.rollInitiative({
      rolls: { valeros: 15, merisiel: 10 },
    });

    // Mid-combat state: damage, a raised shield, Prone, Frightened, a timed
    // condition, a spent spell slot/focus point, an affliction, persistent
    // damage, and a sustained spell.
    valeros.takeDamage(5, { type: "fire" });
    valeros.spendSpellSlot(1);
    valeros.spendFocusPoint(1);
    valeros.addCondition("prone");
    valeros.addCondition("frightened", 1);
    valeros.addCondition("shield-raised");
    valeros.addCondition("slowed", 1, {
      duration: 2,
      durationOrigin: "start",
      round: encounter.round,
    });
    valeros.addAffliction({
      name: "Giant Scorpion Venom",
      saveType: "fortitude",
      saveDC: 18,
      maxStage: 3,
      stage: 2,
    });
    valeros.addPersistentDamage({ formula: "1d6", type: "fire" });
    valeros.addSustainedSpell(
      { id: "bless", name: "Bless", traits: ["sustained"] },
      merisiel,
      2,
    );

    const state = Serializer.serializeCombatState({
      encounter: encounter,
      map: map,
      combatants: encounter.getOrder(),
      hazards: [trap, brokenTrap],
    });
    // The snapshot must be pure JSON.
    const json = JSON.stringify(state);
    const restored = Serializer.deserializeCombatState(json);

    t.assertTrue(restored.encounter instanceof Encounter);
    t.assertTrue(restored.map instanceof GridMap);
    t.assertTrue(restored.hazards[0] instanceof Hazard);
    t.assertTrue(restored.combatants[0] instanceof Combatant);

    const restoredValeros = restored.combatants.find(function (combatant) {
      return combatant.id === "valeros";
    });
    const restoredMerisiel = restored.combatants.find(function (combatant) {
      return combatant.id === "merisiel";
    });

    // Map geometry, terrain classes, hazardous cells, and illumination.
    t.assertDeepEqual(
      restored.map.getBlockedCells(),
      map.getBlockedCells(),
    );
    t.assertDeepEqual(
      restored.map.getDifficultTerrainCells(),
      map.getDifficultTerrainCells(),
    );
    t.assertDeepEqual(
      restored.map.getGreaterDifficultTerrainCells(),
      map.getGreaterDifficultTerrainCells(),
    );
    t.assertDeepEqual(
      restored.map.getHazardousCells(),
      map.getHazardousCells(),
    );
    t.assertEqual(restored.map.getIllumination(8, 8), "dim");
    t.assertEqual(restored.map.getIllumination(9, 9), "darkness");

    // Core stats, position, resources, and equipment.
    t.assertEqual(restoredValeros.currentHP, 25);
    t.assertEqual(restoredValeros.maxHP, 30);
    t.assertEqual(restoredValeros.ac, 18);
    t.assertEqual(restoredValeros.x, 3);
    t.assertEqual(restoredValeros.y, 3);
    t.assertEqual(restoredValeros.getElevation(), 5);
    t.assertEqual(restoredValeros.hands.mainHand.id, "longsword");
    t.assertEqual(restoredValeros.hands.offHand.id, "steel-shield");
    t.assertEqual(restoredValeros.inventory.length, 2);
    t.assertEqual(restoredValeros.shield.hp, 12);
    t.assertEqual(restoredValeros.shield.broken, false);
    t.assertEqual(restoredValeros.getSpellSlot(1).current, 1);
    t.assertEqual(restoredValeros.getFocusPoints().current, 1);

    // Conditions preserve values, sources, durations, and application rounds.
    t.assertTrue(restoredValeros.hasCondition("prone"));
    t.assertTrue(restoredValeros.hasCondition("shield-raised"));
    t.assertEqual(restoredValeros.getConditionValue("frightened"), 1);
    const slowed = restoredValeros.getCondition("slowed");
    t.assertEqual(slowed.value, 1);
    t.assertEqual(slowed.duration, 2);
    t.assertEqual(slowed.durationOrigin, "start");
    t.assertEqual(slowed.appliedRound, 1);

    // Afflictions, persistent damage, sustained spells, and their target link.
    t.assertEqual(restoredValeros.getAffliction("giant-scorpion-venom").stage, 2);
    t.assertEqual(restoredValeros.getPersistentDamage().length, 1);
    t.assertEqual(restoredValeros.getPersistentDamage()[0].type, "fire");
    const sustained = restoredValeros.getActiveSustainedSpells();
    t.assertEqual(sustained.length, 1);
    t.assertEqual(sustained[0].spellId, "bless");
    t.assertEqual(sustained[0].target.id, "merisiel");

    // Initiative order, round, and active combatant are restored.
    t.assertDeepEqual(ids(restored.encounter.getOrder()), ["valeros", "merisiel"]);
    t.assertEqual(restored.encounter.round, 1);
    t.assertEqual(restored.encounter.activeCombatant.id, "valeros");
    t.assertEqual(restoredValeros.actionsRemaining, 3);
    t.assertEqual(restoredValeros.reactionsRemaining, 1);
    t.assertEqual(restoredValeros.initiative, 22);
    t.assertEqual(restoredValeros.initiativeStatistic, "perception");

    // Hazards preserve armed/broken state, HP, triggers, and reactions.
    t.assertEqual(restored.hazards[0].isArmed, true);
    t.assertEqual(restored.hazards[0].hp, 10);
    t.assertDeepEqual(restored.hazards[0].getTriggerArea(), [{ x: 5, y: 3 }]);
    t.assertEqual(restored.hazards[0].getReaction().saveDC, 16);
    t.assertEqual(restored.hazards[1].isBroken, true);
    t.assertEqual(restored.hazards[1].isArmed, false);

    // AC with modifiers is identical, including Prone + Shield Raised +
    // Frightened interacting through the centralized resolver.
    const originalAC = effectiveAC(valeros);
    const restoredAC = effectiveAC(restoredValeros);
    t.assertDeepEqual(restoredAC, originalAC);
    t.assertEqual(restoredAC.total, 17);

    // The exact round-trip contract.
    const stateAgain = Serializer.serializeCombatState({
      encounter: restored.encounter,
      map: restored.map,
      combatants: restored.encounter.getOrder(),
      hazards: restored.hazards,
    });
    t.assertDeepEqual(stateAgain, state);

    // The restored combatant is live: it can still Strike.
    const strike = Strike.performStrike({
      attacker: restoredValeros,
      target: restoredMerisiel,
      map: restored.map,
      combatants: restored.encounter.combatants,
      rollD20: function () {
        return 15;
      },
      rollDamageDie: function () {
        return 5;
      },
    });

    t.assertTrue(strike.ok);
    t.assertTrue(strike.hit);
    t.assertEqual(strike.attackerId, "valeros");
    t.assertEqual(restoredValeros.actionsRemaining, 2);
    t.assertTrue(restoredMerisiel.currentHP < restoredMerisiel.maxHP);
  });

  t.test("serialization preserves a shield-less inventory exactly", function () {
    const map = new GridMap({ cols: 5, rows: 5 });
    const combatant = makeCombatant({
      id: "carrier",
      x: 1,
      y: 1,
      inventory: [makeLongsword()],
      hands: { mainHand: "longsword", offHand: null },
    });
    t.assertEqual(combatant.shield, null);

    const encounter = new Encounter({ combatants: [combatant] });
    encounter.startEncounter();

    const state = Serializer.serializeCombatState({
      encounter: encounter,
      map: map,
      hazards: [],
    });
    const restored = Serializer.deserializeCombatState(state);
    const restoredCombatant = restored.combatants[0];

    t.assertEqual(restoredCombatant.shield, null);
    t.assertEqual(restoredCombatant.hands.mainHand.id, "longsword");
    t.assertEqual(restoredCombatant.hands.offHand, null);
    t.assertDeepEqual(
      Serializer.serializeCombatState({
        encounter: restored.encounter,
        map: restored.map,
        hazards: [],
      }),
      state,
    );
  });
  };
});
