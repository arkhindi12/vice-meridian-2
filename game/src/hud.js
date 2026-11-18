// hud.js — the heads-up display, painted on its own 2D canvas over the 3D view.
//
// One glance has to answer: where am I, what am I doing, who is chasing me, what am I in, what is
// playing, and what does the city think of me. So the display is a ring of five panels with one
// spine of type — a 9 px label, an 11 px line, a 15 px bold value, a 32 px number — and nothing
// overlaps anything else at 1280x720.
//
//   top left     the compass minimap, then RESPECT, the objective, and the dispatch list
//   top right    DAY and the clock, the wanted stars, the wallet
//   bottom left  health, armour, ammo
//   bottom right the radio, then the speedometer with the model and the condition
//   bottom middle the shop or car prompt, and the subtitle box above it
//
// The map is drawn in map space and rotated about its centre, so the arrow is always up and the
// city turns under it; blips are placed afterwards, unrotated, so a diamond stays a diamond.
//
// It paints at the canvas's own resolution and is scaled by CSS, so a 1280x720 render and a laptop
// window see the same layout at the same proportions.

import { LAW } from './scale.js';
import { AVENUES, CITY, SHORE, districtOf } from './cityPlan.js';
import { MISSIONS, currentMission, liveCondition, clockText, rankOf } from './story.js';
import { stationNow, trackTitle } from './radio.js';

export const TITLE = 'VICE MERIDIAN II';
export const TAGLINE = 'THE LONG SHADOW';

const MONO = '"DejaVu Sans Mono", "Liberation Mono", "Courier New", monospace';
const SANS = '"DejaVu Sans", "Liberation Sans", Arial, Helvetica, sans-serif';

const MAP = 196;
const MAP_SPAN = 520; // metres across the round map
const PINK = '#ff2f86';
const CYAN = '#22e6d0';
const GOLD = '#ffd23c';
const BONE = '#fff6ea';
const VIOLET = '#8f5bff';

/** Paint the whole display for the sim's current state. */
export function drawHud(ctx, sim) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';

  // The world layer first: the mission ring on the street, the shop marker, the damage vignette.
  streetMarkers(ctx, sim, w, h);
  vignette(ctx, sim, w, h);

  // A card dims the HUD underneath rather than competing with it.
  const carded = sim.mode === 'busted' || sim.mode === 'wasted' || sim.mode === 'paused';
  ctx.save();
  if (carded) ctx.globalAlpha = sim.mode === 'paused' ? 0.32 : 0.16;

  minimap(ctx, sim, 22, 22);
  respectPanel(ctx, sim, 22, 240);
  objectivePanel(ctx, sim, 22, 318);
  dispatchPanel(ctx, sim, 22, 424);
  vitalsPanel(ctx, sim, 22, h - 86);

  clockBlock(ctx, sim, w - 24, 24);
  wantedStars(ctx, sim, w - 24, 58);
  wallet(ctx, sim, w - 24, 100);

  speedPanel(ctx, sim, w - 24 - 336, h - 86);
  radioPanel(ctx, sim, w - 24 - 336, h - 86 - 82);

  prompt(ctx, sim, w, h);
  subtitle(ctx, sim, w, h);
  toast(ctx, sim, w, h);
  floaters(ctx, sim);
  if (sim.mode === 'play') crosshair(ctx, sim, w, h);
  ctx.restore();

  if (sim.mode === 'busted' || sim.mode === 'wasted') endCard(ctx, sim, w, h, sim.mode);
  if (sim.mode === 'paused') pauseCard(ctx, sim, w, h);
  ctx.restore();
}

// ---------------------------------------------------------------- small tools

function rounded(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A panel: a dark plate, a hairline of its own colour down the left, and a soft drop. */
function panel(ctx, x, y, w, h, accent, fill = 0.78) {
  ctx.save();
  ctx.fillStyle = 'rgba(6,5,12,0.34)';
  rounded(ctx, x + 2, y + 3, w, h, 4);
  ctx.fill();
  ctx.fillStyle = `rgba(10,8,20,${fill})`;
  rounded(ctx, x, y, w, h, 4);
  ctx.fill();
  if (accent) {
    ctx.fillStyle = accent;
    rounded(ctx, x, y, 3.5, h, 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,246,234,0.10)';
  ctx.lineWidth = 1;
  rounded(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 4);
  ctx.stroke();
  ctx.restore();
}

function wrapText(ctx, text, x, y, maxW, lineH, maxLines = 3) {
  const words = String(text).split(' ');
  let line = '';
  let py = y;
  let used = 0;
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (ctx.measureText(trial).width > maxW && line) {
      if (used + 1 >= maxLines) {
        ctx.fillText(`${line}…`, x, py);
        return;
      }
      ctx.fillText(line, x, py);
      line = word;
      py += lineH;
      used += 1;
    } else {
      line = trial;
    }
  }
  if (line) ctx.fillText(line, x, py);
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const metres = (d) => (d < 1000 ? `${Math.round(d)}M` : `${(d / 1000).toFixed(1)}KM`);

// ---------------------------------------------------------------- the minimap

/**
 * A round map that turns with the player's aim, the way a car's sat-nav does: the arrow is always
 * up and the world rotates under it. Roads, blocks, parks and water are drawn in map space and
 * rotated about the centre; the blips go on afterwards, unrotated, so a diamond stays a diamond.
 */
function minimap(ctx, sim, x, y) {
  const r = MAP / 2;
  const cx = x + r;
  const cy = y + r;
  const p = sim.player;
  const yaw = (p.driving ? p.driving.yaw : p.aimYaw) + Math.PI / 2;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const scale = MAP / MAP_SPAN;
  const last = AVENUES[AVENUES.length - 1];
  const toMap = (wx, wz) => {
    const mx = (wx - p.x) * scale;
    const mz = (wz - p.z) * scale;
    return { x: cx + mx * cos - mz * sin, y: cy + mx * sin + mz * cos };
  };
  const poly = (points, fill) => {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  ctx.save();
  // The bezel: a dark ring with a thin lit edge, so the map reads as an instrument.
  ctx.beginPath();
  ctx.arc(cx, cy, r + 7, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8,6,18,0.82)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.save();
  ctx.clip();

  // Water under everything; the town laid over it as a dark plate.
  ctx.fillStyle = '#0b4658';
  ctx.fillRect(cx - r, cy - r, MAP, MAP);
  poly([toMap(CITY.first, CITY.first), toMap(last + 60, CITY.first), toMap(last + 60, last + 60), toMap(CITY.first, last + 60)], '#1b1929');
  // The beach and the promenade: two pale bands west of the first avenue.
  poly([toMap(SHORE.sand, CITY.first), toMap(SHORE.promenade, CITY.first), toMap(SHORE.promenade, last + 60), toMap(SHORE.sand, last + 60)], '#c9ad7d');

  // Blocks, each turned about its own centre.
  for (const b of sim.plan.blocks) {
    const at = toMap(b.x + b.w / 2, b.z + b.h / 2);
    const q = Math.max(3, b.w * scale);
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.rotate(yaw);
    ctx.fillStyle = b.kind === 'park' ? '#2f6247' : b.kind === 'shop' ? '#4a3d55' : '#333147';
    ctx.fillRect(-q / 2, -q / 2, q, q);
    ctx.restore();
  }

  // The avenues: wide strokes with a dashed gold line down the middle of each.
  const roads = (width, colour, dash) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.setLineDash(dash ?? []);
    ctx.beginPath();
    for (const line of AVENUES) {
      const a = toMap(line, -80);
      const b = toMap(line, last + 80);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      const c = toMap(-80, line);
      const d = toMap(last + 80, line);
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };
  roads(Math.max(4, 86 * scale), '#6f6a80');
  roads(1.4, 'rgba(255,210,60,0.40)', [4, 6]);

  // The shops: a small coloured square at each marker, because a shop the player can spend at is
  // worth more on the map than a building.
  for (const shop of sim.plan.shops) {
    const m = toMap(shop.at.x, shop.at.z);
    if (Math.hypot(m.x - cx, m.y - cy) > r - 6) continue;
    ctx.fillStyle = shop.accent;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(m.x - 3, m.y - 3, 6, 6);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(m.x - 3, m.y - 3, 6, 6);
  }

  // The mission: a gold diamond inside the glass, or an arrow at the rim pointing at it.
  const m = currentMission(sim.story);
  if (m) {
    const at = toMap(m.at.x, m.at.z);
    if (Math.hypot(at.x - cx, at.y - cy) < r - 10) {
      const pulse = 1 + Math.sin(sim.time * 4) * 0.18;
      ctx.save();
      ctx.translate(at.x, at.y);
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 10;
      ctx.fillStyle = GOLD;
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-4.5 * pulse, -4.5 * pulse, 9 * pulse, 9 * pulse);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,210,60,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(at.x, at.y, 10 * pulse, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const a = Math.atan2(at.y - cy, at.x - cx);
      ctx.save();
      ctx.translate(cx + Math.cos(a) * (r - 12), cy + Math.sin(a) * (r - 12));
      ctx.rotate(a);
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(-5, 6);
      ctx.lineTo(-5, -6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // Police: a red or blue cruiser dot, a pale dot per officer on foot, and the helicopter as a
  // ringed cross so the air is on the map and not only in the sky.
  const beat = Math.sin(sim.time * 14) > 0;
  for (const u of sim.police.units) {
    const at = toMap(u.x, u.z);
    if (Math.hypot(at.x - cx, at.y - cy) > r - 4) continue;
    ctx.fillStyle = beat ? '#ff3355' : '#3d7dff';
    ctx.beginPath();
    ctx.arc(at.x, at.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 1;
    ctx.stroke();
    for (const o of u.officers) {
      if (!o.alive || o.inCar) continue;
      const om = toMap(o.x, o.z);
      ctx.fillStyle = 'rgba(160,200,255,0.9)';
      ctx.beginPath();
      ctx.arc(om.x, om.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (sim.police.air) {
    const at = toMap(sim.police.air.x, sim.police.air.z);
    const inside = Math.hypot(at.x - cx, at.y - cy) < r - 8;
    const px = inside ? at.x : cx + (at.x - cx) * 0.94;
    const py = inside ? at.y : cy + (at.y - cy) * 0.94;
    ctx.strokeStyle = '#fff0c0';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px - 8, py);
    ctx.lineTo(px - 6, py);
    ctx.moveTo(px + 6, py);
    ctx.lineTo(px + 8, py);
    ctx.moveTo(px, py - 8);
    ctx.lineTo(px, py - 6);
    ctx.moveTo(px, py + 6);
    ctx.lineTo(px, py + 8);
    ctx.stroke();
  }

  // The player's arrow, always up, with a soft wedge showing where they are looking.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, 48, -Math.PI * 0.34, -Math.PI * 0.66);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = BONE;
  ctx.strokeStyle = PINK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(6.5, 7);
  ctx.lineTo(0, 3.5);
  ctx.lineTo(-6.5, 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.restore();

  // The bezel edge, the compass points, and the district's name under the map.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(34,230,208,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // The compass letters turn with the map, so "N" always points at the world's north.
  const compass = ['N', 'E', 'S', 'W'];
  ctx.font = `bold 10px ${MONO}`;
  ctx.textAlign = 'center';
  for (let i = 0; i < 4; i += 1) {
    const bearing = [0, Math.PI / 2, Math.PI, -Math.PI / 2][i] - Math.PI / 2 + (yaw - Math.PI / 2);
    ctx.fillStyle = i === 0 ? GOLD : 'rgba(255,246,234,0.62)';
    ctx.fillText(compass[i], cx + Math.cos(bearing) * (r - 11), cy + Math.sin(bearing) * (r - 11) + 3);
  }
  ctx.textAlign = 'left';
  ctx.font = `bold 10px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.78)';
  ctx.fillText(districtOf(p.x, p.z).toUpperCase(), x + 2, y + MAP + 20);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(34,230,208,0.8)';
  ctx.fillText(sim.player.driving ? 'DRIVING' : 'ON FOOT', x + MAP - 2, y + MAP + 20);
  ctx.textAlign = 'left';
  ctx.restore();
}

// ---------------------------------------------------------------- left column

/** RESPECT: the number the city keeps of the player, with the rank it has bought. */
function respectPanel(ctx, sim, x, y) {
  const W = 196;
  const H = 58;
  panel(ctx, x, y, W, H, VIOLET);
  ctx.save();
  ctx.textAlign = 'left';
  ctx.font = `bold 9px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.55)';
  ctx.fillText('RESPECT', x + 14, y + 17);
  ctx.font = `bold 26px ${MONO}`;
  ctx.fillStyle = '#c9b4ff';
  ctx.fillText(String(Math.round(sim.story.respect)), x + 13, y + 45);
  ctx.textAlign = 'right';
  ctx.font = `bold 10px ${MONO}`;
  ctx.fillStyle = VIOLET;
  ctx.fillText(rankOf(sim.story.respect), x + W - 12, y + 28);
  ctx.font = `9px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.45)';
  ctx.fillText(`${sim.story.done}/${MISSIONS.length} MISSIONS`, x + W - 12, y + 44);
  ctx.restore();
}

/**
 * The objective: which mission of ten, its name, its line, and how far away the marker is with the
 * one condition that is live right now. This is the panel a player reads first, so it gets the
 * most width and the brightest type in the left column.
 */
function objectivePanel(ctx, sim, x, y) {
  const m = currentMission(sim.story);
  const W = 348;
  const H = 94;
  panel(ctx, x, y, W, H, m ? GOLD : CYAN);
  ctx.save();
  ctx.textAlign = 'left';
  if (!m) {
    ctx.font = `bold 12px ${MONO}`;
    ctx.fillStyle = CYAN;
    ctx.fillText(`10/10 CLOSED`, x + 14, y + 22);
    ctx.font = `bold 14px ${MONO}`;
    ctx.fillStyle = BONE;
    ctx.fillText('THE LONG SHADOW IS DONE', x + 14, y + 48);
    ctx.font = `11px ${MONO}`;
    ctx.fillStyle = 'rgba(255,246,234,0.6)';
    ctx.fillText(`RESPECT ${Math.round(sim.story.respect)}  ·  ${money(sim.story.cash)}`, x + 14, y + 70);
    ctx.restore();
    return;
  }

  const d = Math.hypot(m.at.x - sim.player.x, m.at.z - sim.player.z);
  ctx.font = `bold 11px ${MONO}`;
  ctx.fillStyle = GOLD;
  ctx.fillText(`${sim.story.index + 1}/${MISSIONS.length}  ${m.title.toUpperCase()}`, x + 14, y + 20);

  ctx.textAlign = 'right';
  ctx.font = `bold 15px ${MONO}`;
  ctx.fillStyle = BONE;
  ctx.fillText(metres(d), x + W - 13, y + 20);

  ctx.textAlign = 'left';
  ctx.font = `11px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.9)';
  wrapText(ctx, m.line, x + 14, y + 41, W - 28, 14, 2);

  ctx.font = `bold 10px ${MONO}`;
  ctx.fillStyle = sim.police.stars > 0 && m.beat === 'escape' ? '#ff6a80' : CYAN;
  ctx.fillText(liveCondition(m, sim.player, { crewDown: sim.crewDown, stars: sim.police.stars }), x + 14, y + H - 12);
  ctx.textAlign = 'right';
  ctx.font = `9px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.5)';
  ctx.fillText(`$${m.reward} ON DELIVERY`, x + W - 13, y + H - 12);
  ctx.restore();
}

/**
 * The dispatch list: the police radio, printed. At most five lines, nearest unit first, the
 * helicopter always last because "AIR 1" is the line a player scans for. A line is a unit number, a
 * distance in metres and the tactic it is working — nothing else, so five lines never crowd the
 * frame.
 */
function dispatchPanel(ctx, sim, x, y) {
  const lines = sim.dispatch ?? [];
  const W = 300;
  const rows = Math.max(1, Math.min(5, lines.length));
  const H = 26 + rows * 17 + (lines.length > 5 ? 14 : 0);
  const live = sim.police.stars > 0;

  panel(ctx, x, y, W, H, live ? '#ff3355' : 'rgba(255,246,234,0.2)');
  ctx.save();
  ctx.textAlign = 'left';
  ctx.font = `bold 9px ${MONO}`;
  ctx.fillStyle = live ? '#ff7d92' : 'rgba(255,246,234,0.45)';
  ctx.fillText(live ? 'VMPD DISPATCH  ·  LIVE' : 'VMPD DISPATCH  ·  QUIET', x + 13, y + 16);

  if (live) {
    // A tiny transmitting pulse: the list is a radio, not a table.
    const pulse = (Math.sin(sim.time * 6) + 1) / 2;
    ctx.fillStyle = `rgba(255,60,90,${0.35 + pulse * 0.6})`;
    ctx.beginPath();
    ctx.arc(x + W - 16, y + 12, 3.4, 0, Math.PI * 2);
    ctx.fill();
  }

  lines.slice(0, 5).forEach((line, i) => {
    const ly = y + 30 + i * 17;
    ctx.font = `bold 11px ${MONO}`;
    ctx.fillStyle = line.air ? '#fff0c0' : BONE;
    ctx.fillText(line.label, x + 13, ly);
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = 'rgba(255,246,234,0.62)';
    ctx.fillText(`· ${line.dist}M ·`, x + 82, ly);
    ctx.font = `bold 10px ${MONO}`;
    ctx.fillStyle = line.tactic === 'SEARCHLIGHT' ? '#fff0c0' : line.tactic === 'RAMMING' ? '#ff6a80' : line.tactic === 'ROADBLOCK' ? GOLD : CYAN;
    ctx.fillText(line.tactic, x + 152, ly);
    // A small bar showing how close the unit is, out of the list's right edge.
    const g = Math.max(0, 1 - line.dist / 900);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x + W - 76, ly - 5, 62, 4);
    ctx.fillStyle = line.air ? '#fff0c0' : '#ff5a72';
    ctx.fillRect(x + W - 76, ly - 5, 62 * g, 4);
  });

  if (lines.length === 0) {
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = 'rgba(255,246,234,0.4)';
    ctx.fillText('NO UNITS IN THE DISTRICT', x + 13, y + 32);
  }
  if (lines.length > 5) {
    ctx.font = `9px ${MONO}`;
    ctx.fillStyle = 'rgba(255,246,234,0.45)';
    ctx.fillText(`+${lines.length - 5} MORE UNITS`, x + 13, y + H - 6);
  }
  ctx.restore();
}

/** Health, armour and ammunition, in one panel at the bottom of the left column. */
function vitalsPanel(ctx, sim, x, y) {
  const p = sim.player;
  const W = 300;
  const H = 70;
  panel(ctx, x, y, W, H, '#ff3d5a');

  ctx.save();
  ctx.font = `bold 9px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.55)';
  ctx.textAlign = 'left';
  ctx.fillText('HEALTH', x + 13, y + 15);

  // The bar: 210 px, with a tick every quarter.
  const bx = x + 13;
  const by = y + 21;
  const bw = 168;
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  rounded(ctx, bx, by, bw, 12, 2);
  ctx.fill();
  const frac = Math.max(0, Math.min(1, p.hp / p.hpMax));
  const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  grad.addColorStop(0, '#ff3d5a');
  grad.addColorStop(0.55, '#ff8a4a');
  grad.addColorStop(1, '#ffd23c');
  ctx.fillStyle = frac < 0.25 && Math.sin(sim.time * 10) > 0 ? '#ff8a9a' : grad;
  ctx.fillRect(bx + 1, by + 1, (bw - 2) * frac, 10);
  if (p.armour > 0) {
    ctx.fillStyle = 'rgba(120,210,255,0.92)';
    ctx.fillRect(bx + 1, by + 1, (bw - 2) * Math.min(1, p.armour / 60), 3);
  }
  ctx.strokeStyle = 'rgba(255,246,234,0.35)';
  ctx.lineWidth = 1;
  rounded(ctx, bx + 0.5, by + 0.5, bw - 1, 11, 2);
  ctx.stroke();

  ctx.font = `bold 13px ${MONO}`;
  ctx.fillStyle = BONE;
  ctx.fillText(String(Math.round(p.hp)), bx + bw + 10, by + 11);
  ctx.font = `9px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.5)';
  ctx.fillText(`/${p.hpMax}`, bx + bw + 10, by + 20);
  ctx.fillText(p.driving ? 'DRIVING' : p.running ? 'RUNNING' : 'ON FOOT', bx, y + H - 8);

  // Ammunition, right-aligned in the same panel: the magazine, then the pouch.
  ctx.textAlign = 'right';
  ctx.font = `bold 24px ${MONO}`;
  ctx.fillStyle = p.clip > 0 ? BONE : '#ff5a72';
  ctx.fillText(String(p.clip).padStart(2, '0'), x + W - 13, y + 42);
  ctx.font = `bold 10px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.55)';
  ctx.fillText(`/ ${p.ammo}`, x + W - 13, y + 55);
  ctx.font = `9px ${MONO}`;
  ctx.fillStyle = p.reload > 0 ? GOLD : 'rgba(255,246,234,0.42)';
  ctx.fillText(p.reload > 0 ? 'RELOADING…' : '9MM · R', x + W - 13, y + 15);

  // The pistol glyph, so the numbers have something to belong to.
  ctx.save();
  ctx.translate(x + W - 116, y + 30);
  ctx.fillStyle = p.clip > 0 ? 'rgba(255,246,234,0.8)' : 'rgba(255,90,114,0.8)';
  ctx.fillRect(0, 0, 26, 7);
  ctx.fillRect(19, 0, 7, 5);
  ctx.save();
  ctx.translate(3, 7);
  ctx.rotate(0.22);
  ctx.fillRect(0, 0, 8, 13);
  ctx.restore();
  ctx.restore();
  ctx.restore();
}

// ---------------------------------------------------------------- right column

/** "DAY 1 · 18:52" and the district's own name above the stars. */
function clockBlock(ctx, sim, right, y) {
  ctx.save();
  ctx.textAlign = 'right';
  ctx.font = `bold 15px ${MONO}`;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText(clockText(sim.story), right + 1, y + 15);
  ctx.fillStyle = BONE;
  ctx.fillText(clockText(sim.story), right, y + 14);
  ctx.font = `9px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.55)';
  ctx.fillText('VICE MERIDIAN · CORAL STRAND', right, y + 28);
  ctx.restore();
}

function starShape(ctx, cx, cy, r, push) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r * push : r * 0.45;
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function wantedStars(ctx, sim, right, y) {
  const lit = sim.police.stars;
  const size = 25;
  const gap = 4;
  const total = size * LAW.stars + gap * (LAW.stars - 1);
  let x = right - total;
  ctx.save();
  for (let i = 0; i < LAW.stars; i += 1) {
    const push = i < lit ? 1 + Math.sin(sim.time * 3 + x) * 0.04 : 1;
    starShape(ctx, x + size / 2, y + size / 2, size / 2, push);
    if (i < lit) {
      ctx.fillStyle = GOLD;
      ctx.shadowColor = '#ff7a2f';
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = 'rgba(14,10,24,0.6)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,246,234,0.32)';
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }
    x += size + gap;
  }
  ctx.textAlign = 'right';
  ctx.font = `bold 10px ${MONO}`;
  const label = lit === 0 ? 'CLEAN' : sim.police.air ? 'AIRBORNE · SEARCHLIGHT' : sim.police.seen ? 'IN SIGHT' : 'SEARCHING';
  ctx.fillStyle = lit === 0 ? 'rgba(255,246,234,0.5)' : sim.police.air ? '#fff0c0' : sim.police.seen ? '#ff6a80' : 'rgba(255,210,60,0.9)';
  ctx.fillText(label, right, y + size + 15);

  if (lit > 0 && !sim.police.seen) {
    const frac = Math.min(1, sim.police.quiet / LAW.blindAfter);
    ctx.fillStyle = 'rgba(255,210,60,0.2)';
    ctx.fillRect(right - 108, y + size + 20, 108, 3);
    ctx.fillStyle = GOLD;
    ctx.fillRect(right - 108, y + size + 20, 108 * frac, 3);
  }
  ctx.restore();
}

function wallet(ctx, sim, right, y) {
  ctx.save();
  ctx.textAlign = 'right';
  const text = money(sim.story.cash);
  ctx.font = `bold 30px ${MONO}`;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText(text, right + 2, y + 2);
  ctx.fillStyle = '#8dffcf';
  ctx.fillText(text, right, y);
  ctx.font = `9px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.55)';
  ctx.fillText(`SPENT ${money(sim.story.spent)}  ·  ${sim.story.kills} DOWN`, right, y + 14);
  ctx.restore();
}

/**
 * The speedometer. Driving, it is the biggest number on the screen after the wallet: KM/H, the
 * model name under it, and the condition as both a percentage and a bar, because a car at 40 per
 * cent should look like it.
 */
function speedPanel(ctx, sim, x, y) {
  const car = sim.player.driving;
  const W = 336;
  const H = 74;
  panel(ctx, x, y, W, H, car ? CYAN : 'rgba(255,246,234,0.15)');
  ctx.save();
  if (!car) {
    ctx.font = `bold 12px ${MONO}`;
    ctx.fillStyle = 'rgba(255,246,234,0.82)';
    ctx.fillText('ON FOOT', x + 14, y + 30);
    ctx.font = `bold 10px ${MONO}`;
    ctx.fillStyle = 'rgba(255,246,234,0.62)';
    ctx.fillText('E · TAKE THE NEAREST CAR', x + 14, y + 48);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x + 14, y + H - 12, 168, 4);
    ctx.restore();
    return;
  }
  const kmh = Math.round(Math.abs(car.speed) * 3.6);
  ctx.textAlign = 'left';
  ctx.font = `bold 40px ${MONO}`;
  ctx.fillStyle = BONE;
  ctx.fillText(String(kmh).padStart(3, ' '), x + 12, y + 47);
  const nw = ctx.measureText(String(kmh).padStart(3, ' ')).width;
  ctx.font = `bold 11px ${MONO}`;
  ctx.fillStyle = CYAN;
  ctx.fillText('KM/H', x + 16 + nw, y + 30);
  ctx.font = `bold 12px ${MONO}`;
  ctx.fillStyle = BONE;
  ctx.fillText(car.shape.model ?? 'MARLIN 4', x + 16 + nw, y + 47);

  // Condition: a percentage and a bar, red under a third, amber under two thirds.
  const cond = Math.max(0, Math.min(1, car.condition));
  const pct = Math.round(cond * 100);
  const col = cond < 0.34 ? '#ff5a72' : cond < 0.67 ? GOLD : '#8dffcf';
  ctx.textAlign = 'right';
  ctx.font = `bold 15px ${MONO}`;
  ctx.fillStyle = col;
  ctx.fillText(`${pct}%`, x + W - 13, y + 34);
  ctx.font = `9px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.5)';
  ctx.fillText('CONDITION', x + W - 13, y + 48);
  const bx = x + 190;
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  ctx.fillRect(bx, y + 52, W - 206, 5);
  ctx.fillStyle = col;
  ctx.fillRect(bx, y + 52, (W - 206) * cond, 5);

  // A speed bar under the number, so the panel reads as a dial at a glance.
  const sf = Math.min(1, Math.abs(car.speed) / 40);
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(x + 14, y + H - 12, 168, 4);
  ctx.fillStyle = sf > 0.82 ? '#ff5a72' : CYAN;
  ctx.fillRect(x + 14, y + H - 12, 168 * sf, 4);
  ctx.restore();
}

/**
 * The radio: station name and frequency, the band under it, and the track playing. It is always on
 * while driving; on foot the panel greys out and says so, which is more honest than hiding it.
 */
function radioPanel(ctx, sim, x, y) {
  const s = stationNow(sim.radio);
  const W = 336;
  const H = 70;
  const driving = !!sim.player.driving;
  panel(ctx, x, y, W, H, driving ? s.colour : 'rgba(255,246,234,0.15)');
  ctx.save();
  ctx.textAlign = 'left';
  ctx.font = `bold 13px ${MONO}`;
  ctx.fillStyle = driving ? s.colour : 'rgba(255,246,234,0.72)';
  ctx.fillText(s.name, x + 13, y + 20);
  ctx.font = `bold 9px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.62)';
  ctx.fillText(s.band, x + 13, y + 32);

  // Signal bars: three little rising blocks, brighter while the radio has a carrier.
  for (let i = 0; i < 4; i += 1) {
    const bh = 3 + i * 3;
    ctx.fillStyle = driving ? s.colour : 'rgba(255,246,234,0.18)';
    ctx.globalAlpha = 0.4 + i * 0.18;
    ctx.fillRect(x + W - 34 + i * 6, y + 22 - bh, 4, bh);
  }
  ctx.globalAlpha = 1;

  ctx.font = `bold 12px ${MONO}`;
  ctx.fillStyle = driving ? BONE : 'rgba(255,246,234,0.66)';
  ctx.fillText(sim.radio.on ? `\u266a ${trackTitle(sim.radio)}` : 'RADIO OFF', x + 13, y + 52);
  ctx.font = `9px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,246,234,0.6)';
  ctx.fillText(driving ? 'TAB · STATION' : 'PLAYS IN A CAR', x + W - 13, y + 62);
  ctx.textAlign = 'left';

  // The DJ's line, when one is talking, as one small italic-ish line under the track.
  if (sim.radio.djT > 0 && sim.radio.dj) {
    ctx.globalAlpha = Math.min(1, sim.radio.djT);
    ctx.font = `9px ${SANS}`;
    ctx.fillStyle = s.colour;
    const cut = sim.radio.dj.length > 62 ? `${sim.radio.dj.slice(0, 60)}…` : sim.radio.dj;
    ctx.fillText(`ON AIR — ${cut}`, x + 13, y + 66);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the world layer

/** The mission ring on the street, its floating diamond and its name, projected into the frame. */
function streetMarkers(ctx, sim, w, h) {
  if (!sim.project) return;
  const t = sim.time;

  const m = currentMission(sim.story);
  if (m) {
    const at = sim.project(m.at.x, 0.5, m.at.z);
    if (at && at.depth < 1 && at.x > -80 && at.x < w + 80 && at.y > -80 && at.y < h + 80) {
      const pulse = 1 + Math.sin(t * 3) * 0.06;
      ctx.save();
      const bloom = ctx.createRadialGradient(at.x, at.y, 4, at.x, at.y, 54 * pulse);
      bloom.addColorStop(0, 'rgba(255,210,60,0.5)');
      bloom.addColorStop(0.6, 'rgba(255,150,40,0.16)');
      bloom.addColorStop(1, 'rgba(255,150,40,0)');
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.ellipse(at.x, at.y, 54 * pulse, 54 * pulse * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,210,60,0.92)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(at.x, at.y, 30 * pulse, 30 * pulse * 0.42, 0, 0, Math.PI * 2);
      ctx.stroke();

      const fy = at.y - 62 - Math.sin(t * 2.2) * 3;
      ctx.save();
      ctx.translate(at.x, fy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = GOLD;
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 14;
      ctx.fillRect(-7, -7, 14, 14);
      ctx.restore();
      ctx.font = `bold 11px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,246,234,0.95)';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 6;
      const d = Math.round(Math.hypot(m.at.x - sim.player.x, m.at.z - sim.player.z));
      ctx.fillText(`${m.title.toUpperCase()}  ·  ${d} M`, at.x, fy - 18);
      ctx.restore();
    }
  }

  // The shops: a low ring of their own colour on the pavement, so the shops are places you can find
  // by looking down the street rather than only by reading the map.
  for (const shop of sim.plan.shops) {
    const at = sim.project(shop.at.x, 0.4, shop.at.z);
    if (!at || at.depth > 1 || at.x < -40 || at.x > w + 40 || at.y < -40 || at.y > h + 40) continue;
    const d = Math.hypot(shop.at.x - sim.player.x, shop.at.z - sim.player.z);
    if (d > 70) continue;
    const near = d < shop.radius + 2.5;
    const pulse = 1 + Math.sin(t * 4 + shop.z) * 0.1;
    ctx.save();
    ctx.strokeStyle = near ? shop.accent : `${shop.accent}99`;
    ctx.lineWidth = near ? 3 : 1.8;
    ctx.beginPath();
    ctx.ellipse(at.x, at.y, 26 * pulse, 26 * pulse * 0.4, 0, 0, Math.PI * 2);
    ctx.stroke();
    if (near) {
      ctx.font = `bold 11px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = shop.accent;
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 6;
      ctx.fillText(shop.name, at.x, at.y - 30);
    }
    ctx.restore();
  }
}

function vignette(ctx, sim, w, h) {
  const hurt = Math.max(sim.player.hurt * 0.55, sim.flash * 0.5);
  if (hurt > 0.02) {
    const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.78);
    g.addColorStop(0, 'rgba(255,20,60,0)');
    g.addColorStop(1, `rgba(255,16,56,${Math.min(0.75, hurt).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  const v = ctx.createRadialGradient(w / 2, h / 2, h * 0.58, w / 2, h / 2, h * 1.06);
  v.addColorStop(0, 'rgba(10,6,20,0)');
  v.addColorStop(1, 'rgba(10,6,20,0.5)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

function crosshair(ctx, sim, w, h) {
  const ptr = sim.pointer;
  const x = ptr ? ptr.x : w / 2;
  const y = ptr ? ptr.y : h / 2;
  const spread = 8 + sim.player.recoil * 7;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,246,234,0.9)';
  ctx.lineWidth = 1.8;
  for (let i = 0; i < 4; i += 1) {
    const a = (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * spread, y + Math.sin(a) * spread);
    ctx.lineTo(x + Math.cos(a) * (spread + 7), y + Math.sin(a) * (spread + 7));
    ctx.stroke();
  }
  ctx.fillStyle = PINK;
  ctx.beginPath();
  ctx.arc(x, y, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** The shop or car prompt, just above the subtitle box and never on top of it. */
function prompt(ctx, sim, w, h) {
  if (!sim.prompt) return;
  const shop = !!sim.shop;
  ctx.save();
  ctx.font = `bold 13px ${MONO}`;
  const tw = ctx.measureText(sim.prompt).width;
  const x = w / 2 - tw / 2 - 18;
  const y = h - 148;
  ctx.fillStyle = 'rgba(12,10,22,0.86)';
  rounded(ctx, x, y, tw + 36, 32, 4);
  ctx.fill();
  ctx.strokeStyle = shop ? GOLD : 'rgba(34,230,208,0.7)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = shop ? GOLD : BONE;
  ctx.textAlign = 'center';
  ctx.fillText(sim.prompt, w / 2, y + 21);
  ctx.restore();
}

/**
 * The subtitle box: the speaker's tag in caps, then their line, at the bottom of the frame between
 * the vitals panel and the speedometer. It holds one line at a time and fades on its own clock.
 */
function subtitle(ctx, sim, w, h) {
  const sub = sim.story.sub;
  if (!sub) return;
  const fade = Math.min(1, sub.t * 6, (sub.life - sub.t) * 1.6);
  if (fade <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, fade);
  ctx.font = `bold 14px ${SANS}`;
  const maxW = 620;
  const tw = Math.min(maxW, ctx.measureText(sub.line).width);
  const boxW = tw + 44;
  const x = w / 2 - boxW / 2;
  const y = h - 104;
  ctx.fillStyle = 'rgba(6,5,12,0.84)';
  rounded(ctx, x, y, boxW, 44, 3);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,210,60,0.9)';
  ctx.fillRect(x, y, boxW, 2);

  // The tag first, in gold, then the line in bone — one text run, so the eye reads it as speech.
  ctx.textAlign = 'left';
  ctx.font = `bold 12px ${MONO}`;
  ctx.fillStyle = GOLD;
  const tagX = x + 20;
  ctx.fillText(`${sub.tag}:`, tagX, y + 20);
  const tagW = ctx.measureText(`${sub.tag}:`).width;
  ctx.font = `14px ${SANS}`;
  ctx.fillStyle = BONE;
  ctx.fillText(sub.line, tagX + tagW + 8, y + 20);
  ctx.restore();
}

function toast(ctx, sim, w, h) {
  const s = sim.story;
  if (s.toastT <= 0 || !s.toast) return;
  if (sim.mode !== 'play') return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, s.toastT);
  ctx.font = `bold 15px ${SANS}`;
  const tw = ctx.measureText(s.toast).width;
  const x = w / 2 - tw / 2 - 22;
  const y = 132;
  ctx.fillStyle = 'rgba(12,10,22,0.82)';
  rounded(ctx, x, y, tw + 44, 40, 4);
  ctx.fill();
  ctx.fillStyle = /FAILED|WASTED|BUSTED/.test(s.toast) ? '#ff4d6d' : CYAN;
  ctx.fillRect(x, y, 4, 40);
  ctx.fillStyle = BONE;
  ctx.textAlign = 'center';
  ctx.fillText(s.toast, w / 2, y + 26);
  ctx.restore();
}

/** Cash rising off the street where it was earned. */
function floaters(ctx, sim) {
  if (!sim.floaters.length || !sim.project) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `bold 18px ${MONO}`;
  for (const f of sim.floaters) {
    const at = sim.project(f.x, f.y, f.z);
    if (!at || at.depth > 1) continue;
    ctx.globalAlpha = Math.min(1, f.life);
    ctx.fillStyle = f.colour;
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 8;
    ctx.fillText(f.text, at.x, at.y);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the cards

function endCard(ctx, sim, w, h, mode) {
  const busted = mode === 'busted';
  const grad = ctx.createLinearGradient(0, h * 0.22, 0, h * 0.62);
  grad.addColorStop(0, 'rgba(8,5,16,0)');
  grad.addColorStop(0.18, 'rgba(8,5,16,0.86)');
  grad.addColorStop(0.82, 'rgba(8,5,16,0.86)');
  grad.addColorStop(1, 'rgba(8,5,16,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, h * 0.22, w, h * 0.4);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.letterSpacing = '8px';
  ctx.font = `bold 84px ${SANS}`;
  const colour = busted ? '#7fc8ff' : '#ff3d5a';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillText(busted ? 'BUSTED' : 'WASTED', w / 2 + 4, h * 0.42 + 5);
  ctx.fillStyle = colour;
  ctx.shadowColor = colour;
  ctx.shadowBlur = 24;
  ctx.fillText(busted ? 'BUSTED' : 'WASTED', w / 2, h * 0.42);
  ctx.shadowBlur = 0;
  ctx.letterSpacing = '0px';
  ctx.font = `13px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.84)';
  ctx.fillText(busted ? 'The VMPD put the cuffs on. The Meridian keeps the rest.' : 'The sun went down on you on the Strand.', w / 2, h * 0.42 + 34);
  ctx.font = `bold 14px ${MONO}`;
  ctx.fillStyle = GOLD;
  ctx.globalAlpha = 0.55 + Math.sin(sim.time * 4) * 0.45;
  ctx.fillText('PRESS  R  TO  GET  BACK  OUT', w / 2, h * 0.42 + 76);
  ctx.globalAlpha = 1;
  ctx.font = `11px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.6)';
  ctx.fillText(`MISSIONS PASSED ${sim.story.done}/${MISSIONS.length}   ·   RESPECT ${Math.round(sim.story.respect)}`, w / 2, h * 0.42 + 102);
  ctx.restore();
}

function pauseCard(ctx, sim, w, h) {
  ctx.fillStyle = 'rgba(8,5,16,0.58)';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.letterSpacing = '6px';
  ctx.font = `bold 42px ${SANS}`;
  ctx.fillStyle = BONE;
  ctx.fillText('PAUSED', w / 2, h / 2);
  ctx.letterSpacing = '0px';
  ctx.font = `12px ${MONO}`;
  ctx.fillStyle = 'rgba(255,246,234,0.7)';
  ctx.fillText('ESC to get back on the street   ·   M for sound   ·   TAB for the radio', w / 2, h / 2 + 30);
  ctx.restore();
}

export { MAP, MAP_SPAN };
