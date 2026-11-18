# Vice Meridian II

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/arkhindi12/vice-meridian-2/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/arkhindi12/vice-meridian-2/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

An open-world crime game that runs in a browser tab: a 2.4 km sunlit city, ten missions, a named
cast who talk in subtitles, a car you can steal and crash and repair, three radio stations that
actually play, and a police department that sends cruisers, dismounts officers, and — from four
stars — puts a helicopter over your head with a searchlight on the road.

No build step, no network at runtime. One canvas, ES modules, three.js vendored beside them.

## What it is

You are a courier who saw the wrong ledger. **THE LONG SHADOW** is ten missions from a fixer called
Marlowe Vance to a boat at the marina, and along the way you meet Juno Akers (who has the car),
Detective Rusk (who has the file on you) and Sable (who wants the ledger). They speak in a subtitle
box at the bottom of the frame: a name in caps, then the line.

The city is **Vice Meridian**, on a nine-by-nine grid of avenues 300 m apart — the Sunglass Strip
down the coast, Neon Heights in the middle, Coral Strand to the south. Glass towers with lit windows
and neon boards, palm-lined parks, a promenade, and the sea to the west. Traffic drives the lanes,
turns at the junctions and brakes for the car ahead; the pavements are full of people who will run
when you fire a gun. Any car in the street is stealable.

The police work in stars. One star is a cruiser; five is the department. Cruisers arrive out of
sight, the crews get out and shoot, and the heat only cools once nobody has had eyes on you for a
while. At four stars a helicopter lifts and holds its light on the street under you — which also
means it can see you, so the heat cannot cool while it is up. A radio dispatch list on screen names
every unit, its distance in metres, and what it is doing: PURSUIT, RAMMING, ROADBLOCK, SEARCHLIGHT.

## Controls

| Key | Does |
| --- | --- |
| **W A S D** | walk; in a car, throttle / brake / steer |
| **Shift** | run |
| **E** | take the nearest car, leave the car, or buy at a shop counter |
| **Left mouse** | shoot |
| **R** | reload (and, on the wasted or busted card, get back out) |
| **Tab** | change radio station |
| **M** | mute |
| **Esc** / **P** | pause |

The camera sits behind the player and leans along the aim. In a car it pulls back and widens with
speed, and lifts higher while the helicopter is up so the aircraft and its light stay in frame.

## Serving it locally

```sh
node serve.ts            # serves game/ on http://localhost:8080
```

`serve.ts` is Node 22 with no dependencies: it sends the MIME types a browser game needs and
refuses any path outside `game/`. Open the address it prints.

`game/index.html` takes an optional query string that stages one of the four hand-in photographs
instead of playing: `?shot=cover`, `?shot=foot`, `?shot=mission`, `?shot=driving`, with an optional
`&seed=N`. A staged shot builds the same seeded city, poses the cast, and holds the frame — the
pictures are the game's own code, not mock-ups.

## Running the hand-in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

It copies `game/` and `screenshots/` into the output directory, builds `dossier.json` there with the
vendored make.fun library, prints what it wrote, and exits non-zero if anything is wrong. It refuses
before writing anything if `game/index.html` is missing, the vendored three.js is missing, there are
no screenshots, more than four, or one over 256 KiB (naming the file and its size), or if a
screenshot is not really a PNG or JPEG.

## The modules

Each file does one job. `game/src/`, in rough dependency order:

- **scale.js** — every measurement and colour the city is built from: the grid, gait, driving, the
  pistol, the law, the air support, the sun, the palette.
- **random.js** — one seeded stream (mulberry32), so `?seed=4` rebuilds the same town and the same
  screenshot every time.
- **mathKit.js** — fold, swing, clip, fade, dist, quadratic Bézier. The arithmetic four modules
  would otherwise write differently.
- **batch.js** — merges thousands of boxes sharing a material into one buffer, with UVs in metres so
  one window texture tiles correctly on a shopfront and a tower alike.
- **cityPlan.js** — the town as plain records: blocks, lots, parks, the three shop forecourts, and
  the queries the rest of the game asks ("is this solid?", "is this the sea?", "which district?").
- **textures.js** — every surface painted in Canvas 2D and cached: tarmac, paving, facades with lit
  windows, neon boards, shop signboards, palm fronds, the searchlight's cone texture, the sky.
- **world.js** — the renderer, the sun and its shadow box, the sky dome, the road paint, the
  buildings, the palms, the sea, the street furniture. Built once from the plan.
- **vehicle.js** — the seven car shapes, each merged to two draw calls, plus the cruiser's livery and
  roof bar, and the model name the speedometer prints.
- **traffic.js** — the ambient fleet: lane keeping, a nose sensor that brakes for what is ahead, and
  junction turns followed as quadratic arcs rather than snaps.
- **crowd.js** — pedestrians walking the pavements, turning at corners, panicking at gunfire, and
  falling when hit.
- **player.js** — walking with a wall slide, driving, taking and leaving cars, the pistol, damage
  through armour, and the round-stepping that stops a bullet tunnelling through a body.
- **officers.js** — the VMPD: star heat, spawning out of sight, cruisers routing along the grid,
  crews dismounting, officers firing and making the collar, the helicopter and its searchlight, the
  tactics, and the dispatch list.
- **story.js** — the ten missions, the four characters, the subtitle clock, RESPECT and its ranks,
  the day and the clock.
- **shops.js** — the three counters: what each sells, what it costs, and what it changes.
- **radio.js** — three stations, the track clock that turns over every 40–60 seconds, the DJ, and
  the WebAudio loops that actually play them.
- **sound.js** — effects synthesised on the WebAudio graph: engine, siren, rotor, gunfire, tyres,
  footsteps, the cash register.
- **save.js** — the career in localStorage, clamped on the way back in.
- **input.js** — held keys, one-shot presses, the pointer in canvas pixels.
- **hud.js** — the whole display on its own 2D canvas: compass minimap, RESPECT, objective, dispatch,
  health and ammo, clock, stars, wallet, radio, speedometer, prompts, subtitles, the cards.
- **cast.js** — the moving cast in three.js: instanced bodies for the crowd and the officers, the
  per-car meshes, the helicopter with its rotor blur and light cone, rounds and muzzle flashes.
- **scenes.js** — the four photographs, staged from the address bar.
- **sim.js** — the world as one state machine and the single fixed step that advances all of it.
- **main.js** — the front door: frame size, the follow camera, keyboard to sim, the render loop, and
  the staged-shot path.

## The four screenshots

All 1280x720 JPEG, under 256 KiB each, rendered from the game with headless Chromium:

1. **`1-cover.jpg`** — a four-star chase from the road: the player's coupe, four cruisers with their
   bars lit and crews out, the helicopter overhead with its searchlight cone on the boulevard, four
   filled stars, a five-line dispatch list ending in AIR 1, the radio, the speedometer, a 6/10
   objective and Detective Rusk on the radio.
2. **`2-foot.jpg`** — on foot on the Strip: the player walking, twelve pedestrians on both kerbs,
   traffic in the lanes and a drop-top at the kerb to take, with the minimap, health, ammo, the
   objective, RESPECT and the clock.
3. **`3-mission.jpg`** — at the counter of Ironside Arms: the shop prompt, its price, the objective
   with its live condition, the marker ring, pedestrians at the door and traffic behind.
4. **`4-driving.jpg`** — flat out up the Strip: speedometer with the model name and condition, the
   radio station and track, eight cars in the lanes, palms, the sea on the left, and two stars with
   their dispatch list.

## Made for make.fun

This is an entry for make.fun's **"Make GTA 6"** bounty:
<https://make.fun/bounty/gta6-01>

The kit's own files (`serve.ts`, `shots.json`, `LICENSE`, `vendor/makefun-game.ts`) are vendored and
untouched. Everything in `game/` and this README is written for this entry.
