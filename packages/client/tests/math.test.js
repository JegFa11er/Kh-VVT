import assert from "node:assert/strict";
import test from "node:test";

import { distanceSquared, segmentsIntersect } from "../src/canvas/math.js";

test("segmentsIntersect finds the crossing point of two diagonals", function () {
  const point = segmentsIntersect(
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
    { x: 10, y: 0 },
  );
  assert.deepEqual(point, { x: 5, y: 5 });
});

test("segmentsIntersect handles vertical/horizontal crossing without dividing by zero", function () {
  const point = segmentsIntersect(
    { x: 5, y: 0 },
    { x: 5, y: 10 },
    { x: 0, y: 5 },
    { x: 10, y: 5 },
  );
  assert.deepEqual(point, { x: 5, y: 5 });
});

test("segmentsIntersect returns null for parallel segments", function () {
  assert.equal(
    segmentsIntersect(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 5 },
      { x: 10, y: 5 },
    ),
    null,
  );
});

test("segmentsIntersect returns the first shared point of collinear overlaps", function () {
  assert.deepEqual(
    segmentsIntersect(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 0 },
      { x: 15, y: 0 },
    ),
    { x: 5, y: 0 },
  );
});

test("segmentsIntersect returns null for disjoint collinear segments", function () {
  assert.equal(
    segmentsIntersect(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 11, y: 0 },
      { x: 20, y: 0 },
    ),
    null,
  );
});

test("segmentsIntersect treats touching endpoints as an intersection", function () {
  assert.deepEqual(
    segmentsIntersect(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ),
    { x: 10, y: 0 },
  );
  assert.deepEqual(
    segmentsIntersect(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ),
    { x: 10, y: 0 },
  );
});

test("segmentsIntersect returns null when the lines cross outside the segments", function () {
  assert.equal(
    segmentsIntersect(
      { x: 0, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    ),
    null,
  );
});

test("segmentsIntersect supports a degenerate point on a segment", function () {
  assert.deepEqual(
    segmentsIntersect(
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ),
    { x: 5, y: 5 },
  );
  assert.equal(
    segmentsIntersect(
      { x: 15, y: 15 },
      { x: 15, y: 15 },
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ),
    null,
  );
});

test("segmentsIntersect rejects malformed points", function () {
  assert.equal(
    segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, null, {
      x: 0,
      y: 10,
    }),
    null,
  );
});

test("distanceSquared matches the Euclidean distance squared", function () {
  assert.equal(distanceSquared({ x: 1, y: 2 }, { x: 4, y: 6 }), 25);
  assert.equal(distanceSquared(null, { x: 0, y: 0 }), Infinity);
});
