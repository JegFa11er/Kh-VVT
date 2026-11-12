import test from "node:test";
import assert from "node:assert/strict";

import {
  OWNERSHIP_LEVELS,
  canEditActor,
  canViewActor,
  getOwnershipLevel,
  normalizeOwnership,
} from "../src/ui/permissions.js";

test("ownership defaults to no access when the matrix is missing", function () {
  assert.equal(getOwnershipLevel({}, "user-1", "player"), 0);
  assert.equal(getOwnershipLevel(null, "user-1", "player"), 0);
  assert.deepEqual(normalizeOwnership(undefined), { default: 0 });
});

test("explicit user entries override the default row", function () {
  const actor = {
    ownership: { default: 0, "user-1": 3, "user-2": 2, "user-3": 1 },
  };
  assert.equal(getOwnershipLevel(actor, "user-1", "player"), 3);
  assert.equal(getOwnershipLevel(actor, "user-2", "player"), 2);
  assert.equal(getOwnershipLevel(actor, "user-3", "player"), 1);
  assert.equal(getOwnershipLevel(actor, "user-4", "player"), 0);
});

test("the GM always gets owner level even with a restrictive matrix", function () {
  const actor = { ownership: { default: 0, "gm-1": 0 } };
  assert.equal(getOwnershipLevel(actor, "gm-1", "gm"), 3);
  assert.equal(canViewActor(actor, "gm-1", "gm"), true);
  assert.equal(canEditActor(actor, "gm-1", "gm"), true);
});

test("observer may read but not edit; owner may edit", function () {
  const actor = { ownership: { default: 0, "user-1": 2, "user-2": 3 } };
  assert.equal(canViewActor(actor, "user-1", "player"), true);
  assert.equal(canEditActor(actor, "user-1", "player"), false);
  assert.equal(canViewActor(actor, "user-2", "player"), true);
  assert.equal(canEditActor(actor, "user-2", "player"), true);
});

test("limited and none cannot open the sheet", function () {
  const actor = { ownership: { default: 1, "user-1": 0 } };
  assert.equal(canViewActor(actor, "user-1", "player"), false);
  assert.equal(canViewActor(actor, "user-2", "player"), false);
});

test("invalid levels are clamped and the default row is always present", function () {
  const normalized = normalizeOwnership({ default: 99, "user-1": -4, "user-2": "2" });
  assert.equal(normalized.default, OWNERSHIP_LEVELS.OWNER);
  assert.equal(normalized["user-1"], OWNERSHIP_LEVELS.NONE);
  assert.equal(normalized["user-2"], OWNERSHIP_LEVELS.OBSERVER);
});
