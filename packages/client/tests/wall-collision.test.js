import assert from "node:assert/strict";
import test from "node:test";

import { WallLayer, wallBlocksCollision } from "../src/canvas/wall-layer.js";

function makeWall(id, type, x1, y1, x2, y2, extra = {}) {
  return {
    id,
    type,
    x1,
    y1,
    x2,
    y2,
    open: false,
    locked: false,
    ...extra,
  };
}

/** Call the real WallLayer method against a lightweight mock instance. */
function checkCollision(walls, origin, destination, type) {
  return WallLayer.prototype.checkCollision.call(
    { walls },
    origin,
    destination,
    type,
  );
}

const ORIGIN = { x: 50, y: 50 };
const DESTINATION = { x: 350, y: 50 };

test("normal wall blocks movement and returns the nearest hit data", function () {
  const wall = makeWall("wall-1", "normal", 200, 0, 200, 100);
  const collision = checkCollision([wall], ORIGIN, DESTINATION, "movement");
  assert.ok(collision);
  assert.deepEqual(collision.point, { x: 200, y: 50 });
  assert.equal(collision.wall, wall);
  assert.equal(collision.wallId, "wall-1");
  assert.equal(collision.type, "normal");
  assert.equal(collision.distance, 150);
});

test("invisible walls still block movement", function () {
  const wall = makeWall("wall-2", "invisible", 200, 0, 200, 100);
  const collision = checkCollision([wall], ORIGIN, DESTINATION);
  assert.ok(collision);
  assert.equal(collision.wallId, "wall-2");
});

test("terrain walls block movement", function () {
  const wall = makeWall("wall-3", "terrain", 200, 0, 200, 100);
  assert.ok(checkCollision([wall], ORIGIN, DESTINATION));
});

test("ethereal walls never block movement", function () {
  const wall = makeWall("wall-4", "ethereal", 200, 0, 200, 100);
  assert.equal(checkCollision([wall], ORIGIN, DESTINATION, "movement"), null);
});

test("an open door lets the token through", function () {
  const wall = makeWall("wall-5", "door", 200, 0, 200, 100, { open: true });
  assert.equal(checkCollision([wall], ORIGIN, DESTINATION, "movement"), null);
});

test("a closed door blocks movement", function () {
  const wall = makeWall("wall-6", "door", 200, 0, 200, 100, { open: false });
  const collision = checkCollision([wall], ORIGIN, DESTINATION, "movement");
  assert.ok(collision);
  assert.equal(collision.wallId, "wall-6");
});

test("a locked door blocks even when a payload marks it open", function () {
  const wall = makeWall("wall-7", "door", 200, 0, 200, 100, {
    open: true,
    locked: true,
  });
  assert.ok(checkCollision([wall], ORIGIN, DESTINATION, "movement"));
});

test("secret doors follow the same open/closed movement rules", function () {
  const openSecret = makeWall("wall-8", "secret", 200, 0, 200, 100, {
    open: true,
  });
  const closedSecret = makeWall("wall-9", "secret", 200, 0, 200, 100);
  assert.equal(checkCollision([openSecret], ORIGIN, DESTINATION), null);
  assert.ok(checkCollision([closedSecret], ORIGIN, DESTINATION));
});

test("isOpen alias is honoured for door payloads", function () {
  const wall = makeWall("wall-10", "door", 200, 0, 200, 100, {
    open: false,
    isOpen: true,
  });
  assert.equal(checkCollision([wall], ORIGIN, DESTINATION), null);
});

test("checkCollision returns the closest wall when several are crossed", function () {
  const far = makeWall("wall-far", "normal", 300, 0, 300, 100);
  const near = makeWall("wall-near", "normal", 200, 0, 200, 100);
  const collision = checkCollision([far, near], ORIGIN, DESTINATION);
  assert.ok(collision);
  assert.equal(collision.wallId, "wall-near");
  assert.deepEqual(collision.point, { x: 200, y: 50 });
});

test("checkCollision ignores walls that the ray misses", function () {
  const wall = makeWall("wall-11", "normal", 200, 200, 300, 200);
  assert.equal(checkCollision([wall], ORIGIN, DESTINATION), null);
});

test("checkCollision returns null for a zero-length move", function () {
  const wall = makeWall("wall-12", "normal", 200, 0, 200, 100);
  assert.equal(checkCollision([wall], ORIGIN, { ...ORIGIN }), null);
});

test("checkCollision returns null for missing or malformed endpoints", function () {
  const wall = makeWall("wall-13", "normal", 200, 0, 200, 100);
  assert.equal(checkCollision([wall], null, DESTINATION), null);
  assert.equal(
    checkCollision([wall], { x: Number.NaN, y: 0 }, DESTINATION),
    null,
  );
});

test("wallBlocksCollision documents the movement filter", function () {
  assert.equal(wallBlocksCollision(makeWall("a", "normal", 0, 0, 1, 0)), true);
  assert.equal(wallBlocksCollision(makeWall("b", "ethereal", 0, 0, 1, 0)), false);
  assert.equal(
    wallBlocksCollision(makeWall("c", "door", 0, 0, 1, 0, { open: true })),
    false,
  );
  assert.equal(
    wallBlocksCollision(makeWall("d", "door", 0, 0, 1, 0, { open: false })),
    true,
  );
  assert.equal(wallBlocksCollision(null), false);
});
