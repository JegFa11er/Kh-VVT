"use strict";

/**
 * Public entry point for the PF2e rules engine.
 *
 * Every module in this package is a UMD/CommonJS hybrid. Requiring it from
 * Node returns the frozen namespace object (or the class/constructor for the
 * entity modules), so the aggregates below simply group them by domain.
 */

const Encounter = require("./Core/Encounter/encounter.js");
const Initiative = require("./Core/Encounter/initiative.js");

const Combatant = require("./Core/Entities/combatant.js");
const Conditions = require("./Core/Entities/conditions.js");
const Equipment = require("./Core/Entities/equipment.js");
const Hazard = require("./Core/Entities/hazard.js");
const PersistentDamage = require("./Core/Entities/persistent-damage.js");
const Shield = require("./Core/Entities/shield.js");

const Actions = {
  AthleticsManeuver: require("./Core/Actions/athletics-maneuver.js"),
  CastSpell: require("./Core/Actions/cast-spell.js"),
  DisableHazard: require("./Core/Actions/disable-hazard.js"),
  Escape: require("./Core/Actions/escape.js"),
  Grapple: require("./Core/Actions/grapple.js"),
  Interact: require("./Core/Actions/interact.js"),
  RaiseShield: require("./Core/Actions/raise-shield.js"),
  ReactiveStrike: require("./Core/Actions/reactive-strike.js"),
  Reload: require("./Core/Actions/reload.js"),
  ShieldBlock: require("./Core/Actions/shield-block.js"),
  Shove: require("./Core/Actions/shove.js"),
  Stand: require("./Core/Actions/stand.js"),
  Stealth: require("./Core/Actions/stealth.js"),
  Step: require("./Core/Actions/step.js"),
  Stride: require("./Core/Actions/stride.js"),
  Strike: require("./Core/Actions/strike.js"),
  SustainSpell: require("./Core/Actions/sustain-spell.js"),
  TakeCover: require("./Core/Actions/take-cover.js"),
  Trip: require("./Core/Actions/trip.js"),
};

const Rules = {
  Afflictions: require("./Core/Rules/afflictions.js"),
  Checks: require("./Core/Rules/checks.js"),
  Damage: require("./Core/Rules/damage.js"),
  IWR: require("./Core/Rules/iwr.js"),
  Map: require("./Core/Rules/map.js"),
  Modifiers: require("./Core/Rules/modifiers.js"),
  Size: require("./Core/Rules/size.js"),
  Spells: require("./Core/Rules/spells.js"),
  WeaponTraits: require("./Core/Rules/weapon-traits.js"),
};

const Grid = {
  AoE: require("./Core/Grid/aoe.js"),
  Cover: require("./Core/Grid/cover.js"),
  Distance: require("./Core/Grid/distance.js"),
  Flanking: require("./Core/Grid/flanking.js"),
  GridMap: require("./Core/Grid/grid-map.js"),
  GridMath: require("./Core/Grid/grid-math.js"),
  Illumination: require("./Core/Grid/illumination.js"),
  LineOfSight: require("./Core/Grid/los-math.js"),
  Occupancy: require("./Core/Grid/occupancy.js"),
  Pathfinding: require("./Core/Grid/pathfinding.js"),
};

const AI = {
  TacticalAI: require("./Core/AI/tactical-ai.js"),
};

const State = {
  EventBus: require("./Core/State/event-bus.js"),
  Serializer: require("./Core/State/serializer.js"),
};

module.exports = {
  Encounter,
  Initiative,
  Combatant,
  Conditions,
  Equipment,
  Hazard,
  PersistentDamage,
  Shield,
  Actions,
  Rules,
  Grid,
  AI,
  State,
};
