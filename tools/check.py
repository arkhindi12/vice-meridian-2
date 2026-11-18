# check.py - assert the systems a shot is required to show are actually on screen, and fail loudly.
#
# Each rule is a measurement on the composited frame (3D canvas + HUD canvas), not an assumption:
#
#   air          the aircraft projects on screen, its silhouette has dark pixels (a dark body) and
#                its rotor region has hot pixels (a spinning blur)
#   light        the beam midpoint is brighter than the same point 150 px aside, and the pool is
#                brighter than the road 130 px away
#   cruisers     at least two cruisers project on screen with red and blue beacon pixels near them
#   stars        the star row has plenty of gold and the state says four
#   panels       each HUD rectangle has ink in it (text was painted)
#   texts        the objective, dispatch, subtitle, radio and speedometer state are non-empty
#
# usage: python3 tools/check.py <shot> [--strict]
import asyncio
import json
import sys

from playwright.async_api import async_playwright

SHOT = sys.argv[1]
STRICT = '--strict' in sys.argv

JS = """() => {
  const g = window.__game;
  const sim = g.sim;
  const cam = g.world.camera;
  const W = 1280, H = 720;
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const c = off.getContext('2d', { willReadFrequently: true });
  c.drawImage(document.getElementById('scene'), 0, 0);
  c.drawImage(document.getElementById('overlay'), 0, 0);
  const data = c.getImageData(0, 0, W, H).data;
  const L = (i) => data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  const project = (x, y, z) => {
    const v = new g.THREE.Vector3(x, y, z).project(cam);
    return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, on: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1 };
  };
  const box = (cx, cy, r) => {
    let sum = 0, n = 0, hot = 0, dark = 0, max = 0;
    for (let y = Math.max(0, cy - r); y < Math.min(H, cy + r); y += 1) {
      for (let x = Math.max(0, cx - r); x < Math.min(W, cx + r); x += 1) {
        const l = L((y * W + x) * 4);
        sum += l; n += 1; if (l > 215) hot += 1; if (l < 78) dark += 1; if (l > max) max = l;
      }
    }
    return { mean: +(sum / n).toFixed(1), hot, dark, max: Math.round(max) };
  };
  const hue = (cx, cy, r, want) => {
    let n = 0;
    for (let y = Math.max(0, cy - r); y < Math.min(H, cy + r); y += 1) {
      for (let x = Math.max(0, cx - r); x < Math.min(W, cx + r); x += 1) {
        const i = (y * W + x) * 4;
        const R = data[i], G = data[i + 1], B = data[i + 2];
        if (want === 'red' && R > 160 && G < 100 && B < 120 && R - G > 75) n += 1;
        if (want === 'blue' && B > 140 && R < 130 && B - R > 50) n += 1;
        if (want === 'gold' && R > 200 && G > 148 && B < 150 && R - B > 60) n += 1;
      }
    }
    return n;
  };
  const ink = (x0, y0, x1, y1) => {
    let lit = 0, total = 0;
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y += 1) {
      for (let x = Math.max(0, x0); x < Math.min(W, x1); x += 1) {
        if (L((y * W + x) * 4) > 145) lit += 1;
        total += 1;
      }
    }
    return +(100 * lit / total).toFixed(1);
  };

  const out = { shot: SHOT_NAME, facts: {}, checks: [] };
  const check = (name, ok, detail) => out.checks.push({ name, ok, detail });

  out.facts = {
    stars: sim.police.stars,
    units: sim.police.units.length,
    dispatchLines: (sim.dispatch || []).length,
    air: !!sim.police.air,
    driving: !!sim.player.driving,
    model: sim.player.driving ? sim.player.driving.shape.model : null,
    condition: sim.player.driving ? +sim.player.driving.condition.toFixed(2) : null,
    mission: g.missionText().title,
    sub: sim.story.sub ? sim.story.sub.tag : null,
    prompt: sim.prompt,
    radio: g.radio().station + ' / ' + g.radio().track,
    crowd: sim.crowd.length,
    traffic: sim.traffic.length,
    respect: Math.round(sim.story.respect),
  };

  // --- the aircraft
  if (sim.police.air) {
    const a = sim.police.air;
    const at = project(a.x, a.alt, a.z);
    const near = box(Math.round(at.x), Math.round(at.y), 40);
    const rotor = box(Math.round(at.x), Math.round(at.y) + 8, 52);
    // The fuselage alone: a tight patch on the hull, below the rotor plane, which is where the dark
    // body has to read. The rotor above it is bright on purpose (a swept disc at shutter speed).
    const hull = box(Math.round(at.x) - 12, Math.round(at.y) - 4, 11);
    const skyBeside = box(Math.round(at.x) + 96, Math.round(at.y) - 44, 24);
    const skyAbove = box(Math.round(at.x), Math.round(at.y) - 96, 22);
    check('air.onScreen', at.on, [Math.round(at.x), Math.round(at.y)]);
    check('air.darkBody', near.dark > 120, near);
    check('air.rotorBlur', rotor.hot > 60 || rotor.max > 230, rotor);
    check('air.darkHullOnSky', hull.mean < 96 && (skyBeside.mean > hull.mean + 20 || skyAbove.mean > hull.mean + 20), { hull: hull.mean, skyBeside: skyBeside.mean, skyAbove: skyAbove.mean });

    const lamp = project(a.x, a.alt - 1.35, a.z);
    const pool = project(a.light.x, 0.4, a.light.z);
    const mx = (lamp.x + pool.x) / 2, my = (lamp.y + pool.y) / 2;
    const beam = box(Math.round(mx), Math.round(my), 12);
    const ctrl = box(Math.round(mx) - 150, Math.round(my), 12);
    check('light.beamVisible', beam.mean > ctrl.mean + 14, { beam: beam.mean, control: ctrl.mean });
    const p = box(Math.round(pool.x), Math.round(pool.y), 26);
    const beside = box(Math.round(pool.x) + 120, Math.round(pool.y) + 12, 26);
    check('light.poolOnRoad', p.mean > beside.mean + 8, { pool: p.mean, road: beside.mean, poolHot: p.hot });
  } else if (out.facts.stars >= 4) {
    check('air.present', false, 'four stars but no aircraft');
  }

  // --- the cruisers
  const cruisers = sim.police.units.map((u) => {
    const at = project(u.x, 1.1, u.z);
    return {
      number: u.number,
      on: at.on,
      screen: [Math.round(at.x), Math.round(at.y)],
      red: hue(Math.round(at.x), Math.round(at.y) - 18, 34, 'red'),
      blue: hue(Math.round(at.x), Math.round(at.y) - 18, 34, 'blue'),
    };
  });
  out.facts.cruisers = cruisers;
  const shown = cruisers.filter((u) => u.on && (u.red > 8 || u.blue > 8));
  check('cruisers.lit', shown.length >= (out.facts.stars >= 4 ? 2 : 0), shown.map((u) => u.number));

  // --- the stars
  const goldRow = hue(1172, 72, 96, 'gold');
  check('hud.stars', out.facts.stars === 0 ? true : goldRow > 250, { goldPixels: goldRow, stars: out.facts.stars });

  // --- panels painted
  const panels = {
    minimap: [24, 24, 216, 216],
    respect: [26, 244, 214, 294],
    objective: [26, 322, 368, 410],
    dispatch: [26, 428, 320, 508],
    vitals: [26, 638, 320, 702],
    clock: [1004, 18, 1254, 52],
    wallet: [1040, 96, 1254, 124],
    radio: [946, 552, 1252, 616],
    speed: [946, 636, 1252, 702],
  };
  const inked = {};
  for (const k of Object.keys(panels)) {
    const b = panels[k];
    inked[k] = ink(b[0], b[1], b[2], b[3]);
  }
  out.facts.ink = inked;
  for (const k of Object.keys(panels)) check('panel.' + k, inked[k] > 1.0, inked[k] + '% ink');
  check('panel.subtitle', ink(300, 610, 980, 652) > 1.0, ink(300, 610, 980, 652) + '% ink');

  // --- texts
  check('text.objective', !!out.facts.mission && g.missionText().line.length > 0, out.facts.mission);
  check('text.subtitle', !!sim.story.sub && sim.story.sub.line.length > 12, out.facts.sub);
  check('text.radio', !!g.radio().station && !!g.radio().track, out.facts.radio);
  if (sim.police.stars > 0) {
    check('text.dispatch', (sim.dispatch || []).length >= 2, out.facts.dispatchLines);
    check('text.dispatchTactics', (sim.dispatch || []).every((d) => /PURSUIT|RAMMING|ROADBLOCK|SEARCHLIGHT/.test(d.tactic)), (sim.dispatch || []).map((d) => d.tactic));
  }
  if (sim.player.driving) {
    check('text.speedometer', sim.player.driving.condition > 0 && !!out.facts.model, out.facts.model + ' ' + out.facts.condition);
  }
  return out;
}"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        page = await b.new_page(viewport={'width': 1280, 'height': 720})
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://127.0.0.1:8123/?shot=%s&seed=1' % SHOT, wait_until='load')
        await page.wait_for_function('window.__shotReady === true', timeout=60000)
        await page.wait_for_timeout(250)
        out = await page.evaluate('(n) => { const SHOT_NAME = n; return (' + JS.replace('() => {', '() => {', 1) + ')(); }', SHOT)
        await b.close()

    fails = [c for c in out['checks'] if not c['ok']]
    print('== %s ==' % SHOT)
    for c in out['checks']:
        print('  %-26s %s  %s' % (c['name'], 'PASS' if c['ok'] else 'FAIL', json.dumps(c['detail'])))
    print('  facts:', json.dumps({k: v for k, v in out['facts'].items() if k != 'cruisers'}, sort_keys=True))
    if out['facts'].get('cruisers'):
        print('  cruisers:', [(u['number'], u['screen'], u['on'], u['red'], u['blue']) for u in out['facts']['cruisers']])
    if errs:
        print('  PAGE ERRORS', errs)
    print('  %d/%d checks passed' % (len(out['checks']) - len(fails), len(out['checks'])))
    if fails or errs:
        if STRICT:
            sys.exit(1)


asyncio.run(main())
