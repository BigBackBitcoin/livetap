import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Simple mode never shows a protocol word (PRODUCT_SPEC §6.2, DESIGN_SYSTEM §0 rule 1).
 *
 * This is a static guard over the *strings LIVETAP ships in its UI*, so it scans quoted string
 * literals in `.tsx` files plus the copy module. Identifiers are deliberately not scanned:
 * `sourceId`, `MediaSource` and `srcObject` are code, and renaming them would make the codebase
 * worse without making the product more honest.
 *
 * Three paths are exempt, each for a stated reason:
 *  - `src/screens/pro/**` — Pro mode is where the protocol vocabulary is *supposed* to live.
 *  - `src/components/StreamKeyForm.tsx` — the paste-a-key flow is the one place the platform's
 *    own vocabulary is required, because the user is copying two labelled fields off the
 *    platform's own page and has to recognise them. PRODUCT_SPEC §6.2 permits "stream key" for
 *    exactly this reason, and an address error that cannot name the scheme cannot be acted on.
 *  - `src/__tests__/**` — the tests have to write the forbidden words down to forbid them.
 *
 * The stronger guarantee is the E2E one: `e2e/golden-path.spec.ts` scans the rendered DOM of
 * every screen on the path from `/app` to LIVE and fails on any of these words.
 */
/**
 * `import.meta.url` is rewritten to an http URL under happy-dom, so the source tree is located
 * from the working directory instead. Both entry points are covered: the repo root and
 * `apps/web` itself. If neither resolves, the first test below fails loudly rather than
 * silently scanning nothing.
 */
const SRC =
  [join(process.cwd(), 'apps', 'web', 'src'), join(process.cwd(), 'src')].find((candidate) =>
    existsSync(join(candidate, 'screens')),
  ) ?? join(process.cwd(), 'src');

const EXEMPT = [
  join('screens', 'pro') + sep,
  join('components', 'StreamKeyForm.tsx'),
  '__tests__' + sep,
];

/**
 * The words a Simple-mode user must never meet.
 *
 * `encoder`, `encoding`, `mock` and `simulated engine` were added after a product review found
 * all four shipping in Simple mode — "MOCK PREVIEW" over the preview, "Health appears once the
 * encoder starts sending" under it, a "Mock" badge on every platform, and an error card
 * recommending "Software encoding". Not one was caught, because the guard did not look for them.
 */
const BANNED =
  /\b(rtmps?|srt|whip|ingest|cbr|vbr|rate control|keyframe|gop|bitrate|kbps|codec|h\.?264|hevc|av1|nvenc|qsv|videotoolbox|x264|encoders?|encoding|mocks?|simulated engine|muxing|transcod\w*|scenes?|sources?|scene collection|z-order|compositor|oauth|refresh token|webhook|rtt|dropped frames|skipped frames|lagged frames|remux)\b/i;

/** Matches single-quoted, double-quoted and backtick string literals. */
const STRING_LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

/**
 * Addresses are not copy. A route path, an API endpoint, a storage key and a module specifier
 * all have to be spelled the way the machine expects and none of them is ever read by a user.
 * Anything with a space in it is prose and is always scanned.
 */
function isAddress(literal: string): boolean {
  const body = literal.slice(1, -1);
  if (/\s/.test(body)) return false;
  return (
    body.startsWith('/') ||
    body.startsWith('.') ||
    body.includes('://') ||
    /^[a-z0-9@][a-z0-9@/._-]*$/i.test(body)
  );
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.tsx') || full.endsWith(join('lib', 'copy.ts'))) out.push(full);
  }
  return out;
}

describe('no OBS vocabulary in Simple-mode UI strings', () => {
  it('scans a meaningful number of files, so a broken glob cannot pass silently', () => {
    const files = walk(SRC).filter((f) => !EXEMPT.some((e) => f.includes(e)));
    expect(files.length).toBeGreaterThan(10);
  });

  it('finds no banned protocol vocabulary outside Pro mode and the paste-key flow', () => {
    const offences: string[] = [];
    for (const file of walk(SRC)) {
      if (EXEMPT.some((exempt) => file.includes(exempt))) continue;
      const source = readFileSync(file, 'utf8');
      for (const literal of source.match(STRING_LITERAL) ?? []) {
        if (isAddress(literal)) continue;
        const match = BANNED.exec(literal);
        if (match) {
          offences.push(`${relative(SRC, file)}: ${match[0]} in ${literal.slice(0, 90)}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });
});
