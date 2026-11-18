// scale.js — every measurement the city is built from, in one place.
//
// A unit is one metre. Vice Meridian II stands on a nine-by-nine lattice of avenues, 300 m apart,
// each 46 m wide from kerb to kerb. That is 2.4 km from the first avenue to the last: a grid you
// cross in a car in a little over a minute, which is the size a chase needs to breathe. Between two
// avenues sits a 254 m block, with a 13 m pavement ring around it for the crowds, the shopfronts
// and the neon.
//
// Colours live here too, so nothing keeps a private copy that can drift. Three of them do the
// talking: pink for the city's own light, cyan for anything the player owns, gold for the law.

export const GRID = {
  cols: 9,
  rows: 9,
  pitch: 300,
  half: 23, // avenue centre line to kerb
  setback: 13, // pavement depth, kerb to frontage
  storey: 3.7,
};

// The town in world coordinates: the outer kerbs bound the drivable ground.
export const CITY = {
  first: -GRID.half,
  last: (GRID.cols - 1) * GRID.pitch + GRID.half,
  blockSide: GRID.pitch - GRID.half * 2,
};

// The shoreline: west of the first avenue the town gives way to promenade, sand and sea; south of
// the last avenue to the marina quay and the bay.
export const SHORE = {
  kerb: -GRID.half,
  promenade: -98,
  sand: -268,
  water: -304,
  quay: CITY.last,
  bay: CITY.last + 34,
};

// On foot.
export const GAIT = {
  walk: 4.2,
  sprint: 8.6,
  pivot: 11.5,
  girth: 0.42,
  reach: 3.8,
};

// Behind the wheel. vmax 40 m/s is 144 km/h: enough that the speedometer has a top end.
export const DRIVE = {
  vmax: 40,
  vreverse: 12,
  push: 9.6,
  stop: 24,
  coast: 2.3,
  steer: 1.9,
};

// The pistol.
export const GUN = {
  magazine: 15,
  pouch: 60,
  reloadTime: 1.2,
  cycle: 0.17,
  reach: 95,
  muzzle: 210,
  scatter: 0.02,
};

export const CROWD = {
  size: 148,
  stroll: [1.1, 1.9],
  bolt: 5.4,
  panic: 3.4,
};

export const FLEET = { size: 46 };

// The law. One cruiser per star up to five, two officers a cruiser, and a heat that only drains
// once nobody has had eyes on the player for `blindAfter` seconds.
export const LAW = {
  stars: 5,
  perStar: [0, 1, 2, 3, 4, 5],
  crew: 2,
  run: 5.6,
  walk: 3.1,
  volley: 0.62,
  round: 150,
  range: 58,
  blindAfter: 9,
  drainTime: 6,
  spawnNear: 170,
  spawnFar: 250,
  dismount: 36,
  airFrom: 4, // stars at which the helicopter lifts
};

// The air support: an orbit around the player, high enough to clear the towers and low enough that
// the searchlight cone reaches the street at a readable angle.
export const AIR = {
  radius: 40,
  alt: 40,
  orbit: 0.30, // radians per second round the player
  cone: 0.105, // spotlight half-angle: a searchlight, not a floodlight
  poolRadius: 6.5, // metres of lit road: what a cone 25 m up actually leaves
  reach: 165,
  fadeIn: 1.4,
};

// A low sun over the water, a shade south of due west, so every avenue running north has the sea
// on its left and the light coming across it.
export const SUN = {
  bearing: Math.PI * 1.36,
  altitude: 0.30,
  discAltitude: 0.10,
  colour: '#ffd2a4',
  strength: 3.3,
};

export const SKY = {
  haze: '#f3b58f',
  hazeDensity: 0.00058,
  skyFill: '#b7dcf1',
  groundFill: '#d69b78',
};

export const PAINT = {
  asphalt: '#5b5867',
  laneDash: '#f2e2b0',
  centre: '#ffcf5a',
  crossing: '#fbf4e2',
  kerb: '#e7d5ba',
  pavement: '#d8bfa6',
  grass: '#4e8b5d',
  dune: '#efd2a4',
  water: '#0d6b7c',
  facades: ['#cf7a63', '#e6b184', '#9b7cab', '#608f8a', '#e7ccb0', '#b56a60', '#7187af', '#f0dbc7', '#c88b72'],
  curtain: ['#2e5969', '#3a4969', '#4e6e69', '#6a4969'],
  neon: ['#ff2f86', '#22e6d0', '#ffd23c', '#8f5bff', '#ff7a30', '#3d8bff'],
  skins: ['#f1c7a0', '#d9a06b', '#a86b3f', '#7a4a2a', '#e8b98c', '#f6d9c1'],
  tops: ['#ff3d7f', '#22e6d0', '#ffd23c', '#f4efe3', '#3d8bff', '#8f5bff', '#ff7a30', '#63d07a', '#e8483f'],
  legs: ['#26324a', '#2f2f36', '#e6e0d2', '#5b4530', '#37415a', '#1f1f26'],
  cars: ['#ff3d7f', '#22e6d0', '#ffd23c', '#f2f0ea', '#232331', '#8f5bff', '#e8483f', '#177d95', '#ff7a30', '#0f5f8a'],
};
