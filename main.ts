// main.ts — the hand-in for Vice Meridian II.
//
// A gta6-01 entry is one output directory holding three things: game/ (the playable static game),
// screenshots/ (three or four renders, the first by name the cover) and dossier.json (the summary
// the judge reads, produced by the vendored make.fun library from exactly those two trees). This
// program writes all three, or refuses and says why.
//
// The shape of the run is: read every input, copy the trees, then build the dossier from the staged
// copy. Nothing is written until everything has been checked, so a refusal never leaves a
// half-written entry behind. Each check throws a HandInError naming the offender — the file, its
// size, the cap — and one catch at the bottom prints it and sets a non-zero exit code, because an
// entry that cannot be handed in must not look like one that can.
//
// Two choices are deliberate:
//
//   * The dossier is built from the copy under the output directory, never from the source tree.
//     The grader reads the copy, so the dossier must describe the files that actually sit beside it.
//   * The summary's numbers are measured after the copy — readGameTree on the staged tree, statSync
//     on the written dossier — rather than counted by hand along the way. A copy that quietly
//     dropped a file would then show up in the numbers instead of passing unnoticed.
//
// Usage, from the repository root:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// MAKEFUN_OUTPUT_DIR defaults to /output, where the bounty's container mounts it. To play the game
// itself, run `node serve.ts` and open http://localhost:8080.

import { copyFileSync, cpSync, existsSync, mkdirSync, openSync, readSync, closeSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier, DossierError, readGameTree } from './vendor/makefun-game.ts';

// The scorer's caps, passed through unchanged. Only text_max_bytes shapes the dossier's bytes; the
// rest are here so this program refuses an entry the scorer would refuse, before writing anything.
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

const MAX_SHOTS = CAPS.screenshots.max;
const SHOT_BYTES = CAPS.screenshots.max_bytes;

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const GAME_SRC = join(ROOT, 'game');
const SHOTS_SRC = join(ROOT, 'screenshots');
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** A hand-in that cannot be built, with a message written for the person who ran it. */
class HandInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandInError';
  }
}

const kib = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- reading the inputs

/**
 * The screenshots to hand in, in name order, the first being the cover.
 *
 * Refuses: no directory, an empty one, more than the cap, a file that is empty, a file that is not a
 * PNG or JPEG by its magic number, and a file over the byte cap. Every message names the file and
 * the size, because "a screenshot is too big" is not something a person can act on.
 */
function collectScreenshots(): string[] {
  if (!existsSync(SHOTS_SRC)) {
    throw new HandInError(`screenshots/: no such directory (${SHOTS_SRC}) — an entry hands in its renders of the game beside it, the first by name the cover`);
  }
  if (!statSync(SHOTS_SRC).isDirectory()) {
    throw new HandInError(`screenshots/: not a directory (${SHOTS_SRC}) — put the renders back in it`);
  }

  const names = readdirSync(SHOTS_SRC, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort(cmp);

  if (names.length === 0) {
    throw new HandInError('screenshots/: holds no image — the first render by name is the cover, and a dossier with no pictures is not an entry');
  }
  if (names.length > MAX_SHOTS) {
    throw new HandInError(
      `screenshots/: holds ${count(names.length, 'image', 'images')} (${names.join(', ')}), over the ${MAX_SHOTS} a dossier may carry — remove the extras`,
    );
  }

  for (const name of names) {
    const path = join(SHOTS_SRC, name);
    const size = statSync(path).size;
    if (size === 0) {
      throw new HandInError(`screenshots/${name}: empty, 0 bytes — a screenshot is a PNG or JPEG render`);
    }
    if (size > SHOT_BYTES) {
      throw new HandInError(`screenshots/${name}: ${size} bytes (${kib(size)}), over the ${SHOT_BYTES}-byte (256 KiB) cap — re-encode it smaller`);
    }
    if (!looksLikeImage(path)) {
      throw new HandInError(`screenshots/${name}: neither PNG nor JPEG by its first bytes — the dossier only accepts those two`);
    }
  }
  return names;
}

/**
 * True when the file opens with PNG's or JPEG's magic number. Three bytes is all it takes to tell a
 * real render from a truncated file or a text file with the right name, and reading three bytes is
 * cheaper than loading a megabyte of JPEG to find out.
 */
function looksLikeImage(path: string): boolean {
  const head = Buffer.alloc(3);
  const fd = openSync(path, 'r');
  try {
    if (readSync(fd, head, 0, 3, 0) < 3) return false;
  } finally {
    closeSync(fd);
  }
  const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e;
  const jpg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  return png || jpg;
}

/**
 * Refuse a game/ that is not there, has no page, or would not survive the caps; return its measured
 * tree. readGameTree also rejects a symbolic link, too many entries, too many bytes and too long a
 * path, so a tree the scorer would bounce stops here instead of later.
 */
function inspectGame(): { files: { path: string }[]; totalBytes: number; count: number } {
  if (!existsSync(GAME_SRC) || !statSync(GAME_SRC).isDirectory()) {
    throw new HandInError(`game/: no such directory (${GAME_SRC}) — the entry is game/index.html and its files, beside this program`);
  }
  const page = join(GAME_SRC, 'index.html');
  if (!existsSync(page) || !statSync(page).isFile()) {
    throw new HandInError('game/index.html: missing — a game is a directory of static files with its page at the root, and there would be nothing for the judge to open');
  }
  const tree = readGameTree(GAME_SRC, CAPS);
  if (tree.files.length === 0) throw new HandInError('game/: holds no files — the tree is there but empty');
  if (!tree.files.some((file) => file.path === 'index.html')) {
    throw new HandInError('game/index.html: not among the files the tree lists — the page must be a plain file at the root of game/');
  }
  // A vendored three.js is the only library this game needs, and a game without it renders nothing.
  if (!tree.files.some((file) => file.path === 'vendor/three/three.module.min.js')) {
    throw new HandInError('game/vendor/three/three.module.min.js: missing — the game imports three.js from there and would not start');
  }
  return tree;
}

// ---------------------------------------------------------------- writing the output

/**
 * Write the output directory from scratch: the two trees and nothing else. A leftover file from an
 * earlier run would otherwise be copied into the dossier as though this run had produced it.
 */
function stage(shots: string[]): void {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const stale of ['game', 'screenshots', 'dossier.json']) {
    rmSync(join(OUT_DIR, stale), { recursive: true, force: true });
  }
  try {
    cpSync(GAME_SRC, join(OUT_DIR, 'game'), { recursive: true, dereference: false, errorOnExist: false });
    mkdirSync(join(OUT_DIR, 'screenshots'), { recursive: true });
    for (const name of shots) copyFileSync(join(SHOTS_SRC, name), join(OUT_DIR, 'screenshots', name));
  } catch (err) {
    throw new HandInError(`copying the entry into ${OUT_DIR} failed (${(err as Error).message})`);
  }
  if (!existsSync(join(OUT_DIR, 'game', 'index.html'))) {
    throw new HandInError(`the copy in ${OUT_DIR}/game has no index.html — the copy did not land where it should`);
  }
  // A symlink in the staged tree is refused by the scorer, so it is caught here where the message can
  // name the file rather than surfacing later as a generic cap failure.
  const staged = readGameTree(join(OUT_DIR, 'game'), CAPS);
  if (staged.files.length !== readGameTree(GAME_SRC, CAPS).files.length) {
    throw new HandInError(`the copy in ${OUT_DIR}/game holds ${staged.files.length} files against the source's — the copy lost something`);
  }
}

/** Build the dossier from the staged copy, write it, and print what was handed in. */
function finish(shots: string[]): void {
  let dossier: Uint8Array;
  try {
    dossier = buildDossier(OUT_DIR, CAPS);
  } catch (err) {
    if (err instanceof DossierError) throw new HandInError(`dossier: ${err.message}`);
    throw err;
  }
  const dossierPath = join(OUT_DIR, 'dossier.json');
  writeFileSync(dossierPath, dossier);
  const written = statSync(dossierPath).size;
  if (written !== dossier.length) {
    throw new HandInError(`dossier.json: wrote ${written} bytes but built ${dossier.length} — the output directory is not behaving`);
  }
  if (written > 1.5 * 1024 * 1024) {
    throw new HandInError(`dossier.json: ${written} bytes, larger than the 1.5 MiB this entry budgets for it`);
  }

  const stagedGame = readGameTree(join(OUT_DIR, 'game'), CAPS);
  const shotBytes = shots.reduce((sum, name) => sum + statSync(join(OUT_DIR, 'screenshots', name)).size, 0);

  console.log(`hand-in written to ${OUT_DIR}`);
  console.log(`  game/         ${count(stagedGame.files.length, 'file', 'files')}, ${stagedGame.totalBytes} bytes (${kib(stagedGame.totalBytes)})`);
  console.log(`  screenshots/  ${count(shots.length, 'file', 'files')}, ${shotBytes} bytes (${kib(shotBytes)}): ${shots.join(', ')}`);
  console.log(`  dossier.json  ${written} bytes (${kib(written)})`);
}

// ---------------------------------------------------------------- the run

function main(): void {
  const shots = collectScreenshots();
  inspectGame();
  stage(shots);
  finish(shots);
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`hand-in failed: ${message}`);
  process.exitCode = 1;
}
