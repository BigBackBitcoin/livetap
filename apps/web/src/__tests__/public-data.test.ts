import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DESTINATION_STATES,
  DEFAULT_RECONNECT_POLICY,
  INTENT_PROFILES,
  SAFE_AREAS,
  chooseAspectForDestination,
  defaultMoments,
  insetToSafeArea,
  nextDestinationState,
} from '@livetap/core';
import type { AspectRatio, DestinationState } from '@livetap/core';
import { PLATFORM_PROFILES } from '@livetap/adapters';

import {
  DESTINATIONS,
  DOT,
  FORMATS,
  INTENTS,
  MAX_ATTEMPTS,
  MOMENTS,
  PULSING,
  RENAME,
  SAFE_AREAS as PAGE_SAFE_AREAS,
  STATES,
  STATE_CODE,
  STATE_LABEL,
  chooseAspect,
  insetToSafeArea as pageInset,
  nextState,
} from '../public/data.js';
import type { Format } from '../public/data.js';

/**
 * The public experience is the one place in this repo that duplicates the product's own
 * constants, and the duplication is deliberate: `/` ships no framework and no `@livetap/core`,
 * because importing the orchestrator to paint a marketing page would spend the whole 60 KB
 * budget before the page's own logic (`LIVETAP_MOTION_SYSTEM.md` §6.1).
 *
 * A copy that can drift is a lie waiting to happen, so every copy is checked against the real
 * value here. If one of these fails, the page is wrong and the product is right.
 */

const ROOT =
  [join(process.cwd(), 'apps', 'web'), process.cwd()].find((c) =>
    existsSync(join(c, 'index.html')),
  ) ?? process.cwd();

describe('the page copies the product, and cannot drift from it', () => {
  it('has the same safe areas, to the digit', () => {
    expect(PAGE_SAFE_AREAS).toEqual(SAFE_AREAS);
  });

  it('has the same ten destination states, in the same order', () => {
    expect([...STATES]).toEqual([...DESTINATION_STATES]);
  });

  it('gives every state a label, a dot treatment and a distinct code', () => {
    for (const state of DESTINATION_STATES) {
      expect(STATE_LABEL[state], state).toBeTruthy();
      expect(DOT[state], state).toBeTruthy();
      expect(STATE_CODE[state], state).toBeTruthy();
    }
    expect(new Set(Object.values(STATE_CODE)).size).toBe(DESTINATION_STATES.length);
  });

  it('pulses exactly the two states the product pulses', () => {
    expect([...PULSING]).toEqual(['LIVE', 'RECONNECTING']);
  });

  it('carries the reconnect ceiling the product uses', () => {
    expect(MAX_ATTEMPTS).toBe(DEFAULT_RECONNECT_POLICY.maxAttempts);
  });

  it('mirrors the transition table rather than re-deciding it', () => {
    const events = [
      'CONNECT',
      'AUTH_OK',
      'DISCONNECT',
      'START',
      'STREAM_UP',
      'STREAM_DEGRADED',
      'STREAM_RECOVERED',
      'STREAM_LOST',
      'STOP',
      'STOPPED',
      'RESET',
    ] as const;
    for (const from of DESTINATION_STATES) {
      for (const event of events) {
        const mine = nextState(from, event);
        if (mine === null) continue;
        /* The page mirrors a subset: it may refuse a move the product allows (FAILED is never
           reachable from a visitor action), but it must never invent one. */
        expect(nextDestinationState(from, event), `${from} --${event}-->`).toBe(mine);
      }
    }
  });

  it('derives each destination from its own platform profile', () => {
    for (const d of DESTINATIONS) {
      const profile = PLATFORM_PROFILES[d.id as keyof typeof PLATFORM_PROFILES];
      expect(profile, d.id).toBeTruthy();
      expect(d.name).toBe(profile.displayName);
      expect(d.aspects).toEqual(profile.supportedAspectRatios);
      expect(d.preferred).toBe(profile.preferredAspectRatio);
      expect(d.autoStarts).toBe(profile.autoStartsOnIngest);
      expect(d.ceilingMbps).toBe(profile.recommended.maxVideoKbps / 1000);
      /* `method` is derived from the capability class, never written by hand. */
      const automated =
        profile.capabilities.streamKey === 'NATIVE_API' ||
        profile.capabilities.streamKey === 'OAUTH_API';
      expect(d.method, d.id).toBe(automated ? 'connect' : 'key');
      /* Chat is shown only where the platform publishes an automated read. */
      const chat =
        profile.capabilities.chatRead === 'NATIVE_API' ||
        profile.capabilities.chatRead === 'OAUTH_API';
      expect(d.chat, d.id).toBe(chat);
    }
  });

  it('copies the six intent profiles, minus the emoji the page never renders', () => {
    for (const it of INTENTS) {
      const real = INTENT_PROFILES[it.id as keyof typeof INTENT_PROFILES];
      expect(real, it.id).toBeTruthy();
      expect(it.title).toBe(real.title);
      expect(it.tagline).toBe(real.tagline);
      expect(it.whatYouGet).toEqual(real.whatYouGet);
      expect(it.preference).toEqual(real.aspectPreference);
      expect(it.master).toBe(real.masterAspectRatio);
      expect(it.firstMoment).toBe(real.momentOrder[0]);
    }
    expect(INTENTS.map((i) => i.id)).toEqual(Object.keys(INTENT_PROFILES));
  });

  it('copies the six Moments, their transitions and their placements', () => {
    const real = defaultMoments();
    expect(MOMENTS.map((m) => m.id)).toEqual(real.map((m) => m.id));
    for (const m of MOMENTS) {
      const r = real.find((x) => x.id === m.id)!;
      expect(m.name).toBe(r.name);
      expect(m.transition).toBe(r.transition.kind);
      expect(m.ms).toBe(r.transition.durationMs);
      expect(m.micMuted).toBe(r.audio.micMuted);
      /* Only the layer kinds the page paints are copied, and their placements are verbatim. */
      for (const layer of m.layers) {
        if (!layer.at) continue;
        const kind = layer.kind === 'guest' ? 'browser' : layer.kind;
        const rl = r.layers.find((x) => x.kind === kind);
        expect(rl, `${m.id}/${layer.kind}`).toBeTruthy();
        expect(layer.at.default, `${m.id}/${layer.kind} default`).toEqual(rl!.placement.default);
        if (layer.at['9:16']) {
          expect(layer.at['9:16'], `${m.id}/${layer.kind} 9:16`).toEqual(rl!.placement['9:16']);
        }
      }
    }
  });

  it('renames the same Moments the product renames', () => {
    expect(RENAME).toEqual({
      gaming: { 'screen-share': 'Gameplay' },
      presentation: { 'screen-share': 'Slides' },
      podcast: { guest: 'Conversation' },
    });
  });

  it('picks the same aspect for every destination and every intent', () => {
    for (const d of DESTINATIONS) {
      for (const it of INTENTS) {
        const real = chooseAspectForDestination(
          INTENT_PROFILES[it.id as keyof typeof INTENT_PROFILES],
          {
            id: d.id,
            platform: d.id as never,
            supportedAspectRatios: [...d.aspects] as AspectRatio[],
            preferredAspectRatio: d.preferred as AspectRatio,
          },
        );
        expect(chooseAspect(it.preference, d), `${it.id}/${d.id}`).toBe(real);
      }
    }
  });

  it('insets to the safe area with the same maths and the same rounding', () => {
    const rects = [
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 0.1, y: 0.38, w: 0.8, h: 0.24 },
      { x: 0.74, y: 0.7, w: 0.22, h: 0.26 },
      { x: 0.51, y: 0.15, w: 0.47, h: 0.7 },
      { x: -0.2, y: 1.4, w: 2, h: 2 },
    ];
    for (const format of FORMATS) {
      for (const r of rects) {
        expect(pageInset(r, format as Format), `${format} ${JSON.stringify(r)}`).toEqual(
          insetToSafeArea(r, format as AspectRatio),
        );
      }
    }
  });

  it('lists no state the product does not have', () => {
    for (const state of Object.keys(STATE_LABEL)) {
      expect(DESTINATION_STATES).toContain(state as DestinationState);
    }
  });
});

describe('the icon set belongs to the app, not to this page', () => {
  it('uses the same path data as Icons.tsx for every glyph the page draws', () => {
    const icons = readFileSync(
      join(ROOT, '..', '..', 'packages', 'ui', 'src', 'components', 'Icons.tsx'),
      'utf8',
    );
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    /* The markup references the chrome's glyphs directly; the Moment and intent glyphs are
       picked by domain id at runtime, so they are counted by their symbols rather than here. */
    const used = Array.from(html.matchAll(/href="#(i|m|n)-([a-z-]+)"/g), (m) => m[0]);
    expect(used.length).toBeGreaterThan(15);

    /* Every `d` attribute inside the page's sprite has to exist verbatim in the component
       source, so a glyph change in `packages/ui` cannot leave the public page behind. */
    const spriteStart = html.indexOf('<svg class="ltp-sprite"');
    const sprite = html.slice(spriteStart, html.indexOf('</svg>', spriteStart));
    /* The leading whitespace matters: a bare `d="` also matches inside `id="`. */
    const paths = Array.from(sprite.matchAll(/\sd="([\s\S]+?)"/g), (m) => m[1]!);
    expect(paths.length).toBeGreaterThan(40);
    const missing = paths.filter((d) => {
      const flat = d.replace(/\s+/g, ' ').trim();
      return !icons.includes(d) && !icons.includes(flat);
    });
    /* The mark is DESIGN_SYSTEM §1.2 rather than an icon, so its two arcs are exempt. */
    const markPaths = [
      'M15.94 20.91A6 6 0 0 0 15.94 11.09',
      'M17.95 23.78A9.5 9.5 0 0 0 17.95 8.22',
    ];
    expect(missing.filter((d) => !markPaths.includes(d.replace(/\s+/g, ' ').trim()))).toEqual([]);
  });
});

describe('the Scroll Craft engine is vendored, not forked', () => {
  it('carries no project-local edit', () => {
    const engine = readFileSync(join(ROOT, 'src', 'public', 'scrollcraft.js'), 'utf8');
    /* The mechanism is never edited per project. Anything LIVETAP-specific in here means the
       page reached into the engine instead of driving it from `--sc-p` and `data-lt-*`. */
    expect(engine).not.toMatch(/livetap|ltp-|lt-/i);
    expect(engine).toContain('global.ScrollCraft = { mount: mount, reduce: reduce, instances: [] };');
    expect(engine.length).toBeGreaterThan(50_000);
  });
});
