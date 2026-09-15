/**
 * The scales are a contract too.
 *
 * `type-roles.test.ts` already stops a fourth font weight from creeping back. This is the same
 * idea for the three scales that decide how a screen *measures*: spacing, control height and
 * icon size. They are here because every one of them had already drifted, and none of the drift
 * was visible in a diff — only in a screenshot, which is exactly the kind of rule that comes
 * back the moment nobody is looking at screenshots.
 *
 * What the product actually measured before this test existed, at 1440x900 and at 390x844:
 *
 *   control heights   36 / 44 / 52 declared; 26, 32, 34, 44, 56 and 64 rendered. A row holding
 *                     a select (44), a switch (26) and a health pill (34) had three baselines.
 *   card padding      20 in `Card`, 16 in the device cards, 16 in the dock's tab panel.
 *   icon size         one size, 24px, everywhere — including beside 13px type — because
 *                     `.lt-icon` set `inline-size` from a token and CSS beats the `width`
 *                     attribute the `size` prop writes. Twelve call sites asked for 20 and got
 *                     24, and one component carried a hand-written class to work around it.
 *
 * The sheets are parsed as text on purpose: this runs in node with no DOM, and what matters is
 * what the file declares, which is what ships.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Found from the working directory rather than from `import.meta.url`, for the same reason
 * `type-roles.test.ts` does it: vitest may root the run at the repo or at this package.
 */
function sheet(...candidates: string[]): { path: string; css: string } {
  const found = candidates.map((c) => resolve(process.cwd(), c)).find((c) => existsSync(c));
  if (!found) throw new Error(`none of ${candidates.join(', ')} found from ${process.cwd()}`);
  return { path: found, css: readFileSync(found, 'utf8') };
}

const tokens = sheet('packages/ui/src/tokens.css', 'src/tokens.css');
const components = sheet('packages/ui/src/components.css', 'src/components.css');
const global = sheet('packages/ui/src/global.css', 'src/global.css');
const icons = sheet('packages/ui/src/components/Icons.tsx', 'src/components/Icons.tsx');

/*
 * The application's sheet is asserted from here as well.
 *
 * A design system that is only obeyed inside its own package is not a design system — the
 * padding that disagreed with `Card` was in `app.css`, not in `components.css`. `tour.css` is
 * included for the same reason: a new surface is exactly where a fresh literal gets typed.
 */
const app = sheet('apps/web/src/app.css', '../../apps/web/src/app.css');
const tour = sheet('apps/web/src/components/tour.css', '../../apps/web/src/components/tour.css');

const SHEETS = [components, global, app, tour];

/** One declaration: the property, its value, and where to point when it is wrong. */
interface Declaration {
  prop: string;
  value: string;
  where: string;
}

function declarations({ path, css }: { path: string; css: string }): Declaration[] {
  const out: Declaration[] = [];
  css.split('\n').forEach((line, index) => {
    const match = /^\s*([a-z-]+)\s*:\s*([^;]+);/.exec(line);
    // Custom properties are where literals are allowed to live; skip them.
    if (!match || line.trimStart().startsWith('--')) return;
    out.push({
      prop: match[1] as string,
      value: (match[2] as string).trim(),
      where: `${path.split(/[\\/]/).slice(-2).join('/')}:${index + 1}`,
    });
  });
  return out;
}

const ALL = SHEETS.flatMap(declarations);

/**
 * Lengths a declaration states in its own right — everything inside a `var()` is excluded,
 * including a `var(--x, 0px)` fallback, because that is the token's number and not this rule's.
 */
function literalLengths(value: string): string[] {
  const withoutTokens = value.replace(/var\([^)]*\)/g, ' ');
  return withoutTokens.match(/-?\d*\.?\d+(?:px|rem|em)/g) ?? [];
}

describe('the spacing scale', () => {
  const SPACING = /^(padding|margin|gap|row-gap|column-gap)(-[a-z-]+)?$/;

  /*
   * A hairline is not spacing. `1px` is a border's width and `-1px` is the `.lt-sr-only` clip
   * offset; neither is a gap anyone chose, and neither can drift.
   */
  const HAIRLINE = /^-?1px$/;

  it('takes every padding, margin and gap from a token', () => {
    const offenders = ALL.filter(
      (d) => SPACING.test(d.prop) && literalLengths(d.value).some((l) => !HAIRLINE.test(l)),
    ).map((d) => `${d.where}  ${d.prop}: ${d.value}`);
    expect(
      offenders,
      'spacing is a scale, not a number typed into a rule. Use a --lt-space-* token ' +
        '(or --lt-card-pad / --lt-row-gap / --lt-section-gap).',
    ).toEqual([]);
  });
});

describe('the control scale', () => {
  const SIZE = /^(min-)?(block-size|inline-size)$/;

  /*
   * Twelve pixels is the line between a graphic and a box: a status dot, a meter track, a
   * peak line. Anything a hand aims at or an eye reads as a box is taller than that, and has
   * to come from `--lt-control-*`, `--lt-touch-min` or a component token.
   *
   * `max-*` is deliberately outside this rule. A measure cap ("no line of prose wider than
   * 880px") is a typographic decision about content, not a control size.
   */
  const GRAPHIC_MAX_PX = 12;

  it('declares exactly four heights', () => {
    const declared = [...tokens.css.matchAll(/--lt-control-([a-z]+):/g)].map((m) => m[1]);
    expect(new Set(declared)).toEqual(new Set(['sm', 'md', 'lg', 'xl']));
  });

  it('gives every control its height from that scale', () => {
    const offenders = ALL.filter(
      (d) =>
        SIZE.test(d.prop) &&
        literalLengths(d.value).some((l) => Math.abs(Number.parseFloat(l)) > GRAPHIC_MAX_PX),
    ).map((d) => `${d.where}  ${d.prop}: ${d.value}`);
    expect(
      offenders,
      'a control that picks its own height is how a row ends up with three baselines. ' +
        'Take it from --lt-control-sm/md/lg/xl, --lt-touch-min, or a token in tokens.css.',
    ).toEqual([]);
  });

  it('never references a control token that does not exist', () => {
    const used = new Set(
      SHEETS.flatMap(({ css }) => [...css.matchAll(/var\(--lt-control-([a-z]+)/g)].map((m) => m[1] as string)),
    );
    for (const name of used) expect(tokens.css).toContain(`--lt-control-${name}:`);
  });
});

describe('the icon scale', () => {
  /** 16 with meta, 20 with ui and body, 24 for controls and nav, 32 for a card's badge. */
  const SIZES = [16, 20, 24, 32];

  it('publishes four sizes and no more', () => {
    const named = [...tokens.css.matchAll(/--lt-icon-[a-z]+:\s*(\d+)px;/g)].map((m) =>
      Number.parseInt(m[1] as string, 10),
    );
    expect(named.sort((a, b) => a - b)).toEqual(SIZES);
  });

  it('keeps the TypeScript union and the tokens in step', () => {
    const glyph = /export type GlyphSize = ([^;]+);/.exec(icons.css)?.[1] ?? '';
    const icon = /export type IconSize = ([^;]+);/.exec(icons.css)?.[1] ?? '';
    const numbers = (union: string): number[] =>
      union
        .split('|')
        .map((part) => Number.parseInt(part.trim(), 10))
        .sort((a, b) => a - b);
    expect(numbers(glyph), 'GlyphSize must be the whole icon scale').toEqual(SIZES);
    // Icons are never a card's badge; only the Intent and Moment glyph families reach 32.
    expect(numbers(icon), 'IconSize is the scale without the badge step').toEqual(
      SIZES.filter((s) => s !== 32),
    );
  });

  /*
   * The regression this is here to catch is specific and it shipped: `.lt-icon` set its size
   * straight from `--lt-icon-size`, which beat the `width`/`height` attributes that carry the
   * `size` prop, so the prop had no effect anywhere in the product. The fallback chain is what
   * lets a caller ask for a size while a caller who does not ask still follows the density.
   */
  it('lets a caller ask for a size, and follows the density when nobody asks', () => {
    const rule = /\.lt-icon\s*\{([^}]*)\}/.exec(components.css)?.[1] ?? '';
    expect(rule).toMatch(/inline-size:\s*var\(--lt-icon,\s*var\(--lt-icon-size\)\)/);
    expect(rule).toMatch(/block-size:\s*var\(--lt-icon,\s*var\(--lt-icon-size\)\)/);
    expect(icons.css, 'GlyphShell must write the prop as a custom property').toContain("'--lt-icon'");
  });
});

describe('card padding', () => {
  /*
   * Three surfaces read as "a card with a border and something inside it": `Card` itself, the
   * dock's tab panel and Studio's device cards. They were 20, 16 and 16. One token now.
   */
  const CARDS = ['.lt-card', '.lt-tabpanel', '.lt-devices__item'];

  it('is one decision, made once', () => {
    for (const selector of CARDS) {
      const escaped = selector.replace('.', '\\.');
      const rule =
        new RegExp(String.raw`${escaped}\s*\{([^}]*)\}`).exec(components.css)?.[1] ??
        new RegExp(String.raw`${escaped}\s*\{([^}]*)\}`).exec(app.css)?.[1] ??
        '';
      expect(rule, `${selector} must exist`).not.toBe('');
      expect(rule, `${selector} pads itself from --lt-card-pad`).toMatch(
        /padding:\s*var\(--lt-card-pad\)/,
      );
    }
  });
});
