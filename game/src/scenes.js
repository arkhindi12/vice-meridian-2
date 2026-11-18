// scenes.js — the four pictures, staged from the address bar.
//
// ?shot=cover|foot|mission|driving builds the same seeded city the player gets, puts the cast where
// the picture needs them, opens the subtitle the picture needs, and parks the camera. Nothing here
// draws: main.js renders the result through the same render() the game uses — HUD and all — and
// then holds the frame, so the picture is exactly what was staged.
//
// The staging rule is that every picture carries as many systems as a frame can hold. So each one
// names what it is responsible for at the top, and the last line of each function is a check that
// the systems it names are actually on: four stars and an aircraft in the cover, six panels in the
// foot shot, a shop counter in the mission, a radio and a speedometer in the drive.
//
// Placement is always "this avenue, this heading, this far along", never a raw x/z where a lane
// exists, because traffic.js owns the lane offset — a staged car therefore sits in a real lane and
// the queue behind it brakes for it. The west boulevard is avenue 0, its kerbs 23 m either side of
// the centre line, and the northbound lane 5.3 m east of that.

import { carInLane, makeCar } from './traffic.js';
import { makePerson } from './crowd.js';
import { newStory, speak, MISSIONS } from './story.js';
import { STATIONS } from './radio.js';

const STILL = { move: { x: 0, z: 0 }, fire: false, use: false, run: false, reload: false };

export const SHOT_AVENUE = 0;
const NORTH = { dx: 0, dz: -1 };
const SOUTH = { dx: 0, dz: 1 };
const EAST = { dx: 1, dz: 0 };
const WEST = { dx: -1, dz: 0 };
// The pavement edges either side of the boulevard: block one starts at 23, its frontage at 36.
const PAVE_E = 28.5;
const PAVE_W = -17.5;
const LANE_OFF = 5.3;

/** A car seated in a real lane, already rolling at `speed`. */
function roll(sim, kind, line, along, dir, paint, speed) {
  const car = carInLane(kind, line, along, dir, paint);
  car.speed = speed;
  car.cruise = speed;
  sim.traffic.push(car);
  return car;
}

/** A pedestrian at a spot, facing `heading`. */
function stand(sim, x, z, heading, extra = {}) {
  const p = makePerson(sim.rand, x, z, heading, extra);
  p.phase = sim.rand() * 6.28;
  sim.crowd.push(p);
  return p;
}

/** A cruiser with a two-officer crew, either seated or already out on the street. */
function cruiserAt(sim, x, z, heading, deployed = true, tactic = 'PURSUIT', number = null) {
  const car = makeCar('cruiser', x, z, heading, '#f2f3f5', { id: 900 + sim.police.units.length });
  const n = sim.police.units.length + 1;
  const unit = {
    car,
    x,
    z,
    yaw: heading,
    speed: 0,
    mode: deployed ? 'deployed' : 'chase',
    officers: [],
    number: number ?? String(2 + n * 5).padStart(2, '0'),
    tag: `vmpd-${n}`,
    age: 6 + n * 3,
    siren: 3,
    tactic,
    holdAt: null,
  };
  for (let i = 0; i < 2; i += 1) {
    unit.officers.push({
      x,
      z,
      yaw: 0,
      hp: 3,
      cool: 0.2 + i * 0.35,
      alive: true,
      down: 0,
      seat: i,
      moving: 0,
      inCar: !deployed,
      flash: 0,
      collar: i === 0,
    });
  }
  sim.police.units.push(unit);
  return unit;
}

/** Point every officer at the player and put a couple of their rounds in the air. */
function volley(sim, count = 2) {
  sim.police.rounds.length = 0;
  const p = sim.player;
  let n = 0;
  for (const u of sim.police.units) {
    for (const o of u.officers) {
      if (!o.alive || o.inCar) continue;
      o.yaw = Math.atan2(p.z - o.z, p.x - o.x);
      if (n >= count) continue;
      const heading = o.yaw + (n - 0.5) * 0.05;
      sim.police.rounds.push({
        x: o.x + Math.cos(heading) * (3 + n * 4),
        z: o.z + Math.sin(heading) * (3 + n * 4),
        vx: Math.cos(heading) * 150,
        vz: Math.sin(heading) * 150,
        life: 0.9,
        y: 1.35,
      });
      o.flash = 1;
      n += 1;
    }
  }
}

/**
 * Park the aircraft where the picture needs it: a set position, a settled orbit, the rotor at a
 * readable angle, and the light on a given ground point. Because poseAir derives the cone and the
 * pool from this record, setting the record is setting the light.
 */
function hoverAt(sim, x, z, alt, lightX, lightZ, heading) {
  sim.police.air = {
    x,
    z,
    alt,
    orbit: heading,
    spin: 0.8,
    settle: 1,
    light: { x: lightX, z: lightZ },
    intensity: 1,
    bank: 0.2,
    heading,
  };
  sim.police.airFade = 1;
}

/** Set the story to a mission index without running its dress-up twice. */
function setStory(sim, index, cash, respect, extra = {}) {
  sim.story = newStory();
  sim.story.index = index;
  sim.story.done = index;
  sim.story.passed = MISSIONS.slice(0, index).map((m) => m.id);
  sim.story.cash = cash;
  sim.story.respect = respect;
  sim.story.clock = 18 * 60 + 52;
  Object.assign(sim.story, extra);
}

/** Hold a character's line open on the subtitle box, as if it had just been spoken. */
function say(sim, who, line, t = 0.9) {
  speak(sim.story, who, line, 9);
  if (sim.story.sub) sim.story.sub.t = t;
}

/**
 * Stage one of the four pictures. Returns { camera, input } or null if the name is not one of them.
 * The camera is a plain object in the same shape the follow camera uses.
 */
export function stageShot(name, sim) {
  if (name === 'cover') return cover(sim);
  if (name === 'foot') return onFoot(sim);
  if (name === 'mission') return atShop(sim);
  if (name === 'driving') return driving(sim);
  return null;
}

/**
 * 1-cover — a four-star chase from the air and the road at once.
 *
 * Carries: the player's car on the boulevard, two cruisers with bars lit, officers out of them and
 * firing, the helicopter overhead with its searchlight cone on the road, four filled stars, a
 * dispatch list of five lines ending in AIR 1, the minimap, the radio, the speedometer with model
 * and condition, a 9/10 objective, a character's subtitle and a fleeing crowd.
 */
function cover(sim) {
  setStory(sim, 5, 38240, 1460, { kills: 19, shots: 214, spent: 6240 });
  const p = sim.player;
  p.hp = 62;
  p.armour = 24;
  p.clip = 9;
  p.ammo = 78;

  sim.traffic.length = 0;
  const hero = roll(sim, 'coupe', SHOT_AVENUE, 1360, NORTH, '#ff2f86', 26);
  hero.stolen = true;
  hero.condition = 0.74;
  p.driving = hero;
  p.x = hero.x;
  p.z = hero.z;
  p.yaw = hero.yaw;
  p.aimYaw = hero.yaw;

  // A taxi stopped across the near lane, a law car slewed beside it, one more coming the other way.
  const blocked = roll(sim, 'cab', SHOT_AVENUE, 1306, NORTH, '#ffcc33', 0);
  blocked.yaw += 0.5;
  roll(sim, 'sedan', SHOT_AVENUE, 1216, NORTH, '#22e6d0', 8);
  roll(sim, 'suv', SHOT_AVENUE, 1740, NORTH, '#f2f0ea', 16);
  roll(sim, 'coupe', SHOT_AVENUE, 1252, SOUTH, '#8f5bff', 18);
  roll(sim, 'sedan', SHOT_AVENUE, 1420, SOUTH, '#0f5f8a', 15);
  roll(sim, 'van', 300, 900, EAST, '#177d95', 12);

  sim.police.stars = 4;
  sim.police.heat = 0.92;
  sim.police.quiet = 0;
  sim.police.seen = true;
  sim.police.units.length = 0;

  // Unit 12 is on the player's bumper; unit 07 is across the lane ahead; 23 and 41 are on their way.
  // Four cars, each with its own patch of road, so no two silhouettes overlap: one slewed across
  // the player's lane, one in the oncoming lane, one wide to the east, and a blockade car far up
  // the boulevard with its bar going.
  const near = cruiserAt(sim, LANE_OFF - 4.6, 1336, 0.66, true, 'RAMMING', '12');
  const far = cruiserAt(sim, -9.5, 1298, -0.30, true, 'ROADBLOCK', '07');
  const third = cruiserAt(sim, 15.5, 1300, 2.55, true, 'PURSUIT', '23');
  third.officers.forEach((o, i) => { o.x = 17.4 + i * 1.5; o.z = 1304 + i * 2.2; o.yaw = Math.atan2(p.z - o.z, p.x - o.x); });
  cruiserAt(sim, 2.0, 1236, Math.PI, false, 'PURSUIT', '41');

  const nearCrew = [
    [LANE_OFF - 6.6, 1330],
    [LANE_OFF - 2.4, 1328],
  ];
  const farCrew = [
    [-11.6, 1294],
    [-7.4, 1291],
  ];
  [near, far].forEach((unit, k) => {
    const spots = k === 0 ? nearCrew : farCrew;
    unit.officers.forEach((o, i) => {
      o.x = spots[i][0];
      o.z = spots[i][1];
      o.yaw = Math.atan2(p.z - o.z, p.x - o.x);
      o.inCar = false;
      o.moving = i === 0 ? 1 : 0;
    });
  });
  near.officers[1].alive = false;
  near.officers[1].down = 0.6;

  // The aircraft: ahead and to the east, low enough that the cone is a shaft and not a stripe.
  hoverAt(sim, 26, 1300, 25, 4.6, 1352, 1.35);

  // The crowd is part of the picture, not decoration behind it: people running from the cars on
  // both kerbs, at the distance the camera can actually resolve them.
  sim.crowd.length = 0;
  stand(sim, 11.5, 1348, -2.2, { shirt: '#ff2f86' }).panic = 3.4;
  stand(sim, 9.4, 1340, -2.6, { shirt: '#ffd23c', hat: true }).panic = 3.1;
  stand(sim, 13.2, 1332, -2.0, { shirt: '#22e6d0' }).panic = 2.9;
  stand(sim, 7.0, 1354, 2.1, { shirt: '#f4efe3', skin: '#a86b3f' }).panic = 3.2;
  stand(sim, -7.6, 1352, 2.4, { shirt: '#f4efe3' }).panic = 3.2;
  stand(sim, -9.8, 1344, 1.9, { shirt: '#8f5bff', skin: '#a86b3f' }).panic = 3.5;
  stand(sim, -6.2, 1360, 2.6, { shirt: '#63d07a' }).panic = 2.6;
  stand(sim, -12.4, 1336, 2.2, { shirt: '#ff7a30', hat: true }).panic = 3.0;
  stand(sim, 16.4, 1356, -2.4, { shirt: '#3d8bff' }).panic = 3.3;
  const body = stand(sim, LANE_OFF - 3.4, 1300, 0.9, { shirt: '#26324a', skin: '#e8b98c' });
  body.down = 2.2;
  for (const q of sim.crowd) {
    if (q.down > 0) continue;
    q.run = 1;
    q.moving = 1;
  }
  volley(sim, 2);
  sim.rounds.push({ x: p.x + 4.2, y: 1.3, z: p.z - 9, vx: 0, vz: -210, life: 0.5, travelled: 0 });

  sim.radio.index = 0;
  sim.radio.track = 1;
  sim.radio.dj = '';
  sim.radio.djT = 0;

  say(sim, 'rusk', 'Air One has the light on the car. Every unit, close the boulevard.', 1.2);
  sim.prompt = '';

  return {
    camera: { x: 3.9, y: 5.0, z: 1374, lx: 9.7, ly: 4.9, lz: 1296, fov: 62 },
    input: () => ({ ...STILL, move: { x: 0, z: -1 } }),
  };
}

/**
 * 2-foot — on foot in a busy downtown.
 *
 * Carries: the player walking on the pavement, eight pedestrians on both kerbs, four cars in the
 * lanes and one at the kerb to take, the minimap, health and armour, ammo, a 2/10 objective,
 * RESPECT with its rank, and DAY and the clock.
 */
function onFoot(sim) {
  setStory(sim, 1, 4120, 618, { kills: 3, shots: 46, spent: 700 });
  const p = sim.player;
  p.x = PAVE_E + 0.6;
  p.z = 1442;
  p.yaw = Math.PI / 2;
  p.aimYaw = Math.PI / 2 + 0.12;
  p.hp = 84;
  p.armour = 12;
  p.clip = 14;
  p.ammo = 39;
  p.phase = 1.4;
  p.moving = 1;
  p.running = 0;

  sim.traffic.length = 0;
  roll(sim, 'sedan', SHOT_AVENUE, 1436, SOUTH, '#22e6d0', 9);
  roll(sim, 'coupe', SHOT_AVENUE, 1404, SOUTH, '#e8483f', 11);
  roll(sim, 'suv', SHOT_AVENUE, 1462, NORTH, '#f2f0ea', 8);
  roll(sim, 'cab', SHOT_AVENUE, 1396, NORTH, '#ffcc33', 10);
  roll(sim, 'coupe', SHOT_AVENUE, 1372, SOUTH, '#ff7a30', 12);
  const kerb = roll(sim, 'drop', SHOT_AVENUE - 19.4, 1448, NORTH, '#ff2f86', 0);
  kerb.parked = true;

  // The crowd has to be inside forty metres or it is not a crowd, it is confetti: everyone here
  // stands on the two pavements the camera can actually resolve.
  sim.crowd.length = 0;
  stand(sim, PAVE_E + 1.6, 1436, -Math.PI / 2, { shirt: '#ff2f86', skin: '#d9a06b' });
  stand(sim, PAVE_E + 0.4, 1428, Math.PI / 2, { shirt: '#3d8bff', bag: true });
  stand(sim, PAVE_E + 2.6, 1421, -Math.PI / 2, { shirt: '#ffd23c', hat: true, skin: '#a86b3f' });
  stand(sim, PAVE_E - 0.2, 1412, Math.PI / 2, { shirt: '#f4efe3' });
  stand(sim, PAVE_E + 1.9, 1404, -Math.PI / 2, { shirt: '#22e6d0', skin: '#7a4a2a' });
  stand(sim, PAVE_E + 3.2, 1394, Math.PI / 2, { shirt: '#8f5bff', hat: true });
  stand(sim, PAVE_E + 0.8, 1383, -Math.PI / 2, { shirt: '#63d07a' });
  stand(sim, PAVE_E + 2.4, 1371, Math.PI / 2, { shirt: '#e8483f', bag: true });
  stand(sim, PAVE_W + 1.8, 1430, Math.PI / 2, { shirt: '#ffd23c', skin: '#e8b98c' });
  stand(sim, PAVE_W - 0.6, 1416, -Math.PI / 2, { shirt: '#ff7a30', skin: '#7a4a2a' });
  stand(sim, PAVE_W + 2.2, 1402, Math.PI / 2, { shirt: '#f4efe3', hat: true });
  stand(sim, PAVE_W + 0.4, 1388, -Math.PI / 2, { shirt: '#3d8bff' });

  sim.police.stars = 0;
  sim.police.units.length = 0;
  sim.police.air = null;
  sim.police.seen = false;

  sim.radio.index = 1;
  sim.radio.track = 2;
  sim.radio.djT = 0;

  say(sim, 'juno', 'The coupe is on the boulevard, two blocks down. Do not scratch it.', 1.1);
  sim.prompt = '';

  return {
    camera: { x: 27.4, y: 2.6, z: 1449, lx: 30, ly: 1.4, lz: 1415, fov: 68 },
    input: () => ({ ...STILL, move: { x: 0, z: -1 } }),
  };
}

/**
 * 3-mission — a mission in progress at a shop.
 *
 * Carries: the shop prompt at the counter, the objective line and its live condition, the money it
 * is about to cost, the shop's marker ring and its lit signboard, pedestrians on the pavement and
 * traffic on the boulevard behind.
 */
function atShop(sim) {
  setStory(sim, 2, 4120, 712, { kills: 4, shots: 61, spent: 1050 });
  const p = sim.player;
  const shop = sim.plan.shops[0];
  p.x = shop.at.x + 0.6;
  p.z = shop.at.z + 1.2;
  p.yaw = Math.PI / 2;
  p.aimYaw = Math.PI / 2 - 0.34;
  p.hp = 91;
  p.clip = 6;
  p.ammo = 12;
  p.phase = 0.7;
  p.moving = 0;

  sim.traffic.length = 0;
  // Up the near lane and down the far one, close enough that both sides of the boulevard read.
  roll(sim, 'cab', SHOT_AVENUE, 742, NORTH, '#ffcc33', 6);
  roll(sim, 'sedan', SHOT_AVENUE, 706, NORTH, '#177d95', 9);
  roll(sim, 'coupe', SHOT_AVENUE, 768, SOUTH, '#ff7a30', 8);
  roll(sim, 'suv', SHOT_AVENUE, 700, SOUTH, '#f2f0ea', 7);
  const kerb = roll(sim, 'sedan', SHOT_AVENUE + 19.4, 754, NORTH, '#e8483f', 0);
  kerb.parked = true;
  const kerb2 = roll(sim, 'drop', SHOT_AVENUE + 19.4, 724, NORTH, '#8f5bff', 0);
  kerb2.parked = true;

  sim.crowd.length = 0;
  stand(sim, PAVE_E + 1.0, 764, -Math.PI / 2, { shirt: '#ff2f86', skin: '#d9a06b' });
  stand(sim, PAVE_E + 2.6, 742, Math.PI / 2, { shirt: '#ffd23c', hat: true, skin: '#a86b3f' });
  stand(sim, PAVE_E - 0.4, 741, 0, { shirt: '#3d8bff', bag: true });
  stand(sim, PAVE_E + 1.4, 728, -Math.PI / 2, { shirt: '#22e6d0' });
  stand(sim, PAVE_W, 750, Math.PI / 2, { shirt: '#f4efe3' });
  stand(sim, PAVE_W - 1.4, 736, 0, { shirt: '#63d07a', skin: '#7a4a2a' });

  sim.police.stars = 0;
  sim.police.units.length = 0;
  sim.police.air = null;
  sim.police.seen = false;

  sim.radio.index = 2;
  sim.radio.track = 0;
  sim.radio.on = true;
  sim.radio.djT = 0;

  say(sim, 'vance', 'Two boxes of nine, and ask him for the good ones. I am not paying for the good ones.', 1.3);

  sim.shop = shop;
  sim.prompt = `E · ${shop.name}  ·  $${shop.price}`;

  // From the road, looking north-east: the player at the counter on the right, the marker ring on
  // the pavement, the boulevard and its traffic on the left, the shop's own sign over the door.
  return {
    camera: { x: 30.6, y: 3.4, z: 761, lx: 32, ly: 1.8, lz: 745, fov: 58 },
    input: () => STILL,
  };
}

/**
 * 4-driving — driving at speed on the Strip.
 *
 * Carries: the speedometer with the model name and the condition, the radio with its station and
 * track, six cars in the lanes and two oncoming, palms down the promenade, the sea on the left, the
 * minimap, and two stars with their dispatch list.
 */
function driving(sim) {
  setStory(sim, 8, 26480, 1180, { kills: 12, shots: 148, spent: 3900 });
  const p = sim.player;
  p.hp = 78;
  p.clip = 11;
  p.ammo = 34;

  sim.traffic.length = 0;
  const hero = roll(sim, 'drop', SHOT_AVENUE, 1700, NORTH, '#22e6d0', 33);
  hero.stolen = true;
  hero.condition = 0.71;
  p.driving = hero;
  p.x = hero.x;
  p.z = hero.z;
  p.yaw = hero.yaw;
  p.aimYaw = hero.yaw;

  // The same lane, just ahead: the taxi the player is closing on, then the coupe beyond it.
  roll(sim, 'cab', SHOT_AVENUE, 1679, NORTH, '#ffcc33', 26);
  roll(sim, 'coupe', SHOT_AVENUE, 1670, NORTH, '#f2f0ea', 28);
  roll(sim, 'sedan', SHOT_AVENUE, 1652, NORTH, '#8f5bff', 24);
  roll(sim, 'van', SHOT_AVENUE, 1633, NORTH, '#177d95', 22);
  // Oncoming, one after another, close enough to pass at speed in the far lane.
  roll(sim, 'suv', SHOT_AVENUE, 1690, SOUTH, '#177d95', 21);
  roll(sim, 'sedan', SHOT_AVENUE, 1672, SOUTH, '#e8483f', 19);
  roll(sim, 'coupe', SHOT_AVENUE, 1655, SOUTH, '#ffd23c', 22);
  roll(sim, 'sedan', SHOT_AVENUE, 1638, SOUTH, '#ff7a30', 20);

  sim.police.stars = 2;
  sim.police.heat = 0.8;
  sim.police.seen = true;
  sim.police.quiet = 0;
  sim.police.air = null;
  sim.police.units.length = 0;
  const oncoming = cruiserAt(sim, -LANE_OFF, 1668, -Math.PI / 2, false, 'PURSUIT', '19');
  oncoming.speed = 24;
  oncoming.officers.forEach((o) => { o.inCar = true; });
  const block = cruiserAt(sim, LANE_OFF + 1.2, 1618, 0, true, 'ROADBLOCK', '31');
  block.officers.forEach((o, i) => {
    o.inCar = false;
    o.x = LANE_OFF + 4.6 + i * 1.5;
    o.z = 1614 - i * 2.0;
    o.yaw = Math.atan2(p.z - o.z, p.x - o.x);
  });

  sim.crowd.length = 0;
  for (let i = 0; i < 12; i += 1) {
    const side = i % 2 === 0 ? PAVE_W : PAVE_E;
    stand(sim, side, 1730 - i * 26, i % 2 === 0 ? 0 : Math.PI, { shirt: ['#ff2f86', '#22e6d0', '#ffd23c', '#f4efe3'][i % 4] });
  }

  sim.radio.index = 0;
  sim.radio.track = 2;
  sim.radio.djT = 0;
  sim.prompt = '';

  say(sim, 'juno', 'They are at the junction, not behind you. Take the sea road and do not lift.', 1.4);

  // Flat out up the boulevard, from seventeen metres back of the bonnet.
  return {
    camera: { x: hero.x - 0.2, y: 6.0, z: hero.z + 12, lx: hero.x + 0.9, ly: 1.4, lz: hero.z - 30, fov: 62 },
    input: () => ({ ...STILL, move: { x: 0, z: -1 }, run: true }),
  };
}

export const SHOT_NAMES = ['cover', 'foot', 'mission', 'driving'];

/** The stations, exported so main.js can print the dial list on the console. */
export { STATIONS };
