/**
 * The type system is a contract too.
 *
 * Nine roles, three weights, and uppercase in exactly one place. Each of those is a decision the
 * product made once, and each is the kind of decision that erodes one reasonable-looking edit at
 * a time: a fourth weight because this one heading wanted to be a little heavier, an uppercase
 * label because it looked tidy in that card, a tenth role because none of the nine quite fitted.
 *
 * So the constraints are measured from the stylesheet rather than written down in a comment and
 * hoped for. The sheet is parsed as text on purpose: this runs in node with no DOM, and what
 * matters is what the file declares, which is what ships.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Found from the working directory rather than from `import.meta.url`: vitest transforms this
 * module, so `import.meta.url` is not guaranteed to be a file: URL, and the run can be rooted
 * either at the repo or at this package depending on which project picked the file up.
 */
const CANDIDATES = ['packages/ui/src/tokens.css', 'src/tokens.css'];
const sheet = CANDIDATES.map((c) => resolve(process.cwd(), c)).find((c) => existsSync(c));
if (!sheet) throw new Error(`tokens.css not found from ${process.cwd()}`);
const css = readFileSync(sheet, 'utf8');

/** The nine roles, in the order they descend in size. */
const ROLES = ['display', 'hero', 'h1', 'h2', 'body', 'ui', 'meta', 'status', 'button'] as const;

function ruleFor(role: string): string {
  const match = new RegExp(String.raw`\.lt-type-${role}\s*\{([^}]*)\}`).exec(css);
  if (!match) throw new Error(`no .lt-type-${role} rule in tokens.css`);
  return match[1] as string;
}

describe('type roles', () => {
  it('declares all nine roles', () => {
    for (const role of ROLES) expect(() => ruleFor(role)).not.toThrow();
  });

  it('gives every role a size, a line height and a weight', () => {
    for (const role of ROLES) {
      const rule = ruleFor(role);
      expect(rule, `${role} font-size`).toMatch(/font-size:/);
      expect(rule, `${role} line-height`).toMatch(/line-height:/);
      expect(rule, `${role} font-weight:`).toMatch(/font-weight:/);
    }
  });

  it('uses exactly three weights, and always by name', () => {
    const weights = new Set<string>();
    for (const role of ROLES) {
      const weight = /font-weight:\s*([^;]+);/.exec(ruleFor(role))?.[1]?.trim();
      expect(weight, `${role} must take its weight from a token`).toMatch(/^var\(--lt-w-[a-z]+\)$/);
      weights.add(weight as string);
    }
    expect(weights.size, `weights in use: ${[...weights].join(', ')}`).toBeLessThanOrEqual(3);
  });

  it('shouts in exactly one place', () => {
    const shouting = ROLES.filter((role) => /text-transform:\s*uppercase/.test(ruleFor(role)));
    expect(shouting).toEqual(['status']);
  });

  it('tightens tracking as size grows, so 48px and 14px look like one typeface', () => {
    const track = (role: string): number => {
      const raw = /letter-spacing:\s*([^;]+);/.exec(ruleFor(role))?.[1]?.trim() ?? '0';
      const viaToken = /var\(--lt-tracking-(\d+)\)/.exec(raw);
      if (viaToken) {
        const named = new RegExp(String.raw`--lt-tracking-${viaToken[1]}:\s*([^;]+);`).exec(css)?.[1] ?? '0';
        return Number.parseFloat(named);
      }
      return Number.parseFloat(raw);
    };
    // STATUS is deliberately outside this curve: it is tracked WIDE to read as a machine state.
    const curve = ['display', 'hero', 'h1', 'h2', 'body'] as const;
    for (let i = 1; i < curve.length; i += 1) {
      expect(track(curve[i] as string), `${curve[i]} vs ${curve[i - 1]}`).toBeGreaterThanOrEqual(
        track(curve[i - 1] as string),
      );
    }
    expect(track('status')).toBeGreaterThan(0.02);
  });
});
