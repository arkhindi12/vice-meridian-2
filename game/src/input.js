// input.js — what is held, what was just pressed, and where the pointer is.
//
// Held keys are read every frame — walk, steer, hold the throttle. A press is queued and consumed
// once, so a car door opens on the key-down and not on every frame the key stays down. The pointer
// is kept in canvas pixels rather than CSS pixels, so the crosshair and the aim ray agree at any
// window size and any page scaling.
//
// Two keys are not about the player at all: M mutes and TAB changes station. They are handled at the
// same place because a staged photograph must be able to leave them alone.

const held = new Set();
const pressed = new Set();
const pointer = { x: 0, y: 0, down: false, inside: false, moved: false };

// Keys the page would otherwise scroll or tab with.
const SWALLOW = new Set(['w', 'a', 's', 'd', 'e', 'r', 'm', 'p', 'j', 'shift', ' ', 'tab', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

const normalise = (e) => (e.key === ' ' ? ' ' : e.key.toLowerCase());

let firstGesture = null;

/** Register the one-shot "the user interacted" callback, used to start audio. */
export function onFirstGesture(fn) {
  firstGesture = fn;
}

/** Bind the keyboard and pointer to a canvas. Safe to call once per page. */
export function attachInput(canvas) {
  window.addEventListener('keydown', (e) => {
    const k = normalise(e);
    if (SWALLOW.has(k)) e.preventDefault();
    if (!held.has(k)) pressed.add(k);
    held.add(k);
    firstGesture?.();
  });
  window.addEventListener('keyup', (e) => {
    held.delete(normalise(e));
  });
  window.addEventListener('blur', () => {
    held.clear();
    pressed.clear();
    pointer.down = false;
  });

  const place = (e) => {
    const box = canvas.getBoundingClientRect();
    const sx = canvas.width / Math.max(1, box.width);
    const sy = canvas.height / Math.max(1, box.height);
    pointer.x = Math.round((e.clientX - box.left) * sx);
    pointer.y = Math.round((e.clientY - box.top) * sy);
    pointer.inside = true;
    pointer.moved = true;
  };
  canvas.addEventListener('pointermove', place);
  canvas.addEventListener('pointerdown', (e) => {
    place(e);
    if (e.button === 0) {
      pointer.down = true;
      pressed.add('fire');
    }
    if (e.button === 2) pressed.add('alt');
    firstGesture?.();
  });
  window.addEventListener('pointerup', (e) => {
    if (e.button === 0) pointer.down = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerleave', () => {
    pointer.inside = false;
  });
}

/** True while any of these keys is down. */
export function keyHeld(...keys) {
  return keys.some((k) => held.has(k));
}

/** True once per key-down, and consumes the press. */
export function keyPressed(...keys) {
  let hit = false;
  for (const k of keys) {
    if (pressed.has(k)) {
      pressed.delete(k);
      hit = true;
    }
  }
  return hit;
}

/** Drop whatever is left of this frame's presses. Called once per simulation step. */
export function endFrame() {
  pressed.clear();
}

/** The pointer, in canvas pixels. */
export function pointerState() {
  return pointer;
}

/**
 * True the first time it is asked after the pointer actually moved, then false. The aim is only
 * resampled on real motion: the camera leans into the aim, so re-deriving the aim from a parked
 * cursor every frame would chase its own tail and walk the player in circles.
 */
export function takePointerMotion() {
  if (!pointer.moved) return false;
  pointer.moved = false;
  return true;
}

/**
 * WASD as a screen-space vector: x right, z down, magnitude capped at one. The caller maps it
 * through the camera onto the ground.
 */
export function moveAxes() {
  let x = 0;
  let z = 0;
  if (keyHeld('w', 'arrowup')) z -= 1;
  if (keyHeld('s', 'arrowdown')) z += 1;
  if (keyHeld('a', 'arrowleft')) x -= 1;
  if (keyHeld('d', 'arrowright')) x += 1;
  const len = Math.hypot(x, z);
  return len > 1 ? { x: x / len, z: z / len, mag: 1 } : { x, z, mag: len };
}
