/**
 * Geometry helpers for the canvas physics layers.
 *
 * The wall physics (movement collision, and later line-of-sight / shadow
 * casting) is built on exact line-segment intersection math. Nothing in this
 * module touches PixiJS or the DOM so it can run headless in tests.
 */

/** Tolerance used for parallel/degenerate comparisons. */
const EPSILON = 1e-9;

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function isFinitePoint(point) {
  return Boolean(
    point &&
      typeof point === "object" &&
      Number.isFinite(Number(point.x)) &&
      Number.isFinite(Number(point.y)),
  );
}

/**
 * Intersection point of segments `p1 → p2` and `p3 → p4`.
 *
 * Uses the cross-product form of the parametric line equations:
 *
 *   p1 + t·r = p3 + u·s,  r = p2 − p1,  s = p4 − p3
 *   t = (q × s) / (r × s),  u = (q × r) / (r × s),  q = p3 − p1
 *
 * The denominator `r × s` is checked against zero before any division, so
 * parallel (or collinear) segments never divide by zero. Collinear overlaps
 * return the first shared point along `p1 → p2`; segments that only touch at
 * an endpoint return that endpoint.
 *
 * @param {{x:number,y:number}} p1
 * @param {{x:number,y:number}} p2
 * @param {{x:number,y:number}} p3
 * @param {{x:number,y:number}} p4
 * @returns {{x:number,y:number}|null}
 */
export function segmentsIntersect(p1, p2, p3, p4) {
  if (!isFinitePoint(p1) || !isFinitePoint(p2) || !isFinitePoint(p3) || !isFinitePoint(p4)) {
    return null;
  }

  const x1 = Number(p1.x);
  const y1 = Number(p1.y);
  const x2 = Number(p2.x);
  const y2 = Number(p2.y);
  const x3 = Number(p3.x);
  const y3 = Number(p3.y);
  const x4 = Number(p4.x);
  const y4 = Number(p4.y);

  const rx = x2 - x1;
  const ry = y2 - y1;
  const sx = x4 - x3;
  const sy = y4 - y3;
  const rLengthSquared = rx * rx + ry * ry;
  const sLengthSquared = sx * sx + sy * sy;

  // Degenerate segment p1 == p2: the "segment" is a single point.
  if (rLengthSquared <= EPSILON * EPSILON) {
    if (sLengthSquared <= EPSILON * EPSILON) {
      return Math.abs(x1 - x3) <= EPSILON && Math.abs(y1 - y3) <= EPSILON
        ? { x: x1, y: y1 }
        : null;
    }
    const t = ((x1 - x3) * sx + (y1 - y3) * sy) / sLengthSquared;
    if (t < -EPSILON || t > 1 + EPSILON) {
      return null;
    }
    // The projection alone is not enough: the point must sit on the line.
    const onLine = cross(sx, sy, x1 - x3, y1 - y3);
    const tolerance = EPSILON * Math.sqrt(sLengthSquared);
    return Math.abs(onLine) <= tolerance ? { x: x1, y: y1 } : null;
  }

  // Degenerate segment p3 == p4: mirror the point-on-segment check.
  if (sLengthSquared <= EPSILON * EPSILON) {
    const t = ((x3 - x1) * rx + (y3 - y1) * ry) / rLengthSquared;
    if (t < -EPSILON || t > 1 + EPSILON) {
      return null;
    }
    const onLine = cross(rx, ry, x3 - x1, y3 - y1);
    const tolerance = EPSILON * Math.sqrt(rLengthSquared);
    return Math.abs(onLine) <= tolerance ? { x: x3, y: y3 } : null;
  }

  const qpx = x3 - x1;
  const qpy = y3 - y1;
  const denominator = cross(rx, ry, sx, sy);

  // Parallel check scaled by the vector lengths keeps the test stable for
  // very short and very long segments alike.
  const parallelTolerance = EPSILON * Math.sqrt(rLengthSquared * sLengthSquared);
  if (Math.abs(denominator) <= parallelTolerance) {
    // Parallel but not collinear: no intersection.
    const collinearTolerance = EPSILON * Math.sqrt(rLengthSquared);
    if (Math.abs(cross(qpx, qpy, rx, ry)) > collinearTolerance) {
      return null;
    }

    // Collinear: project p3/p4 onto p1 → p2 and keep the shared interval.
    const t3 = ((x3 - x1) * rx + (y3 - y1) * ry) / rLengthSquared;
    const t4 = ((x4 - x1) * rx + (y4 - y1) * ry) / rLengthSquared;
    const start = Math.max(0, Math.min(t3, t4));
    const end = Math.min(1, Math.max(t3, t4));
    if (start > end + EPSILON) {
      return null;
    }
    const t = Math.min(1, Math.max(0, start));
    return { x: x1 + t * rx, y: y1 + t * ry };
  }

  const t = cross(qpx, qpy, sx, sy) / denominator;
  const u = cross(qpx, qpy, rx, ry) / denominator;
  if (
    t < -EPSILON ||
    t > 1 + EPSILON ||
    u < -EPSILON ||
    u > 1 + EPSILON
  ) {
    return null;
  }

  return { x: x1 + t * rx, y: y1 + t * ry };
}

/** Squared distance between two points (avoids a square root in hot loops). */
export function distanceSquared(a, b) {
  if (!isFinitePoint(a) || !isFinitePoint(b)) {
    return Infinity;
  }
  const dx = Number(b.x) - Number(a.x);
  const dy = Number(b.y) - Number(a.y);
  return dx * dx + dy * dy;
}

// ---------------------------------------------------------------- raycasting

/** Falls back to a full circle when no wall distance can stop a ray. */
export const DEFAULT_ARC_SAMPLES = 180;

/** Two extra rays are cast this far (radians) on each side of every corner. */
export const DEFAULT_RAY_EPSILON = 1e-5;

const TWO_PI = Math.PI * 2;

/** Rays that hit the ray origin itself are ignored (tolerance in pixels). */
const MIN_HIT_DISTANCE = 1e-6;

function isDoorLikeWall(wall) {
  return wall.type === "door" || wall.type === "secret";
}

function isOpenDoor(wall) {
  return wall.open === true || wall.isOpen === true;
}

/**
 * Vision/light filter (Step 5.2).
 *
 * `invisible` walls are not part of the sight simulation at all: rays and
 * shadow polygons pass straight through them. `ethereal` walls are invisible
 * to movement but fully opaque to sight. Ordinary walls, `terrain` walls and
 * closed (or locked) doors/secret doors block. Open, unlocked doors do not.
 *
 * Terrain is only *partially* transparent: the raycast allows a ray to cross a
 * single `terrain` wall and stops it at the next blocking wall.
 *
 * @param {object} wall
 * @returns {boolean} true when the wall belongs to the sight simulation
 */
export function wallBlocksSight(wall) {
  if (!wall || typeof wall !== "object") {
    return false;
  }
  if (wall.type === "invisible") {
    return false;
  }
  if (isDoorLikeWall(wall)) {
    if (wall.locked === true) {
      return true;
    }
    return !isOpenDoor(wall);
  }
  // normal / terrain / ethereal and any unknown type block sight.
  return true;
}

function normalizeAngle(angle) {
  let normalized = angle % TWO_PI;
  if (normalized < 0) {
    normalized += TWO_PI;
  }
  return normalized;
}

function wallEndpointList(wall) {
  const x1 = Number(wall.x1);
  const y1 = Number(wall.y1);
  const x2 = Number(wall.x2);
  const y2 = Number(wall.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return null;
  }
  if (x1 === x2 && y1 === y2) {
    return null;
  }
  return {
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
  };
}

/**
 * Nearest visible point along one ray. All blocking walls are intersected,
 * sorted by distance and then consumed with the terrain rule:
 *
 *   first `terrain` hit  -> pass through and keep walking;
 *   any later hit        -> stop there (`terrain`, `normal`, `ethereal`, …).
 *
 * @param {{x:number,y:number}} origin
 * @param {number} angle
 * @param {number} radius
 * @param {Array<object>} walls sight blockers (raw wall records)
 * @returns {{x:number,y:number}}
 */
export function castVisibilityRay(origin, angle, radius, walls) {
  const segments = prepareSightSegments(walls);
  return castRayAgainstSegments(
    Number(origin.x),
    Number(origin.y),
    angle,
    radius,
    segments,
  );
}

/**
 * Normalize raw wall records into blocking segments once, so a polygon with
 * hundreds of rays does not re-parse every wall for every ray.
 */
function prepareSightSegments(walls) {
  const segments = [];
  for (const wall of Array.isArray(walls) ? walls : []) {
    if (!wallBlocksSight(wall)) {
      continue;
    }
    const endpoints = wallEndpointList(wall);
    if (!endpoints) {
      continue;
    }
    segments.push({
      start: endpoints.start,
      end: endpoints.end,
      type: wall.type,
    });
  }
  return segments;
}

function castRayAgainstSegments(ox, oy, angle, radius, segments) {
  const originPoint = { x: ox, y: oy };
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const end = { x: ox + dx * radius, y: oy + dy * radius };
  const hits = [];

  for (const segment of segments) {
    const point = segmentsIntersect(originPoint, end, segment.start, segment.end);
    if (!point) {
      continue;
    }
    const distance = Math.hypot(point.x - ox, point.y - oy);
    if (distance <= MIN_HIT_DISTANCE || distance > radius + 1e-6) {
      continue;
    }
    hits.push({
      point: point,
      distance: distance,
      type: segment.type,
    });
  }

  hits.sort(function (left, right) {
    return left.distance - right.distance;
  });

  let crossedTerrain = false;
  for (const hit of hits) {
    if (hit.type === "terrain" && !crossedTerrain) {
      crossedTerrain = true;
      continue;
    }
    return hit.point;
  }
  return end;
}

/**
 * Build the shadow-cast polygon used by lights and token vision.
 *
 * Algorithm:
 *  1. Every sight-blocking wall endpoint inside the radius contributes a ray
 *     (plus two rays offset by ±`epsilon` radians so corners are both hit and
 *     passed).
 *  2. Uniform rays around the full circle close the open arcs of the circle,
 *     so a lone wall or an open field still yields a correct visible polygon.
 *  3. Each ray resolves to its nearest visible point with the PF2e terrain
 *     rule (one terrain wall is see-through, the second one stops the ray).
 *  4. Points are sorted by `Math.atan2` / ray angle and returned as the vertex
 *     list for a `PIXI.Polygon`.
 *
 * @param {{x:number,y:number}} origin
 * @param {number} radius
 * @param {Array<object>} walls
 * @param {"vision"|"light"} [type]
 * @param {{arcSamples?:number, epsilon?:number}} [options]
 * @returns {Array<{x:number,y:number}>}
 */
export function computePolygon(origin, radius, walls, type = "vision", options = {}) {
  if (!isFinitePoint(origin)) {
    return [];
  }
  const ox = Number(origin.x);
  const oy = Number(origin.y);
  const visionRadius = Number(radius);
  if (!Number.isFinite(visionRadius) || visionRadius <= 0) {
    return [];
  }
  const arcSamples = Math.max(
    8,
    Math.trunc(Number(options.arcSamples) || DEFAULT_ARC_SAMPLES),
  );
  const epsilon = Number.isFinite(Number(options.epsilon))
    ? Math.abs(Number(options.epsilon))
    : DEFAULT_RAY_EPSILON;

  const blockers = prepareSightSegments(walls);

  const angles = [];
  const radiusSquared = visionRadius * visionRadius;

  for (const segment of blockers) {
    for (const endpoint of [segment.start, segment.end]) {
      const dx = endpoint.x - ox;
      const dy = endpoint.y - oy;
      if (dx * dx + dy * dy > radiusSquared) {
        continue;
      }
      const angle = Math.atan2(dy, dx);
      angles.push(normalizeAngle(angle - epsilon));
      angles.push(normalizeAngle(angle));
      angles.push(normalizeAngle(angle + epsilon));
    }
  }

  // Uniform angular sampling keeps open arcs of the circle from collapsing
  // into a single chord when a lone wall is the only blocker.
  for (let index = 0; index < arcSamples; index += 1) {
    angles.push((index / arcSamples) * TWO_PI);
  }

  angles.sort(function (left, right) {
    return left - right;
  });

  const points = [];
  let previousAngle = null;
  for (const angle of angles) {
    if (previousAngle !== null && Math.abs(angle - previousAngle) <= 1e-7) {
      continue;
    }
    previousAngle = angle;
    points.push({
      angle: angle,
      point: castRayAgainstSegments(ox, oy, angle, visionRadius, blockers),
    });
  }

  points.sort(function (left, right) {
    return left.angle - right.angle;
  });
  return points.map(function (entry) {
    return entry.point;
  });
}

/**
 * Even-odd point-in-polygon test for the raycast vision polygon.
 *
 * @param {{x:number,y:number}} point
 * @param {Array<{x:number,y:number}>} polygon
 * @returns {boolean}
 */
export function pointInPolygon(point, polygon) {
  if (!isFinitePoint(point) || !Array.isArray(polygon) || polygon.length < 3) {
    return false;
  }
  const x = Number(point.x);
  const y = Number(point.y);
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    if (!isFinitePoint(currentPoint) || !isFinitePoint(previousPoint)) {
      return false;
    }
    const xi = Number(currentPoint.x);
    const yi = Number(currentPoint.y);
    const xj = Number(previousPoint.x);
    const yj = Number(previousPoint.y);
    const crosses = yi > y !== yj > y;
    if (
      crosses &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}
