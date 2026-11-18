# verify.py - prove what is actually on screen by occlusion: render the staged frame, hide one
# subject, render again *without re-posing*, and diff. The changed pixels are that subject's
# footprint.
#
# This is the strongest check available without eyes: it does not trust the projection maths, the
# brightness of a patch, or a list of entities. If the helicopter's pixels change when the
# helicopter is hidden, the helicopter is in the picture, and the diff's bounding box says where.
#
# The one trap is that the pose pass re-enables everything it owns, so the second render calls the
# renderer directly rather than the frame function. The HUD is a separate canvas, so it is diffed as
# a canvas rather than through the DOM.
#
# usage: python3 tools/verify.py <shot>
import asyncio
import json
import sys

from playwright.async_api import async_playwright

SHOT = sys.argv[1]

JS = """() => {
  const g = window.__game;
  const sim = g.sim;
  const cast = g.cast;
  const W = 1280, H = 720;
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const c = off.getContext('2d', { willReadFrequently: true });

  // Render exactly the current scene state, with no posing pass to undo the hiding.
  const renderNow = () => {
    g.world.renderer.render(g.world.scene, g.world.camera);
    c.clearRect(0, 0, W, H);
    c.drawImage(document.getElementById('scene'), 0, 0);
    return c.getImageData(0, 0, W, H).data;
  };

  const diff = (a, b, threshold) => {
    let n = 0;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = (y * W + x) * 4;
        const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        if (d > threshold) {
          n += 1;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    return { px: n, box: n ? [x0, y0, x1 - x0 + 1, y1 - y0 + 1] : null, share: +(100 * n / (W * H)).toFixed(2) };
  };

  g.draw();                    // one posed frame, so every mesh is in its final place
  const base = renderNow();
  const out = { shot: SHOT_NAME, subjects: [] };

  const test = (name, hide, show) => {
    hide();
    const ohne = renderNow();
    show();
    const d = diff(base, ohne, 26);
    out.subjects.push({ name, ...d });
  };

  if (sim.police.air) {
    test('helicopter.body', () => { cast.air.group.visible = false; }, () => { cast.air.group.visible = true; });
    test('searchlight.cone', () => { cast.air.cone.visible = false; cast.air.shaft.visible = false; }, () => { cast.air.cone.visible = true; cast.air.shaft.visible = true; });
    test('searchlight.pool', () => { cast.air.pool.visible = false; }, () => { cast.air.pool.visible = true; });
  }

  sim.police.units.forEach((u) => {
    const entry = cast.fleet.get(u.car);
    if (!entry) { out.subjects.push({ name: 'cruiser.' + u.number, px: 0, box: null, share: 0, missing: 'no mesh' }); return; }
    test('cruiser.' + u.number, () => { entry.group.visible = false; }, () => { entry.group.visible = true; });
  });

  if (sim.player.driving) {
    const entry = cast.fleet.get(sim.player.driving);
    if (entry) test('player.car', () => { entry.group.visible = false; }, () => { entry.group.visible = true; });
  } else {
    test('player.body', () => { cast.hero.group.visible = false; }, () => { cast.hero.group.visible = true; });
  }
  test('crowd', () => { cast.crowd.show(0); }, () => { cast.crowd.show(sim.crowd.length); });

  // The ambient traffic, one car at a time, and how many of them paint any pixels at all.
  let ambientVisible = 0;
  for (const t of sim.traffic) {
    if (t.stolen) continue;
    const entry = cast.fleet.get(t);
    if (!entry) continue;
    test('traffic.' + t.kind, () => { entry.group.visible = false; }, () => { entry.group.visible = true; });
    if (out.subjects[out.subjects.length - 1].px > 200) ambientVisible += 1;
  }
  out.ambientVisible = ambientVisible;

  // The HUD: its own canvas, so its content is the diff between "painted" and "cleared".
  const overlay = document.getElementById('overlay');
  const octx = overlay.getContext('2d');
  const hudData = octx.getImageData(0, 0, W, H).data;
  let hudPx = 0;
  let hx0 = W, hy0 = H, hx1 = 0, hy1 = 0;
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 4;
    if (hudData[i + 3] > 24) {
      hudPx += 1;
      if (x < hx0) hx0 = x; if (x > hx1) hx1 = x;
      if (y < hy0) hy0 = y; if (y > hy1) hy1 = y;
    }
  }
  out.hud = { px: hudPx, box: hudPx ? [hx0, hy0, hx1 - hx0 + 1, hy1 - hy0 + 1] : null, share: +(100 * hudPx / (W * H)).toFixed(2) };

  // Text lines in specific HUD rectangles, counted as rows that hold bright glyph pixels: a
  // dispatch list with five lines has five such rows groups.
  const rowsWithInk = (bx0, by0, bx1, by1) => {
    let groups = 0, inGroup = false;
    for (let y = by0; y < by1; y += 1) {
      let lit = 0;
      for (let x = bx0; x < bx1; x += 1) {
        const i = (y * W + x) * 4;
        if (hudData[i + 3] > 40 && hudData[i] * 0.299 + hudData[i + 1] * 0.587 + hudData[i + 2] * 0.114 > 120) lit += 1;
      }
      if (lit > 3 && !inGroup) { groups += 1; inGroup = true; }
      if (lit <= 3) inGroup = false;
    }
    return groups;
  };
  out.dispatchRows = rowsWithInk(30, 452, 320, 512);
  out.subtitleRows = rowsWithInk(300, 612, 980, 650);
  out.objectiveRows = rowsWithInk(28, 330, 366, 404);
  out.radioRows = rowsWithInk(952, 556, 1250, 616);
  out.speedRows = rowsWithInk(952, 640, 1250, 700);
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
        out = await page.evaluate('(n) => { const SHOT_NAME = n; return (' + JS + ')(); }', SHOT)
        print('== %s ==' % SHOT)
        for s in out['subjects']:
            flag = 'PRESENT' if s['px'] > 400 else ('thin' if s['px'] > 60 else 'ABSENT')
            print('  %-20s %7d px (%5.2f%%)  box=%-24s %s' % (s['name'], s['px'], s['share'], str(s['box']), flag))
        print('  ambient visible      %d cars' % out['ambientVisible'])
        print('  HUD                  %7d px (%5.2f%%)  box=%s' % (out['hud']['px'], out['hud']['share'], out['hud']['box']))
        print('  text rows: dispatch=%d subtitle=%d objective=%d radio=%d speed=%d' % (
            out['dispatchRows'], out['subtitleRows'], out['objectiveRows'], out['radioRows'], out['speedRows']))
        if errs:
            print('  ERRORS', errs)
        await b.close()


asyncio.run(main())
