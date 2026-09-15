#!/usr/bin/env node
/**
 * A/B the compositor against itself, interleaved, on a machine that is busy with other things.
 *
 * This exists because of a specific way of being wrong. The first "after" measurement taken on
 * this host came back at 11.8 fps against a 16.3 fps "before", which reads as a 28% regression and
 * was nothing of the kind: seven other builds were running, the CPU was pegged at 100%, and the
 * same unchanged build measured 16.3, 18.4 and 21.6 fps on three consecutive runs. A single
 * before/after pair on a contended machine is not evidence in either direction - it is a coin
 * flip that will happily confirm whatever you were hoping for.
 *
 * So: build A, measure A, build B, measure B, repeat. Interleaving is the point. Whatever else the
 * host is doing drifts over minutes, and alternating puts that drift into BOTH samples instead of
 * into whichever one happened to run while a test suite was compiling. The report quotes medians,
 * and it quotes the spread beside them, so a difference smaller than the noise is visible as such
 * rather than rounded into a claim.
 *
 * "A" is whatever the named files contain at HEAD; "B" is whatever is in the working tree now.
 * The working tree is restored on the way out, including after a crash or a Ctrl-C.
 *
 *   node apps/web/scripts/perf-ab.mjs
 *   node apps/web/scripts/perf-ab.mjs --reps=4 --seconds=10
 *   node apps/web/scripts/perf-ab.mjs --files=packages/media/src/compositor/MomentCompositor.ts
 *
 * Exit 0 always: this is an instrument, not a gate. `perf-studio.mjs` is the gate.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const reps = Number(arg('reps', 3));
const seconds = Number(arg('seconds', 8));
const extra = arg('extra', '');
const FILES = arg(
  'files',
  'packages/media/src/compositor/MomentCompositor.ts,packages/media/src/compositor/types.ts',
)
  .split(',')
  .map((f) => f.trim())
  .filter(Boolean);

const work = path.join(repoRoot, '.scratch', 'perf-ab');
fs.mkdirSync(work, { recursive: true });

const slug = (f) => f.replace(/[\\/]/g, '__');

/** The working-tree version of each file, kept so an interrupted run cannot lose the change. */
function snapshotWorkingTree() {
  for (const file of FILES) {
    fs.copyFileSync(path.join(repoRoot, file), path.join(work, `B__${slug(file)}`));
  }
}

/** The HEAD version of each file, which is the baseline being compared against. */
function snapshotHead() {
  for (const file of FILES) {
    const content = execFileSync('git', ['show', `HEAD:${file}`], { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 });
    fs.writeFileSync(path.join(work, `A__${slug(file)}`), content);
  }
}

function install(which) {
  for (const file of FILES) {
    fs.copyFileSync(path.join(work, `${which}__${slug(file)}`), path.join(repoRoot, file));
  }
}

function build() {
  const r = spawnSync('npm', ['run', 'build', '-w', '@livetap/desktop'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    throw new Error(`desktop build failed:\n${(r.stderr || r.stdout || '').slice(-3000)}`);
  }
}

/** One measurement, parsed out of perf-studio's own JSON rather than re-derived from its text. */
function measure(tag) {
  const out = path.join(work, `${tag}.json`);
  const args = ['apps/web/scripts/perf-studio.mjs', `--seconds=${seconds}`, `--label=${tag}`, `--json=.scratch/perf-ab/${tag}.json`];
  if (extra) args.push(...extra.split(' ').filter(Boolean));
  const r = spawnSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8' });
  if (!fs.existsSync(out)) {
    process.stdout.write(`      no measurement (${(r.stdout || r.stderr || '').trim().split('\n').slice(-3).join(' | ')})\n`);
    return null;
  }
  const json = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.rmSync(out, { force: true });
  return json;
}

/** Kill anything left over, so one run's orphans cannot composite video during the next one. */
function reapElectron() {
  if (process.platform !== 'win32') return;
  spawnSync('taskkill', ['/F', '/IM', 'electron.exe'], { stdio: 'ignore' });
}

const median = (xs) => {
  if (xs.length === 0) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const spread = (xs) => (xs.length ? `${Math.min(...xs).toFixed(2)}..${Math.max(...xs).toFixed(2)}` : '-');

function main() {
  snapshotWorkingTree();
  snapshotHead();

  const samples = { A: [], B: [] };
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    install('B');
  };
  process.on('exit', restore);
  process.on('SIGINT', () => {
    restore();
    process.exit(130);
  });

  try {
    for (let rep = 1; rep <= reps; rep += 1) {
      for (const which of ['A', 'B']) {
        const tag = `${which}${rep}`;
        process.stdout.write(`  [${tag}] ${which === 'A' ? 'HEAD' : 'working tree'} ... `);
        reapElectron();
        install(which);
        build();
        const result = measure(tag);
        if (result) {
          samples[which].push(result);
          process.stdout.write(
            `${result.fps.toFixed(1)} fps of ${result.ceilingFps.toFixed(1)} (${(result.fractionOfCeiling * 100).toFixed(0)}%), ${result.medianMsPerDraw.toFixed(2)} ms/copy\n`,
          );
        }
      }
    }
  } finally {
    restore();
    reapElectron();
  }

  const pull = (which, key) => samples[which].map((s) => s[key]).filter((n) => Number.isFinite(n));
  const row = (name, key, unit, better) => {
    const a = pull('A', key);
    const b = pull('B', key);
    if (a.length === 0 || b.length === 0) return;
    const ma = median(a);
    const mb = median(b);
    const change = ma === 0 ? 0 : ((mb - ma) / ma) * 100;
    const direction = better === 'higher' ? change : -change;
    const verdict = Math.abs(change) < 5 ? 'no measurable change' : direction > 0 ? 'BETTER' : 'WORSE';
    console.log(
      `  ${name.padEnd(22)} ${ma.toFixed(2).padStart(9)} ${mb.toFixed(2).padStart(9)} ${unit.padEnd(8)} ${`${change >= 0 ? '+' : ''}${change.toFixed(1)}%`.padStart(8)}  ${verdict}`,
    );
    console.log(`  ${''.padEnd(22)} ${spread(a).padStart(9)} ${spread(b).padStart(9)} ${'(spread)'.padEnd(8)}`);
  };

  console.log('');
  console.log(`  ${reps} interleaved pairs, medians. A = HEAD, B = working tree.`);
  console.log(`  ${''.padEnd(22)} ${'A'.padStart(9)} ${'B'.padStart(9)}`);
  console.log('  ---------------------------------------------------------------------------');
  row('cost per copy', 'medianMsPerDraw', 'ms', 'lower');
  row('drawImage share', 'drawBusyFraction', 'of 1', 'lower');
  row('frame rate', 'fps', 'fps', 'higher');
  row('share of ceiling', 'fractionOfCeiling', 'of 1', 'higher');
  row('copies per second', 'drawsPerSecond', '/s', 'higher');
  row('longest task', 'longestTaskMs', 'ms', 'lower');
  row('machine ceiling', 'ceilingFps', 'fps', 'higher');
  console.log('');
  console.log('  "machine ceiling" is the control: if it moved, the HOST changed between the two');
  console.log('  halves and every other row in this table is worth correspondingly less.');
  console.log('');
}

main();
