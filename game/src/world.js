// world.js — the renderer, the light, the sky and the static city, built once from the plan.
//
// Everything that never moves goes through Batch into one mesh per material, so a town of several
// thousand boxes and a hundred neon boards costs about thirty draw calls. This module also owns the
// two things that move without being cast: the sun's shadow box, which slides with the player but
// snaps to a grid so its edges do not crawl, and the sea's ripple map, which drifts.
//
// The moving cast — cars, bodies, the helicopter — is not here. cast.js builds those into the scene
// this module hands back.

import * as THREE from '../vendor/three/three.module.min.js';
import { SUN, SKY, PAINT, CITY, SHORE, GRID } from './scale.js';
import { AVENUES, KERB, SETBACK, EDGE } from './cityPlan.js';
import { Batch } from './batch.js';
import { stream } from './random.js';
import {
  tarmac,
  paving,
  dune,
  turf,
  facade,
  shopfront,
  neonBoard,
  shopSign,
  fronds,
  glow,
  skyLadder,
  sunDisc,
  ripples,
} from './textures.js';

const ROAD_W = CITY.first;
const ROAD_E = CITY.last;

/** Build the world onto `canvas` for `plan`, and hand back the handle the game drives. */
export function buildWorld(canvas, plan) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
    stencil: false,
  });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(new THREE.Color(SKY.haze), SKY.hazeDensity);

  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.4, 9000);

  // One low sun in the west, a hemisphere fill the colour of the sky over the sand, and a cool rim
  // off the water so no shadowed wall is ever black.
  const sunRay = new THREE.Vector3(Math.cos(SUN.bearing), SUN.altitude, Math.sin(SUN.bearing)).normalize();
  const sun = new THREE.DirectionalLight(new THREE.Color(SUN.colour), SUN.strength);
  sun.position.copy(sunRay).multiplyScalar(430);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const frustum = sun.shadow.camera;
  frustum.left = -180;
  frustum.right = 180;
  frustum.top = 180;
  frustum.bottom = -180;
  frustum.near = 40;
  frustum.far = 1000;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.5;
  scene.add(sun, sun.target);

  scene.add(new THREE.HemisphereLight(new THREE.Color(SKY.skyFill), new THREE.Color(SKY.groundFill), 1.28));
  const rim = new THREE.DirectionalLight(new THREE.Color('#7fd8e8'), 0.5);
  rim.position.set(260, 170, -320);
  scene.add(rim);

  const town = new THREE.Group();
  town.name = 'vice-meridian';
  scene.add(town);

  const sky = skyDome(scene, sunRay);
  layGround(town, plan);
  paintLanes(town);
  raiseBlocks(town, plan);
  signShops(town, plan);
  plantPalms(town, plan);
  const sea = floodBay(town);
  furnish(town, plan);

  return {
    renderer,
    scene,
    camera,
    sun,
    sunRay,
    town,
    sky,
    sea,
    /** Aim the shadow box at a point, snapped so its edges do not crawl as the player moves. */
    pointSun(x, z) {
      const snap = 4;
      const sx = Math.round(x / snap) * snap;
      const sz = Math.round(z / snap) * snap;
      sun.target.position.set(sx, 0, sz);
      sun.position.set(sx + sunRay.x * 430, sunRay.y * 430, sz + sunRay.z * 430);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
    },
    resize(w, h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    /** Drift the water, so a still frame has one thing moving in it. */
    animate(t) {
      if (sea?.material?.map) {
        sea.material.map.offset.x = t * 0.006;
        sea.material.map.offset.y = t * 0.0035;
      }
    },
  };
}

// ---------------------------------------------------------------- sky

function skyDome(scene, sunRay) {
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(3000, 32, 18),
    new THREE.MeshBasicMaterial({
      map: skyLadder(),
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  dome.name = 'sky';
  dome.renderOrder = -20;
  dome.frustumCulled = false;
  scene.add(dome);

  const disc = new THREE.Mesh(
    new THREE.PlaneGeometry(430, 430),
    new THREE.MeshBasicMaterial({
      map: sunDisc(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    }),
  );
  disc.position.copy(new THREE.Vector3(Math.cos(SUN.bearing), SUN.discAltitude, Math.sin(SUN.bearing)).normalize()).multiplyScalar(2400);
  disc.lookAt(0, disc.position.y, 0);
  disc.name = 'sun-disc';
  disc.renderOrder = 6;
  disc.frustumCulled = false;
  scene.add(disc);

  // A bank of cloud low over the water: wide faint planes stacked back into the haze.
  const cloudPaint = new THREE.MeshBasicMaterial({
    map: glow('#ffc8b0'),
    transparent: true,
    opacity: 0.17,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  for (let i = 0; i < 6; i += 1) {
    const cloud = new THREE.Mesh(new THREE.PlaneGeometry(1100 + i * 240, 74 + i * 14), cloudPaint);
    cloud.position.set(-1750 - i * 80, 200 + i * 56, 760 - i * 300);
    cloud.lookAt(0, cloud.position.y * 0.9, 0);
    cloud.name = `cloud-${i}`;
    cloud.renderOrder = 5;
    cloud.frustumCulled = false;
    scene.add(cloud);
  }
  return { dome, disc };
}

// ---------------------------------------------------------------- ground

function layGround(town, plan) {
  // One tarmac plate under the whole town: the avenues and their crossings are its surface.
  const road = new Batch(new THREE.MeshLambertMaterial({ map: tarmac() }), { shadows: false });
  road.slab(ROAD_W - 2, ROAD_W - 2, ROAD_E + 2, ROAD_E + 2, 0, { tile: 22 });
  town.add(road.mesh('roadbed'));

  // Each block is a plate 0.3 m up on a kerb, ringed by a 0.6 m stone. A shop block's forecourt is
  // paved a little paler, the way a garage apron is.
  const walk = new Batch(new THREE.MeshLambertMaterial({ map: paving() }), { shadows: false });
  const forecourt = new Batch(new THREE.MeshLambertMaterial({ map: paving(), color: new THREE.Color('#f0e0cc') }), { shadows: false });
  const green = new Batch(new THREE.MeshLambertMaterial({ map: turf() }), { shadows: false });
  const stones = new Batch(new THREE.MeshLambertMaterial({ color: new THREE.Color(PAINT.kerb) }), { shadows: false });
  for (const b of plan.blocks) {
    if (b.kind === 'park') green.slab(b.x, b.z, b.x + b.w, b.z + b.h, 0.32, { tile: 9 });
    else if (b.kind === 'shop') forecourt.slab(b.x, b.z, b.x + b.w, b.z + b.h, 0.31, { tile: 7 });
    else walk.slab(b.x, b.z, b.x + b.w, b.z + b.h, 0.3, { tile: 7 });
    const t = 0.6;
    stones.box(b.x + b.w / 2, 0, b.z - t / 2, b.w + t * 2, 0.3, t, { tile: [4, 1] });
    stones.box(b.x + b.w / 2, 0, b.z + b.h + t / 2, b.w + t * 2, 0.3, t, { tile: [4, 1] });
    stones.box(b.x - t / 2, 0, b.z + b.h / 2, t, 0.3, b.h, { tile: [4, 1] });
    stones.box(b.x + b.w + t / 2, 0, b.z + b.h / 2, t, 0.3, b.h, { tile: [4, 1] });
  }
  town.add(walk.mesh('pavement'), forecourt.mesh('forecourts'), green.mesh('lawns'), stones.mesh('kerbs'));

  // The promenade: a pale walk between the west avenue and the sand, and the marina quay south.
  const prom = new Batch(new THREE.MeshLambertMaterial({ map: paving() }), { shadows: false });
  prom.slab(SHORE.promenade, ROAD_W, SHORE.kerb + 1, ROAD_E, 0.26, { tile: 8 });
  prom.slab(ROAD_W, SHORE.quay - 1, ROAD_E, SHORE.bay, 0.26, { tile: 8 });
  town.add(prom.mesh('promenade'));

  const beach = new Batch(new THREE.MeshLambertMaterial({ map: dune() }), { shadows: false });
  beach.slab(SHORE.sand, ROAD_W - 140, SHORE.promenade, ROAD_E + 140, 0.08, { tile: 26 });
  town.add(beach.mesh('beach'));
}

// ---------------------------------------------------------------- paint on the road

/** Lane dashes, a gold centre line and zebra crossings at every junction arm. */
function paintLanes(town) {
  const flat = (colour, opacity) =>
    new Batch(
      new THREE.MeshBasicMaterial({ color: new THREE.Color(colour), toneMapped: false, transparent: true, opacity }),
      { shadows: false },
    );
  const dashes = flat(PAINT.laneDash, 0.92);
  const centre = flat(PAINT.centre, 0.9);
  const zebra = flat(PAINT.crossing, 0.82);
  const dash = 3.4;
  const gap = 8.8;
  const lane = 5.3;
  const lines = AVENUES;

  const clearOfJunctions = (t) => !lines.some((line) => Math.abs(t - line) < KERB + 7);

  for (const line of lines) {
    for (let t = ROAD_W + 6; t < ROAD_E - 6; t += gap) {
      if (!clearOfJunctions(t)) continue;
      dashes.patch(t + dash / 2, line - lane, dash, 0.24, 0.025);
      dashes.patch(t + dash / 2, line + lane, dash, 0.24, 0.025);
      dashes.patch(line - lane, t + dash / 2, 0.24, dash, 0.025);
      dashes.patch(line + lane, t + dash / 2, 0.24, dash, 0.025);
    }
    for (let t = ROAD_W + 4; t < ROAD_E - 4; t += 1.4) {
      if (!clearOfJunctions(t)) continue;
      centre.patch(t, line - 0.55, 1.4, 0.17, 0.026);
      centre.patch(t, line + 0.55, 1.4, 0.17, 0.026);
      centre.patch(line - 0.55, t, 0.17, 1.4, 0.026);
      centre.patch(line + 0.55, t, 0.17, 1.4, 0.026);
    }
    for (const other of lines) {
      if (other === line) continue;
      for (let k = 0; k < 11; k += 1) {
        const off = -KERB + 5.5 + k * 8.2;
        zebra.patch(other + off, line - KERB - 4.8, 4.2, 5.2, 0.028);
        zebra.patch(other + off, line + KERB + 4.8, 4.2, 5.2, 0.028);
        zebra.patch(line - KERB - 4.8, other + off, 5.2, 4.2, 0.028);
        zebra.patch(line + KERB + 4.8, other + off, 5.2, 4.2, 0.028);
      }
    }
  }
  town.add(dashes.mesh('lane-dashes'), centre.mesh('centre-lines'), zebra.mesh('crossings'));
}

// ---------------------------------------------------------------- buildings

/**
 * The blocks. A building is a body whose facade texture is keyed on its wall colour, a window seed
 * and how lit it is; a cornice; sometimes a slimmer shaft out of a wide podium; a roof with plant on
 * it; and, at street level, a lit shopfront band with maybe a neon board above it and a pool of its
 * colour on the pavement under that.
 */
function raiseBlocks(town, plan) {
  const rand = stream(1707);
  const storey = GRID.storey;
  const bodies = new Map();
  const boards = new Map();
  const roofs = new Batch(new THREE.MeshLambertMaterial({ color: new THREE.Color('#4b4254') }));
  const stone = new Batch(new THREE.MeshLambertMaterial({ color: new THREE.Color('#eee1cb') }));
  const shops = new Batch(new THREE.MeshBasicMaterial({ map: shopfront(3), toneMapped: false }), { shadows: false });
  const pools = new Batch(
    new THREE.MeshBasicMaterial({
      map: glow('#ff7ac0'),
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
    { shadows: false },
  );

  for (const b of plan.buildings) {
    const key = `${b.wall}|${b.seed % 6}|${b.lit.toFixed(2)}`;
    let body = bodies.get(key);
    if (!body) {
      body = new Batch(
        new THREE.MeshLambertMaterial({
          map: facade(b.wall, b.seed, b.lit),
          color: new THREE.Color(b.shade, b.shade, b.shade),
        }),
      );
      bodies.set(key, body);
    }
    const cx = b.x + b.w / 2;
    const cz = b.z + b.d / 2;
    const lower = b.podium > 0 ? b.podium : b.height;
    body.box(cx, 0.3, cz, b.w, lower, b.d, { tile: [14, storey * 2] });
    stone.box(cx, lower + 0.3, cz, b.w + 0.6, 0.36, b.d + 0.6, { tile: [10, 1] });
    if (b.shaft) {
      body.box(cx, lower + 0.66, cz, b.shaft.w, b.height - lower, b.shaft.d, { tile: [14, storey * 2] });
      stone.box(cx, b.height + 0.66, cz, b.shaft.w + 0.5, 0.34, b.shaft.d + 0.5, { tile: [10, 1] });
    }
    const topW = b.shaft ? b.shaft.w : b.w;
    const topD = b.shaft ? b.shaft.d : b.d;
    roofs.box(cx, b.height + 0.92, cz, topW * 0.98, 0.5, topD * 0.98, { tile: [11, 2] });
    if (b.crown === 'box') roofs.box(b.x + b.w * 0.32, b.height + 1.42, b.z + b.d * 0.32, 4.6, 2.8, 3.8, { tile: [4, 2] });
    if (b.crown === 'ac') roofs.box(b.x + b.w * 0.68, b.height + 1.42, b.z + b.d * 0.7, 3.2, 1.3, 2.6, { tile: [3, 2] });
    if (b.crown === 'antenna') roofs.box(cx, b.height + 1.42, cz, 0.55, 9, 0.55, { tile: [2, 2] });

    // Street level: a lit band on the two faces that meet a pavement, on the low buildings.
    if (b.floors <= 4 && !b.shop) {
      const bandH = 3.0;
      const y = 0.45;
      const bandW = Math.min(b.w - 3, 26);
      if (bandW >= 6) {
        const south = b.z + b.d + 0.08;
        const north = b.z - 0.08;
        shops.quad([cx - bandW / 2, y, south], [cx + bandW / 2, y, south], [cx + bandW / 2, y + bandH, south], [cx - bandW / 2, y + bandH, south], [[0, 0], [bandW / 8, 0], [bandW / 8, 1], [0, 1]], [0, 0, 1]);
        shops.quad([cx + bandW / 2, y, north], [cx - bandW / 2, y, north], [cx - bandW / 2, y + bandH, north], [cx + bandW / 2, y + bandH, north], [[bandW / 8, 0], [0, 0], [0, 1], [bandW / 8, 1]], [0, 0, -1]);
        shops.quad([b.x + b.w + 0.08, y, cz - bandW / 2], [b.x + b.w + 0.08, y, cz + bandW / 2], [b.x + b.w + 0.08, y + bandH, cz + bandW / 2], [b.x + b.w + 0.08, y + bandH, cz - bandW / 2], [[0, 0], [bandW / 8, 0], [bandW / 8, 1], [0, 1]], [1, 0, 0]);
        shops.quad([b.x - 0.08, y, cz + bandW / 2], [b.x - 0.08, y, cz - bandW / 2], [b.x - 0.08, y + bandH, cz - bandW / 2], [b.x - 0.08, y + bandH, cz + bandW / 2], [[0, 0], [bandW / 8, 0], [bandW / 8, 1], [0, 1]], [-1, 0, 0]);
      }
    }

    if (b.neon) {
      const side = b.neonFace % 4;
      const run = Math.min(b.w, b.d) * 0.66;
      const rise = Math.max(3, Math.min(10, b.height * 0.3));
      const y = Math.min(b.height - rise - 0.6, 4.2 + rand() * 5);
      const boardKey = `${b.neon}:${b.seed % 5}`;
      let board = boards.get(boardKey);
      if (!board) {
        board = new Batch(
          new THREE.MeshBasicMaterial({ map: neonBoard(b.neon, b.seed % 5), transparent: true, toneMapped: false }),
          { shadows: false },
        );
        boards.set(boardKey, board);
      }
      const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
      if (side === 0) board.quad([cx - run / 2, y, b.z + b.d + 0.35], [cx + run / 2, y, b.z + b.d + 0.35], [cx + run / 2, y + rise, b.z + b.d + 0.35], [cx - run / 2, y + rise, b.z + b.d + 0.35], uv);
      if (side === 1) board.quad([cx + run / 2, y, b.z - 0.35], [cx - run / 2, y, b.z - 0.35], [cx - run / 2, y + rise, b.z - 0.35], [cx + run / 2, y + rise, b.z - 0.35], uv);
      if (side === 2) board.quad([b.x + b.w + 0.35, y, cz + run / 2], [b.x + b.w + 0.35, y, cz - run / 2], [b.x + b.w + 0.35, y + rise, cz - run / 2], [b.x + b.w + 0.35, y + rise, cz + run / 2], uv);
      if (side === 3) board.quad([b.x - 0.35, y, cz - run / 2], [b.x - 0.35, y, cz + run / 2], [b.x - 0.35, y + rise, cz + run / 2], [b.x - 0.35, y + rise, cz - run / 2], uv);
      const gx = side === 2 ? b.x + b.w + 4 : side === 3 ? b.x - 4 : cx;
      const gz = side === 0 ? b.z + b.d + 4 : side === 1 ? b.z - 4 : cz;
      if (b.floors > 2) pools.patch(gx, gz, run * 1.8, 10, 0.33, side < 2 ? 0 : Math.PI / 2);
    }
  }

  let n = 0;
  for (const body of bodies.values()) town.add(body.mesh(`facade-${n++}`));
  n = 0;
  for (const board of boards.values()) town.add(board.mesh(`neon-${n++}`));
  town.add(roofs.mesh('roofs'), stone.mesh('cornices'), shops.mesh('shopfronts'), pools.mesh('neon-spill'));
}

/**
 * The three shops get a plate over the door with their name on it, and a lit awning under the
 * plate. The marker in the street is what the HUD paints; this is what tells the player which
 * frontage is which without reading the HUD at all.
 */
function signShops(town, plan) {
  for (const shop of plan.shops) {
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(13, 4.9),
      new THREE.MeshBasicMaterial({ map: shopSign(shop.name, shop.strap, shop.accent), transparent: true, toneMapped: false }),
    );
    plate.position.set(shop.x - shop.w / 2 - 0.3, 6.4, shop.z);
    plate.rotation.y = -Math.PI / 2;
    plate.name = `sign-${shop.id}`;
    town.add(plate);

    // The awning: a coloured bar with a glow under it, so the shop reads from a car at speed.
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.28, 20),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(shop.accent), toneMapped: false }),
    );
    awning.position.set(shop.x - shop.w / 2 - 1.4, 3.5, shop.z);
    town.add(awning);
    const spill = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 22),
      new THREE.MeshBasicMaterial({
        map: glow(shop.accent),
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    spill.rotation.x = -Math.PI / 2;
    spill.position.set(shop.x - shop.w / 2 - 5, 0.36, shop.z);
    town.add(spill);
  }
}

// ---------------------------------------------------------------- parks and palms

/**
 * The parks: a crossing of stone paths, a round fountain and a ring of palms. The promenade rank
 * and the pavement planters are planted here too, because a street without palms does not read as
 * this coast. Each crown is two crossed planes in one InstancedMesh.
 */
function plantPalms(town, plan) {
  const rand = stream(23);
  const paths = new Batch(new THREE.MeshLambertMaterial({ color: new THREE.Color('#dcc8ae') }), { shadows: false });
  const water = new Batch(new THREE.MeshLambertMaterial({ color: new THREE.Color('#5fb8c4') }), { shadows: false });
  const trunks = new Batch(new THREE.MeshLambertMaterial({ color: new THREE.Color('#7d5a3c') }));
  const crowns = [];

  const palm = (x, z, h, scale = 1) => {
    trunks.column(x, 0.3, z, 0.42 * scale, 0.24 * scale, h * 0.95, 5);
    crowns.push({ x, z, y: h * 0.95 + 0.3, scale: scale * (0.9 + rand() * 0.3), turn: rand() * 6.28 });
  };

  for (const park of plan.parks) {
    const cx = park.x + park.w / 2;
    const cz = park.z + park.h / 2;
    paths.box(cx, 0.34, cz, park.w, 0.025, 5.5, { tile: [6, 1] });
    paths.box(cx, 0.34, cz, 5.5, 0.025, park.h, { tile: [6, 1] });
    water.column(cx, 0.36, cz, 5.6, 5.6, 0.5, 14);
    paths.column(cx, 0.36, cz, 6.6, 6.0, 0.85, 14);
    for (let i = 0; i < park.palms; i += 1) {
      const a = (i / park.palms) * Math.PI * 2 + rand() * 0.5;
      const rad = (i % 2 === 0 ? 0.38 : 0.24) * park.w;
      const px = cx + Math.cos(a) * rad;
      const pz = cz + Math.sin(a) * rad;
      if (Math.abs(px - cx) < 9 && Math.abs(pz - cz) < 9) continue;
      palm(px, pz, 12 + rand() * 8);
    }
  }

  // The promenade rank, the beach scatter, and the row along the marina quay.
  for (let t = ROAD_W + 12; t < ROAD_E; t += 24) {
    palm(SHORE.promenade + 12, t, 12 + rand() * 7);
    if (Math.round(t / 24) % 2 === 0) palm(SHORE.sand + 24, t + 12, 11 + rand() * 6);
  }
  for (let t = ROAD_W + 16; t < CITY.last - KERB; t += 30) palm(t, SHORE.quay - 10, 12 + rand() * 6);

  // Pavement planters: the signature of this street, and what breaks up a wall of glass at eye
  // height.
  for (const b of plan.blocks) {
    if (b.kind === 'park') continue;
    for (let t = b.z + 6; t < b.z + b.h - 4; t += 26) {
      palm(b.x + 4.2, t, 11 + rand() * 6);
      palm(b.x + b.w - 4.2, t + 13, 11 + rand() * 6);
    }
    for (let t = b.x + 10; t < b.x + b.w - 6; t += 30) {
      if (rand() < 0.55) palm(t, b.z + 4.2, 10 + rand() * 5);
    }
  }

  town.add(paths.mesh('park-paths'), water.mesh('fountains'), trunks.mesh('palm-trunks'));

  const inst = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshLambertMaterial({
      map: fronds(),
      transparent: true,
      alphaTest: 0.32,
      side: THREE.DoubleSide,
    }),
    crowns.length * 2,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const v = new THREE.Vector3();
  const e = new THREE.Euler();
  crowns.forEach((crown, i) => {
    for (let k = 0; k < 2; k += 1) {
      const size = 10 * crown.scale;
      e.set(-Math.PI / 2 + 0.12, crown.turn + k * Math.PI * 0.5, 0);
      q.setFromEuler(e);
      v.set(crown.x, crown.y, crown.z);
      s.set(size, size, size);
      m.compose(v, q, s);
      inst.setMatrixAt(i * 2 + k, m);
    }
  });
  inst.instanceMatrix.needsUpdate = true;
  inst.name = 'palm-crowns';
  inst.frustumCulled = false;
  town.add(inst);
}

// ---------------------------------------------------------------- water

function floodBay(town) {
  const ripple = ripples();
  ripple.repeat.set(46, 46);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(PAINT.water),
      roughness: 0.14,
      metalness: 0.55,
      map: ripple,
    }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-1400, -0.5, 1400);
  sea.name = 'sea';
  town.add(sea);

  // The sun's track across the bay, and the surf line where the sand meets the water.
  const track = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 2800),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffcf9a'),
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  track.rotation.x = -Math.PI / 2;
  track.position.set(-1100, -0.3, 1300);
  town.add(track);

  const surf = new THREE.Mesh(
    new THREE.PlaneGeometry(5, ROAD_E - ROAD_W + 400),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#e2f8f2'), transparent: true, opacity: 0.5 }),
  );
  surf.rotation.x = -Math.PI / 2;
  surf.position.set(SHORE.water - 2, -0.2, (ROAD_W + ROAD_E) / 2);
  town.add(surf);

  return sea;
}

// ---------------------------------------------------------------- street furniture

/** Lamp posts, hydrants, benches, the moored hulls at the quay and the pier out into the bay. */
function furnish(town, plan) {
  const rand = stream(51);
  const posts = new Batch(new THREE.MeshLambertMaterial({ color: new THREE.Color('#3b3946') }));
  const heads = new Batch(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe3b0'), toneMapped: false }), { shadows: false });
  const hydrants = new Batch(new THREE.MeshLambertMaterial({ color: new THREE.Color('#e8483f') }));
  const benches = new Batch(new THREE.MeshLambertMaterial({ color: new THREE.Color('#8a6a4a') }));

  for (const b of plan.blocks) {
    posts.column(b.x + 5, 0.3, b.z + 5, 0.15, 0.1, 7.6, 5);
    heads.box(b.x + 5, 7.6, b.z + 5, 0.5, 0.4, 0.5, { tile: [1, 1] });
    posts.column(b.x + b.w - 5, 0.3, b.z + b.h - 5, 0.15, 0.1, 7.6, 5);
    heads.box(b.x + b.w - 5, 7.6, b.z + b.h - 5, 0.5, 0.4, 0.5, { tile: [1, 1] });
    if (rand() < 0.55) hydrants.column(b.x + b.w * 0.5, 0.3, b.z + 3.4, 0.32, 0.26, 0.9, 6);
    if (b.kind === 'park') {
      for (let i = 0; i < 3; i += 1) benches.box(b.x + b.w * 0.5, 0.42, b.z + 12 + i * 20, 1.9, 0.45, 0.5, { tile: [2, 1] });
    }
  }

  const hulls = new Batch(new THREE.MeshLambertMaterial({ color: new THREE.Color('#f2efe6') }));
  const decks = new Batch(new THREE.MeshLambertMaterial({ color: new THREE.Color('#c8a27a') }), { shadows: false });
  for (let i = 0; i < 11; i += 1) {
    const x = 280 + i * 200;
    const z = ROAD_E + 22 + (i % 2) * 14;
    hulls.turned(x, -0.4, z, 6, 2.4, 17, 0.02 * i, null, [4, 2]);
    hulls.turned(x, 2.0, z - 2.4, 3.6, 1.7, 5.4, 0.02 * i, null, [3, 2]);
  }
  decks.turned(2350, 0.4, ROAD_E + 120, 6.5, 0.4, 190, 0, null, [4, 4]);
  decks.turned(2350, 0.4, ROAD_E + 214, 44, 0.4, 7, 0, null, [4, 4]);
  for (let i = 0; i < 10; i += 1) {
    posts.column(2350 + (i % 2 ? 3.2 : -3.2), -1.2, ROAD_E + 40 + i * 18, 0.22, 0.2, 3.4, 5);
  }
  // The lighthouse off the point, at the end of the pier.
  posts.column(-290, -0.6, ROAD_E + 300, 3.4, 1.9, 19, 10);
  heads.box(-290, 18.4, ROAD_E + 300, 2.8, 1.8, 2.8, { tile: [1, 1] });

  town.add(posts.mesh('lamp-posts'), heads.mesh('lamp-heads'), hydrants.mesh('hydrants'), benches.mesh('benches'), hulls.mesh('boat-hulls'), decks.mesh('pier'));
}

export { SETBACK, EDGE };
