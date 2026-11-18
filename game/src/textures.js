// textures.js — every surface in the game, painted in Canvas 2D and cached by name.
//
// Nothing is downloaded and no image ships with the game. The tarmac is grit and tyre polish, the
// windows are a grid of warm and cool panes, the palm crown is eleven quadratic curves, the sky is
// a seven-stop ladder from violet to gold. Each painter seeds its own stream, so the same aggregate
// lands in the same spot on every load and a screenshot never drifts between two runs.
//
// Every painter takes a key and memoises, so a hundred buildings sharing a wall colour and a lit
// ratio share one 256-pixel tile and therefore one texture on the GPU.

import * as THREE from '../vendor/three/three.module.min.js';
import { stream } from './random.js';
import { PAINT } from './scale.js';

const cache = new Map();

function sheet(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function texture(canvas, { srgb = true, clamp = false } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function memo(key, paint) {
  const known = cache.get(key);
  if (known) return known;
  const made = paint();
  cache.set(key, made);
  return made;
}

// ---------------------------------------------------------------- the ground

/** Dark aggregate with two polished wheel bands, over a 20 m square. */
export function tarmac() {
  return memo('tarmac', () => {
    const c = sheet(512, 512);
    const g = c.getContext('2d');
    const r = stream(41);
    g.fillStyle = PAINT.asphalt;
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 7600; i += 1) {
      const v = 88 + r() * 72;
      g.fillStyle = `rgba(${Math.round(v + 16)},${Math.round(v + 10)},${Math.round(v + 22)},${(0.05 + r() * 0.2).toFixed(3)})`;
      g.fillRect(r() * 512, r() * 512, 1 + r() * 2.4, 1 + r() * 2.4);
    }
    g.fillStyle = 'rgba(232,203,182,0.045)';
    g.fillRect(116, 0, 62, 512);
    g.fillRect(334, 0, 62, 512);
    for (let i = 0; i < 26; i += 1) {
      const y = r() * 512;
      const w = 30 + r() * 120;
      g.fillStyle = `rgba(18,16,24,${(0.025 + r() * 0.045).toFixed(3)})`;
      g.fillRect(r() * 512, y, w, 3 + r() * 9);
    }
    return texture(c);
  });
}

/** Warm concrete pavers, eight metres to a repeat. */
export function paving() {
  return memo('paving', () => {
    const c = sheet(512, 512);
    const g = c.getContext('2d');
    const r = stream(77);
    g.fillStyle = PAINT.pavement;
    g.fillRect(0, 0, 512, 512);
    const tile = 64;
    for (let y = 0; y < 512; y += tile) {
      for (let x = 0; x < 512; x += tile) {
        const v = 0.9 + r() * 0.16;
        g.fillStyle = `rgb(${Math.round(203 * v)},${Math.round(178 * v)},${Math.round(155 * v)})`;
        g.fillRect(x + 1, y + 1, tile - 2, tile - 2);
      }
    }
    g.strokeStyle = 'rgba(88,68,58,0.34)';
    g.lineWidth = 2;
    for (let i = 0; i <= 512; i += tile) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 512);
      g.moveTo(0, i);
      g.lineTo(512, i);
      g.stroke();
    }
    for (let i = 0; i < 520; i += 1) {
      g.fillStyle = `rgba(80,60,50,${(0.03 + r() * 0.08).toFixed(3)})`;
      g.fillRect(r() * 512, r() * 512, 2 + r() * 10, 2 + r() * 10);
    }
    return texture(c);
  });
}

/** Pale beach sand: shell grit and wind ripples. */
export function dune() {
  return memo('dune', () => {
    const c = sheet(256, 256);
    const g = c.getContext('2d');
    const r = stream(9);
    g.fillStyle = PAINT.dune;
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4400; i += 1) {
      g.fillStyle = r() < 0.5 ? `rgba(255,246,224,${(0.1 + r() * 0.2).toFixed(2)})` : `rgba(180,140,100,${(0.06 + r() * 0.14).toFixed(2)})`;
      g.fillRect(r() * 256, r() * 256, 1, 1);
    }
    g.strokeStyle = 'rgba(200,165,120,0.15)';
    for (let i = 0; i < 18; i += 1) {
      const y = r() * 256;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x < 256; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 3);
      g.stroke();
    }
    return texture(c);
  });
}

/** Mown lawn, with the stripes a park keeper leaves. */
export function turf() {
  return memo('turf', () => {
    const c = sheet(256, 256);
    const g = c.getContext('2d');
    const r = stream(31);
    g.fillStyle = PAINT.grass;
    g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 32) {
      g.fillStyle = (x / 32) % 2 ? 'rgba(255,255,214,0.05)' : 'rgba(0,40,20,0.08)';
      g.fillRect(x, 0, 32, 256);
    }
    for (let i = 0; i < 2800; i += 1) {
      g.fillStyle = `rgba(${Math.round(60 + r() * 60)},${Math.round(120 + r() * 60)},${Math.round(60 + r() * 40)},${(0.14 + r() * 0.3).toFixed(2)})`;
      g.fillRect(r() * 256, r() * 256, 1, 1 + r() * 2);
    }
    for (let i = 0; i < 16; i += 1) {
      g.fillStyle = r() < 0.6 ? '#ffe9a8' : '#ff9cc4';
      g.beginPath();
      g.arc(r() * 256, r() * 256, 1.4, 0, Math.PI * 2);
      g.fill();
    }
    return texture(c);
  });
}

// ---------------------------------------------------------------- the buildings

/**
 * One 256 px tile of facade: four windows across, two floors down. A lit pane is a warm or a cool
 * vertical wash; a dark one is night glass with a little sky in it. Both get a frame and a glint,
 * which is what keeps a wall of windows from reading as a checkerboard.
 */
export function facade(wall, grain, lit) {
  return memo(`wall:${wall}:${grain}:${lit}`, () => {
    const r = stream(grain + 13);
    const S = 256;
    const c = sheet(S, S);
    const g = c.getContext('2d');
    g.fillStyle = wall;
    g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(0, 0, 10, S);
    g.fillRect(S - 10, 0, 10, S);
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.fillRect(0, 0, S, 6);

    const cols = 4;
    const rows = 2;
    const cw = S / cols;
    const ch = S / rows;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const px = col * cw + 16;
        const py = row * ch + 22;
        const pw = cw - 32;
        const ph = ch - 44;
        const on = r() < lit;
        if (on) {
          const warm = r() > 0.36;
          const wash = g.createLinearGradient(px, py, px, py + ph);
          wash.addColorStop(0, warm ? '#fff0c4' : '#e6ffff');
          wash.addColorStop(1, warm ? '#ffc470' : '#9fe2e6');
          g.fillStyle = wash;
        } else {
          const v = 22 + r() * 14;
          g.fillStyle = `rgb(${Math.round(v)},${Math.round(v + 8)},${Math.round(v + 22)})`;
        }
        g.fillRect(px, py, pw, ph);
        g.strokeStyle = 'rgba(10,8,16,0.55)';
        g.lineWidth = 2;
        g.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
        g.fillStyle = on ? 'rgba(255,255,255,0.22)' : 'rgba(180,210,255,0.14)';
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + pw * 0.42, py);
        g.lineTo(px, py + ph * 0.5);
        g.closePath();
        g.fill();
      }
    }
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(0, ch - 8, S, 3);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(0, ch + 4, S, 4);
    return texture(c);
  });
}

/** A shopfront band: a lit interior, silhouetted customers, a shelf of colour behind glass. */
export function shopfront(grain) {
  return memo(`shop:${grain}`, () => {
    const r = stream(grain + 5);
    const c = sheet(256, 128);
    const g = c.getContext('2d');
    g.fillStyle = '#1a1020';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = r() < 0.7 ? '#ffcf8a' : '#b8f0ee';
    g.fillRect(6, 8, 244, 104);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 5; i += 1) g.fillRect(20 + i * 46, 40 + r() * 30, 14, 60);
    g.globalAlpha = 0.55;
    for (let i = 0; i < 30; i += 1) {
      g.fillStyle = PAINT.neon[Math.floor(r() * PAINT.neon.length)];
      g.fillRect(10 + r() * 230, 20 + r() * 20, 6, 6);
    }
    g.globalAlpha = 1;
    g.strokeStyle = '#1a1020';
    g.lineWidth = 4;
    for (let i = 1; i < 4; i += 1) {
      g.beginPath();
      g.moveTo(i * 64, 0);
      g.lineTo(i * 64, 128);
      g.stroke();
    }
    return texture(c);
  });
}

/** A neon board: a dark panel, a glowing border and two or three abstract tube strokes. */
export function neonBoard(colour, grain) {
  return memo(`neon:${colour}:${grain}`, () => {
    const r = stream(grain + 3);
    const c = sheet(128, 64);
    const g = c.getContext('2d');
    g.fillStyle = '#120a1c';
    g.fillRect(0, 0, 128, 64);
    g.strokeStyle = colour;
    g.shadowColor = colour;
    g.shadowBlur = 8;
    g.lineWidth = 3;
    g.strokeRect(4, 4, 120, 56);
    g.lineWidth = 2;
    const strokes = 2 + Math.floor(r() * 2);
    for (let i = 0; i < strokes; i += 1) {
      const y = 16 + i * 16;
      g.beginPath();
      g.moveTo(16 + r() * 10, y);
      g.lineTo(64 + r() * 20, y - 6 + r() * 12);
      g.lineTo(112 - r() * 8, y);
      g.stroke();
    }
    g.shadowBlur = 0;
    return texture(c, { srgb: false });
  });
}

/**
 * A shop's own signboard: the name in lit letters on a dark ground, drawn at the size the plate
 * hangs at so the words are legible from across the boulevard rather than smeared into a blur.
 */
export function shopSign(name, strap, accent) {
  return memo(`sign:${name}`, () => {
    const c = sheet(512, 192);
    const g = c.getContext('2d');
    g.fillStyle = '#0c0912';
    g.fillRect(0, 0, 512, 192);
    g.strokeStyle = accent;
    g.shadowColor = accent;
    g.shadowBlur = 14;
    g.lineWidth = 5;
    g.strokeRect(8, 8, 496, 176);
    g.textAlign = 'center';
    g.fillStyle = accent;
    g.font = 'bold 54px "DejaVu Sans", "Liberation Sans", Arial, sans-serif';
    g.fillText(name, 256, 92);
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,246,234,0.86)';
    g.font = 'bold 22px "DejaVu Sans Mono", "Liberation Mono", monospace';
    g.fillText(strap, 256, 142);
    return texture(c, { srgb: false });
  });
}

// ---------------------------------------------------------------- props and effects

/** A palm crown seen from above: eleven drooping fronds, cut out of transparency. */
export function fronds() {
  return memo('fronds', () => {
    const c = sheet(256, 256);
    const g = c.getContext('2d');
    const r = stream(404);
    for (let i = 0; i < 11; i += 1) {
      const a = (i / 11) * Math.PI * 2 + r() * 0.2;
      const len = 100 + r() * 18;
      const droop = 0.5 + r() * 0.35;
      g.save();
      g.translate(128, 128);
      g.rotate(a);
      const wash = g.createLinearGradient(0, 0, len, 0);
      wash.addColorStop(0, '#1f5a37');
      wash.addColorStop(1, '#57a35e');
      g.fillStyle = wash;
      g.beginPath();
      g.moveTo(0, -5);
      g.quadraticCurveTo(len * 0.55, -22 * droop, len, 4);
      g.quadraticCurveTo(len * 0.55, 16 * droop, 0, 5);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(20,60,35,0.8)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(len, 4);
      g.stroke();
      g.restore();
    }
    g.fillStyle = '#2f6b40';
    g.beginPath();
    g.arc(128, 128, 12, 0, Math.PI * 2);
    g.fill();
    return texture(c);
  });
}

/** A soft round blob in one colour, so a material can tint it and add it to the scene. */
export function glow(colour = '#ffffff') {
  return memo(`glow:${colour}`, () => {
    const c = sheet(128, 128);
    const g = c.getContext('2d');
    const wash = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    wash.addColorStop(0, colour);
    wash.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = wash;
    g.fillRect(0, 0, 128, 128);
    return texture(c, { srgb: false });
  });
}

/**
 * A cone of light for the helicopter: bright at the apex, fading out along the beam, brightest
 * down the middle. Mapped onto an open cone with additive blending, it reads as a shaft of sunlit
 * dust from any angle — which is the only way a searchlight shows up in a still frame.
 */
export function beam() {
  return memo('beam', () => {
    const c = sheet(64, 256);
    const g = c.getContext('2d');
    const down = g.createLinearGradient(0, 0, 0, 256);
    down.addColorStop(0, 'rgba(255,246,214,0.92)');
    down.addColorStop(0.35, 'rgba(255,238,196,0.42)');
    down.addColorStop(1, 'rgba(255,228,170,0.05)');
    g.fillStyle = down;
    g.fillRect(0, 0, 64, 256);
    // Feather the two edges so the cone has no hard silhouette line against the sky.
    const edges = g.createLinearGradient(0, 0, 64, 0);
    edges.addColorStop(0, 'rgba(0,0,0,1)');
    edges.addColorStop(0.32, 'rgba(0,0,0,0)');
    edges.addColorStop(0.68, 'rgba(0,0,0,0)');
    edges.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = edges;
    g.fillRect(0, 0, 64, 256);
    g.globalCompositeOperation = 'source-over';
    return texture(c, { srgb: false, clamp: true });
  });
}

/** The sky: a gulf evening, violet overhead through coral to gold on the waterline. */
export function skyLadder() {
  return memo('sky', () => {
    const c = sheet(8, 512);
    const g = c.getContext('2d');
    const ladder = g.createLinearGradient(0, 0, 0, 512);
    ladder.addColorStop(0.0, '#1b4a7a');
    ladder.addColorStop(0.22, '#4a6ea7');
    ladder.addColorStop(0.42, '#9a6c9d');
    ladder.addColorStop(0.58, '#dc6e7f');
    ladder.addColorStop(0.72, '#ff8c5d');
    ladder.addColorStop(0.86, '#ffb372');
    ladder.addColorStop(1.0, '#ffe0a8');
    g.fillStyle = ladder;
    g.fillRect(0, 0, 8, 512);
    return texture(c, { clamp: true });
  });
}

/** The sun as a billboard: a hot core with a wide warm halo behind it. */
export function sunDisc() {
  return memo('sun', () => {
    const c = sheet(256, 256);
    const g = c.getContext('2d');
    const wash = g.createRadialGradient(128, 128, 2, 128, 128, 128);
    wash.addColorStop(0, 'rgba(255,255,252,1)');
    wash.addColorStop(0.3, 'rgba(255,252,232,1)');
    wash.addColorStop(0.36, 'rgba(255,238,186,0.98)');
    wash.addColorStop(0.42, 'rgba(255,206,140,0.72)');
    wash.addColorStop(0.55, 'rgba(255,164,112,0.3)');
    wash.addColorStop(0.75, 'rgba(255,132,112,0.11)');
    wash.addColorStop(1, 'rgba(255,110,120,0)');
    g.fillStyle = wash;
    g.fillRect(0, 0, 256, 256);
    return texture(c, { srgb: false });
  });
}

/** Long thin crests for the bay, tiled across the water. */
export function ripples() {
  return memo('ripples', () => {
    const c = sheet(256, 256);
    const g = c.getContext('2d');
    const r = stream(88);
    for (let i = 0; i < 150; i += 1) {
      const y = r() * 256;
      const x = r() * 256;
      const w = 10 + r() * 60;
      g.strokeStyle = `rgba(255,236,210,${(0.05 + r() * 0.16).toFixed(3)})`;
      g.lineWidth = 1 + r() * 2;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + w * 0.5, y - 2, x + w, y);
      g.stroke();
    }
    return texture(c, { srgb: false });
  });
}
