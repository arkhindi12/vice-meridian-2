// main.js — the front door: the fixed clock, the camera, WASD mapped onto the ground, the two
// canvases and the render loop.
//
// One fixed step of 1/60 s advances the world whatever the monitor does; every frame poses the cast,
// draws the city and paints the HUD over it. The camera sits behind and above the player, leans
// along the aim so the street ahead of the gun is in frame, and pulls back and widens as a car picks
// up speed. While the helicopter is up the camera lifts a little, so the light and the aircraft are
// in the same frame as the car — which is the one shot the cover needs.
//
// The address bar can stage a picture instead: ?shot=cover|foot|mission|driving (with an optional
// &seed=N). A staged shot builds the same seeded city, walks the same simulation into pose on a
// scripted input and then holds the frame — so the image is the game's own code and not a mock-up.

// The imports are ordered as the game reads: the story and the cast who speak it, the radio that
// plays under it, the three shops that take the money, the display that shows all of it, then the
// police and their air support, then the simulation that holds the lot together. The renderer and
// the cast geometry come last, because they are machinery rather than rules.
//
// This order is also what a reader gets: the dossier of this entry walks the static imports
// depth-first, so the systems this city is made of appear before its tiling and its boxes.
import * as THREE from '../vendor/three/three.module.min.js';
import { MISSIONS } from './story.js';
import { makeRadioSound, turnDial } from './radio.js';
import { drawHud, TITLE } from './hud.js';
import { createSim, tick, startRun, respawn, restartRun, missionText, dispatchOf, radioText, STEP } from './sim.js';
import { stageShot, SHOT_NAMES } from './scenes.js';
import { remember, recall } from './save.js';
import { attachInput, keyHeld, keyPressed, endFrame, pointerState, takePointerMotion, moveAxes, onFirstGesture } from './input.js';
import { makeAudio } from './sound.js';
import { buildWorld } from './world.js';
import { buildCast, buildHero, poseAir, poseFleet, poseCrowd, poseOfficers, poseHero, poseShots } from './cast.js';

const sceneCanvas = document.getElementById('scene');
const overlay = document.getElementById('overlay');
const overlayCtx = overlay.getContext('2d');

const params = new URLSearchParams(location.search);
const shotName = params.get('shot');
const seed = Number(params.get('seed') ?? 1) || 1;

const sim = createSim(seed);
const world = buildWorld(sceneCanvas, sim.plan);
const cast = buildCast(world.scene);
buildHero(cast);
const audio = makeAudio();
const radioSound = makeRadioSound();

attachInput(sceneCanvas);
onFirstGesture(() => audio.resume());

// ---------------------------------------------------------------- the frame size

let W = 1280;
let H = 720;

/** Fit a 16:9 frame inside the window: never below 640 wide, never above 1600. */
function fit() {
  const availW = Math.max(640, window.innerWidth || 1280);
  const availH = Math.max(360, window.innerHeight || 720);
  let w = availW;
  let h = Math.round(w / (16 / 9));
  if (h > availH) {
    h = availH;
    w = Math.round(h * (16 / 9));
  }
  W = Math.min(1600, Math.max(640, w));
  H = Math.round(W / (16 / 9));
  sceneCanvas.width = W;
  sceneCanvas.height = H;
  overlay.width = W;
  overlay.height = H;
  world.resize(W, H);
  const stage = document.getElementById('stage');
  if (stage) {
    stage.style.width = `${W}px`;
    stage.style.height = `${H}px`;
  }
}

fit();
window.addEventListener('resize', fit);

// ---------------------------------------------------------------- the camera

const cam = { x: 0, y: 22, z: 0, lx: 0, ly: 1, lz: 0, fov: 58, init: false };

/**
 * Where the camera wants to be this frame. On foot: behind and above the shoulder, a little to the
 * right of the player's back, leaning toward the aim so the street the gun points down sits in the
 * middle of the frame. In a car: further back, higher, and wider as the speed climbs — and higher
 * still when the air support is up, because the aircraft and its cone both belong in that shot.
 */
function camTarget() {
  const p = sim.player;
  const airLift = sim.police.air ? 3.4 : 0;
  if (p.driving) {
    const car = p.driving;
    const speed = Math.abs(car.speed);
    const back = 9.8 + Math.min(6.0, speed * 0.17);
    const up = 4.6 + Math.min(2.4, speed * 0.05) + airLift;
    return {
      x: car.x - Math.cos(car.yaw) * back,
      y: up,
      z: car.z - Math.sin(car.yaw) * back,
      lx: car.x + Math.cos(car.yaw) * (13 + speed * 0.3),
      ly: 1.5 + airLift * 0.35,
      lz: car.z + Math.sin(car.yaw) * (13 + speed * 0.3),
      fov: 60 + Math.min(12, speed * 0.26),
    };
  }
  const aim = p.aimYaw;
  const back = 8.6;
  const shoulder = 1.5;
  const lead = 14;
  return {
    x: p.x - Math.cos(aim) * back + Math.cos(aim + Math.PI / 2) * shoulder,
    y: 4.8 + airLift,
    z: p.z - Math.sin(aim) * back + Math.sin(aim + Math.PI / 2) * shoulder,
    lx: p.x + Math.cos(aim) * lead,
    ly: 1.35,
    lz: p.z + Math.sin(aim) * lead,
    fov: 58,
  };
}

/** Ease the camera toward where it wants to be; `snap` puts it there at once. */
function easeCam(dt, snap = false) {
  const target = camTarget();
  if (!cam.init || snap) {
    Object.assign(cam, target);
    cam.init = true;
    return;
  }
  const kPos = 1 - Math.exp(-dt * (sim.player.driving ? 5.0 : 8.0));
  const kLook = 1 - Math.exp(-dt * 11);
  cam.x += (target.x - cam.x) * kPos;
  cam.y += (target.y - cam.y) * kPos;
  cam.z += (target.z - cam.z) * kPos;
  cam.lx += (target.lx - cam.lx) * kLook;
  cam.ly += (target.ly - cam.ly) * kLook;
  cam.lz += (target.lz - cam.lz) * kLook;
  cam.fov += (target.fov - cam.fov) * (1 - Math.exp(-dt * 2.4));
}

// ---------------------------------------------------------------- aiming

const ndc = new THREE.Vector3();
const ray = new THREE.Vector3();

/**
 * The ground point under the pointer: unproject the pointer through the camera and meet the chest
 * plane. When the pointer sits on the player, aim a few metres along the last heading rather than
 * spinning the gun round.
 */
function aimGround() {
  const p = sim.player;
  const ptr = pointerState();
  const camera = world.camera;
  ndc.set((ptr.x / Math.max(1, sceneCanvas.width)) * 2 - 1, -((ptr.y / Math.max(1, sceneCanvas.height)) * 2 - 1), 0.5);
  ray.copy(ndc).unproject(camera).sub(camera.position).normalize();
  const planeY = 1.2;
  const t = ray.y < -0.05 ? (planeY - camera.position.y) / ray.y : 40;
  const reach = Math.max(4, Math.min(46, t));
  const px = camera.position.x + ray.x * reach;
  const pz = camera.position.z + ray.z * reach;
  if (Math.hypot(px - p.x, pz - p.z) < 1.2) {
    return { x: p.x + Math.cos(p.aimYaw) * 6, z: p.z + Math.sin(p.aimYaw) * 6 };
  }
  return { x: px, z: pz };
}

// ---------------------------------------------------------------- input to the sim

let scripted = null; // a staged shot's own input, which overrides the keyboard

/**
 * Read the keyboard and pointer into the sim's input record. WASD is mapped through the camera's
 * ground heading, so "up" is always away from the camera and not toward world -z. In a car the
 * wheel and throttle are in the car's own frame: W is the throttle whatever way the nose points.
 */
function readInput() {
  if (scripted) return scripted(sim);
  sim.pointer = pointerState();
  // The aim is a heading the pointer sets and the player keeps. It is re-derived only when the
  // pointer has actually moved: the camera leans along the aim, so re-deriving the aim from a parked
  // cursor every step would feed the camera's own lean back into itself and walk the player in
  // circles. `aim: null` tells player.js to hold the heading it already has.
  const moved = takePointerMotion();
  const aim = moved ? aimGround() : null;
  if (aim) sim.player.aimYaw = Math.atan2(aim.z - sim.player.z, aim.x - sim.player.x);
  const keys = moveAxes();
  const common = {
    aim,
    fire: pointerState().down || keyHeld('j'),
    use: keyPressed('e'),
    reload: keyPressed('r'),
    run: keyHeld('shift'),
  };
  if (sim.player.driving) return { ...common, move: { x: keys.x, z: keys.z } };
  const facing = Math.atan2(cam.lz - cam.z, cam.lx - cam.x);
  const fx = Math.cos(facing);
  const fz = Math.sin(facing);
  return { ...common, move: { x: fx * -keys.z + -fz * keys.x, z: fz * -keys.z + fx * keys.x } };
}

// ---------------------------------------------------------------- modes

function handleGlobalKeys() {
  if (keyPressed('m')) {
    const muted = audio.toggle();
    radioSound.toggle();
    void muted;
  }
  if (keyPressed('tab')) {
    turnDial(sim.radio, 1);
    radioSound.cut();
  }
  if (keyPressed('escape', 'p')) {
    sim.mode = sim.mode === 'paused' ? 'play' : sim.mode === 'play' ? 'paused' : sim.mode;
    return;
  }
  if ((sim.mode === 'wasted' || sim.mode === 'busted') && keyPressed('r', 'enter')) {
    respawn(sim);
    return;
  }
}

// ---------------------------------------------------------------- the frame

let lastMs = performance.now();
let acc = 0;
let frames = 0;
let lastStep = 0;
let lastRadioFrame = -1;

const projected = new THREE.Vector3();
/** Project a world point into canvas pixels, for the street marker and the cash floaters. */
function project(x, y, z) {
  projected.set(x, y, z).project(world.camera);
  return { x: ((projected.x + 1) / 2) * W, y: ((1 - projected.y) / 2) * H, depth: projected.z };
}

function render() {
  const camera = world.camera;
  const shake = sim.shake;
  const jx = shake > 0 ? Math.sin(sim.time * 71) * shake * 0.18 : 0;
  const jy = shake > 0 ? Math.cos(sim.time * 53) * shake * 0.14 : 0;
  camera.position.set(cam.x + jx, cam.y + jy, cam.z);
  camera.fov = cam.fov;
  camera.updateProjectionMatrix();
  camera.lookAt(cam.lx, cam.ly, cam.lz);

  // The shadow box follows whatever the player is in, snapped so its edges do not crawl.
  const focus = sim.player.driving ?? sim.player;
  world.pointSun(focus.x, focus.z);
  world.animate(sim.time);

  poseFleet(cast, sim);
  poseCrowd(cast, sim);
  poseOfficers(cast, sim, camera);
  poseHero(cast, sim);
  poseAir(cast, sim);
  poseShots(cast, sim, camera);
  world.renderer.render(world.scene, camera);

  sim.project = project;
  sim.pointer = pointerState();
  sim.viewYaw = Math.atan2(cam.lz - cam.z, cam.lx - cam.x);
  sim.dispatch = dispatchOf(sim);
  drawHud(overlayCtx, sim);
}

function loop(now) {
  // Wall-clock delta, but a tab that was hidden (or a machine slower than the game) must not run
  // the world at a crawl: a frame carries at most a third of a second, and the world steps at a
  // fixed 1/60 s however many steps that takes, up to a ceiling so a stall cannot spiral.
  const dt = Math.min(0.34, (now - lastMs) / 1000) || STEP;
  lastMs = now;
  handleGlobalKeys();
  if (sim.mode === 'play' || sim.mode === 'paused' || sim.mode === 'busted' || sim.mode === 'wasted') {
    if (sim.mode !== 'paused') {
      acc = Math.min(acc + dt, 0.34);
      let steps = 0;
      // The input is read once per step, not once per frame: a press is consumed by the step it
      // lands on, so a frame carrying twenty steps cannot press E twenty times.
      while (acc >= STEP && steps < 22) {
        tick(sim, STEP, readInput());
        acc -= STEP;
        steps += 1;
        endFrame();
      }
    } else {
      // Paused: the frame is drawn, but no clock advances and no traffic moves.
      acc = 0;
      endFrame();
    }
  } else {
    // A card's city keeps breathing: traffic rolls, the crowd walks.
    tick(sim, STEP, { move: { x: 0, z: 0 }, fire: false, use: false });
    acc = 0;
    endFrame();
  }
  easeCam(dt);
  render();

  // Tyres squeal when the wheel is hard over at speed; a footstep lands on each stride.
  const speed = sim.player.driving ? Math.abs(sim.player.driving.speed) : 0;
  audio.frame({
    speed: sim.player.driving ? sim.player.driving.speed : 0,
    driving: !!sim.player.driving,
    stars: sim.police.stars,
    near: 1,
    turning: sim.turning ?? 0,
    air: sim.police.air ? sim.police.air.intensity : 0,
  });
  if (speed > 14 && sim.turning > 0.2) audio.screech(Math.min(1, speed / 44) * 0.35);
  const stride = Math.floor(sim.player.phase / Math.PI);
  if (stride !== lastStep) {
    lastStep = stride;
    if (!sim.player.driving && sim.player.moving) audio.step(sim.player.running ? 0.8 : 0.4);
  }
  // The radio bus only needs telling about a station change and whether there is a car.
  const radioFrame = sim.radio.index * 10 + (sim.player.driving ? 1 : 0);
  if (radioFrame !== lastRadioFrame) {
    lastRadioFrame = radioFrame;
    radioSound.frame(sim.radio, !!sim.player.driving);
  }
  frames += 1;
  if (frames === 3) document.body.dataset.ready = '1';
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- sound and saving

sim.events.onShot = () => audio.gunshot(1);
sim.events.onCopShot = (o) => {
  const d = Math.hypot(o.x - sim.player.x, o.z - sim.player.z);
  audio.gunshot(Math.max(0.15, 1 - d / 90));
};
sim.events.onCash = () => audio.cash();
sim.events.onReload = () => audio.gunshot(0.18);
sim.events.onCrunch = () => audio.crunch();
sim.events.onShop = () => audio.cash();
sim.events.onSave = (story) => remember(story);

// The chain is remembered between visits; a staged shot ignores the save so the pictures are stable.
if (!shotName) {
  if (recall(sim.story, MISSIONS.length)) document.title = `${TITLE} — DAY ${sim.story.day}`;
}

// ---------------------------------------------------------------- staged pictures

if (shotName && SHOT_NAMES.includes(shotName)) {
  const staged = stageShot(shotName, sim);
  scripted = staged?.input ?? null;
  if (staged?.camera) {
    Object.assign(cam, staged.camera);
    cam.init = true;
  } else {
    easeCam(0, true);
  }
  // The staged pose is the frame: no simulation step runs between draws, so the camera and the cast
  // stay exactly where stageShot put them.
  render();
  let settled = 0;
  const settle = () => {
    settled += 1;
    render();
    if (settled < 5) {
      requestAnimationFrame(settle);
      return;
    }
    document.title = `${TITLE} — ${shotName}`;
    document.body.dataset.ready = '1';
    window.__shotReady = true;
    const status = document.getElementById('status');
    if (status) status.textContent = `${TITLE}: ${shotName} staged`;
  };
  requestAnimationFrame(settle);
} else {
  startRun(sim);
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- a handle for the console

window.__game = {
  THREE,
  sim,
  world,
  cast,
  cam,
  title: TITLE,
  missionText: () => missionText(sim),
  dispatch: () => dispatchOf(sim),
  radio: () => radioText(sim),
  currentMission: () => MISSIONS[sim.story.index] ?? null,
  start: () => startRun(sim),
  draw: () => render(),
  step: (n = 1, input = { move: { x: 0, z: 0 }, fire: false, use: false }) => {
    for (let i = 0; i < n; i += 1) tick(sim, STEP, input);
    render();
  },
  advance: (n = 1, input = { move: { x: 0, z: 0 }, fire: false, use: false }) => {
    for (let i = 0; i < n; i += 1) tick(sim, STEP, input);
  },
};
