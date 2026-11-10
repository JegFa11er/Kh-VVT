import assert from "node:assert/strict";
import test from "node:test";

import {
  castVisibilityRay,
  computePolygon,
  pointInPolygon,
  wallBlocksSight,
} from "../src/canvas/math.js";

const RADIUS = 500;
const OPTIONS = { arcSamples: 64, epsilon: 1e-5 };

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

/** A wall long enough that every ray of the 500px test circle hits it. */
function slab(id, type, x, extra = {}) {
  return makeWall(id, type, x, -10000, x, 10000, extra);
}

function polygonMaxX(points) {
  return Math.max(...points.map((point) => point.x));
}

function polygonMinX(points) {
  return Math.min(...points.map((point) => point.x));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ------------------------------------------------------------ wall filtering

test("wallBlocksSight: invisible passes, ethereal/normal/terrain block", function () {
  assert.equal(wallBlocksSight(makeWall("a", "invisible", 0, 0, 1, 0)), false);
  assert.equal(wallBlocksSight(makeWall("a", "ethereal", 0, 0, 1, 0)), true);
  assert.equal(wallBlocksSight(makeWall("a", "normal", 0, 0, 1, 0)), true);
  assert.equal(wallBlocksSight(makeWall("a", "terrain", 0, 0, 1, 0)), true);
  assert.equal(wallBlocksSight(null), false);
});

test("wallBlocksSight: closed doors block, open unlocked doors pass", function () {
  assert.equal(wallBlocksSight(makeWall("a", "door", 0, 0, 1, 0)), true);
  assert.equal(
    wallBlocksSight(makeWall("a", "door", 0, 0, 1, 0, { open: true })),
    false,
  );
  assert.equal(
    wallBlocksSight(makeWall("a", "door", 0, 0, 1, 0, { isOpen: true })),
    false,
  );
  assert.equal(
    wallBlocksSight(
      makeWall("a", "door", 0, 0, 1, 0, { open: true, locked: true }),
    ),
    true,
  );
  assert.equal(
    wallBlocksSight(makeWall("a", "secret", 0, 0, 1, 0, { open: true })),
    false,
  );
  assert.equal(wallBlocksSight(makeWall("a", "secret", 0, 0, 1, 0)), true);
});

// ------------------------------------------------------------------ polygons

test("computePolygon returns a full circle when the scene has no walls", function () {
  const polygon = computePolygon({ x: 0, y: 0 }, RADIUS, [], "vision", OPTIONS);
  assert.equal(polygon.length, OPTIONS.arcSamples);
  for (const point of polygon) {
    assert.ok(Math.abs(distance(point, { x: 0, y: 0 }) - RADIUS) < 1e-6);
  }
});

test("computePolygon sorts vertices by angle", function () {
  const walls = [
    slab("w1", "normal", 200),
    makeWall("w2", "normal", -100, -100, -100, 100),
  ];
  const polygon = computePolygon({ x: 0, y: 0 }, RADIUS, walls, "vision", OPTIONS);
  const angles = polygon.map((point) =>
    Math.atan2(point.y, point.x) < 0
      ? Math.atan2(point.y, point.x) + Math.PI * 2
      : Math.atan2(point.y, point.x),
  );
  for (let index = 1; index < angles.length; index += 1) {
    assert.ok(angles[index] >= angles[index - 1]);
  }
});

test("computePolygon always respects the requested radius", function () {
  const walls = [makeWall("w", "normal", 100, 100, 300, 200)];
  const polygon = computePolygon({ x: 0, y: 0 }, RADIUS, walls, "vision", OPTIONS);
  for (const point of polygon) {
    assert.ok(distance(point, { x: 0, y: 0 }) <= RADIUS + 1e-6);
  }
});

test("computePolygon rejects invalid origins and radii", function () {
  assert.deepEqual(computePolygon(null, RADIUS, []), []);
  assert.deepEqual(computePolygon({ x: 0, y: 0 }, 0, []), []);
  assert.deepEqual(computePolygon({ x: 0, y: 0 }, -10, []), []);
  assert.deepEqual(
    computePolygon({ x: Number.NaN, y: 0 }, RADIUS, []),
    [],
  );
});

test("computePolygon ignores malformed and zero-length walls", function () {
  const polygon = computePolygon(
    { x: 0, y: 0 },
    RADIUS,
    [
      { id: "bad", type: "normal", x1: "x", y1: 0, x2: 10, y2: 10 },
      makeWall("dot", "normal", 50, 50, 50, 50),
    ],
    "vision",
    OPTIONS,
  );
  for (const point of polygon) {
    assert.ok(Math.abs(distance(point, { x: 0, y: 0 }) - RADIUS) < 1e-6);
  }
});

// --------------------------------------------------------- special wall types

test("invisible walls do not clip vision or light", function () {
  const polygon = computePolygon(
    { x: 0, y: 0 },
    RADIUS,
    [slab("w", "invisible", 100)],
    "vision",
    OPTIONS,
  );
  assert.ok(Math.abs(polygonMaxX(polygon) - RADIUS) < 1e-6);
});

test("ethereal walls block sight", function () {
  const polygon = computePolygon(
    { x: 0, y: 0 },
    RADIUS,
    [slab("w", "ethereal", 100)],
    "vision",
    OPTIONS,
  );
  assert.ok(Math.abs(polygonMaxX(polygon) - 100) < 1e-6);
});

test("normal walls clip the polygon at the wall", function () {
  const polygon = computePolygon(
    { x: 0, y: 0 },
    RADIUS,
    [slab("w", "normal", 100)],
    "light",
    OPTIONS,
  );
  assert.ok(Math.abs(polygonMaxX(polygon) - 100) < 1e-6);
});

test("closed doors clip light, open doors let it through", function () {
  const closed = computePolygon(
    { x: 0, y: 0 },
    RADIUS,
    [slab("d", "door", 100)],
    "light",
    OPTIONS,
  );
  assert.ok(Math.abs(polygonMaxX(closed) - 100) < 1e-6);

  const open = computePolygon(
    { x: 0, y: 0 },
    RADIUS,
    [slab("d", "door", 100, { open: true })],
    "light",
    OPTIONS,
  );
  assert.ok(Math.abs(polygonMaxX(open) - RADIUS) < 1e-6);
});

test("a single terrain wall is see-through", function () {
  const polygon = computePolygon(
    { x: 0, y: 0 },
    RADIUS,
    [slab("t", "terrain", 100)],
    "light",
    OPTIONS,
  );
  assert.ok(Math.abs(polygonMaxX(polygon) - RADIUS) < 1e-6);
});

test("two terrain walls stop the ray at the second wall", function () {
  const polygon = computePolygon(
    { x: 0, y: 0 },
    RADIUS,
    [slab("t1", "terrain", 100), slab("t2", "terrain", 200)],
    "light",
    OPTIONS,
  );
  // The ray crossed the first terrain wall (x = 100) and stopped at x = 200.
  assert.ok(Math.abs(polygonMaxX(polygon) - 200) < 1e-6);
  assert.ok(polygonMaxX(polygon) > 100);
});

test("terrain followed by a normal wall stops at the normal wall", function () {
  const polygon = computePolygon(
    { x: 0, y: 0 },
    RADIUS,
    [slab("t", "terrain", 100), slab("n", "normal", 150)],
    "light",
    OPTIONS,
  );
  assert.ok(Math.abs(polygonMaxX(polygon) - 150) < 1e-6);
});

test("terrain followed by an invisible wall keeps travelling", function () {
  const polygon = computePolygon(
    { x: 0, y: 0 },
    RADIUS,
    [slab("t", "terrain", 100), slab("i", "invisible", 200)],
    "light",
    OPTIONS,
  );
  assert.ok(Math.abs(polygonMaxX(polygon) - RADIUS) < 1e-6);
});

test("a terrain wall is still solid after the free pass is spent", function () {
  const hit = castVisibilityRay(
    { x: 0, y: 0 },
    0,
    RADIUS,
    [slab("t1", "terrain", 100), slab("t2", "terrain", 200)],
  );
  assert.ok(Math.abs(hit.x - 200) < 1e-9);
  assert.equal(hit.y, 0);
});

test("castVisibilityRay returns the radius end point when nothing blocks", function () {
  const hit = castVisibilityRay({ x: 0, y: 0 }, 0, RADIUS, []);
  assert.deepEqual(hit, { x: RADIUS, y: 0 });
});

// --------------------------------------------------------------------- rooms

test("a closed room produces a polygon that contains only the room", function () {
  const room = [
    makeWall("top", "normal", 0, 0, 500, 0),
    makeWall("right", "normal", 500, 0, 500, 500),
    makeWall("bottom", "normal", 500, 500, 0, 500),
    makeWall("left", "normal", 0, 500, 0, 0),
  ];
  const polygon = computePolygon(
    { x: 250, y: 250 },
    RADIUS,
    room,
    "light",
    OPTIONS,
  );

  assert.ok(polygon.length >= 8);
  assert.equal(pointInPolygon({ x: 250, y: 250 }, polygon), true);
  assert.equal(pointInPolygon({ x: 50, y: 50 }, polygon), true);
  assert.equal(pointInPolygon({ x: 700, y: 250 }, polygon), false);
  assert.equal(pointInPolygon({ x: 250, y: 700 }, polygon), false);

  assert.ok(polygonMinX(polygon) >= -1e-6);
  assert.ok(polygonMaxX(polygon) <= 500 + 1e-6);
  for (const point of polygon) {
    assert.ok(point.y >= -1e-6 && point.y <= 500 + 1e-6);
  }
});

test("exact rays hit wall corners instead of slipping past them", function () {
  const wall = makeWall("w", "normal", 100, -200, 100, 200);
  const polygon = computePolygon(
    { x: 0, y: 0 },
    RADIUS,
    [wall],
    "vision",
    OPTIONS,
  );
  const nearest = Math.min(
    ...polygon.map((point) => distance(point, { x: 100, y: 200 })),
  );
  assert.ok(nearest < 1e-6);
});

// -------------------------------------------------------------- point in poly

test("pointInPolygon implements the even-odd rule", function () {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  assert.equal(pointInPolygon({ x: 5, y: 5 }, square), true);
  assert.equal(pointInPolygon({ x: 15, y: 5 }, square), false);
  assert.equal(pointInPolygon({ x: 5, y: -1 }, square), false);
  assert.equal(pointInPolygon({ x: 5, y: 5 }, []), false);
  assert.equal(pointInPolygon(null, square), false);
});
