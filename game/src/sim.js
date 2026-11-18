// sim.js — the world as one state machine, and the single tick that advances all of it.
//
// The live game, a paused frame and a staged photograph all come through here. `tick` takes its
// input as plain data, so a photograph can hand the world a script and land in a known pose; it
// knows nothing about meshes, cameras or pixels.
//
// The order matters:
//   1. the player's own clocks, the reload, the subtitle and the radio
//   2. the player's movement — on foot or driving — and the trigger
//   3. traffic (which needs the player as an obstacle), then the crowd, then the police and the air
//   4. the player's rounds, resolved against walls, people and officers
//   5. the police's rounds, resolved against the player
//   6. the shops, the mission chain, and the arrest or death check that can end the run

import { GUN, GAIT } from './scale.js';
import { CityPlan } from './cityPlan.js';
import { stream } from './random.js';
import { seedFleet, driveFleet, carInLane } from './traffic.js';
import { seedCrowd, walkCrowd, scatter, personAt, fellAt, bodyAhead, makePerson } from './crowd.js';
import { newPolice, runPolice, raiseHeat, standDown, hitOfficer, arrestAt, dispatchLines } from './officers.js';
import {
  newStory,
  currentMission,
  testMission,
  announce,
  speak,
  liveCondition,
  tickSpeech,
  tickClock,
  addRespect,
  MISSIONS,
} from './story.js';
import { newPlayer, toggleVehicle, nearestCar, fireWeapon, reloadWeapon, hurt, advanceRound, walkPlayer, drivePlayer, HOME } from './player.js';
import { newRadio, tickRadio, stationNow, trackTitle } from './radio.js';
import { shopAt, shopPrompt, buyAtShop } from './shops.js';

export const STEP = 1 / 60;

/** Build a world for a seed: plan, cast, story, radio and the props the first missions need. */
export function createSim(seed = 1) {
  const sim = {
    seed,
    plan: new CityPlan(seed),
    rand: stream(seed * 3 + 9),
    time: 0,
    mode: 'play',
    player: newPlayer(),
    traffic: seedFleet(seed),
    crowd: seedCrowd(seed),
    police: newPolice(seed),
    story: newStory(),
    radio: newRadio(),
    rounds: [],
    impacts: [],
    floaters: [],
    prompt: '',
    shop: null,
    shopCool: 0,
    shake: 0,
    flash: 0,
    turning: 0,
    ramCool: 0,
    crewDown: 0,
    pointer: { x: 0, y: 0 },
    project: null,
    viewYaw: 0,
    events: {
      onShot: null,
      onCopShot: null,
      onCash: null,
      onReload: null,
      onImpact: null,
      onSave: null,
      onShop: null,
      onCrunch: null,
      onRadioOn: null,
    },
    onCrime: null,
  };
  sim.onCrime = (kind, at) => commitCrime(sim, kind, at);
  dressForMission(sim);
  return sim;
}

// ---------------------------------------------------------------- the mission's props

/**
 * The world changes as the chain moves. A `deliver` mission parks its car where the story says;
 * a `clear` mission puts its crew inside the marker. Both are placed from the mission's own record,
 * so the marker and the thing inside it can never disagree.
 */
export function dressForMission(sim) {
  const m = currentMission(sim.story);
  if (!m) return;

  if (m.car) {
    const exists = sim.traffic.some((c) => c.missionCar === m.id);
    if (!exists) {
      const car = carInLane(m.car.kind, sim.plan.nearestAvenue(m.car.x), m.car.z, { dx: 0, dz: 1 }, m.car.paint, {
        parked: true,
        missionCar: m.id,
      });
      car.x = m.car.x;
      car.z = m.car.z;
      car.yaw = Math.PI / 2;
      car.dir = { dx: 0, dz: 1 };
      sim.traffic.push(car);
    }
  }

  if (m.beat === 'clear') {
    const have = sim.crowd.filter((p) => p.crew === m.id).length;
    for (let i = have; i < m.need; i += 1) {
      const a = (i / m.need) * Math.PI * 2 + 0.4;
      const p = makePerson(sim.rand, m.at.x + Math.cos(a) * (m.radius * 0.4), m.at.z + Math.sin(a) * (m.radius * 0.4), a + Math.PI);
      p.crew = m.id;
      p.shirt = '#2b2b36';
      p.trousers = '#16161d';
      sim.crowd.push(p);
    }
  }
}

/** How many of the crew are down inside the marker, for a `clear` mission. */
function crewDownInside(sim, m) {
  if (m.beat !== 'clear') return 0;
  let n = 0;
  for (const p of sim.crowd) {
    if (p.crew !== m.id) continue;
    if (p.down > 0) n += 1;
  }
  return n;
}

// ---------------------------------------------------------------- crime

/**
 * Something the law cares about. A shot fired is a star; a shot that drops somebody is three; a car
 * stolen is one, or two if a cruiser happens to be watching.
 */
function commitCrime(sim, kind, at) {
  if (sim.mode !== 'play') return;
  const before = sim.police.stars;
  if (kind === 'shot') {
    raiseHeat(sim.police, 1);
    scatter(sim.crowd, at.x, at.z, 52, () => {
      // A witness close enough to see the gun calls it in harder.
      for (const p of sim.crowd) {
        if (p.down > 0) continue;
        if (Math.hypot(p.x - at.x, p.z - at.z) < 22) {
          raiseHeat(sim.police, 2);
          break;
        }
      }
    });
  } else if (kind === 'kill') {
    raiseHeat(sim.police, 3);
  } else if (kind === 'theft') {
    const seen = sim.police.units.some((u) => Math.hypot(u.x - at.x, u.z - at.z) < 60);
    raiseHeat(sim.police, seen ? 2 : 1);
  } else if (kind === 'copdown') {
    raiseHeat(sim.police, 4);
  }
  // A jump in the heat is somebody on the radio saying so.
  if (sim.police.stars > before && sim.police.stars >= 2) {
    speak(sim.story, 'rusk', ruskLine(sim.police.stars), 5);
  }
}

/** What the detective says when the level climbs. */
function ruskLine(stars) {
  if (stars >= 5) return 'Every unit, every boat, everything with a rotor. Bring the whole city down on them.';
  if (stars >= 4) return 'They are on the causeway. Get the helicopter up and keep the light on that car.';
  if (stars >= 3) return 'Three cars are not enough. Put a block on the next junction and pin them.';
  return 'I want units on the Strip. Somebody is shooting on my waterfront.';
}

// ---------------------------------------------------------------- the frame

/**
 * Advance the world one step. `input` is
 *   { move: {x, z}, aim: {x, z} | null, fire, use, run, reload }
 * where `move` is world-space (the camera maps WASD onto the ground), `aim` is a ground point to
 * face, `use` is true on the step E came down, and `fire` is held.
 */
export function tick(sim, dt, input) {
  sim.time += dt;
  const p = sim.player;

  sim.shake *= Math.exp(-dt * 6);
  sim.flash = Math.max(0, sim.flash - dt * 2.4);
  sim.shopCool = Math.max(0, sim.shopCool - dt);
  p.muzzle = Math.max(0, p.muzzle - dt * 9);
  p.recoil = Math.max(0, p.recoil - dt * 4);
  p.hurt = Math.max(0, p.hurt - dt * 0.9);
  p.cool = Math.max(0, p.cool - dt);
  tickReload(sim, dt);
  tickSpeech(sim.story, dt);
  tickRadio(sim.radio, dt);
  tickClock(sim.story, dt, p.driving ? Math.abs(p.driving.speed) > 6 : p.moving > 0);

  if (sim.mode === 'play') {
    // E at a shop's counter buys; anywhere else it takes or leaves a car.
    //
    // A garage is bought from the driver's seat, because that is the only way a repair could reach
    // the car — but only while there is something to repair. Once the bay has fixed it, E belongs
    // to the car door again, or a player would be locked into a repaired car for ever.
    const shop = shopAt(sim.plan, p.x, p.z);
    const wantsRepair = shop?.kind === 'garage' && p.driving && p.driving.condition < 0.999;
    const atCounter = !!shop && (!p.driving || wantsRepair);
    sim.shop = atCounter ? shop : null;
    if (input.use) {
      if (atCounter) buyAtShop(sim, shop);
      else toggleVehicle(sim);
    }
    if (p.driving) drivePlayer(sim, dt, input);
    else walkPlayer(sim, dt, input);
    if (input.fire) fireWeapon(sim);
    if (input.reload) reloadWeapon(sim);
  }

  stepWorld(sim, dt);

  if (sim.mode === 'play') {
    if (p.hp <= 0) {
      sim.mode = 'wasted';
      sim.shake = 1.2;
      sim.story.toastT = 0;
      sim.story.toast = '';
      sim.story.sub = null;
    } else if (!p.driving && arrestAt(sim.police, p.x, p.z)) {
      sim.mode = 'busted';
      sim.police.busted += 1;
      standDown(sim.police);
      sim.story.toastT = 0;
      sim.story.toast = '';
      sim.story.sub = null;
    }
  }
  updatePrompt(sim);
  sim.dispatch = dispatchLines(sim.police, p);
}

// The reload clock is the one part of the weapon the sim runs itself, because a reload can finish
// while the world is paused on a card.
function tickReload(sim, dt) {
  const p = sim.player;
  if (p.reload <= 0) return;
  p.reload -= dt;
  if (p.reload > 0) return;
  const take = Math.min(GUN.magazine - p.clip, p.ammo);
  p.clip += take;
  p.ammo -= take;
  if (take > 0) sim.events.onReload?.();
}

/** Traffic, crowd, police, air, bullets, shops and the mission: everything live. */
function stepWorld(sim, dt) {
  const p = sim.player;
  const live = sim.mode === 'play' || sim.mode === 'busted' || sim.mode === 'wasted';
  const blockers = [];
  if (p.driving) blockers.push({ x: p.driving.x, z: p.driving.z, len: p.driving.len });
  for (const u of sim.police.units) blockers.push({ x: u.x, z: u.z, len: u.car.len });

  if (live) {
    for (const car of sim.traffic) car.bodyAhead = bodyAhead(sim.crowd, car.x, car.z, car.yaw, 11, 1.7);
    driveFleet(sim.traffic, dt, blockers, p.driving ? null : { x: p.x, z: p.z });
  }

  walkCrowd(sim.crowd, dt, sim.time, sim.plan, sim.mode === 'play' && !p.driving ? p : null);

  if (sim.mode === 'play') {
    runPolice(sim.police, dt, sim.plan, {
      player: {
        x: p.x,
        z: p.z,
        yaw: p.aimYaw,
        vx: p.driving ? Math.cos(p.driving.yaw) * p.driving.speed : 0,
        vz: p.driving ? Math.sin(p.driving.yaw) * p.driving.speed : 0,
      },
      blockers: blockers.concat(sim.traffic.filter((c) => !c.stolen).map((c) => ({ x: c.x, z: c.z, len: c.len }))),
      onFire: (o) => sim.events.onCopShot?.(o),
      viewYaw: sim.viewYaw ?? 0,
      // A police round finds the player at the body on foot, or at the car when driving.
      hitTest: (x, z) => (p.driving ? Math.hypot(x - p.driving.x, z - p.driving.z) < 2.2 : Math.hypot(x - p.x, z - p.z) < 0.65),
      onHit: () => {
        if (p.driving) {
          p.driving.speed *= 0.9;
          p.driving.condition = Math.max(0, p.driving.condition - 0.02);
          hurt(sim, 2.5);
        } else {
          hurt(sim, 8 + sim.rand() * 7);
        }
      },
    });
  }

  // ---- the player's rounds.
  for (let i = sim.rounds.length - 1; i >= 0; i -= 1) {
    if (advanceRound(sim.rounds[i], dt, (round) => resolveRound(sim, round))) sim.rounds.splice(i, 1);
  }

  // ---- cruisers that run the player down, and the player ramming them back. A hard ram is the
  // one stunt the world rewards with RESPECT: it costs bodywork, and it is what the word means here.
  if (sim.mode === 'play' && p.driving) {
    for (const u of sim.police.units) {
      if (Math.hypot(u.x - p.driving.x, u.z - p.driving.z) > 2.8 || u.speed < 4) continue;
      const impactSpeed = Math.abs(p.driving.speed);
      p.driving.speed *= 0.86;
      p.driving.condition = Math.max(0, p.driving.condition - 0.008);
      sim.shake = Math.max(sim.shake, 0.45);
      if (impactSpeed > 16 && sim.ramCool <= 0) {
        sim.ramCool = 3.5;
        addRespect(sim.story, 45, 'RAMMED A CRUISER');
      }
    }
  }
  sim.ramCool = Math.max(0, (sim.ramCool ?? 0) - dt);

  // ---- the short-lived effects.
  for (let i = sim.impacts.length - 1; i >= 0; i -= 1) {
    sim.impacts[i].life -= dt;
    if (sim.impacts[i].life <= 0) sim.impacts.splice(i, 1);
  }
  for (let i = sim.floaters.length - 1; i >= 0; i -= 1) {
    const f = sim.floaters[i];
    f.life -= dt;
    f.y += dt * 1.6;
    if (f.life <= 0) sim.floaters.splice(i, 1);
  }

  // ---- the mission chain.
  if (sim.mode === 'play') {
    const m = currentMission(sim.story);
    if (m) {
      sim.crewDown = crewDownInside(sim, m);
      const passed = testMission(sim.story, dt, p, { crewDown: sim.crewDown, stars: sim.police.stars, bought: sim.story.bought });
      if (passed) bankMission(sim, passed);
    }
  }
}

function bankMission(sim, m) {
  sim.events.onCash?.(m.reward);
  const p = sim.player;
  sim.floaters.push({ x: p.x, z: p.z, y: 2.2, life: 2.4, text: `+$${m.reward}`, colour: '#7dffcf' });
  sim.events.onSave?.(sim.story);
  dressForMission(sim);
}

/**
 * What a round met on its way: a wall, a person, an officer. Returns true when the round stops
 * there.
 */
function resolveRound(sim, r) {
  if (sim.plan.buildingAt(r.x, r.z, 0)) {
    impact(sim, r.x, r.z, '#ffd9a0', 0.28);
    return true;
  }
  const person = personAt(sim.crowd, r.x, r.z, 0.55);
  if (person) {
    fellAt(sim.crowd, person.x, person.z, 0.8);
    impact(sim, person.x, person.z, '#ff4d6d', 0.55);
    sim.story.kills += 1;
    addRespect(sim.story, person.crew ? 40 : 12, person.crew ? 'CREW DOWN' : '');
    commitCrime(sim, 'kill', person);
    scatter(sim.crowd, person.x, person.z, 30);
    return true;
  }
  const officer = hitOfficer(sim.police, r.x, r.z, 0.65);
  if (officer) {
    impact(sim, r.x, r.z, '#ff4d6d', 0.55);
    if (!officer.alive) {
      // An officer going down is the loudest thing the street has heard all evening.
      commitCrime(sim, 'copdown', officer);
      scatter(sim.crowd, officer.x, officer.z, 40);
      addRespect(sim.story, 60, 'OFFICER DOWN');
    }
    return true;
  }
  return false;
}

function impact(sim, x, z, colour, size) {
  sim.impacts.push({ x, z, y: 1.1, life: 0.22, max: 0.22, colour, size });
  sim.events.onImpact?.(x, z);
}

// ---------------------------------------------------------------- the HUD's own state

function updatePrompt(sim) {
  const p = sim.player;
  sim.prompt = '';
  if (sim.mode !== 'play') return;
  const shop = shopPrompt(sim);
  if (shop) {
    sim.shop = shopAt(sim.plan, p.x, p.z);
    sim.prompt = shop;
    return;
  }
  sim.shop = null;
  if (p.driving) {
    sim.prompt = 'E · LEAVE THE CAR';
    return;
  }
  if (nearestCar(sim, GAIT.reach)) sim.prompt = 'E · TAKE THE CAR';
  else if (p.clip === 0 && p.ammo > 0) sim.prompt = 'R · RELOAD';
}

/** What the HUD prints in the objective panel: the mission, its line and its live condition. */
export function missionText(sim) {
  const m = currentMission(sim.story);
  if (!m) {
    return {
      title: 'THE LONG SHADOW · CLOSED',
      line: 'The boat is gone. The city is yours.',
      cond: '',
      index: MISSIONS.length,
      of: MISSIONS.length,
    };
  }
  return {
    title: `${sim.story.index + 1}/${MISSIONS.length} ${m.title.toUpperCase()}`,
    line: m.line,
    cond: liveCondition(m, sim.player, { crewDown: sim.crewDown, stars: sim.police.stars }),
    index: sim.story.index,
    of: MISSIONS.length,
  };
}

/** The dispatch list, as the HUD prints it. */
export function dispatchOf(sim) {
  return dispatchLines(sim.police, sim.player);
}

/** The radio's caption: station, band and the track playing. */
export function radioText(sim) {
  const s = stationNow(sim.radio);
  return { station: s.name, band: s.band, track: trackTitle(sim.radio), colour: s.colour, dj: sim.radio.dj, djT: sim.radio.djT };
}

// ---------------------------------------------------------------- the modes

/** Start from the title card: the player is already on the street, clean, with a mission waiting. */
export function startRun(sim) {
  sim.mode = 'play';
  sim.story.toastT = 0;
  const m = currentMission(sim.story);
  announce(sim.story, `WELCOME TO VICE MERIDIAN  ·  ${m ? `${m.title.toUpperCase()} IS WAITING` : 'THE CITY IS YOURS'}`, 5);
  if (m) speak(sim.story, m.who, m.say, 5.6);
}

/** Put the player back on the pavement after an arrest or a bad night, a little poorer. */
export function respawn(sim) {
  const p = sim.player;
  sim.story.cash = Math.max(0, Math.floor(sim.story.cash * 0.9));
  p.hp = p.hpMax;
  p.armour = 0;
  p.clip = GUN.magazine;
  p.ammo = Math.max(p.ammo, 34);
  p.hurt = 0;
  p.reload = 0;
  p.driving = null;
  p.x = HOME.x;
  p.z = HOME.z;
  p.yaw = Math.PI / 2;
  p.aimYaw = Math.PI / 2;
  standDown(sim.police);
  sim.rounds.length = 0;
  sim.impacts.length = 0;
  // Whatever the player was driving is left well away, not on top of them.
  for (const c of sim.traffic) {
    if (c.stolen && Math.hypot(c.x - p.x, c.z - p.z) < 60) {
      c.x += 160;
      c.speed = 0;
    }
  }
  sim.mode = 'play';
  announce(sim.story, 'YOU WOKE UP ON THE STRAND  ·  THE WORK IS STILL WAITING', 4);
  speak(sim.story, 'vance', 'You are still breathing, which is more than the last one. Get back to it.', 4.6);
  sim.events.onSave?.(sim.story);
}

/** A whole new run: a fresh story, the fleet back in the traffic's hands, the player at home. */
export function restartRun(sim) {
  sim.story = newStory();
  sim.mode = 'play';
  for (const c of sim.traffic) {
    if (c.stolen) {
      c.stolen = false;
      c.parked = false;
      c.condition = 1;
    }
  }
  sim.player = newPlayer();
  sim.rounds.length = 0;
  sim.impacts.length = 0;
  sim.floaters.length = 0;
  standDown(sim.police);
  dressForMission(sim);
  startRun(sim);
}

export { MISSIONS };
