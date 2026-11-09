"use strict";

const { createHarness } = require("./harness.js");

const suites = [
  {
    name: "Core/Grid — PF2e 5-10-5 distance",
    register: require("./Grid/distance.test.js"),
  },
  {
    name: "Core/Grid & Actions — Pathfinding + Stride",
    register: require("./Grid/pathfinding.test.js"),
  },
  {
    name: "Core/Grid — Difficult Terrain & Occupancy",
    register: require("./Grid/terrain-occupancy.test.js"),
  },
  {
    name: "Core/Grid — Hazards & Verticality",
    register: require("./Grid/hazards-verticality.test.js"),
  },
  {
    name: "Core/Grid — Line of Sight",
    register: require("./Grid/los.test.js"),
  },
  {
    name: "Core/Grid — Cover Geometry",
    register: require("./Grid/cover.test.js"),
  },
  {
    name: "Core/Rules — d20 Checks & Degrees of Success",
    register: require("./Rules/checks.test.js"),
  },
  {
    name: "Core/Rules — Modifier Stacking",
    register: require("./Rules/modifiers.test.js"),
  },
  {
    name: "Core/Rules — Saving Throws, Skills & DCs",
    register: require("./Rules/saves-skills.test.js"),
  },
  {
    name: "Core/Rules — Damage Types & IWR",
    register: require("./Rules/iwr.test.js"),
  },
  {
    name: "Core/Rules — Weapon Traits & Reach",
    register: require("./Rules/weapon-traits.test.js"),
  },
  {
    name: "Core/Rules — Canonical Compliance Audit",
    register: require("./Rules/canonical-compliance.test.js"),
  },
  {
    name: "Core/Rules — Reach-10 Exception & Grabbed/Restrained",
    register: require("./Rules/reach-and-restrictions.test.js"),
  },
  {
    name: "Core/Grid — Flanking Geometry",
    register: require("./Grid/flanking.test.js"),
  },
  {
    name: "Core/Entities — Conditions",
    register: require("./Entities/conditions.test.js"),
  },
  {
    name: "Core/Entities — Dying, Wounded, Unconscious & Healing",
    register: require("./Entities/dying.test.js"),
  },
  {
    name: "Core/Entities — Persistent Damage",
    register: require("./Entities/persistent-damage.test.js"),
  },
  {
    name: "Core/Entities — Advanced Conditions, Durations & Afflictions",
    register: require("./Entities/afflictions-durations.test.js"),
  },
  {
    name: "Core/Entities — Large Creatures, Occupancy & Reach",
    register: require("./Entities/combatant-size.test.js"),
  },
  {
    name: "Core/Entities — Hands, Inventory & Shields",
    register: require("./Entities/equipment-shields.test.js"),
  },
  {
    name: "Core/Actions — Step & Strike",
    register: require("./Actions/step-strike.test.js"),
  },
  {
    name: "Core/Actions — Strike, MAP, Damage & HP",
    register: require("./Actions/strike.test.js"),
  },
  {
    name: "Core/Actions — Raise a Shield",
    register: require("./Actions/raise-shield.test.js"),
  },
  {
    name: "Core/Actions — Take Cover",
    register: require("./Actions/take-cover.test.js"),
  },
  {
    name: "Core/Actions — Trip & Reflex DC",
    register: require("./Actions/trip.test.js"),
  },
  {
    name: "Core/Actions — Shove & Push Geometry",
    register: require("./Actions/shove.test.js"),
  },
  {
    name: "Core/Actions — Grapple, Grabbed & Source Duration",
    register: require("./Actions/grapple.test.js"),
  },
  {
    name: "Core/Actions — Escape & Best Skill",
    register: require("./Actions/escape.test.js"),
  },
  {
    name: "Core/Actions — Stand & Reactions",
    register: require("./Actions/stand.test.js"),
  },
  {
    name: "Core/Actions — Reactions & Reactive Strike",
    register: require("./Actions/reactive-strike.test.js"),
  },
  {
    name: "Core/Actions — Ranged Combat & Reload",
    register: require("./Actions/ranged-strike.test.js"),
  },
  {
    name: "Core/Actions — Spellcasting & AoE",
    register: require("./Actions/cast-spell.test.js"),
  },
  {
    name: "Core/Actions — Advanced Spells & Geometry",
    register: require("./Actions/advanced-spells.test.js"),
  },
  {
    name: "Core/Actions — Stealth, Senses & Illumination",
    register: require("./Actions/stealth-senses.test.js"),
  },
  {
    name: "Core/Encounter — Initiative & Round Cycle",
    register: require("./Encounter/encounter.test.js"),
  },
  {
    name: "Core/State — Initiative, Serialization & Event Bus",
    register: require("./State/initiative-serialization.test.js"),
  },
  {
    name: "Core/AI — Tactical AI Engine",
    register: require("./AI/tactical-ai.test.js"),
  },
  {
    name: "Core/AI — Headless AI Stress Simulation",
    register: require("./AI/stress-simulation.test.js"),
  },
];

let totalPassed = 0;
let totalFailed = 0;

for (const suite of suites) {
  console.log("\n" + suite.name);
  const harness = createHarness();
  suite.register(harness);

  for (const result of harness.results) {
    if (result.passed) {
      totalPassed += 1;
      console.log("  PASS  " + result.name);
    } else {
      totalFailed += 1;
      console.error("  FAIL  " + result.name);
      console.error("        " + result.error);
    }
  }
}

console.log("\n" + totalPassed + " passed, " + totalFailed + " failed (" + suites.length + " suite(s))");

if (totalFailed > 0) {
  process.exitCode = 1;
}
