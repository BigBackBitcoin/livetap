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
        '--ltp-band-hero',
        '--ltp-desk',
        '--ltp-desk-pro',
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

  it('never drifts the ground: the picture is the drama, the ground stays still', () => {
    expect(Array.from(html.matchAll(/data-sc-drift=/g))).toHaveLength(0);
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

/*
 * WHAT REPLACED THE SCROLL SCORE.
 *
 * The block that stood here asserted the landing ran ten acts across 12.6 viewport-heights in a
 * fixed device sequence. It was an accurate description of a page that had 1,249 visible words, a
 * main thread too busy to accept a script injection inside five seconds, and two of the eight
 * campaign assets in use. The owner's verdict was "too much words everywhere, looks tacky", and
 * the test was the reason it never shrank: it pinned the shape in place.
 *
 * These assert the properties that were actually wanted instead of the shape that was built.
 */
describe('the landing stays a landing', () => {
  /** Visible copy: comments, scripts, styles and inline SVG removed. */
  const visibleWords = (): string[] => {
    const text = html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|svg)[\s\S]*?<\/>/gi, ' ')
      .replace(/<[^>]*>/g, ' ');
    return text.split(/\s+/).filter(Boolean);
  };

  /*
   * THE BUDGET IS THE POINT. A landing page's job is to make somebody tap through, and 1,249
   * words is what it looks like when a page tries to be the product instead. The number is
   * generous on purpose: this fails on a regression, not on an edit.
   */
  it('says what it needs in under 250 visible words', () => {
    const words = visibleWords();
    expect(words.length).toBeLessThan(250);
    expect(words.length, 'the page lost its copy entirely').toBeGreaterThan(80);
  });

  it('leads with the film rather than describing it', () => {
    expect(html).toMatch(/<video[^>]*class="lt-hero__film"/);
    expect(html).toContain('/brand/creator.webm');
    expect(html).toContain('/brand/creator.mp4');
    /* A poster is what decides whether the first frame is the page or a black rectangle. */
    expect(html).toMatch(/class="lt-hero__film"[\s\S]*?poster="\/brand\/creator\.webp"/);
  });

  /*
   * An autoplaying video without `muted` never starts, and without `playsinline` iOS takes it
   * fullscreen and throws the visitor out of the page on arrival. Both are silent failures on the
   * exact devices least likely to be tested here.
   */
  it('never autoplays a film that a phone would refuse or hijack', () => {
    const films = Array.from(html.matchAll(/<video[\s\S]*?>/g), (m) => m[0]);
    expect(films.length).toBeGreaterThan(0);
    for (const film of films.filter((f) => f.includes('autoplay'))) {
      expect(film, 'an autoplaying film is missing muted').toContain('muted');
      expect(film, 'an autoplaying film is missing playsinline').toContain('playsinline');
    }
  });

  /* A reference to an asset that is not there ships a broken picture, and nothing else notices. */
  it('references no brand asset that does not exist', () => {
    const refs = [...new Set(Array.from(html.matchAll(/\/brand\/([\w.-]+)/g), (m) => m[1]!))];
    expect(refs.length).toBeGreaterThan(3);
    const missing = refs.filter((f) => !existsSync(join(ROOT, 'public', 'brand', f)));
    expect(missing).toEqual([]);
  });

  /*
   * The two honesty sentences are injected into these markers at build time by `demoHonesty` in
   * vite.config.ts. Losing a marker does not break the build; it silently removes the page's only
   * statement that the hosted build broadcasts nowhere.
   */
  it('keeps both markers the demo honesty is injected into', () => {
    expect(html).toContain('<!--lt:demo-hero-->');
    expect(html).toContain('<!--lt:demo-browser-->');
  });
});
