// player.js — the body on the street, the hands on the wheel, and the pistol.
//
// Everything about the player that is not a drawing decision lives here. They walk with a wall slide
// and refuse the sea, take and leave cars, steer one they have taken, fire the pistol and let the
// rounds fly, take damage through armour and die. Health, condition and cash belong to the run; the
// story chain is saved elsewhere.
//
// Input arrives as plain data — { move: {x, z}, aim: {x, z} | null, fire, use, run, reload } — with
// `move` already mapped into world space, which is what lets a staged photograph drive the player
// from a script rather than a keyboard.

import { GAIT, DRIVE, GUN } from './scale.js';
import { swing } from './mathKit.js';
import { makeCar } from './traffic.js';

/** Where the run starts, and where the player wakes up after an arrest or a bad night. */
export const HOME = { x: 118, z: 1500 };

export function newPlayer() {
  return {
    x: HOME.x,
    z: HOME.z,
    yaw: Math.PI / 2,
    aimYaw: Math.PI / 2,
    phase: 0,
    moving: 0,
    running: 0,
    speed: 0,
    hp: 100,
    hpMax: 100,
    armour: 0,
    clip: GUN.magazine,
    ammo: GUN.pouch,
    reload: 0,
    cool: 0,
    muzzle: 0,
    recoil: 0,
    hurt: 0,
    driving: null,
    lastCar: null,
  };
}

// ---------------------------------------------------------------- on foot

/**
 * Walk, on this frame's input. The legs turn toward the walk vector while the shoulders and the gun
 * arm follow the aim, so the player can strafe with the pistol held on a target.
 */
export function walkPlayer(sim, dt, input) {
  const p = sim.player;
  const move = input.move ?? { x: 0, z: 0 };
  const mag = Math.hypot(move.x, move.z);
  const running = !!input.run && mag > 0.1;
  const target = mag > 0.01 ? (running ? GAIT.sprint : GAIT.walk) : 0;
  p.speed += (target - p.speed) * Math.min(1, dt * 10);

  if (mag > 0.01) {
    p.moving = 1;
    p.running = running ? 1 : 0;
    slide(sim, p, (move.x / mag) * p.speed * dt, (move.z / mag) * p.speed * dt);
    p.phase += dt * (running ? 12.5 : 7.0) * Math.min(1.15, p.speed / GAIT.walk);
    p.yaw = swing(p.yaw, Math.atan2(move.z, move.x), GAIT.pivot * dt);
  } else {
    p.moving = 0;
    p.running = 0;
    p.phase += dt * 1.6;
  }
  if (input.aim) p.aimYaw = Math.atan2(input.aim.z - p.z, input.aim.x - p.x);
  else if (mag > 0.01) p.aimYaw = p.yaw;
}

/** Move with a wall slide along each axis, and no swimming. */
function slide(sim, p, dx, dz) {
  const r = GAIT.girth;
  const plan = sim.plan;
  if (!plan.buildingAt(p.x + dx, p.z, r) && !plan.inWater(p.x + dx, p.z)) p.x += dx;
  if (!plan.buildingAt(p.x, p.z + dz, r) && !plan.inWater(p.x, p.z + dz)) p.z += dz;
}

// ---------------------------------------------------------------- driving

/**
 * Steer the car the player is in. Throttle from W, brake from S, wheel from A and D. Steering falls
 * off with speed, so a car at forty metres a second cannot swing like one at ten; a wall scrapes it
 * down, costs condition, and hurts a little.
 */
export function drivePlayer(sim, dt, input) {
  const p = sim.player;
  const car = p.driving;
  if (!car) return;
  const throttle = input.move?.z < -0.1 ? 1 : 0;
  const brake = input.move?.z > 0.1 ? 1 : 0;
  const wheel = input.move?.x ?? 0;

  if (throttle) {
    // A tired car pulls less hard and tops out lower: condition is not only cosmetic.
    const bite = (1 - Math.min(0.75, (Math.abs(car.speed) / (DRIVE.vmax * (0.62 + 0.38 * car.condition))) * 0.9)) * (0.72 + 0.28 * car.condition);
    car.speed += DRIVE.push * bite * dt;
  } else if (brake) {
    car.speed -= DRIVE.stop * dt * (car.speed > 0 ? 1 : 0.35);
  } else {
    car.speed -= Math.sign(car.speed) * DRIVE.coast * dt;
  }
  car.speed = Math.max(-DRIVE.vreverse, Math.min(DRIVE.vmax, car.speed));
  if (Math.abs(car.speed) < 0.2 && !throttle) car.speed = 0;

  const grip = Math.min(1, Math.abs(car.speed) / 9) * (1 - Math.min(0.55, (Math.abs(car.speed) / DRIVE.vmax) * 0.55));
  car.yaw += wheel * DRIVE.steer * grip * dt * (car.speed < -0.5 ? -1 : 1);
  car.lights = brake || (car.speed < 1 && throttle) ? 1 : Math.max(0, car.lights - dt * 4);
  sim.turning = Math.abs(wheel) * grip;

  const vx = Math.cos(car.yaw) * car.speed;
  const vz = Math.sin(car.yaw) * car.speed;
  const nx = car.x + vx * dt;
  const nz = car.z + vz * dt;
  const solid = (x, z) => sim.plan.buildingAt(x, z, 1.05) || sim.plan.inWater(x, z);
  let moved = 0;
  if (!solid(nx, car.z)) {
    car.x = nx;
    moved += Math.abs(vx * dt);
  }
  if (!solid(car.x, nz)) {
    car.z = nz;
    moved += Math.abs(vz * dt);
  }
  const wanted = Math.hypot(vx * dt, vz * dt);
  if (wanted > 0.001 && moved < wanted * 0.55) {
    // A wall, not a slide: the car scrapes to a stop, it hurts, and the bodywork pays.
    const hit = Math.abs(car.speed);
    car.speed *= -0.18;
    sim.shake = Math.max(sim.shake, Math.min(0.7, hit * 0.03 + 0.15));
    if (hit > 3) {
      hurt(sim, Math.min(6, hit * 0.4));
      damageCar(sim, car, hit * 0.012);
    }
  }

  // Bumping traffic: shove the other car along, give up some speed, take some damage.
  for (const other of sim.traffic) {
    if (other === car) continue;
    const ox = other.x - car.x;
    const oz = other.z - car.z;
    const d = Math.hypot(ox, oz);
    const min = (other.len + car.len) * 0.42;
    if (d >= min || d <= 0.01) continue;
    const push = (min - d) * 0.6;
    other.x += (ox / d) * push;
    other.z += (oz / d) * push;
    if (!other.parked && !other.stolen) other.speed = Math.max(other.speed, Math.abs(car.speed) * 0.6);
    if (Math.abs(car.speed) > 6) damageCar(sim, car, Math.abs(car.speed) * 0.006);
    car.speed *= 0.88;
    sim.shake = Math.max(sim.shake, 0.3);
  }

  p.x = car.x;
  p.z = car.z;
  p.yaw = car.yaw;
  p.aimYaw = car.yaw;
  p.moving = Math.abs(car.speed) > 0.5 ? 1 : 0;
  p.running = Math.abs(car.speed) > 20 ? 1 : 0;
}

/** Knock a car's condition down and let the frame loop see it. */
export function damageCar(sim, car, amount) {
  const before = car.condition;
  car.condition = Math.max(0, car.condition - amount);
  if (before > 0.35 && car.condition <= 0.35) sim.events.onCrunch?.();
}

/** E: leave the car the player is in, or take the nearest one within reach. */
export function toggleVehicle(sim) {
  const p = sim.player;
  if (p.driving) {
    const car = p.driving;
    car.speed *= 0.2;
    // Step out on the driver's side, if there is room there.
    const side = car.yaw + Math.PI / 2;
    const ox = car.x + Math.cos(side) * (car.wid * 0.5 + 0.9);
    const oz = car.z + Math.sin(side) * (car.wid * 0.5 + 0.9);
    if (sim.plan.isOpen(ox, oz, 0.4)) {
      p.x = ox;
      p.z = oz;
    }
    p.driving = null;
    p.yaw = car.yaw;
    return true;
  }
  const near = nearestCar(sim, GAIT.reach);
  return near ? enterCar(sim, near) : false;
}

/** The closest car to the player within `reach`, or null. */
export function nearestCar(sim, reach = GAIT.reach) {
  const p = sim.player;
  let best = null;
  let gap = reach;
  for (const car of sim.traffic) {
    const d = Math.hypot(car.x - p.x, car.z - p.z);
    if (d < gap) {
      gap = d;
      best = car;
    }
  }
  return best;
}

/** Take a car over: out of the fleet's hands and into the player's. */
export function enterCar(sim, car) {
  const p = sim.player;
  if (!car || car.stolen) return false;
  car.stolen = true;
  car.parked = false;
  car.speed *= 0.3;
  car.lights = 0;
  p.driving = car;
  p.lastCar = car;
  p.x = car.x;
  p.z = car.z;
  p.yaw = car.yaw;
  p.aimYaw = car.yaw;
  if (sim.onCrime) sim.onCrime('theft', car);
  sim.events.onRadioOn?.();
  return true;
}

/** Put a fresh car into the player's hands — how a staged scene or a mission hands one over. */
export function handOverCar(sim, kind, x, z, yaw, paint) {
  const car = makeCar(kind, x, z, yaw, paint);
  car.stolen = true;
  sim.traffic.push(car);
  sim.player.driving = car;
  sim.player.lastCar = car;
  sim.player.x = car.x;
  sim.player.z = car.z;
  sim.player.yaw = car.yaw;
  sim.player.aimYaw = car.yaw;
  return car;
}

// ---------------------------------------------------------------- the pistol

/** Start a reload, if there is anything to reload with. */
export function reloadWeapon(sim) {
  const p = sim.player;
  if (p.reload > 0 || p.clip >= GUN.magazine || p.ammo <= 0) return;
  p.reload = GUN.reloadTime;
}

/**
 * Fire one round down the aim. It goes into sim.rounds for the sim to walk forward and resolve; the
 * heat it raises and the crowd's reaction are the sim's business, through onCrime.
 */
export function fireWeapon(sim) {
  const p = sim.player;
  if (p.reload > 0 || p.cool > 0) return false;
  if (p.clip <= 0) {
    if (p.ammo > 0) reloadWeapon(sim);
    return false;
  }
  p.clip -= 1;
  p.cool = GUN.cycle;
  p.muzzle = 1;
  p.recoil = 1;
  sim.shake = Math.max(sim.shake, 0.22);
  sim.story.shots += 1;

  const heading = p.aimYaw + (sim.rand() - 0.5) * GUN.scatter * 2;
  const from = p.driving ? { x: p.driving.x, z: p.driving.z } : { x: p.x, z: p.z };
  sim.rounds.push({
    x: from.x + Math.cos(heading) * 1.0,
    z: from.z + Math.sin(heading) * 1.0,
    vx: Math.cos(heading) * GUN.muzzle,
    vz: Math.sin(heading) * GUN.muzzle,
    y: p.driving ? 1.1 : 1.3,
    travelled: 0,
    life: 2,
  });
  sim.events.onShot?.(from, heading);
  if (sim.onCrime) sim.onCrime('shot', from);
  return true;
}

// ---------------------------------------------------------------- health

/** Take damage through armour, and flash the screen for it. */
export function hurt(sim, amount) {
  const p = sim.player;
  let n = amount;
  if (p.armour > 0) {
    const soak = Math.min(p.armour, n * 0.6);
    p.armour -= soak;
    n -= soak;
  }
  p.hp = Math.max(0, p.hp - n);
  p.hurt = 1;
  sim.shake = Math.max(sim.shake, 0.9);
  sim.flash = 0.6;
}

/** Buy health: the clothier's stock. */
export function grantHealth(p, amount) {
  p.hpMax = Math.min(160, p.hpMax + amount);
  p.hp = p.hpMax;
}

// ---------------------------------------------------------------- moving a round

/**
 * Walk a round in hops small enough that it cannot tunnel through a person, a wall or an officer.
 * `hit` is called at each hop and returns true when the round has been consumed. Returns true when
 * the round is finished with.
 */
export function advanceRound(r, dt, hit) {
  const step = Math.hypot(r.vx, r.vz) * dt;
  const hops = Math.max(1, Math.ceil(step / 0.8));
  let consumed = false;
  for (let h = 0; h < hops && !consumed; h += 1) {
    r.x += (r.vx * dt) / hops;
    r.z += (r.vz * dt) / hops;
    r.travelled += step / hops;
    consumed = hit(r);
  }
  r.life -= dt;
  return consumed || r.life <= 0 || r.travelled > GUN.reach;
}
