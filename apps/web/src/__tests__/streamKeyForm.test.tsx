import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { StreamKeyForm } from '../components/StreamKeyForm.js';
import { isPastedDestination } from '../screens/Destinations.js';
import type { DestinationSnapshot } from '@livetap/core';
import { mount } from './helpers/render.js';

/** Let every pending microtask and timer settle inside React's act() boundary. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * The paste form as a creator meets it, on the day nobody has registered anything.
 *
 * PRODUCT_SPEC §6 is blunt about what this screen may be: paste the stream key, then connect,
 * nothing else. So these tests are as much about what is NOT on the page as what is — and about
 * the pre-fill, because the difference between "go live tonight" and "give up" is whether the
 * creator has to know what a server address is.
 */
function fieldValue(container: HTMLElement, labelText: string): string {
  const label = Array.from(container.querySelectorAll('label')).find((el) =>
    (el.textContent ?? '').includes(labelText),
  );
  const id = label?.getAttribute('for');
  const input = Array.from(container.querySelectorAll('input')).find((el) => el.id === id);
  return input?.value ?? '';
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('the paste form, per platform', () => {
  it('pre-fills YouTube’s published address so the creator only pastes the key', async () => {
    const view = await mount(<StreamKeyForm platform="youtube" onSubmit={() => undefined} />);
    expect(fieldValue(view.container, 'Server address')).toBe('rtmp://a.rtmp.youtube.com/live2');
    // And names it after the platform, so nothing is asked that need not be.
    expect(fieldValue(view.container, 'Name for this destination')).toBe('YouTube');
    await view.unmount();
  });

  it('pre-fills Facebook’s published address', async () => {
    const view = await mount(<StreamKeyForm platform="facebook" onSubmit={() => undefined} />);
    expect(fieldValue(view.container, 'Server address')).toBe(
      'rtmps://live-api-s.facebook.com:443/rtmp/',
    );
    await view.unmount();
  });

  it('leaves the address empty where LIVETAP will not guess, and says so with a placeholder', async () => {
    for (const platform of ['kick', 'tiktok', 'instagram', 'x'] as const) {
      const view = await mount(<StreamKeyForm platform={platform} onSubmit={() => undefined} />);
      expect(fieldValue(view.container, 'Server address'), platform).toBe('');
      const address = Array.from(view.container.querySelectorAll('input')).find(
        (el) => el.getAttribute('placeholder') !== null,
      );
      expect(address?.getAttribute('placeholder'), platform).toBe('rtmp://');
      await view.unmount();
    }
  });

  it('keeps the address editable — the creator’s own page is the authority', async () => {
    const view = await mount(<StreamKeyForm platform="youtube" onSubmit={() => undefined} />);
    const inputs = Array.from(view.container.querySelectorAll('input'));
    const address = inputs.find((el) => el.value === 'rtmp://a.rtmp.youtube.com/live2');
    expect(address).toBeDefined();
    expect(address?.readOnly).toBe(false);
    expect(address?.disabled).toBe(false);
    await view.unmount();
  });

  it('does not offer Instagram a widescreen shape it does not accept', async () => {
    const view = await mount(<StreamKeyForm platform="instagram" onSubmit={() => undefined} />);
    // 9:16 is the only shape Instagram Live takes, so there is no choice to make and no select.
    expect(view.container.querySelectorAll('select').length).toBe(0);
    expect(view.text()).not.toContain('Widescreen 16:9');
    await view.unmount();
  });

  it('still offers a shape where the platform genuinely has more than one', async () => {
    const view = await mount(<StreamKeyForm platform="youtube" onSubmit={() => undefined} />);
    const options = Array.from(view.container.querySelectorAll('option')).map((el) => el.value);
    expect(options).toContain('16:9');
    expect(options).toContain('9:16');
    expect(options).not.toContain('1:1');
    await view.unmount();
  });
});

describe('the paste form obeys §6: paste the key, then connect, nothing else', () => {
  it('has no essay above the fields', async () => {
    const view = await mount(<StreamKeyForm platform="youtube" onSubmit={() => undefined} />);
    expect(view.text()).not.toContain('Open the platform');
    expect(view.text()).not.toContain('copy the two things it shows you');
    await view.unmount();
  });

  it('gives one line of help, and it says where to look rather than what the thing is', async () => {
    const view = await mount(<StreamKeyForm platform="youtube" onSubmit={() => undefined} />);
    const hints = Array.from(view.container.querySelectorAll('.lt-field__hint')).map(
      (el) => el.textContent ?? '',
    );
    expect(hints).toEqual(['YouTube Studio, then Go live, then Stream settings.']);
    await view.unmount();
  });

  it('keeps the longer answer behind a disclosure that starts closed', async () => {
    const view = await mount(<StreamKeyForm platform="youtube" onSubmit={() => undefined} />);
    const details = view.container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('Where do I find this?');
    await view.unmount();
  });

  it('ends on CONNECT', async () => {
    const view = await mount(<StreamKeyForm platform="youtube" onSubmit={() => undefined} />);
    const submit = view.container.querySelector('button[type="submit"]');
    expect(submit?.textContent).toContain('Connect');
    await view.unmount();
  });
});

describe('Twitch, whose address is regional', () => {
  /** The shape Twitch actually returns, trimmed to one entry. */
  const LIST = JSON.stringify({
    ingests: [
      {
        availability: 1,
        default: false,
        priority: 0,
        name: 'Default',
        url_template: 'rtmp://ingest.global-contribute.live-video.net/app/{stream_key}',
        url_template_secure: 'rtmps://ingest.global-contribute.live-video.net/app/{stream_key}',
      },
    ],
  });

  function ingestList(): typeof fetch {
    return (async () => ({
      ok: true,
      status: 200,
      json: async () => JSON.parse(LIST) as unknown,
      text: async () => LIST,
    })) as unknown as typeof fetch;
  }

  it('fills the address from Twitch’s own published list, preferring the secure template', async () => {
    globalThis.fetch = ingestList();
    const view = await mount(<StreamKeyForm platform="twitch" onSubmit={() => undefined} />);
    await settle();
    expect(fieldValue(view.container, 'Server address')).toBe(
      'rtmps://ingest.global-contribute.live-video.net/app',
    );
    await view.unmount();
  });

  it('leaves the address empty when the list cannot be read, rather than shipping a guess', async () => {
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const view = await mount(<StreamKeyForm platform="twitch" onSubmit={() => undefined} />);
    await settle();
    // `resolveIngest` falls back to a host the official docs never name. A wrong default fails
    // at go-live for a reason nobody can see; an empty field asks a question the creator can
    // answer off the page already open in front of them.
    expect(fieldValue(view.container, 'Server address')).toBe('');
    await view.unmount();
  });
});

describe('what the creator actually pasted', () => {
  it('accepts one joined address, splits it, and says what it did', async () => {
    let submitted: { url: string; streamKey: string } | null = null;
    const view = await mount(
      <StreamKeyForm
        onSubmit={(value) => {
          submitted = { url: value.url, streamKey: value.streamKey };
        }}
      />,
    );

    const inputs = Array.from(view.container.querySelectorAll('input'));
    const key = inputs.find((el) => el.type === 'password');
    const address = inputs.find((el) => el.getAttribute('placeholder') === 'rtmp://');
    const name = inputs.find((el) => el !== key && el !== address);
    await act(async () => {
      setValue(address, 'rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl-mnop');
      setValue(name, 'Late night build');
    });
    await act(async () => {
      view.container
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(submitted).toEqual({
      url: 'rtmp://a.rtmp.youtube.com/live2',
      streamKey: 'abcd-efgh-ijkl-mnop',
    });
    expect(view.text()).toContain('That address had the key on the end');
    await view.unmount();
  });

  it('accepts the whole address pasted into the key box, and says what it did', async () => {
    let submitted: { url: string; streamKey: string } | null = null;
    const view = await mount(
      <StreamKeyForm
        onSubmit={(value) => {
          submitted = { url: value.url, streamKey: value.streamKey };
        }}
      />,
    );

    const inputs = Array.from(view.container.querySelectorAll('input'));
    const key = inputs.find((el) => el.type === 'password');
    const address = inputs.find((el) => el.getAttribute('placeholder') === 'rtmp://');
    const name = inputs.find((el) => el !== key && el !== address);
    await act(async () => {
      setValue(key, 'rtmps://live-api-s.facebook.com:443/rtmp/FB-1234567890-0-Ab');
      setValue(name, 'Late night build');
    });
    await act(async () => {
      view.container
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(submitted).toEqual({
      url: 'rtmps://live-api-s.facebook.com:443/rtmp',
      streamKey: 'FB-1234567890-0-Ab',
    });
    expect(view.text()).toContain('LIVETAP put it in the address box');
    await view.unmount();
  });
});

describe('the destination a pasted key creates', () => {
  const base: DestinationSnapshot = {
    state: 'READY',
    reconnectAttempt: 0,
    stateChangedAt: 0,
    config: {
      id: 'd1',
      platform: 'custom',
      label: 'Late night build',
      aspectRatio: '16:9',
      enabled: true,
      mock: false,
      ingest: { protocol: 'rtmp', url: 'rtmp://a.rtmp.youtube.com/live2', streamKey: 'k' },
    },
  };

  it('is a pasted destination when the creator supplied the address and nobody signed in', () => {
    expect(isPastedDestination(base)).toBe(true);
  });

  it('is not one when an account is behind it — that destination has a control plane', () => {
    expect(isPastedDestination({ ...base, account: { scopes: [] } })).toBe(false);
  });

  it('is not one when it is a demo, which is a different kind of not-real entirely', () => {
    expect(isPastedDestination({ ...base, config: { ...base.config, mock: true } })).toBe(false);
  });

  it('is not one with no address, because nothing was pasted', () => {
    const { ingest: _ingest, ...config } = base.config;
    expect(isPastedDestination({ ...base, config })).toBe(false);
  });
});

/**
 * Type into a controlled input the way a person does.
 *
 * `input.value = x` alone is not enough: React overrides the `value` property to track the last
 * value it rendered, so assigning through that override updates the tracker too and React
 * concludes nothing changed. Going through the prototype's own setter leaves the tracker stale,
 * which is exactly what a real keystroke does.
 */
function setValue(input: HTMLInputElement | undefined, value: string): void {
  if (!input) throw new Error('field not found');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
