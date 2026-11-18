// mathKit.js — the small arithmetic four other modules would each write differently.
//
// Headings are radians measured from +x toward +z, the same convention as atan2(z, x), so a yaw can
// go straight into Math.cos and Math.sin. Everything here is pure and allocation-light.

export const FULL = Math.PI * 2;

/** Fold a heading into (-PI, PI]. */
export function fold(a) {
  let r = a % FULL;
  if (r > Math.PI) r -= FULL;
  if (r <= -Math.PI) r += FULL;
  return r;
}

/** Turn `from` toward `to` by at most `step`, the short way round. */
export function swing(from, to, step) {
  const gap = fold(to - from);
  return from + Math.max(-step, Math.min(step, gap));
}

export function clip(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Exponential ease toward a target, frame-rate independent. */
export function fade(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

export function dist(ax, az, bx, bz) {
  return Math.hypot(bx - ax, bz - az);
}

/** Quadratic Bezier at t on a 2D control triangle. */
export function bezier(from, ctrl, to, t) {
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x,
    z: u * u * from.z + 2 * u * t * ctrl.z + t * t * to.z,
  };
}

export function bezierTangent(from, ctrl, to, t) {
  const u = 1 - t;
  return {
    x: 2 * u * (ctrl.x - from.x) + 2 * t * (to.x - ctrl.x),
    z: 2 * u * (ctrl.z - from.z) + 2 * t * (to.z - ctrl.z),
  };
}
