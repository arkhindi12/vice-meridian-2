// random.js — one seeded stream, so a photograph is the same photograph every time.
//
// Everything laid out at load — the block plan, the skyline, the fleet, the crowd, the lit windows —
// comes from a stream built here. mulberry32: one 32-bit word of state, two multiply-xor rounds, a
// division. `?seed=4` therefore builds the same town on every machine, and a staged shot replays
// exactly.

/** A random stream. Call it for a float in [0, 1); it carries a few shape helpers too. */
export function stream(seed = 1) {
  let state = (Math.imul(seed | 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  if (state === 0) state = 0x6d2b79f5;

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** A float in [lo, hi). */
  next.between = (lo, hi) => lo + next() * (hi - lo);
  /** An integer in [lo, hi], both ends included. */
  next.int = (lo, hi) => Math.floor(lo + next() * (hi - lo + 1));
  /** One member of a list. */
  next.pick = (list) => list[Math.min(list.length - 1, Math.floor(next() * list.length))];
  /** True with probability p. */
  next.chance = (p = 0.5) => next() < p;
  /** Either -1 or 1. */
  next.sign = () => (next() < 0.5 ? -1 : 1);

  return next;
}

/** A stable 0..1 number from any integer, for decisions that must not change between frames. */
export function hash01(n) {
  let t = (Math.imul(n | 0, 0x27d4eb2d) ^ 0x165667b1) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  return ((t ^ (t >>> 13)) >>> 0) / 4294967296;
}
