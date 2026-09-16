/**
 * The screen must not promise more than the cleanup observed.
 *
 * `destroySession` returns three distinguishable outcomes and the entire reason it does is so a
 * screen can tell them apart. The failure this file exists to catch is the comfortable one: a UI
 * that says "Forgotten" on all three. That looks identical to a correct product from the outside
 * and is a false privacy claim on two of the three paths.
 *
 * Assertions are on the WORDS a person reads, not on the report object. The report is already
 * tested in `session.test.ts`, and asserting on it again here would pass even if the screen
 * ignored it completely — which is precisely the bug.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { EndSession } from '../screens/EndSession.js';
import { useAppStore } from '../state/store.js';
import type { DestroyReport } from '../state/session.js';
import { mount, type Mounted } from './helpers/render.js';

let view: Mounted | null = null;

const report = (over: Partial<DestroyReport>): DestroyReport => ({
  streamKeysForgotten: 1,
  platformsSignedOut: [],
  storageRemaining: [],
  storageReadable: true,
  clean: true,
  ...over,
});

/** Replace the store's own `endSession` with one that answers a chosen report. */
function answerWith(result: DestroyReport): ReturnType<typeof vi.fn> {
  const fake = vi.fn(async () => result);
  useAppStore.setState({ endSession: fake } as never);
  return fake;
}

/** Pretend a broadcast is running, without starting one. */
function phase(value: 'active' | 'live' | 'ending'): void {
  useAppStore.setState({
    sessionPhase: () => value,
  } as never);
}

async function open(): Promise<Mounted> {
  view = await mount(
    <MemoryRouter>
      <EndSession />
    </MemoryRouter>,
  );
  return view;
}

describe('ending a session', () => {
  beforeEach(() => {
    phase('active');
  });

  afterEach(async () => {
    await view?.unmount();
    view = null;
    vi.restoreAllMocks();
  });

  it('asks before doing something that cannot be undone', async () => {
    const fake = answerWith(report({}));
    const ui = await open();
    await ui.click(/end session and forget me/i);
    expect(ui.text()).toMatch(/cannot be undone/i);
    expect(fake).not.toHaveBeenCalled();
  });

  it('says FORGOTTEN only when the cleanup came back clean', async () => {
    answerWith(report({ clean: true }));
    const ui = await open();
    await ui.click(/end session and forget me/i);
    await ui.click(/end session and forget me/i);
    expect(ui.text()).toMatch(/Forgotten/);
    expect(ui.text()).not.toMatch(/could not confirm/i);
  });

  it('says COULD NOT CONFIRM for an unreadable store, and never says forgotten', async () => {
    /*
     * The dangerous case. Storage came back empty — but empty because it could not be READ, and a
     * screen reporting success here makes exactly the unobserved claim the report exists to stop.
     */
    answerWith(report({ clean: false, storageReadable: false }));
    const ui = await open();
    await ui.click(/end session and forget me/i);
    await ui.click(/end session and forget me/i);
    expect(ui.text()).toMatch(/could not confirm/i);
    expect(ui.text()).toMatch(/claimed here that was not observed/i);
    expect(ui.text()).not.toMatch(/Nothing of yours is left/i);
  });

  it('NAMES what survived, because nobody can clear by hand what they cannot see', async () => {
    answerWith(
      report({ clean: false, storageReadable: true, storageRemaining: ['livetap.destinations'] }),
    );
    const ui = await open();
    await ui.click(/end session and forget me/i);
    await ui.click(/end session and forget me/i);
    expect(ui.text()).toMatch(/mostly forgotten/i);
    expect(ui.text()).toMatch(/livetap\.destinations/);
  });

  it('refuses while live, and explains rather than disappearing', async () => {
    phase('live');
    const ui = await open();
    expect(ui.text()).toMatch(/you are still live/i);
    await expect(ui.click(/end session and forget me/i)).rejects.toThrow(/No clickable element/);
  });

  it('also refuses during the END grace period, when bytes may still be on the wire', async () => {
    phase('ending');
    const ui = await open();
    expect(ui.text()).toMatch(/you are still live/i);
  });
});
