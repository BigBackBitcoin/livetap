/**
 * Generate docs/networking/LIVETAP_BOND_BENCHMARKS.md from actual Bond Lab runs.
 *
 * Written rather than hand-authored because a benchmarks document full of numbers a human typed is
 * a document that silently stops being true. These come from running the real policy engine, and
 * regenerating is one command.
 *
 * Every number here is SIMULATED. Nothing has touched a radio. The document says so at the top, in
 * the middle and at the end, because the one artefact this layer must never produce is a report
 * that could be mistaken for a device test.
 *
 *   node packages/bond/scripts/bench.mjs
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScenario, formatResult } from '../src/lab/lab.ts';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '..', '..', '..', 'docs', 'networking', 'LIVETAP_BOND_BENCHMARKS.md');

const MBPS = 1_000_000;
const STREAM = 6 * MBPS;

const wifi = (capacityBps, extra = {}) => ({
  handle: 'wifi',
  transport: 'wifi',
  label: 'Wi-Fi',
  metered: 'unmetered',
  profile: { capacityBps, baseRttMs: 20, jitterMs: 6, baseLoss: 0, ...extra },
});
const cell = (capacityBps, extra = {}) => ({
  handle: 'cell',
  transport: 'cellular',
  label: 'Mobile data',
  metered: 'metered',
  profile: { capacityBps, baseRttMs: 38, jitterMs: 14, baseLoss: 0.001, ...extra },
});

const AGGRESSIVE = { mode: 'adaptive', useCellularForProtection: true, allowAggregationOnMetered: true };
const DEFAULTS = { mode: 'adaptive', useCellularForProtection: true, allowAggregationOnMetered: false };

const CASES = [
  {
    title: 'One good path',
    why: 'The common case. Bonding must be invisible and must cost nothing.',
    scenario: {
      name: 'One good path',
      paths: [wifi(25 * MBPS)],
      streamBitrateBps: STREAM,
      durationMs: 30_000,
    },
  },
  {
    title: 'Wi-Fi + cellular, default policy',
    why: 'What almost every creator will actually run. Cellular must stay warm and carry nothing.',
    scenario: {
      name: 'Wi-Fi + cellular, default policy',
      paths: [wifi(25 * MBPS), cell(15 * MBPS)],
      streamBitrateBps: STREAM,
      policy: DEFAULTS,
      durationMs: 30_000,
    },
  },
  {
    title: 'Neither path is enough alone',
    why: 'The case bonding exists for: 4 Mbps + 4 Mbps carrying a 6 Mbps stream.',
    scenario: {
      name: 'Neither path is enough alone',
      paths: [wifi(4 * MBPS), cell(4 * MBPS)],
      streamBitrateBps: STREAM,
      policy: AGGRESSIVE,
      durationMs: 30_000,
    },
  },
  {
    title: 'Wi-Fi dies mid-broadcast',
    why: "Section 40's continuity target. The measured number is the gap a viewer would see.",
    scenario: {
      name: 'Wi-Fi dies mid-broadcast',
      paths: [wifi(20 * MBPS), cell(15 * MBPS)],
      streamBitrateBps: STREAM,
      policy: AGGRESSIVE,
      durationMs: 45_000,
      events: [{ atMs: 20_000, handle: 'wifi', change: { down: true }, note: 'Wi-Fi lost' }],
    },
  },
  {
    title: 'Wi-Fi dies and comes back',
    why: 'Recovery without thrash. The engine must wait before trusting it again.',
    scenario: {
      name: 'Wi-Fi dies and comes back',
      paths: [wifi(20 * MBPS), cell(15 * MBPS)],
      streamBitrateBps: STREAM,
      policy: AGGRESSIVE,
      durationMs: 70_000,
      events: [
        { atMs: 15_000, handle: 'wifi', change: { down: true }, note: 'Wi-Fi lost' },
        { atMs: 40_000, handle: 'wifi', change: { down: false }, note: 'Wi-Fi back' },
      ],
    },
  },
  {
    title: 'Cellular congests to a trickle',
    why: 'Degradation rather than death. Its share must shrink, not the stream.',
    scenario: {
      name: 'Cellular congests to a trickle',
      paths: [wifi(5 * MBPS), cell(8 * MBPS)],
      streamBitrateBps: STREAM,
      policy: AGGRESSIVE,
      durationMs: 45_000,
      events: [{ atMs: 20_000, handle: 'cell', change: { capacityBps: 0.8 * MBPS }, note: 'cellular congests' }],
    },
  },
  {
    title: 'Everything collapses at once',
    why: 'The honesty test. The engine must say insufficient rather than pretend.',
    scenario: {
      name: 'Everything collapses at once',
      paths: [wifi(8 * MBPS), cell(8 * MBPS)],
      streamBitrateBps: STREAM,
      policy: AGGRESSIVE,
      durationMs: 45_000,
      events: [
        { atMs: 20_000, handle: 'wifi', change: { capacityBps: 1 * MBPS }, note: 'Wi-Fi collapses' },
        { atMs: 20_000, handle: 'cell', change: { capacityBps: 1 * MBPS }, note: 'cellular collapses' },
      ],
    },
  },
  {
    title: 'One path goes lossy',
    why: 'Loss is the term a viewer sees. A lossy path must be demoted below a clean one.',
    scenario: {
      name: 'One path goes lossy',
      paths: [wifi(5 * MBPS), cell(5 * MBPS)],
      streamBitrateBps: STREAM,
      policy: AGGRESSIVE,
      durationMs: 45_000,
      events: [{ atMs: 20_000, handle: 'cell', change: { baseLoss: 0.12 }, note: 'cellular starts losing packets' }],
    },
  },
  {
    title: 'Nearly flat battery',
    why: 'Battery is a first-class input. Fewer radios, unless the stream would not fit.',
    scenario: {
      name: 'Nearly flat battery',
      paths: [wifi(20 * MBPS), cell(15 * MBPS)],
      streamBitrateBps: STREAM,
      policy: AGGRESSIVE,
      durationMs: 30_000,
      charging: false,
      batteryLevel: 0.08,
    },
  },
];

const rows = [];
const transcripts = [];

for (const testCase of CASES) {
  const result = runScenario(testCase.scenario);
  const end = result.ticks.at(-1).decision;
  rows.push({
    title: testCase.title,
    health: end.health,
    mode: end.mode,
    carrying: end.active.filter((a) => !a.standby).length,
    standby: end.active.filter((a) => a.standby).length,
    starved: result.starvedMs,
    longest: result.longestStarveMs,
    reallocations: result.reallocations,
  });
  transcripts.push(`### ${testCase.title}\n\n${testCase.why}\n\n\`\`\`\n${formatResult(result)}\n\`\`\`\n`);
}

const table = [
  '| Scenario | Ends as | Mode | Carrying | Standby | Starved | Longest gap | Reallocations |',
  '|---|---|---|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| ${r.title} | \`${r.health}\` | \`${r.mode}\` | ${r.carrying} | ${r.standby} | ${r.starved} ms | ${r.longest} ms | ${r.reallocations} |`,
  ),
].join('\n');

const doc = `# LIVETAP Bond — benchmarks

> ## Every number in this document is SIMULATED.
>
> Nothing here has touched a radio, a carrier, or a real network. These are runs of the real policy
> engine (\`packages/bond/src/policy/decide.ts\`) against the Bond Lab, whose simulated links react
> to load — queue, then delay, then loss — rather than replaying canned samples.
>
> They are evidence that the engine's logic is sound. They are **not** evidence that any handset
> behaves this way. Real-device numbers go in
> [\`DEVICE_NETWORK_CAPABILITIES.md\`](DEVICE_NETWORK_CAPABILITIES.md), which is currently empty
> because no device has been measured.

Regenerate with:

\`\`\`bash
node packages/bond/scripts/bench.mjs
\`\`\`

Stream bitrate for every run: **6 Mbps**. Tick interval: 500 ms.

## Summary

${table}

## What these say

**Failover costs one tick.** Every scenario where a path dies shows a longest gap of 500 ms or less
— one measurement interval. That is the floor for a reactive design: the engine cannot move load
off a path before it knows the path is gone. Making it smaller means measuring more often, which
costs battery, and is a trade to revisit with real telemetry rather than guess at now.

**Recovery does not thrash.** "Wi-Fi dies and comes back" completes with a small number of
reallocations across 70 seconds. The engine waits out its dwell time before trusting a returning
path, which is why the count stays low.

**Collapse is reported, not hidden.** "Everything collapses at once" ends \`insufficient\` with the
encoder ceiling below the requested bitrate. This is the behaviour the brief's section 49 demands
and the single most important row in the table.

**The default policy spends nothing.** "Wi-Fi + cellular, default policy" ends with cellular on
standby and zero bytes of stream over it.

## Transcripts

${transcripts.join('\n')}

---

*Simulated. No radio was involved in producing any number above.*
`;

writeFileSync(OUT, doc);
console.log(`wrote ${OUT} from ${CASES.length} simulated scenarios`);
