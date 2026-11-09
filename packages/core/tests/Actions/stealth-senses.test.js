/**
 * Phase 17 — Stealth Actions, Senses & Illumination.
 * Runs in the browser (test_runner.html) and in Node (tests/run-node.js).
 */
(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../src/Core/Grid/grid-map.js"),
      require("../../src/Core/Entities/combatant.js"),
      require("../../src/Core/Grid/illumination.js"),
      require("../../src/Core/Actions/stealth.js"),
      require("../../src/Core/Grid/cover.js"),
    );
  } else {
    root.PF2e = root.PF2e || {};
    root.PF2e.TestSuites = root.PF2e.TestSuites || [];
    root.PF2e.TestSuites.push({
      name: "Core/Actions — Stealth, Senses & Illumination",
      register: factory(
        root.PF2e.Core.GridMap,
        root.PF2e.Core.Combatant,
        root.PF2e.Core.Grid.Illumination,
        root.PF2e.Core.Actions.Stealth,
        root.PF2e.Core.Cover,
      ),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  GridMap,
  Combatant,
  Illumination,
  Stealth,
  Cover,
) {
  "use strict";

  if (!GridMap || !Combatant || !Illumination || !Stealth || !Cover) {
    throw new Error(
      "Stealth tests require GridMap, Combatant, Illumination, Stealth and Cover.",
    );
  }

  function makeCombatant(overrides) {
    return new Combatant(
      Object.assign(
        {
          id: "hero",
          name: "Valeros",
          alliance: "player",
          initiative: 10,
          x: 0,
          y: 0,
          speedFeet: 25,
          maxActions: 3,
          maxHP: 20,
          ac: 18,
          skills: { perception: 0, stealth: 0 },
        },
        overrides || {},
      ),
    );
  }

  function makeObserver(overrides) {
    return makeCombatant(
      Object.assign(
        {
          id: "goblin",
          name: "Goblin",
          alliance: "enemy",
          initiative: 5,
          x: 0,
          y: 0,
          maxHP: 10,
          ac: 15,
          skills: { perception: 4, stealth: 0 },
        },
        overrides || {},
      ),
    );
  }

  return function registerStealthSensesTests(t) {
    // ------------------------------------------------- senses model

    t.test("Combatant defaults to vision and parses authored senses", function () {
      const plain = makeCombatant({ id: "plain" });
      t.assertDeepEqual(plain.getSenses(), ["vision"]);
      t.assertTrue(plain.hasSense("vision"));
      t.assertTrue(!plain.hasLowLightVision());
      t.assertTrue(!plain.hasDarkvision());

      const elf = makeCombatant({
        id: "elf",
        senses: [
          "Low-Light Vision",
          "darkvision",
          { type: "tremorsense", range: 30 },
          { name: "scent", rangeFeet: 15 },
        ],
      });
      t.assertDeepEqual(elf.getSenses(), [
        "vision",
        "low-light-vision",
        "darkvision",
        "tremorsense-30",
        "scent-15",
      ]);
      t.assertTrue(elf.hasLowLightVision());
      t.assertTrue(elf.hasDarkvision());
      t.assertTrue(elf.hasSense("tremorsense"));
      t.assertEqual(elf.getSenseRange("tremorsense"), 30);
      t.assertEqual(elf.getSenseRange("scent"), 15);
      t.assertEqual(elf.getSenseRange("darkvision"), null);
    });

    // ------------------------------------------- illumination & senses

    t.test("Dim light conceals a target from normal vision but not low-light vision", function () {
      const map = new GridMap({ cols: 8, rows: 8 });
      map.setIllumination(2, 2, "dim");

      const target = makeCombatant({ id: "target", x: 2, y: 2 });
      const normal = makeObserver({ id: "normal", x: 0, y: 0 });
      const elf = makeObserver({
        id: "elf",
        x: 1,
        y: 0,
        senses: ["low-light-vision"],
      });

      const normalResult = Illumination.getPerceivedVisibility(
        normal,
        target,
        map,
      );
      t.assertEqual(normalResult.visibility, "concealed");
      t.assertEqual(normalResult.condition, "concealed");
      t.assertEqual(normalResult.flatCheckDC, 5);
      t.assertTrue(normalResult.targetable);
      t.assertTrue(!normalResult.observed);

      const elfResult = Illumination.getPerceivedVisibility(elf, target, map);
      t.assertEqual(elfResult.visibility, "observed");
      t.assertEqual(elfResult.flatCheckDC, null);
      t.assertTrue(elfResult.observed);
    });

    t.test("Darkness leaves a target hidden unless the observer has darkvision", function () {
      const map = new GridMap({ cols: 8, rows: 8 });
      map.setIllumination(2, 2, "darkness");

      const target = makeCombatant({ id: "target", x: 2, y: 2 });
      const normal = makeObserver({ id: "normal", x: 0, y: 0 });
      const drow = makeObserver({
        id: "drow",
        x: 1,
        y: 0,
        senses: ["darkvision"],
      });

      const normalResult = Illumination.getPerceivedVisibility(
        normal,
        target,
        map,
      );
      t.assertEqual(normalResult.visibility, "hidden");
      t.assertEqual(normalResult.flatCheckDC, 11);
      t.assertTrue(normalResult.targetable);

      const drowResult = Illumination.getPerceivedVisibility(drow, target, map);
      t.assertEqual(drowResult.visibility, "observed");

      const silentResult = Illumination.getPerceivedVisibility(
        normal,
        target,
        map,
        { silent: true },
      );
      t.assertEqual(silentResult.visibility, "undetected");
      t.assertTrue(!silentResult.targetable);
    });

    // ---------------------------------------------------------------- Hide

    t.test("Hide behind standard cover succeeds and applies Hidden", function () {
      const map = new GridMap({
        cols: 8,
        rows: 8,
        blocked: [{ x: 1, y: 3 }],
      });
      const hider = makeCombatant({
        id: "hider",
        x: 2,
        y: 3,
        skills: { stealth: 8, perception: 0 },
      });
      const observer = makeObserver({ id: "observer", x: 0, y: 0 });

      const cover = Cover.determineCover(observer, hider, map, [
        observer,
        hider,
      ]);
      t.assertEqual(cover.degree, "standard");

      const result = Stealth.performHide({
        combatant: hider,
        observers: [observer],
        map: map,
        d20: 15,
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.requirement, "cover");
      t.assertEqual(result.check.degree, "SUCCESS");
      t.assertEqual(result.check.total, 23);
      t.assertEqual(result.perceptionDC, 14);
      t.assertEqual(result.visibility, "hidden");
      t.assertEqual(result.actionsLeft, 2);
      t.assertTrue(hider.hasCondition("hidden"));
      t.assertTrue(!hider.hasCondition("undetected"));
    });

    t.test("Hide in an open bright field is refused with no-cover-or-concealment", function () {
      const map = new GridMap({ cols: 8, rows: 8 });
      const hider = makeCombatant({
        id: "hider",
        x: 2,
        y: 0,
        skills: { stealth: 8, perception: 0 },
      });
      const observer = makeObserver({ id: "observer", x: 0, y: 0 });

      const result = Stealth.performHide({
        combatant: hider,
        observers: [observer],
        map: map,
        d20: 20,
      });

      t.assertTrue(!result.ok);
      t.assertEqual(result.reason, "no-cover-or-concealment");
      t.assertEqual(hider.actionsRemaining, 3);
      t.assertTrue(!hider.hasCondition("hidden"));
    });

    // --------------------------------------------------------------- Sneak

    t.test("Sneak caps movement at half Speed and keeps Hidden", function () {
      const map = new GridMap({ cols: 10, rows: 10 });
      map.setIllumination(3, 0, "dim");

      const sneaker = makeCombatant({
        id: "sneaker",
        x: 0,
        y: 0,
        speedFeet: 30,
        skills: { stealth: 8, perception: 0 },
        conditions: ["hidden"],
      });
      const observer = makeObserver({
        id: "observer",
        x: 0,
        y: 5,
        skills: { perception: 0, stealth: 0 },
      });

      const result = Stealth.performSneak({
        combatant: sneaker,
        destination: { x: 3, y: 0 },
        observers: [observer],
        map: map,
        d20: 10,
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.costFeet, 15);
      t.assertEqual(result.maxFeet, 15);
      t.assertTrue(result.moved);
      t.assertEqual(result.visibility, "hidden");
      t.assertTrue(result.keptHidden);
      t.assertEqual(sneaker.x, 3);
      t.assertEqual(sneaker.y, 0);
      t.assertEqual(sneaker.actionsRemaining, 2);
      t.assertTrue(sneaker.hasCondition("hidden"));

      const tooFar = makeCombatant({
        id: "too-far",
        x: 0,
        y: 0,
        speedFeet: 30,
        skills: { stealth: 8, perception: 0 },
        conditions: ["hidden"],
      });
      const refused = Stealth.performSneak({
        combatant: tooFar,
        destination: { x: 4, y: 0 },
        observers: [observer],
        map: map,
        d20: 10,
      });

      t.assertTrue(!refused.ok);
      t.assertEqual(refused.reason, "exceeds-sneak-speed");
      t.assertEqual(refused.costFeet, 20);
      t.assertEqual(tooFar.x, 0);
      t.assertEqual(tooFar.y, 0);
      t.assertEqual(tooFar.actionsRemaining, 3);
    });

    // ---------------------------------------------------------------- Seek

    t.test("Seek 15-ft burst critical success turns Hidden into Observed", function () {
      const map = new GridMap({ cols: 10, rows: 10 });
      const seeker = makeCombatant({
        id: "seeker",
        x: 1,
        y: 1,
        skills: { perception: 8, stealth: 0 },
      });
      const target = makeObserver({
        id: "target",
        x: 2,
        y: 1,
        skills: { stealth: 0, perception: 0 },
        conditions: ["hidden"],
      });

      const result = Stealth.performSeek({
        seeker: seeker,
        areaType: "burst",
        radiusFeet: 15,
        combatants: [seeker, target],
        map: map,
        d20: 20,
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.actionCost, 1);
      t.assertDeepEqual(result.traits, ["concentrate", "secret"]);
      t.assertEqual(result.actionsLeft, 2);
      t.assertEqual(result.targets.length, 1);
      t.assertEqual(result.targets[0].degree, "CRITICAL_SUCCESS");
      t.assertEqual(result.targets[0].visibility, "observed");
      t.assertDeepEqual(result.revealed, ["target"]);
      t.assertTrue(!target.hasCondition("hidden"));
      t.assertTrue(!target.hasCondition("undetected"));
    });

    t.test("Seek success downgrades Undetected to Hidden", function () {
      const map = new GridMap({ cols: 10, rows: 10 });
      const seeker = makeCombatant({
        id: "seeker",
        x: 1,
        y: 1,
        skills: { perception: 8, stealth: 0 },
      });
      const target = makeObserver({
        id: "lurker",
        x: 2,
        y: 1,
        skills: { stealth: 0, perception: 0 },
        conditions: ["undetected"],
      });

      const result = Stealth.performSeek({
        seeker: seeker,
        areaType: "burst",
        radiusFeet: 15,
        combatants: [seeker, target],
        map: map,
        d20: 10,
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.targets[0].degree, "SUCCESS");
      t.assertEqual(result.targets[0].previousVisibility, "undetected");
      t.assertEqual(result.targets[0].visibility, "hidden");
      t.assertDeepEqual(result.downgraded, ["lurker"]);
      t.assertTrue(target.hasCondition("hidden"));
      t.assertTrue(!target.hasCondition("undetected"));
    });

    t.test("Seek 30-ft cone uses the cone area and finds a target in front", function () {
      const map = new GridMap({ cols: 10, rows: 10 });
      const seeker = makeCombatant({
        id: "seeker",
        x: 1,
        y: 5,
        skills: { perception: 8, stealth: 0 },
      });
      const target = makeObserver({
        id: "target",
        x: 4,
        y: 5,
        skills: { stealth: 0, perception: 0 },
        conditions: ["hidden"],
      });

      const result = Stealth.performSeek({
        seeker: seeker,
        areaType: "cone",
        direction: "east",
        radiusFeet: 30,
        combatants: [seeker, target],
        map: map,
        d20: 20,
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.radiusFeet, 30);
      t.assertTrue(result.cells.length > 0);
      t.assertEqual(result.targets.length, 1);
      t.assertEqual(result.targets[0].degree, "CRITICAL_SUCCESS");
      t.assertEqual(result.targets[0].visibility, "observed");
      t.assertTrue(!target.hasCondition("hidden"));
    });

    // ------------------------------------------------------------ Point Out

    t.test("Point Out turns an Undetected enemy into Hidden for allies", function () {
      const hero = makeCombatant({ id: "hero", x: 0, y: 0 });
      const ally = makeCombatant({ id: "ally", x: 1, y: 0 });
      const target = makeObserver({
        id: "goblin",
        x: 4,
        y: 0,
        conditions: ["undetected"],
      });

      const result = Stealth.performPointOut({
        combatant: hero,
        target: target,
        allies: [ally],
      });

      t.assertTrue(result.ok);
      t.assertEqual(result.actionCost, 1);
      t.assertDeepEqual(result.traits, ["auditory", "visual", "manipulate"]);
      t.assertEqual(result.actionsLeft, 2);
      t.assertEqual(result.previousVisibility, "undetected");
      t.assertEqual(result.visibility, "hidden");
      t.assertEqual(result.allies.length, 1);
      t.assertEqual(result.allies[0].awareness, "hidden");
      t.assertTrue(target.hasCondition("hidden"));
      t.assertTrue(!target.hasCondition("undetected"));

      const alreadySeen = makeObserver({
        id: "seen",
        x: 4,
        y: 0,
      });
      const refused = Stealth.performPointOut({
        combatant: makeCombatant({ id: "hero-2" }),
        target: alreadySeen,
        allies: [ally],
      });
      t.assertTrue(!refused.ok);
      t.assertEqual(refused.reason, "target-not-undetected");
    });
  };
});
