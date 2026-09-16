/**
 * ACCEPTANCE CRITERION I: a normal creator immediately understands which account is which.
 *
 * The other nine criteria are about the machine — distinct tokens, distinct identities, distinct
 * lifecycles — and every one of them can be satisfied by a screen that still shows three rows
 * reading "YouTube". That product is correct and unusable: this is the screen where somebody
 * decides which of their channels goes live, and the word that distinguishes them was the least
 * prominent thing on the card.
 *
 * So these assert on what a person READS and what they can REACH, never on the destination array.
 * Asserting on state would pass on exactly the screen this file exists to prevent.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { Destinations } from '../screens/Destinations.js';
import { useAppStore } from '../state/store.js';
import type { DestinationSnapshot } from '@livetap/core';
import { mount, type Mounted } from './helpers/render.js';

let view: Mounted | null = null;

function account(id: string, platform: string, label: string): DestinationSnapshot {
  return {
    config: {
      id,
      platform: platform as DestinationSnapshot['config']['platform'],
      label,
      aspectRatio: '16:9',
      enabled: true,
      mock: false,
    },
    state: 'READY',
    reconnectAttempt: 0,
    stateChangedAt: 0,
  } as DestinationSnapshot;
}

beforeEach(() => {
  useAppStore.setState({
    destinations: [
      account('d1', 'youtube', 'Carter Gaming'),
      account('d2', 'youtube', 'Carter Live'),
      account('d3', 'tiktok', '@carterofficial'),
    ],
    ready: true,
  } as never);
});

afterEach(async () => {
  await view?.unmount();
  view = null;
  useAppStore.setState({ destinations: [] } as never);
});

describe('the destination library reads as accounts under platforms', () => {
  it('shows every account, named, rather than one row per platform', async () => {
    view = await mount(
      <MemoryRouter>
        <Destinations />
      </MemoryRouter>,
    );

    const text = view.text();
    expect(text, 'the first YouTube account is not named on the screen').toContain('Carter Gaming');
    expect(
      text,
      'the second YouTube account is missing — the screen is still one row per platform',
    ).toContain('Carter Live');
    expect(text).toContain('@carterofficial');
  });

  it('puts both YouTube accounts under one YouTube heading', async () => {
    view = await mount(
      <MemoryRouter>
        <Destinations />
      </MemoryRouter>,
    );

    const groups = view.container.querySelectorAll('.lt-destgroup');
    expect(groups, 'two platforms should make two groups, not one flat list').toHaveLength(2);

    const youtube = view.container.querySelector('#lt-destgroup-youtube')?.closest('.lt-destgroup');
    expect(youtube, 'there is no YouTube group').not.toBeNull();
    expect(
      youtube?.querySelectorAll('.lt-destcard'),
      'both YouTube accounts should sit under the YouTube heading',
    ).toHaveLength(2);
  });

  it('says how many accounts a platform has, but only when it has more than one', async () => {
    view = await mount(
      <MemoryRouter>
        <Destinations />
      </MemoryRouter>,
    );

    const youtube = view.container.querySelector('#lt-destgroup-youtube')?.closest('.lt-destgroup');
    const tiktok = view.container.querySelector('#lt-destgroup-tiktok')?.closest('.lt-destgroup');

    expect(youtube?.querySelector('.lt-destgroup__count')?.textContent).toBe('2 accounts');
    expect(
      tiktok?.querySelector('.lt-destgroup__count'),
      '"1 account" on every heading is noise a reader learns to skip',
    ).toBeNull();
  });

  /*
   * The affordance is the difference between a list and a library. Without it, a creator who
   * wants a second channel has to find "Add destination" and pick YouTube again — which, before
   * the store was fixed, silently reconnected the channel they already had.
   */
  it('offers another account of the same platform, in that platform own words', async () => {
    view = await mount(
      <MemoryRouter>
        <Destinations />
      </MemoryRouter>,
    );

    const labels = [...view.container.querySelectorAll('.lt-destgroup__add')].map(
      (b) => b.textContent?.trim() ?? '',
    );
    expect(labels).toContain('Add another YouTube account');
    expect(labels).toContain('Add another TikTok account');
  });
});
