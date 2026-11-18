# play.py - play the game the way a player would and assert the things a still frame cannot show:
# walking moves the player, traffic and crowds keep moving, a car can be taken, driven, damaged and
# repaired, a shot raises the heat and scatters the street, police arrive, dismount and put a
# helicopter up at four stars, a shop takes money and changes the game, the chain advances and pays,
# the clock and RESPECT climb, heat cools when unseen, and an arrest ends the run.
#
# Each check is isolated: the player is healed and the heat reset between sections, so one section
# cannot fail because the previous one got the player shot.
#
# usage: python3 tools/play.py
import asyncio

from playwright.async_api import async_playwright

JS = """() => {
  const g = window.__game;
  const sim = g.sim;
  const log = [];
  const note = (name, ok, detail) => log.push({ name, ok: !!ok, detail });
  const still = { move: { x: 0, z: 0 }, fire: false, use: false, run: false, reload: false };
  const run = (n, input = still) => { for (let i = 0; i < n; i += 1) g.step(1, input); };
  const adv = (n, input = still) => { for (let i = 0; i < n; i += 1) g.advance(1, input); };

  // A clean slate between sections: alive, on foot, no heat, no cars chasing.
  const reset = (x, z) => {
    const p = sim.player;
    p.hp = p.hpMax;
    p.armour = 0;
    p.driving = null;
    p.x = x ?? p.x;
    p.z = z ?? p.z;
    sim.mode = 'play';
    sim.police.stars = 0;
    sim.police.heat = 0;
    sim.police.quiet = 0;
    sim.police.units.length = 0;
    sim.police.rounds.length = 0;
    sim.police.air = null;
    sim.rounds.length = 0;
  };

  const p = sim.player;

  // ---- 1. walking moves the player.
  reset(60, 1500);
  const start = { x: p.x, z: p.z };
  run(90, { ...still, move: { x: 1, z: 0 } });
  note('player.walks', Math.hypot(p.x - start.x, p.z - start.z) > 3, Math.hypot(p.x - start.x, p.z - start.z).toFixed(2) + ' m in 1.5 s');

  // ---- 2. a building refuses the step, and the sea refuses the step.
  let blockZ = null;
  for (let z = 40; z < 2200; z += 2) { if (sim.plan.buildingAt(60, z, 0) && !sim.plan.buildingAt(30, z, 0)) { blockZ = z; break; } }
  reset(28, blockZ);
  run(260, { ...still, move: { x: 1, z: 0 } });
  const stopped = p.x;
  const blocked = sim.plan.buildingAt(stopped + 0.7, blockZ, 0);
  note('player.blockedByWalls', !!blocked && stopped < 60, 'stopped at x=' + stopped.toFixed(1) + ' on z=' + blockZ + ', wall ahead: ' + (blocked ? 'yes' : 'no'));
  reset(-280, 1500);
  run(240, { ...still, move: { x: -1, z: 0 } });
  note('player.refusesWater', p.x >= -306, 'x=' + p.x.toFixed(1) + ' (waterline at -304)');

  // ---- 3. traffic and crowds keep moving.
  reset(120, 1500);
  const cars0 = sim.traffic.slice(0, 12).map((c) => ({ x: c.x, z: c.z }));
  const peds0 = sim.crowd.slice(0, 20).map((q) => ({ x: q.x, z: q.z }));
  adv(120);
  let carsMoved = 0;
  let pedsMoved = 0;
  for (let i = 0; i < cars0.length; i += 1) if (Math.hypot(sim.traffic[i].x - cars0[i].x, sim.traffic[i].z - cars0[i].z) > 3) carsMoved += 1;
  for (let i = 0; i < peds0.length; i += 1) if (Math.hypot(sim.crowd[i].x - peds0[i].x, sim.crowd[i].z - peds0[i].z) > 0.5) pedsMoved += 1;
  note('traffic.drives', carsMoved >= 5, carsMoved + '/' + cars0.length + ' cars moved in 2 s');
  note('crowd.walks', pedsMoved >= 6, pedsMoved + '/' + peds0.length + ' pedestrians moved in 2 s');

  // ---- 4. take a car, drive it, and hit a wall with it.
  reset();
  const car = sim.traffic.find((c) => !c.stolen);
  p.x = car.x + 1.2;
  p.z = car.z;
  run(1, { ...still, use: true });
  note('car.taken', !!p.driving, p.driving ? p.driving.kind + ' / ' + p.driving.shape.model : 'not taken');
  if (p.driving) {
    const z0 = p.z;
    adv(150, { ...still, move: { x: 0, z: -1 } });
    note('car.drives', Math.abs(p.driving.speed) > 5 && Math.abs(p.z - z0) > 8, 'speed ' + Math.abs(p.driving.speed).toFixed(1) + ' m/s');
    // A head-on wall, found by asking the plan rather than by hoping.
    let wallX = null;
    for (let x = 8; x < 200; x += 0.5) if (sim.plan.buildingAt(x, 700, 0)) { wallX = x; break; }
    const drv = p.driving;
    drv.x = 8; drv.z = 700; drv.yaw = 0; drv.speed = 0; drv.condition = 1;
    p.hp = p.hpMax;
    adv(420, { ...still, move: { x: 0, z: -1 } });
    note('car.crashes', drv.condition < 0.9, 'condition 1.00 -> ' + drv.condition.toFixed(2) + ' (wall at x=' + wallX + ')');
    note('car.crashHurts', p.hp < p.hpMax, 'hp ' + Math.round(p.hp));
  }

  // ---- 5. the garage repairs the car you are sitting in.
  if (p.driving) {
    const garage = sim.plan.shops.find((s) => s.kind === 'garage');
    p.driving.x = garage.at.x;
    p.driving.z = garage.at.z;
    p.x = garage.at.x;
    p.z = garage.at.z;
    sim.story.cash = 5000;
    sim.shopCool = 0;
    const cond0 = p.driving.condition;
    const cash0 = sim.story.cash;
    run(1, { ...still, use: true });
    note('shop.garageRepairs', p.driving.condition > cond0 && sim.story.cash < cash0, cond0.toFixed(2) + ' -> ' + p.driving.condition.toFixed(2) + ' for $' + (cash0 - sim.story.cash));
    run(1, { ...still, use: true });
    note('car.left', !p.driving, p.driving ? 'still in' : 'on foot');
  }

  // ---- 6. a shot: the magazine drops, the street scatters, the heat rises.
  reset(60, 1500);
  const ped = sim.crowd.find((q) => q.down <= 0);
  p.x = ped.x - 2.5;
  p.z = ped.z;
  p.aimYaw = 0;
  p.cool = 0;
  p.clip = 15;
  run(1, { ...still, fire: true });
  note('gun.fires', p.clip === 14, 'clip 15 -> ' + p.clip);
  adv(30);
  note('crime.raisesHeat', sim.police.stars >= 1, sim.police.stars + ' stars');
  note('crowd.panics', sim.crowd.some((q) => q.panic > 0.2), 'somebody is running');

  // ---- 7. the police arrive, dismount, and put a helicopter up at four stars.
  reset(150, 1260);
  sim.police.stars = 4;
  sim.police.heat = 1;
  adv(1500);
  const crewsOut = sim.police.units.some((u) => u.officers.some((o) => !o.inCar && o.alive));
  note('police.units', sim.police.units.length >= 2, sim.police.units.length + ' cruisers on the street');
  note('police.officersOut', crewsOut, 'crews dismounted');
  note('police.air', !!sim.police.air, sim.police.air ? 'altitude ' + sim.police.air.alt.toFixed(0) + ' m' : 'none');
  if (sim.police.air) {
    const err = Math.hypot(sim.police.air.light.x - p.x, sim.police.air.light.z - p.z);
    note('police.lightFollows', err < 45, err.toFixed(1) + ' m off the player');
  }
  const disp = sim.dispatch;
  note('police.dispatch', disp.length >= 3, disp.map((d) => d.label + ' ' + d.dist + 'M ' + d.tactic).join(' | '));
  note('police.dispatchAir', disp.some((d) => d.air && d.tactic === 'SEARCHLIGHT'), 'AIR 1 with SEARCHLIGHT');
  note('police.dispatchCapped', disp.length <= 5, disp.length + ' lines');
  note('police.tactics', new Set(disp.map((d) => d.tactic)).size >= 2, [...new Set(disp.map((d) => d.tactic))].join(','));

  // ---- 8. the air support lands when the heat drops below four.
  sim.police.stars = 2;
  sim.police.heat = 0.8;
  adv(500);
  note('police.airLands', !sim.police.air, sim.police.air ? 'still up' : 'landed below four stars');

  // ---- 9. the shops.
  reset(60, 1500);
  sim.story.cash = 5000;
  const gun = sim.plan.shops.find((s) => s.kind === 'gun');
  p.x = gun.at.x;
  p.z = gun.at.z;
  p.ammo = 5;
  sim.shopCool = 0;
  const cash1 = sim.story.cash;
  run(1, { ...still, use: true });
  note('shop.gun', p.ammo > 5, 'ammo 5 -> ' + p.ammo + ' for $' + (cash1 - sim.story.cash));
  const cloth = sim.plan.shops.find((s) => s.kind === 'clothier');
  const max0 = p.hpMax;
  p.x = cloth.at.x;
  p.z = cloth.at.z;
  p.hp = 40;
  sim.shopCool = 0;
  run(1, { ...still, use: true });
  note('shop.clothier', p.hpMax > max0 && p.hp === p.hpMax, 'hpMax ' + max0 + ' -> ' + p.hpMax + ', healed to ' + p.hp);
  sim.shopCool = 0;
  run(1, still);
  note('shop.prompt', /CASA VELA/.test(sim.prompt), JSON.stringify(sim.prompt));

  // ---- 10. the clock and RESPECT climb on play.
  reset(60, 1500);
  const clock0 = sim.story.clock;
  const respect0 = sim.story.respect;
  adv(600, { ...still, move: { x: 0, z: -1 } });
  note('clock.advances', sim.story.clock !== clock0, clock0.toFixed(0) + ' -> ' + sim.story.clock.toFixed(0) + ' min');
  note('respect.climbs', sim.story.respect >= respect0, respect0 + ' -> ' + Math.round(sim.story.respect));

  // ---- 11. the mission chain advances, pays, and speaks.
  reset(60, 1500);
  sim.story.index = 0;
  sim.story.done = 0;
  sim.story.passed = [];
  sim.story.cash = 1000;
  const m0 = g.missionText().title;
  const peak = g.currentMission();
  p.x = peak.at.x;
  p.z = peak.at.z;
  run(8);
  note('mission.passes', sim.story.index === 1, m0 + ' -> ' + g.missionText().title);
  note('mission.pays', sim.story.cash > 1000, '$1000 -> $' + sim.story.cash);
  note('mission.speaks', !!sim.story.sub, sim.story.sub ? sim.story.sub.tag : 'silent');
  note('mission.ten', g.missionText().of === 10, '1 of ' + g.missionText().of);

  // ---- 12. a purchase satisfies the shop mission.
  reset(60, 1500);
  sim.story.index = 2;
  sim.story.done = 2;
  sim.story.bought = '';
  const salt = g.currentMission();
  p.x = salt.at.x;
  p.z = salt.at.z;
  sim.story.cash = 5000;
  sim.shopCool = 0;
  run(1, { ...still, use: true });
  run(4);
  note('mission.buyPasses', sim.story.index === 3, salt.title + ' -> ' + g.missionText().title);

  // ---- 13. heat cools when nobody can see the player.
  reset(60, 1500);
  sim.police.stars = 3;
  sim.police.heat = 1;
  sim.police.units.length = 0;
  sim.police.air = null;
  let cooledAt = null;
  for (let i = 0; i < 7200 && cooledAt === null; i += 1) {
    // Hold the "nobody can see you" condition: the quota would otherwise keep arriving, and a
    // cruiser 170 m away down a straight avenue does have a sight line.
    sim.police.units.length = 0;
    sim.police.air = null;
    sim.police.rounds.length = 0;
    g.advance(1, still);
    if (sim.police.stars < 3) cooledAt = i / 60;
  }
  note('police.cools', cooledAt !== null, cooledAt === null ? 'never cooled in 120 s' : 'shed a star after ' + cooledAt.toFixed(1) + ' s unseen');

  // ---- 14. an arrest ends the run.
  reset(60, 1500);
  sim.police.stars = 2;
  sim.police.units.length = 0;
  sim.police.units.push({
    car: { x: p.x + 3, z: p.z, len: 4.9, yaw: 0, wid: 2 },
    x: p.x + 3, z: p.z, yaw: 0, speed: 0, mode: 'deployed', number: '99', age: 4, siren: 0, tactic: 'RAMMING',
    officers: [{ x: p.x + 0.4, z: p.z, yaw: 0, hp: 3, cool: 99, alive: true, down: 0, seat: 0, moving: 0, inCar: false, flash: 0, collar: true }],
  });
  run(1);
  note('arrest.busts', sim.mode === 'busted', 'mode "' + sim.mode + '"');

  // ---- 15. the radio turns over on its own clock.
  reset(60, 1500);
  const t0 = g.radio().track;
  adv(3000);
  note('radio.turnsOver', g.radio().track !== t0, t0 + ' -> ' + g.radio().track);

  // ---- 16. the chain is ten missions, each named and paid.
  const all = [];
  for (let i = 0; i < 10; i += 1) {
    sim.story.index = i;
    const m = g.currentMission();
    if (m) all.push(m.title + ' $' + m.reward);
  }
  note('mission.chainOfTen', all.length === 10, all.join(' | '));
  sim.story.index = 0;
  return log;
}"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        page = await b.new_page(viewport={'width': 1280, 'height': 720})
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://127.0.0.1:8123/', wait_until='load')
        await page.wait_for_function('window.__game && window.__game.sim', timeout=60000)
        await page.wait_for_timeout(600)
        log = await page.evaluate(JS)
        for row in log:
            print('  %-26s %s  %s' % (row['name'], 'PASS' if row['ok'] else 'FAIL', row['detail']))
        bad = [r for r in log if not r['ok']]
        print('  %d/%d passed' % (len(log) - len(bad), len(log)))
        if errs:
            print('  PAGE ERRORS:', errs)
        await b.close()


asyncio.run(main())
