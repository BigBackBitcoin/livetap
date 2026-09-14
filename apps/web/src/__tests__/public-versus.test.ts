import { afterEach, describe, expect, it, vi } from 'vitest';

import { mountVersus } from '../public/versus.js';
import type { VersusHandle } from '../public/versus.js';

/**
 * The comparison band, and the guard that keeps it honest.
 *
 * The band exists because an audit of the deployed page asked for the setup difference as
 * something a visitor can press. The risk in building it is not that it breaks, it is that it
 * starts saying things the repository cannot support. So the interesting test here is not (1),
 * (2) or (4) but (3): every digit the band paints has to be one of the seven the measured
 * documents actually contain, and anything else fails the suite rather than the review.
 */

let mounted: VersusHandle | null = null;
let host: HTMLElement | null = null;

function mount(reduced = true, onPlayLivetap?: () => void): HTMLElement {
  const div = document.createElement('div');
  div.setAttribute('data-lt-versus', '');
  document.body.append(div);
  host = div;
  mounted = mountVersus(div, onPlayLivetap ? { reduced, onPlayLivetap } : { reduced });
  return div;
}

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  host?.remove();
  host = null;
});

/**
 * The allow-list, and where each entry is measured or cited.
 *
 * `14`, `1,443` and the multistream footnote are the OBS side of `docs/qa/FRICTION_BENCHMARK.md`
 * section 3 (which cites `SWITCHING_TRIGGERS.md` T6 and T1). `6`, `2`, `0`, `16:9` and `9:16` are
 * the LIVETAP side of section 2, every one of them asserted by a test in this repository.
 *
 * Longest first, so `16:9` is consumed before `6` can claim its digit.
 */
const ALLOWED = ['1,443', '1443', '16:9', '9:16', '14', '6', '2', '0'] as const;

/**
 * The copy a visitor reads or hears: text nodes, plus the attributes a screen-reader user meets
 * as prose. `data-lt-source` is deliberately not read. A citation is provenance, not a claim, and
 * a section number in one is the one place a digit is allowed to be something other than a fact
 * about the product.
 */
function spokenCopy(root: HTMLElement): string {
  const spoken = Array.from(root.querySelectorAll('*'))
    .flatMap((el) => ['aria-label', 'title', 'alt'].map((name) => el.getAttribute(name)))
    .filter((value): value is string => value !== null);
  return [root.textContent ?? '', ...spoken].join('\n');
}

/** Every digit run left over once the allow-list has been taken out of the copy. */
function unsupportedNumbers(root: HTMLElement): string[] {
  let text = spokenCopy(root);
  for (const allowed of ALLOWED) text = text.split(allowed).join(' ');
  return Array.from(text.matchAll(/\d[\d,.:]*/g), (match) => match[0]);
}

describe('mounting the comparison band', () => {
  it('renders two lanes, each with a real heading', () => {
    const root = mount();
    const headings = Array.from(root.querySelectorAll('h3'), (h) => h.textContent);
    expect(headings).toEqual(['The usual way', 'LIVETAP']);
  });

  it('names the incumbent plainly rather than implying it', () => {
    const root = mount();
    expect(root.textContent).toContain('OBS Studio');
  });

  it('lists the 14 concepts and the 6 taps as list items, in order', () => {
    const root = mount();
    const obs = Array.from(root.querySelectorAll('[data-lt-track="obs"] li'));
    const ours = Array.from(root.querySelectorAll('[data-lt-track="livetap"] li'));
    expect(obs).toHaveLength(14);
    expect(ours).toHaveLength(6);
    expect(obs[0]?.textContent).toBe('Auto-Configuration Wizard');
    expect(obs[13]?.textContent).toBe('Start Streaming');
    expect(ours.map((li) => li.textContent)).toEqual([
      'Talking',
      'YouTube',
      'TikTok',
      'Continue',
      'Open Studio',
      'GO LIVE',
    ]);
  });

  it('starts idle, and says so where a verification pass can read it', () => {
    const root = mount();
    expect(root.dataset.ltVersusState).toBe('idle');
    expect(root.querySelector('[data-lt-track="obs"]')).not.toHaveProperty(
      'dataset.ltShown',
      'true',
    );
  });

  it('puts both play buttons on real buttons, so the band is keyboard operable', () => {
    const root = mount();
    const buttons = Array.from(root.querySelectorAll('button[data-lt-play]'));
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Play the usual setup',
      'Play LIVETAP',
    ]);
    for (const button of buttons) expect(button.getAttribute('type')).toBe('button');
  });
});

describe('playing a lane', () => {
  it('marks the state and reveals all 14 concepts at once under reduced motion', () => {
    const root = mount(true);
    mounted?.play('obs');
    expect(root.dataset.ltVersusState).toBe('obs');
    const track = root.querySelector<HTMLElement>('[data-lt-track="obs"]');
    expect(track?.dataset.ltShown).toBe('true');
    expect(track?.querySelectorAll('li')).toHaveLength(14);
    expect(root.querySelector('[data-lt-count="obs"]')?.textContent).toBe('14');
  });

  it('reaches "both" when the other lane plays too, and comes back to idle on reset', () => {
    const root = mount(true);
    mounted?.play('livetap');
    expect(root.dataset.ltVersusState).toBe('livetap');
    mounted?.play('obs');
    expect(root.dataset.ltVersusState).toBe('both');
    mounted?.reset();
    expect(root.dataset.ltVersusState).toBe('idle');
    expect(
      root.querySelector<HTMLElement>('[data-lt-track="livetap"]')?.dataset.ltShown,
    ).toBeUndefined();
    /* Reset puts the counters back to the claim, not to zero: the resting state is a sentence. */
    expect(root.querySelector('[data-lt-count="livetap"]')?.textContent).toBe('6');
  });

  it('tells the page when LIVETAP plays, and only then', () => {
    const onPlayLivetap = vi.fn();
    mount(true, onPlayLivetap);
    mounted?.play('obs');
    expect(onPlayLivetap).not.toHaveBeenCalled();
    mounted?.play('livetap');
    expect(onPlayLivetap).toHaveBeenCalledTimes(1);
  });

  it('plays from a click on the button itself', () => {
    const root = mount(true);
    root.querySelector<HTMLElement>('[data-lt-play="livetap"]')?.click();
    expect(root.dataset.ltVersusState).toBe('livetap');
  });

  it('lands on the final count with motion on', async () => {
    const root = mount(false);
    mounted?.play('livetap');
    expect(root.dataset.ltVersusState).toBe('livetap');
    await vi.waitFor(
      () => expect(root.querySelector('[data-lt-count="livetap"]')?.textContent).toBe('6'),
      { timeout: 4000, interval: 50 },
    );
  });

  it('empties the host on destroy', () => {
    const root = mount(true);
    mounted?.play('obs');
    mounted?.destroy();
    mounted = null;
    expect(root.innerHTML).toBe('');
    expect(root.dataset.ltVersusState).toBeUndefined();
  });
});

describe('no number the documents do not contain', () => {
  it('prints nothing outside the allow-list at rest', () => {
    expect(unsupportedNumbers(mount())).toEqual([]);
  });

  it('prints nothing outside the allow-list once both lanes have played', () => {
    const root = mount(true);
    mounted?.play('obs');
    mounted?.play('livetap');
    expect(root.dataset.ltVersusState).toBe('both');
    expect(unsupportedNumbers(root)).toEqual([]);
  });

  it('prints the numbers the benchmark measured, so the guard is guarding something', () => {
    const root = mount(true);
    const text = root.textContent ?? '';
    expect(text).toContain('14 concepts named before your first stream');
    expect(text).toContain('1,443');
    expect(text).toContain('6 taps · 2 questions · 0 broadcasting words');
    expect(text).toContain('16:9 and 9:16 at once');
    expect(text).toContain('reconnects itself: 0 actions');
  });

  it('asserts no tap count and no minutes figure for the incumbent', () => {
    /*
     * FRICTION_BENCHMARK.md section 3: "A tap-for-tap count for OBS is deliberately not asserted
     * here." Neither is a wall-clock figure: section 5 lists time to first stream as the thing
     * this benchmark does not yet measure. So the OBS lane may not quantify either. The one
     * permitted phrase is the cited multistream footnote, "one click per destination", which is
     * the plugin's documented start semantics rather than a count of anybody's setup.
     */
    const lane = mount().querySelector('[data-lt-lane="obs"]');
    expect(lane?.textContent).not.toMatch(/\d[\d,.]*\s*(?:taps?|clicks?|minutes?|seconds?)/i);
    expect(lane?.textContent).not.toMatch(/\bminutes?\b|\bseconds?\b|\btaps?\b/i);
  });

  it('cites its sources in small print rather than asking to be believed', () => {
    const root = mount();
    expect(root.textContent).toContain(
      'Counted from the OBS Quick Start Guide. See docs/qa/FRICTION_BENCHMARK.md',
    );
  });

  it('uses no em dash and no emoji', () => {
    const copy = spokenCopy(mount());
    expect(copy).not.toContain('—');
    expect(copy).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});

describe('the competitor strip', () => {
  it('names at most four, and every one of them carries a source', () => {
    const root = mount();
    const items = Array.from(root.querySelectorAll('.ltv-others__list > li'));
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(4);
    for (const item of items) {
      expect(item.getAttribute('data-lt-source')).toMatch(/COMPETITOR_FAILURE_DATABASE_A\.md §/);
      /* One short line each. A paragraph here is how an unsupported claim gets in. */
      expect((item.textContent ?? '').length).toBeLessThan(140);
    }
  });

  it('names the ones the audit asked to be named', () => {
    const names = Array.from(
      mount().querySelectorAll('.ltv-other__name'),
      (el) => el.textContent,
    );
    expect(names).toEqual(['Restream', 'StreamYard', 'Streamlabs', 'Riverside']);
  });
});
