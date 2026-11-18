// save.js — the run, remembered.
//
// One key in localStorage holds the mission chain, the cash banked, the respect earned and the ids
// already passed. It is read once at boot and written after every mission, every purchase and every
// arrest, so closing the tab loses a shootout and not a career.
//
// A save is a user-editable text file sitting in a browser, so loading clamps everything: an index
// past the end of the chain, a negative bank balance, a respect figure a lifetime could not earn.
// Nothing here trusts the file it reads.

const STORE_KEY = 'vice-meridian/career/v3';

/**
 * Remember the story. Storage can refuse — a private window, a full quota — and the run simply is
 * not remembered, which is not worth an exception.
 */
export function remember(story) {
  try {
    window.localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        index: story.index,
        done: story.done,
        cash: story.cash,
        respect: Math.round(story.respect),
        passed: story.passed,
        day: story.day,
        clock: Math.round(story.clock),
      }),
    );
  } catch {
    // Nothing to do: the game carries on from memory.
  }
}

/** Fold a saved run back into a fresh story. Returns true when there was one worth resuming. */
export function recall(story, missionCount) {
  let raw = null;
  try {
    raw = window.localStorage.getItem(STORE_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    const index = Math.max(0, Math.min(missionCount, Math.floor(Number(data.index) || 0)));
    story.index = index;
    story.done = Math.max(0, Math.min(index, Math.floor(Number(data.done) || index)));
    story.cash = Math.max(0, Math.min(1e7, Math.floor(Number(data.cash) || 0)));
    story.respect = Math.max(0, Math.min(1e6, Math.floor(Number(data.respect) || 0)));
    story.passed = Array.isArray(data.passed) ? data.passed.slice(0, missionCount).map(String) : [];
    story.day = Math.max(1, Math.min(999, Math.floor(Number(data.day) || 1)));
    story.clock = Math.max(0, Math.min(1439, Number(data.clock) || story.clock));
    return index > 0;
  } catch {
    return false;
  }
}

/** Forget the run, so the title card offers a clean town. */
export function forget() {
  try {
    window.localStorage.removeItem(STORE_KEY);
  } catch {
    // As above.
  }
}

export { STORE_KEY };
