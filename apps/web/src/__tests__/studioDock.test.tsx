/**
 * "WHERE IS THIS GOING RIGHT NOW" HAS TO NAME THE ACCOUNT.
 *
 * The Studio dock built its chip as `${platformDisplayName} · ${state}`, so a creator
 * broadcasting to Carter Gaming and Carter Live saw two rows both reading "YouTube · Live" — in
 * the one place that answers where the stream is going, next to a control that stops one of them.
 *
 * Every layer beneath was already per account by the time this was written: separate tokens,
 * separate credentials, separate lifecycles, separate forward targets at the relay. This line was
 * where the distinction disappeared for the person watching, which is the only place it has to
 * survive for the feature to be worth anything.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { DestinationList } from '../components/DestinationChips.js';
import { useAppStore } from '../state/store.js';
import type { DestinationSnapshot } from '@livetap/core';
import { mount, type Mounted } from './helpers/render.js';

let view: Mounted | null = null;

function dest(id: string, platform: string, label: string): DestinationSnapshot {
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

function show(destinations: DestinationSnapshot[]): void {
  useAppStore.setState({ destinations, ready: true } as never);
}

afterEach(async () => {
  await view?.unmount();
  view = null;
  useAppStore.setState({ destinations: [] } as never);
});

beforeEach(() => {
  useAppStore.setState({ destinations: [] } as never);
});

const render = async (): Promise<Mounted> =>
  mount(
    <MemoryRouter>
      <DestinationList />
    </MemoryRouter>,
  );

describe('the live dock names the account', () => {
  it('tells two channels on one platform apart', async () => {
    show([dest('d1', 'youtube', 'Carter Gaming'), dest('d2', 'youtube', 'Carter Live')]);
    view = await render();

    const text = view.text();
    expect(text, 'the first channel is not named in the dock').toContain('Carter Gaming');
    expect(
      text,
      'both rows read the same thing — a creator cannot tell which one they are about to stop',
    ).toContain('Carter Live');
  });

  it('still says the platform when a destination has no name of its own', async () => {
    show([dest('d1', 'youtube', 'YouTube')]);
    view = await render();

    expect(view.text()).toContain('YouTube');
  });

  /*
   * The dock is narrow and answers one question. A platform heading above every single-account
   * row would double its height to repeat a word the row already says, which is why this differs
   * from the Destinations screen, where grouping is unconditional because that is a library.
   */
  it('groups under a platform heading only where there is more than one of it', async () => {
    show([
      dest('d1', 'youtube', 'Carter Gaming'),
      dest('d2', 'youtube', 'Carter Live'),
      dest('d3', 'tiktok', '@carterofficial'),
    ]);
    view = await render();

    const headings = [...view.container.querySelectorAll('.lt-chiprow__group')].map(
      (el) => el.textContent?.trim() ?? '',
    );
    expect(headings, 'exactly the platform with two accounts should be headed').toEqual(['YouTube']);
  });

  it('adds no headings at all when every platform has one account', async () => {
    show([dest('d1', 'youtube', 'Carter Gaming'), dest('d2', 'tiktok', '@carterofficial')]);
    view = await render();

    expect(
      view.container.querySelectorAll('.lt-chiprow__group'),
      'a heading over every single row doubles the dock to repeat what the row says',
    ).toHaveLength(0);
  });
});
