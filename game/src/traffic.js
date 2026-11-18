// traffic.js — the ambient fleet: what a car is here, and how it drives when nobody is in it.
//
// A car holds a heading, the avenue it runs along, and which side of that avenue's centre line it
// keeps. It accelerates toward its own cruise speed, but a sensor at its nose looks down the lane
// for the nearest thing — another car, the player's car, a cruiser, a body lying in the road — and
// the throttle falls away with the gap, so a boulevard queues behind a stalled taxi and then flows
// again.
//
// At a junction a car may turn, and a turn is never a snap: the car hands its position to a
// quadratic laid from where it is, round the middle of the crossing, into the lane of its new
// avenue, and follows it out facing the new heading. Most cars go straight on, because a grid
// where everything turns is a grid that jams solid.
//
// A `parked` car sits at the kerb with the engine off until somebody steals it; a `stolen` one is
// the player's, and this module stops touching it entirely.

import { FLEET, PAINT } from './scale.js';
import { AVENUES, CITY, KERB } from './cityPlan.js';
import { stream } from './random.js';
import { bezier, bezierTangent } from './mathKit.js';
import { SHAPES, TAXI_YELLOW } from './vehicle.js';

/** A lane's centre, measured from its avenue's centre line. */
export const LANE = 5.3;

export const HEADINGS = [
  { dx: 1, dz: 0 },
  { dx: -1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: 0, dz: -1 },
];

/** Right-hand traffic: eastbound keeps south of the line, southbound keeps west of it. */
export function laneOffset(dir) {
  if (dir.dx !== 0) return dir.dx > 0 ? LANE : -LANE;
  return dir.dz > 0 ? -LANE : LANE;
}

/** The cardinal axis a heading is nearest to. */
export function axisOf(yaw) {
  if (Math.abs(Math.cos(yaw)) >= Math.abs(Math.sin(yaw))) return { dx: Math.cos(yaw) >= 0 ? 1 : -1, dz: 0 };
  return { dx: 0, dz: Math.sin(yaw) >= 0 ? 1 : -1 };
}

/** A car record. `x, z` is its centre, `yaw` its heading from +x, `len` its length along that. */
export function makeCar(kind, x, z, yaw, paint, extra = {}) {
  const shape = SHAPES[kind] ?? SHAPES.sedan;
  return {
    kind,
    len: shape.len,
    wid: shape.wid,
    shape,
    x,
    z,
    yaw,
    speed: 0,
    cruise: shape.top[1] * 0.8,
    dir: axisOf(yaw),
    line: 0,
    turn: null,
    cool: 0,
    paint: paint ?? PAINT.cars[0],
    lights: 0,
    bodyAhead: Infinity,
    stolen: false,
    parked: false,
    condition: 1,
    ...extra,
  };
}

/** A car seated in the lane of avenue `line`, `along` metres up it, heading `dir`. */
export function carInLane(kind, line, along, dir, paint, extra = {}) {
  const off = laneOffset(dir);
  const x = dir.dx !== 0 ? along : line + off;
  const z = dir.dz !== 0 ? along : line + off;
  const car = makeCar(kind, x, z, Math.atan2(dir.dz, dir.dx), paint, extra);
  car.dir = { dx: dir.dx, dz: dir.dz };
  car.line = line;
  return car;
}

/** A car at the kerb: in the lane, pushed toward the pavement, engine off. */
export function kerbCar(kind, line, along, dir, paint) {
  const car = carInLane(kind, line, along, dir, paint, { parked: true });
  const off = laneOffset(dir);
  if (dir.dx !== 0) car.z += off * 1.6;
  else car.x += off * 1.6;
  car.cruise = 0;
  return car;
}

/** How far along its avenue a car has come. */
export function travelled(car) {
  return car.dir.dx !== 0 ? car.x : car.z;
}

/** True inside a junction box, where a car must not be born. */
function inJunction(v) {
  for (const line of AVENUES) if (Math.abs(v - line) < KERB + 2) return true;
  return false;
}

/** The seeded fleet: cars spread around the avenues, with a handful left at the kerb to steal. */
export function seedFleet(seed = 1) {
  const rand = stream(seed * 11 + 3);
  const low = CITY.first + 40;
  const high = CITY.last - 40;
  const cars = [];
  let guard = 0;

  while (cars.length < FLEET.size && guard < FLEET.size * 90) {
    guard += 1;
    const dir = rand.pick(HEADINGS);
    const line = rand.pick(AVENUES);
    const along = Math.floor(rand.between(low, high) / 40) * 40 + 20;
    if (inJunction(along)) continue;
    const kind = rand.pick(['sedan', 'sedan', 'coupe', 'suv', 'cab', 'sedan', 'drop', 'van', 'coupe']);
    const paint = kind === 'cab' ? TAXI_YELLOW : rand.pick(PAINT.cars);
    const car = carInLane(kind, line, along, dir, paint);
    if (cars.some((other) => Math.hypot(other.x - car.x, other.z - car.z) < 26)) continue;
    car.cruise = rand.between(car.shape.top[0], car.shape.top[1]);
    car.speed = rand.between(car.shape.top[0] * 0.55, car.shape.top[1] * 0.75);
    car.condition = rand.between(0.7, 1);
    cars.push(car);
  }

  for (let i = 0; i < 8; i += 1) {
    const dir = rand.pick(HEADINGS);
    const line = rand.pick(AVENUES);
    const along = Math.floor(rand.between(low, high) / 38) * 38 + 24;
    if (inJunction(along)) continue;
    cars.push(kerbCar(rand.pick(['sedan', 'coupe', 'suv', 'drop']), line, along, dir, rand.pick(PAINT.cars)));
  }
  return cars;
}

/** The far kerbs of the grid, where a car that runs off the end turns round. */
export function avenueLimits() {
  return { min: CITY.first, max: CITY.last };
}

/**
 * Advance every AI-driven car one step.
 *
 * `blockers` are bodies a car must not drive through — the player's car and each cruiser — given
 * as {x, z, len}. `onFoot` is the player's position when they are not in a car, so traffic stops
 * for somebody standing in the lane instead of driving through them.
 */
export function driveFleet(cars, dt, blockers = [], onFoot = null) {
  const limits = avenueLimits();
  for (const car of cars) {
    if (car.stolen || car.parked) continue;
    car.cool = Math.max(0, car.cool - dt);
    car.lights = Math.max(0, car.lights - dt * 3.2);

    // ---- the sensor: the nearest body ahead, within the lane.
    let gap = 120;
    for (const other of cars) {
      if (other === car) continue;
      const ahead = (other.x - car.x) * car.dir.dx + (other.z - car.z) * car.dir.dz;
      if (ahead <= 0 || ahead > 46) continue;
      const side = Math.abs((other.x - car.x) * car.dir.dz - (other.z - car.z) * car.dir.dx);
      if (side > 2.7) continue;
      gap = Math.min(gap, ahead - other.len * 0.5 - car.len * 0.5 - 0.6);
    }
    for (const b of blockers) {
      const ahead = (b.x - car.x) * car.dir.dx + (b.z - car.z) * car.dir.dz;
      const side = Math.abs((b.x - car.x) * car.dir.dz - (b.z - car.z) * car.dir.dx);
      if (ahead > 0 && side < 3.0) gap = Math.min(gap, ahead - (b.len ?? 4.6) * 0.5 - car.len * 0.5);
    }
    if (onFoot) {
      const ahead = (onFoot.x - car.x) * car.dir.dx + (onFoot.z - car.z) * car.dir.dz;
      const side = Math.abs((onFoot.x - car.x) * car.dir.dz - (onFoot.z - car.z) * car.dir.dx);
      if (ahead > 0 && side < 2.4) gap = Math.min(gap, ahead - 3);
    }
    if (car.bodyAhead < gap) gap = car.bodyAhead;

    // ---- the throttle: hold the cruise, or fall away with the gap to what is in front.
    const want = gap < 5 ? 0 : gap < 26 ? car.cruise * (0.18 + 0.032 * gap) : car.cruise;
    const rate = want < car.speed ? 5.2 : 1.15;
    car.speed += (want - car.speed) * Math.min(1, dt * rate);
    if (want < car.speed - 0.4) car.lights = Math.min(1, car.lights + dt * (want < 0.5 ? 9 : 5));

    if (car.turn) {
      followTurn(car, dt);
      continue;
    }

    // ---- a junction ahead? Most cars go straight; the rest take the turn.
    const at = travelled(car);
    const sign = car.dir.dx + car.dir.dz;
    for (const line of AVENUES) {
      if (line === car.line) continue;
      const d = (line - at) * sign;
      if (d <= 0.5 || d > 5.5) continue;
      if (car.cool > 0) break;
      // A stable per-car roll: the same junction is a turn for one car and a straight for another,
      // and the same car makes the same decision every time it comes round again.
      const roll = Math.abs(Math.sin(car.x * 0.0017 + car.z * 0.0029 + line * 0.013));
      if (roll < 0.44) break;
      beginTurn(car, line, roll);
      break;
    }
    if (car.turn) continue;

    // ---- straight on down the lane, easing back to its middle.
    const target = car.line + laneOffset(car.dir);
    if (car.dir.dx !== 0) car.z += (target - car.z) * Math.min(1, dt * 2.2);
    else car.x += (target - car.x) * Math.min(1, dt * 2.2);
    car.x += car.dir.dx * car.speed * dt;
    car.z += car.dir.dz * car.speed * dt;
    car.yaw = Math.atan2(car.dir.dz, car.dir.dx);

    // ---- off the end of the grid: turn around onto the far lane of the nearest avenue.
    if (at < limits.min - 8 || at > limits.max + 8) {
      car.dir = { dx: -car.dir.dx, dz: -car.dir.dz };
      const across = car.dir.dx !== 0 ? car.z : car.x;
      car.line = nearestLine(across);
      car.cool = 2;
    }
  }
}

function nearestLine(v) {
  let best = AVENUES[0];
  for (const line of AVENUES) if (Math.abs(line - v) < Math.abs(best - v)) best = line;
  return best;
}

/**
 * Begin a turn through the junction at (cx, cz). The car leaves the crossing a lane offset to the
 * right of its new heading, and the control point sits on the middle of the crossing, so the arc
 * bends the right way and never cuts across the far kerb.
 */
function beginTurn(car, line, roll) {
  const onX = car.dir.dx !== 0;
  // Right-hand traffic: the right turn is the common band, the left the rare one.
  const next = onX
    ? { dx: 0, dz: roll < 0.7 ? car.dir.dx : -car.dir.dx }
    : { dx: roll < 0.7 ? -car.dir.dz : car.dir.dz, dz: 0 };
  const cx = onX ? line : car.line;
  const cz = onX ? car.line : line;
  const off = laneOffset(next);
  const to = next.dx !== 0 ? { x: cx + off, z: cz } : { x: cx, z: cz + off };
  const from = { x: car.x, z: car.z };
  const ctrl = { x: cx, z: cz };
  const len = Math.max(9, Math.hypot(to.x - from.x, to.z - from.z));
  car.turn = { from, ctrl, to, next, line, t: 0, len, pace: Math.max(5.5, Math.min(car.speed, 11)) };
  car.cool = 6;
}

/** Walk the quadratic a turning car is on, and land it in the new lane facing the new way. */
function followTurn(car, dt) {
  const t = car.turn;
  t.t = Math.min(1, t.t + (t.pace * dt) / t.len);
  const at = bezier(t.from, t.ctrl, t.to, t.t);
  car.x = at.x;
  car.z = at.z;
  const tan = bezierTangent(t.from, t.ctrl, t.to, t.t);
  if (tan.x * tan.x + tan.z * tan.z > 1e-5) car.yaw = Math.atan2(tan.z, tan.x);
  if (t.t >= 1) {
    car.dir = { ...t.next };
    car.line = t.line;
    car.turn = null;
    car.speed = Math.min(car.speed, t.pace * 1.1);
    car.cool = 4;
  }
}
