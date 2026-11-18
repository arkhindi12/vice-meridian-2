// crowd.js — the pedestrians: people walking the pavements, and what a gunshot does to them.
//
// A person is a small record — a spot, a direction, a stride phase, a mood. They walk the strip
// between the kerb and a building's setback, turn at the corners when the wander takes them, and
// never walk into a wall: if the next step meets one they turn instead.
//
// A shot within earshot turns everybody round and sends them running away from it, and the sight of
// a body does the same to anybody close enough to see one. A round that lands on a person drops
// them, and that is permanent: the record stays where it fell with `down` counting the seconds
// since, which is what the renderer lays them out with.
//
// Nothing here knows what a mesh is. The renderer reads x, z, yaw, phase, moving, run and down.

import { CROWD, PAINT } from './scale.js';
import { AVENUES, CITY, KERB, SETBACK, SHORE, districtOf } from './cityPlan.js';
import { stream } from './random.js';
import { fold } from './mathKit.js';

// The pavement a pedestrian keeps to: just outside the kerb, just inside the building line.
const PAVE_IN = KERB + 1.6;
const PAVE_OUT = KERB + SETBACK - 1.4;

/** A person. `extra` overrides any field, which is how a staged scene dresses one. */
export function makePerson(rand, x, z, yaw = 0, extra = {}) {
  return {
    x,
    z,
    yaw,
    dir: { x: Math.cos(yaw), z: Math.sin(yaw) },
    pace: rand.between(CROWD.stroll[0], CROWD.stroll[1]),
    phase: rand.between(0, Math.PI * 2),
    moving: 1,
    run: 0,
    down: 0,
    panic: 0,
    hat: rand.chance(0.22),
    skin: rand.pick(PAINT.skins),
    shirt: rand.pick(PAINT.tops),
    trousers: rand.pick(PAINT.legs),
    bag: rand.chance(0.25),
    district: 'street',
    ...extra,
  };
}

/** The seeded crowd: people spread along both sides of every avenue. */
export function seedCrowd(seed = 1) {
  const rand = stream(seed);
  const last = AVENUES[AVENUES.length - 1];
  const people = [];
  let guard = 0;
  while (people.length < CROWD.size && guard < CROWD.size * 40) {
    guard += 1;
    const alongX = rand.chance();
    const line = rand.pick(AVENUES);
    const side = rand.sign();
    const along = rand.between(-2, last + 2);
    const off = rand.between(PAVE_IN + 0.6, PAVE_OUT - 0.6);
    const x = alongX ? along : line + side * off;
    const z = alongX ? line + side * off : along;
    if (x < SHORE.water + 2 || z > SHORE.bay - 2) continue;
    const stride = rand.sign();
    const yaw = alongX ? (stride > 0 ? 0 : Math.PI) : stride > 0 ? Math.PI / 2 : -Math.PI / 2;
    people.push(makePerson(rand, x, z, yaw));
  }
  return people;
}

/**
 * A shot went off at (x, z): everybody within `radius` turns and runs the other way. `onFirst` is
 * called once, for the first person who heard it, which is how the caller learns somebody saw.
 */
export function scatter(people, x, z, radius = 46, onFirst = null) {
  let first = true;
  for (const p of people) {
    if (p.down > 0) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d > radius) continue;
    // Straight away from the noise, with a little shoulder room so a crowd fans out.
    const a = Math.atan2(p.z - z, p.x - x) + Math.sin(p.phase * 7.3) * 0.5;
    p.dir = { x: Math.cos(a), z: Math.sin(a) };
    p.yaw = a;
    p.panic = CROWD.panic + Math.min(3, d * 0.05);
    p.run = 1;
    if (first && onFirst) {
      onFirst(p);
      first = false;
    }
  }
}

/** Somebody saw a body: they run from it, a beat later than they ran from the shot. */
function flinchFromBodies(people, i) {
  const p = people[i];
  for (let k = 0; k < people.length; k += 1) {
    if (k === i) continue;
    const other = people[k];
    if (other.down <= 0) continue;
    if (Math.hypot(p.x - other.x, p.z - other.z) > 14) continue;
    const a = Math.atan2(p.z - other.z, p.x - other.x);
    p.dir = { x: Math.cos(a), z: Math.sin(a) };
    p.yaw = a;
    p.panic = Math.max(p.panic, 2.6);
    return;
  }
}

/**
 * Step the crowd. `time` only drives a slow wander so nobody walks a perfect line; `player` is
 * passed when the player is on foot, so the crowd parts around them instead of through them.
 */
export function walkCrowd(people, dt, time, plan, player = null) {
  const last = AVENUES[AVENUES.length - 1];
  for (let i = 0; i < people.length; i += 1) {
    const p = people[i];
    if (p.down > 0) {
      p.down += dt;
      continue;
    }
    p.panic = Math.max(0, p.panic - dt);
    const fleeing = p.panic > 0.3;
    p.run = fleeing ? 1 : 0;
    const speed = fleeing ? CROWD.bolt : p.pace;
    if (fleeing && p.panic > CROWD.panic - 0.4) flinchFromBodies(people, i);
    p.phase += dt * (fleeing ? 13 : 5.6) * (p.pace / 1.5);

    // The body turns toward where it is going, at a walking rate.
    const want = Math.atan2(p.dir.z, p.dir.x);
    p.yaw += Math.max(-8 * dt, Math.min(8 * dt, fold(want - p.yaw)));

    const mag = Math.hypot(p.dir.x, p.dir.z) || 1;
    const nx = p.x + (p.dir.x / mag) * speed * dt;
    const nz = p.z + (p.dir.z / mag) * speed * dt;
    if (plan.isOpen(nx, nz, 0.35)) {
      p.x = nx;
      p.z = nz;
      p.moving = 1;
    } else {
      // A wall or the water: turn hard, and if running, turn along it rather than into it.
      const a = fleeing ? p.yaw + Math.PI * 0.5 * (Math.sin(p.phase * 0.7) > 0 ? 1 : -1) : p.yaw + Math.PI;
      p.dir = { x: Math.cos(a), z: Math.sin(a) };
      p.moving = fleeing ? 1 : 0;
    }

    if (!fleeing) {
      // A pedestrian turns off the pavement now and then, but only near a corner.
      const nearLine = AVENUES.some((l) => Math.abs(p.x - l) < PAVE_OUT + 2 || Math.abs(p.z - l) < PAVE_OUT + 2);
      if (nearLine && Math.sin(p.x * 0.011 + p.z * 0.007 + time * 0.31) > 0.985) {
        p.dir = Math.sin(p.phase * 3.1) > 0 ? { x: -p.dir.z, z: p.dir.x } : { x: p.dir.z, z: -p.dir.x };
      }
      // And nobody walks into the same wall twice: glance a couple of metres ahead.
      const alongX = Math.abs(Math.cos(p.yaw)) > 0.5;
      if (alongX && plan.buildingAt(p.x + Math.cos(p.yaw) * 2.5, p.z, 0.3)) p.dir = { x: -p.dir.x, z: p.dir.z };
      if (!alongX && plan.buildingAt(p.x, p.z + Math.sin(p.yaw) * 2.5, 0.3)) p.dir = { x: p.dir.x, z: -p.dir.z };
    } else {
      // Somebody running from the street keeps inside the grid: the edge turns them along it.
      if (p.x < CITY.first || p.x > last) p.dir = { x: -p.dir.x, z: p.dir.z };
      if (p.z < CITY.first || p.z > last) p.dir = { x: p.dir.x, z: -p.dir.z };
    }

    // The player shoulders through a crowd rather than over it.
    if (player) {
      const gap = Math.hypot(p.x - player.x, p.z - player.z);
      if (gap < 1.1 && gap > 0.001) {
        p.x += ((p.x - player.x) / gap) * (1.1 - gap);
        p.z += ((p.z - player.z) / gap) * (1.1 - gap);
      }
    }
    p.district = districtOf(p.x, p.z);
  }
}

/** The nearest standing person within `r` of a point, or null. */
export function personAt(people, x, z, r = 0.6) {
  let best = null;
  let gap = r;
  for (const p of people) {
    if (p.down > 0) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < gap) {
      gap = d;
      best = p;
    }
  }
  return best;
}

/** Drop everybody within `r` of a point. Returns how many fell. */
export function fellAt(people, x, z, r = 0.75) {
  let fell = 0;
  for (const p of people) {
    if (p.down > 0) continue;
    if (Math.hypot(p.x - x, p.z - z) < r) {
      p.down = 0.001;
      p.moving = 0;
      fell += 1;
    }
  }
  return fell;
}

/**
 * How far ahead a car may drive before somebody lying in its path stops it. Walking people do not
 * block traffic; a body in the lane does, which is what makes a shootout jam the street.
 */
export function bodyAhead(people, x, z, yaw, reach = 12, halfWidth = 1.6) {
  let best = Infinity;
  const fx = Math.cos(yaw);
  const fz = Math.sin(yaw);
  for (const p of people) {
    if (p.down <= 0) continue;
    const dx = p.x - x;
    const dz = p.z - z;
    const ahead = dx * fx + dz * fz;
    if (ahead <= 0 || ahead >= reach) continue;
    if (Math.abs(dx * fz - dz * fx) >= halfWidth) continue;
    best = Math.min(best, ahead - 1.4);
  }
  return best;
}

export { PAVE_IN, PAVE_OUT };
