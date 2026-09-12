import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The public experience's standing bans, as a test rather than as good intentions.
 *
 * Every line here is a ship blocker somewhere in the design documents: tokens only
 * (`LIVETAP_VISUAL_DIRECTION.md` §4.1), no em dash anywhere visible (§7.1), no scroll cue, no
 * section counter, no progress readout, no device the Live surface grammar bans
 * (`LIVETAP_SCROLL_STORY.md` §1.1), and a cue contract only the closing act may hold
 * (Scroll Craft's own devices reference).
 */

const ROOT =
  [join(process.cwd(), 'apps', 'web'), process.cwd()].find((c) =>
    existsSync(join(c, 'index.html')),
  ) ?? process.cwd();

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const css = readFileSync(join(ROOT, 'src', 'landing.css'), 'utf8');
const main = readFileSync(join(ROOT, 'src', 'public', 'main.ts'), 'utf8');
const data = readFileSync(join(ROOT, 'src', 'public', 'data.ts'), 'utf8');

/** Markup with the comments, the sprite and the script tags taken out: what a visitor meets. */
function visibleMarkup(): string {
  const spriteStart = html.indexOf('<svg class="ltp-sprite"');
  const spriteEnd = html.indexOf('</svg>', spriteStart) + 6;
  return (html.slice(0, spriteStart) + html.slice(spriteEnd))
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ');
}

describe('colour comes from tokens, in both themes', () => {
  it('has no raw hex, rgb() or hsl() in the page stylesheet', () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const offences = [
      ...body.matchAll(/#[0-9a-f]{3,8}\b/gi),
      ...body.matchAll(/\b(?:rgba?|hsla?)\(/gi),
    ].map((m) => m[0]);
    expect(offences).toEqual([]);
  });

  it('adds no colour beyond the nine documented derivations and the display face', () => {
    const declared = Array.from(css.matchAll(/^\s{2}(--ltp-[a-z-]+):/gm), (m) => m[1]!);
    expect(new Set(declared)).toEqual(
      new Set([
        '--ltp-font-display',
        '--ltp-edge',
        '--ltp-hair',
        '--ltp-field',
        '--ltp-signal-idle',
        '--ltp-signal-ready',
        '--ltp-signal-live',
        '--ltp-signal-strain',
        '--ltp-atmos',
        '--ltp-carrier',
        '--ltp-rail',
        '--ltp-topbar',
        '--ltp-status',
        '--ltp-band',
        '--ltp-desk',
        '--ltp-col',
        '--ltp-pad',
        '--ltp-overlap',
        '--ltp-z-atmos',
        '--ltp-z-signal',
        '--ltp-z-stage',
        '--ltp-z-dests',
        '--ltp-z-data',
        '--ltp-z-interaction',
        '--ltp-z-acts',
        '--ltp-z-chrome',
      ]),
    );
  });
});

describe('the standing bans hold', () => {
  it('has no em dash in anything a visitor reads or hears', () => {
    /*
     * The ban is on visible copy, which on this page is the markup's text plus the attributes a
     * screen-reader user meets as prose, plus every string literal the page paints from. Source
     * comments are not copy and the rest of the repository punctuates them its own way.
     */
    const markup = visibleMarkup();
    const spoken = Array.from(
      markup.matchAll(/(?:aria-label|alt|title|content)="([^"]*)"/gi),
      (m) => m[1] ?? '',
    );
    const strings = [main, data]
      .map((src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' '))
      .flatMap((src) => src.match(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? []);
    const copy = [markup.replace(/<[^>]*>/g, ' '), ...spoken, ...strings];
    expect(copy.filter((line) => line.includes('—'))).toEqual([]);
  });

  it('animates nothing that triggers layout', () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
    expect(body).not.toMatch(/transition:\s*all/);
    const animated = Array.from(body.matchAll(/transition:\s*([^;]+);/g), (m) => m[1]!);
    for (const decl of animated) {
      expect(decl, decl).not.toMatch(
        /\b(width|height|top|right|bottom|left|inset|margin|padding|gap|aspect-ratio)\b/,
      );
    }
  });

  it('uses no device the Live surface grammar bans', () => {
    const markup = visibleMarkup();
    for (const banned of [
      'data-sc-scrub',
      'data-sc-kinetic',
      'data-sc-spotlight',
      'data-sc-magnet',
      'data-sc-progress',
      'data-sc-sequence',
    ]) {
      expect(markup, banned).not.toContain(banned);
    }
  });

  it('drifts the ground exactly twice', () => {
    expect(Array.from(html.matchAll(/data-sc-drift=/g))).toHaveLength(2);
  });

  it('has no scroll cue, no section counter and no progress readout', () => {
    const text = visibleMarkup()
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ');
    expect(text).not.toMatch(/scroll to explore|scroll down|↓/i);
    expect(text).not.toMatch(/\b0\d\s*\/\s*\d\d\b/);
  });

  it('carries no inline style attribute and no inline stylesheet', () => {
    /* The deployed CSP is `script-src 'self'; style-src 'self'`, so an inline `<style>` block
       would be dropped with no visible error. Custom properties are set from JS instead. */
    expect(html).not.toMatch(/<style[\s>]/);
    expect(html).not.toMatch(/\sstyle="/);
  });

  it('uses no emoji as an icon', () => {
    expect(visibleMarkup()).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('hands the visitor to the real onboarding route', () => {
    expect(html).toContain('href="./app/start"');
    expect(html).toContain('href="./app"');
    expect(html).toContain('https://github.com/BigBackBitcoin/livetap');
  });
});

describe('the score is the one the design documents wrote', () => {
  const acts = Array.from(html.matchAll(/data-sc-act="(\w+)"[^>]*?(?:data-sc-span="([\d.]+)")?/g));

  it('runs eight acts and two declared silences', () => {
    const devices = Array.from(html.matchAll(/data-sc-act="(\w+)"/g), (m) => m[1]!);
    expect(devices).toEqual([
      'pin',
      'flow',
      'pan',
      'pin',
      'flow',
      'pin',
      'flow',
      'pin',
      'flow',
      'pin',
    ]);
    expect(acts.length).toBe(10);
    expect(Array.from(html.matchAll(/data-lt-rest="/g))).toHaveLength(2);
  });

  it('spends 12.8 viewport-heights, with the peak the largest span by a visible margin', () => {
    const spans = Array.from(html.matchAll(/data-sc-span="([\d.]+)"/g), (m) => Number(m[1]));
    expect(spans).toEqual([1.3, 1.6, 1.4, 1.4, 2.8, 1.2]);
    const pinned = spans.reduce((a, b) => a + b, 0);
    /* Plus the two flow acts at 0.9 each and the two silences at 0.7 and 0.6. */
    expect(pinned + 0.9 * 2 + 0.7 + 0.6).toBeCloseTo(12.8, 5);
    const peak = Math.max(...spans);
    const next = spans.filter((s) => s !== peak).sort((a, b) => b - a)[0]!;
    expect(peak / next).toBeGreaterThan(1.7);
  });

  it('lets only the closing act hold its final cue', () => {
    const cues = Array.from(html.matchAll(/data-sc-cue="([^"]+)"/g), (m) => m[1]!);
    const holds = cues.filter((c) => c.trim().split(/\s+/).length === 1);
    expect(holds).toEqual([]);
    /* ACT 8 is the one cue whose window ends at 1 with no ramp out, so the last screen still
       has content on it. Every other cue closes with a window that ends. */
    const closing = cues.filter((c) => c.endsWith('1 0 0'));
    expect(closing).toHaveLength(1);
  });

  it('uses the page-only iris exactly once', () => {
    expect(Array.from(html.matchAll(/data-sc-reveal="iris"/g))).toHaveLength(1);
    expect(Array.from(html.matchAll(/data-sc-reveal="/g))).toHaveLength(1);
  });

  it('counts only numbers the visitor produced', () => {
    const counters = Array.from(html.matchAll(/data-sc-count="([^"]+)"/g), (m) => m[1]!);
    expect(counters).toHaveLength(2);
    /* Both start at zero and are re-targeted from the visitor's own picks at runtime, so a
       hard-coded target here would be an invented statistic. */
    for (const c of counters) expect(c).toBe('0 0');
  });
});
