// sound.js — the sound effects, synthesised: no audio file ships with the game and nothing is sampled.
//
// The engine is two detuned oscillators through a low-pass that opens with speed. The siren is a
// sine swept by a slow LFO, and the helicopter is a chopped low rotor thump over a turbine whine.
// Gunfire is a short burst of noise with a fast decay over a low thump. The city is a quiet bed of
// filtered noise. Tyres squeal when a car is thrown into a corner and heels land a soft tick as the
// player runs. All of it is built on the WebAudio graph on the first click or key press — browsers
// refuse to start a context before a gesture — and the whole bus is muted with M.
//
// The radio is a separate bus in radio.js: a station keeps playing under the siren, and muting the
// game mutes both.
//
// Every method is a no-op when there is no context: a page that never receives a gesture, or a
// headless browser that never plays a sound, must not throw.

export function makeAudio() {
  let ctx = null;
  let master = null;
  let engine = null;
  let siren = null;
  let rotor = null;
  let bed = null;
  let muted = false;

  function build() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);

    // The engine: two oscillators into a filter, into a gain the frame loop writes.
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 3;
    const oscA = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscA.frequency.value = 46;
    const oscB = ctx.createOscillator();
    oscB.type = 'square';
    oscB.frequency.value = 69;
    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(master);
    oscA.start();
    oscB.start();
    engine = { gain: engineGain, filter, oscA, oscB };

    // The siren: one sine, swept between two notes by a triangle LFO.
    const sirenGain = ctx.createGain();
    sirenGain.gain.value = 0;
    const sirenOsc = ctx.createOscillator();
    sirenOsc.type = 'sine';
    sirenOsc.frequency.value = 720;
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.value = 0.55;
    const depth = ctx.createGain();
    depth.gain.value = 210;
    lfo.connect(depth);
    depth.connect(sirenOsc.frequency);
    sirenOsc.connect(sirenGain);
    sirenGain.connect(master);
    sirenOsc.start();
    lfo.start();
    siren = { gain: sirenGain, osc: sirenOsc };

    // The helicopter: a low sawtooth chopped by a square LFO, plus a turbine sine well above it.
    const rotorGain = ctx.createGain();
    rotorGain.gain.value = 0;
    const chop = ctx.createGain();
    chop.gain.value = 0.5;
    const chopLfo = ctx.createOscillator();
    chopLfo.type = 'square';
    chopLfo.frequency.value = 11;
    const chopDepth = ctx.createGain();
    chopDepth.gain.value = 0.5;
    chopLfo.connect(chopDepth);
    chopDepth.connect(chop.gain);
    const rotorOsc = ctx.createOscillator();
    rotorOsc.type = 'sawtooth';
    rotorOsc.frequency.value = 34;
    const rotorLp = ctx.createBiquadFilter();
    rotorLp.type = 'lowpass';
    rotorLp.frequency.value = 260;
    rotorOsc.connect(rotorLp);
    rotorLp.connect(chop);
    chop.connect(rotorGain);
    const turbine = ctx.createOscillator();
    turbine.type = 'sine';
    turbine.frequency.value = 640;
    const turbineGain = ctx.createGain();
    turbineGain.gain.value = 0.18;
    turbine.connect(turbineGain);
    turbineGain.connect(rotorGain);
    rotorGain.connect(master);
    rotorOsc.start();
    rotorLp.start?.();
    chopLfo.start();
    turbine.start();
    rotor = { gain: rotorGain, osc: rotorOsc, lfo: chopLfo };

    // The city: brown-ish noise through a band-pass, very quiet.
    const seconds = 2;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 520;
    band.Q.value = 0.6;
    const bedGain = ctx.createGain();
    bedGain.gain.value = 0.05;
    source.connect(band);
    band.connect(bedGain);
    bedGain.connect(master);
    source.start();
    bed = { gain: bedGain };
    return ctx;
  }

  /** Called on the first click or key press: a context will not start without a gesture. */
  function resume() {
    const c = build();
    if (c && c.state === 'suspended') c.resume();
  }

  /**
   * Called every frame with the player's speed, whether they drive, the wanted level and whether
   * the helicopter is up. The air's rotor noise rides its own distance, so a four-star chase is
   * loud overhead and quiet again once the light has gone.
   */
  function frame({ speed = 0, driving = false, stars = 0, near = 1, turning = 0, air = 0 } = {}) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const s = Math.min(1, Math.abs(speed) / 44);
    engine.gain.gain.setTargetAtTime(driving ? 0.05 + s * 0.13 : 0, t, 0.08);
    engine.filter.frequency.setTargetAtTime(280 + s * 1900 + turning * 260, t, 0.1);
    engine.oscA.frequency.setTargetAtTime(38 + s * 74, t, 0.12);
    engine.oscB.frequency.setTargetAtTime(57 + s * 96 + turning * 18, t, 0.12);
    siren.gain.gain.setTargetAtTime(stars > 0 ? 0.016 + near * 0.018 : 0, t, 0.2);
    siren.osc.frequency.setTargetAtTime(560 + stars * 40, t, 0.3);
    rotor.gain.gain.setTargetAtTime(air > 0.02 ? 0.05 + air * 0.1 : 0, t, 0.35);
    rotor.osc.frequency.setTargetAtTime(30 + air * 10, t, 0.4);
    rotor.lfo.frequency.setTargetAtTime(9 + air * 6, t, 0.4);
    bed.gain.gain.setTargetAtTime(0.045, t, 0.5);
  }

  /** A pistol shot: a crack of noise over a low thump. `loud` scales with how close the shooter is. */
  function gunshot(loud = 1) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const dur = 0.22;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      const k = i / data.length;
      data[i] = (Math.random() * 2 - 1) * (1 - k) ** 5 * (0.8 + Math.random() * 0.2);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.5 * loud;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 2400;
    source.connect(low);
    low.connect(gain);
    gain.connect(master);
    source.start(t);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.14);
    const thump = ctx.createGain();
    thump.gain.setValueAtTime(0.35 * loud, t);
    thump.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(thump);
    thump.connect(master);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  /** The cash register: three rising triangle notes. */
  function cash() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    [880, 1320, 1760].forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t + i * 0.07);
      gain.gain.linearRampToValueAtTime(0.12, t + i * 0.07 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.22);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t + i * 0.07);
      osc.stop(t + i * 0.07 + 0.24);
    });
  }

  /** A heel on the pavement: a very short tick of noise, band-passed high. */
  function step(loud = 0.4) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.value = 0.12 * loud;
    source.connect(hp);
    hp.connect(gain);
    gain.connect(master);
    source.start(t);
  }

  /** Tyres losing grip: a thin squeal that rises with how hard the car is turning. */
  function screech(amount = 0) {
    if (!ctx || muted) return;
    if (amount < 0.05) return;
    const t = ctx.currentTime;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.3), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * 0.6;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2200 + amount * 900;
    band.Q.value = 8;
    const gain = ctx.createGain();
    gain.gain.value = Math.min(0.06, amount * 0.05);
    source.connect(band);
    band.connect(gain);
    gain.connect(master);
    source.start(t);
    source.stop(t + 0.3);
  }

  /** Metal on metal: a dull clang for a car taking a wall at speed. */
  function crunch() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(210, t);
    osc.frequency.exponentialRampToValueAtTime(56, t + 0.2);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + 0.26);
  }

  /** Mute or unmute everything. Returns the new state. */
  function toggle() {
    muted = !muted;
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.55, ctx.currentTime, 0.05);
    return muted;
  }

  return {
    resume,
    frame,
    gunshot,
    cash,
    step,
    screech,
    crunch,
    toggle,
    get muted() {
      return muted;
    },
  };
}
