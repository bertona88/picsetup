const TENSION = 0.78;

export function curveSegments(points) {
  if (!Array.isArray(points) || points.length < 2) return [];
  if (points.length === 2) return [{ type: 'line', p0: points[0], p1: points[1] }];
  const segments = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = {
      x: p1.x + ((p2.x - p0.x) / 6) * TENSION,
      y: p1.y + ((p2.y - p0.y) / 6) * TENSION
    };
    const c2 = {
      x: p2.x - ((p3.x - p1.x) / 6) * TENSION,
      y: p2.y - ((p3.y - p1.y) / 6) * TENSION
    };
    segments.push({ type: 'cubic', p0: p1, c1, c2, p1: p2 });
  }
  return segments;
}

export function smoothPath(points) {
  if (!points?.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const segments = curveSegments(points);
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (const segment of segments) {
    if (segment.type === 'line') {
      d += ` L ${segment.p1.x.toFixed(2)} ${segment.p1.y.toFixed(2)}`;
    } else {
      d += ` C ${segment.c1.x.toFixed(2)} ${segment.c1.y.toFixed(2)}, ${segment.c2.x.toFixed(2)} ${segment.c2.y.toFixed(2)}, ${segment.p1.x.toFixed(2)} ${segment.p1.y.toFixed(2)}`;
    }
  }
  return d;
}

const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function cubicLength(segment, tolerance = 0.02, depth = 0) {
  const chord = distance(segment.p0, segment.p1);
  const polygon = distance(segment.p0, segment.c1) + distance(segment.c1, segment.c2) + distance(segment.c2, segment.p1);
  if (depth >= 14 || polygon - chord <= tolerance) return (polygon + chord) / 2;

  const p01 = midpoint(segment.p0, segment.c1);
  const p12 = midpoint(segment.c1, segment.c2);
  const p23 = midpoint(segment.c2, segment.p1);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const p0123 = midpoint(p012, p123);
  return cubicLength({ type: 'cubic', p0: segment.p0, c1: p01, c2: p012, p1: p0123 }, tolerance / 2, depth + 1)
    + cubicLength({ type: 'cubic', p0: p0123, c1: p123, c2: p23, p1: segment.p1 }, tolerance / 2, depth + 1);
}

export function curveLength(points, tolerance = 0.02) {
  return curveSegments(points).reduce((total, segment) => total + (segment.type === 'line' ? distance(segment.p0, segment.p1) : cubicLength(segment, tolerance)), 0);
}

export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < (points?.length ?? 0); i += 1) total += distance(points[i - 1], points[i]);
  return total;
}

export function cubicPoint(segment, t) {
  if (segment.type === 'line') {
    return {
      x: segment.p0.x + (segment.p1.x - segment.p0.x) * t,
      y: segment.p0.y + (segment.p1.y - segment.p0.y) * t
    };
  }
  const u = 1 - t;
  const a = u ** 3;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t ** 3;
  return {
    x: a * segment.p0.x + b * segment.c1.x + c * segment.c2.x + d * segment.p1.x,
    y: a * segment.p0.y + b * segment.c1.y + c * segment.c2.y + d * segment.p1.y
  };
}


function cubicDerivatives(segment, t) {
  if (segment.type === 'line') {
    return {
      first: { x: segment.p1.x - segment.p0.x, y: segment.p1.y - segment.p0.y },
      second: { x: 0, y: 0 }
    };
  }
  const u = 1 - t;
  const first = {
    x: 3 * (u * u * (segment.c1.x - segment.p0.x) + 2 * u * t * (segment.c2.x - segment.c1.x) + t * t * (segment.p1.x - segment.c2.x)),
    y: 3 * (u * u * (segment.c1.y - segment.p0.y) + 2 * u * t * (segment.c2.y - segment.c1.y) + t * t * (segment.p1.y - segment.c2.y))
  };
  const second = {
    x: 6 * (u * (segment.c2.x - 2 * segment.c1.x + segment.p0.x) + t * (segment.p1.x - 2 * segment.c2.x + segment.c1.x)),
    y: 6 * (u * (segment.c2.y - 2 * segment.c1.y + segment.p0.y) + t * (segment.p1.y - 2 * segment.c2.y + segment.c1.y))
  };
  return { first, second };
}

/**
 * Returns the smallest local radius of curvature of the rendered route.
 * Straight segments report Infinity. The estimate samples the exact cubic
 * Bezier representation used by smoothPath, so bend checks match the view.
 */
export function curveMinimumRadius(points, samplesPerSegment = 64) {
  const segments = curveSegments(points);
  if (!segments.length) return { radius: Number.POSITIVE_INFINITY, point: points?.[0] ?? null, segmentIndex: -1, t: 0 };
  let best = { radius: Number.POSITIVE_INFINITY, point: segments[0].p0, segmentIndex: 0, t: 0 };
  segments.forEach((segment, segmentIndex) => {
    if (segment.type === 'line') return;
    const samples = Math.max(8, Math.round(samplesPerSegment));
    for (let index = 0; index <= samples; index += 1) {
      const t = index / samples;
      const { first, second } = cubicDerivatives(segment, t);
      const speed2 = first.x * first.x + first.y * first.y;
      const cross = Math.abs(first.x * second.y - first.y * second.x);
      if (speed2 < 1e-18 || cross < 1e-18) continue;
      const radius = Math.pow(speed2, 1.5) / cross;
      if (Number.isFinite(radius) && radius < best.radius) best = { radius, point: cubicPoint(segment, t), segmentIndex, t };
    }
  });
  return best;
}

export function sampleCurve(points, samplesPerSegment = 24) {
  const segments = curveSegments(points);
  if (!segments.length) return points ? [...points] : [];
  const out = [segments[0].p0];
  for (const segment of segments) {
    for (let i = 1; i <= samplesPerSegment; i += 1) out.push(cubicPoint(segment, i / samplesPerSegment));
  }
  return out;
}
