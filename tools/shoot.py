# shoot.py - open each staged scene in headless Chromium, wait for __shotReady, report page
# errors, and write the four JPEGs the entry hands in.
#
# This is a development tool and lives outside game/ so it is never part of the hand-in. It runs
# against the static server that serve.ts puts up, so what it renders is what the game serves.
#
# usage: python3 tools/shoot.py [baseURL] [outDir]
import asyncio
import json
import os
import sys

from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8123'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'screenshots'

SHOTS = [
    ('1-cover.jpg', 'cover'),
    ('2-foot.jpg', 'foot'),
    ('3-mission.jpg', 'mission'),
    ('4-driving.jpg', 'driving'),
]

PROBE = """() => {
    const g = window.__game;
    if (!g) return { missing: true };
    const sim = g.sim;
    return {
      stars: sim.police.stars,
      air: !!sim.police.air,
      airIntensity: sim.police.air ? sim.police.air.intensity : 0,
      units: sim.police.units.length,
      dispatch: (sim.dispatch || []).map(d => d.label + ' ' + d.dist + 'M ' + d.tactic),
      mission: g.missionText(),
      sub: sim.story.sub ? sim.story.sub.tag + ': ' + sim.story.sub.line : null,
      prompt: sim.prompt,
      driving: !!sim.player.driving,
      model: sim.player.driving ? sim.player.driving.shape.model : null,
      condition: sim.player.driving ? sim.player.driving.condition : null,
      cash: sim.story.cash,
      respect: Math.round(sim.story.respect),
      crowd: sim.crowd.length,
      traffic: sim.traffic.length,
      radio: g.radio(),
      buildings: sim.plan.buildings.length,
    };
}"""


async def main():
    os.makedirs(OUT, exist_ok=True)
    report = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            args=[
                '--use-gl=angle',
                '--use-angle=swiftshader',
                '--enable-unsafe-swiftshader',
                '--disable-lcd-text',
                '--force-device-scale-factor=1',
            ]
        )
        page = await browser.new_page(viewport={'width': 1280, 'height': 720}, device_scale_factor=1)
        errors = []
        page.on('pageerror', lambda e: errors.append('pageerror: %s' % e))

        def on_console(m):
            if m.type == 'error':
                errors.append('console.%s: %s' % (m.type, m.text))

        page.on('console', on_console)

        for name, shot in SHOTS:
            errors.clear()
            url = '%s/?shot=%s&seed=1' % (BASE, shot)
            await page.goto(url, wait_until='load')
            try:
                await page.wait_for_function('window.__shotReady === true', timeout=60000)
            except Exception as exc:  # noqa: BLE001
                errors.append('timeout waiting for __shotReady: %s' % exc)
            await page.wait_for_timeout(500)
            path = os.path.join(OUT, name)
            await page.screenshot(path=path, type='jpeg', quality=86)
            size = os.path.getsize(path)
            info = await page.evaluate(PROBE)
            report.append({'name': name, 'bytes': size, 'info': info, 'errors': list(errors)})
            print(json.dumps(report[-1], indent=2))
        await browser.close()
    bad = [r for r in report if r['errors'] or r['bytes'] > 262144]
    print('')
    print('SUMMARY ' + ('FAIL' if bad else 'OK'))
    for r in report:
        print('  %-16s %7d bytes  errors=%d' % (r['name'], r['bytes'], len(r['errors'])))
    if bad:
        sys.exit(1)


asyncio.run(main())
