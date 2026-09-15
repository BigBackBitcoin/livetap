import { describe, expect, it } from 'vitest';
import { LocalSources } from './LocalSources.js';
import { createFakeAudioContextCtor } from '../testing/fakes.js';
import type { ResolvedDeps } from '../browser/deps.js';

/**
 * THE SILENT HEARTBEAT.
 *
 * On a machine with no microphone and no system audio — a server, a laptop with the mic
 * disabled, anyone who picked "No microphone" — nothing gets connected to the mix destination
 * and the graph has no reason to render. Its track still reports `readyState: "live"`, which is
 * what made this invisible, but it delivers no audio frames, and `MediaRecorder` will not emit a
 * chunk until every track in its stream has produced data. So the recorder stalls before the
 * first chunk, the encoder ffmpeg receives nothing, and the sender ffmpeg never writes a header.
 *
 * Measured on a host with no capture devices at all: six ffmpeg processes spawned and not one
 * opened a TCP connection to the server. 0 of 3 publishers, three times. With a capture device,
 * on the same build minutes apart, 3 of 3 and three shapes decoded off disk.
 *
 * `docs/qa/NO_CAPTURE_DEVICE_DEFECT.md` has the full measurement.
 */
describe('the audio mix always has a live input', () => {
  const build = (): { sources: LocalSources; ctx: ReturnType<typeof createFakeAudioContextCtor> } => {
    const ctx = createFakeAudioContextCtor();
    const sources = new LocalSources({
      deps: { AudioContextCtor: ctx.ctor } as unknown as ResolvedDeps,
      callbacks: {
        deviceLost: () => undefined,
        engineError: () => undefined,
        layerUnavailable: () => undefined,
      },
    });
    return { sources, ctx };
  };

  it('runs a silent source when there is no microphone and no system audio', () => {
    const { sources, ctx } = build();

    const stream = sources.buildAudioMix(null);
    expect(stream, 'the mix produced no stream at all').not.toBeNull();

    const quiet = ctx.instances[0]?.constantSources ?? [];
    expect(quiet.length, 'nothing was connected to the mix destination').toBe(1);
    expect(quiet[0]?.started, 'the silence was created but never started').toBe(true);
    expect(quiet[0]?.connected, 'the silence was never connected to the destination').toBe(1);
    expect(
      quiet[0]?.offset.value,
      'the heartbeat is meant to be SILENCE — a non-zero offset is a DC tone on the broadcast',
    ).toBe(0);
  });

  it('starts exactly one, however many times the mix is rebuilt', () => {
    const { sources, ctx } = build();

    sources.buildAudioMix(null);
    sources.buildAudioMix(null);
    sources.buildAudioMix(null);

    expect(
      ctx.instances[0]?.constantSources.length,
      'a node per rebuild leaks one WebAudio node per Moment change',
    ).toBe(1);
  });

  it('stops the silence when the audio graph is torn down', () => {
    const { sources, ctx } = build();

    sources.buildAudioMix(null);
    const quiet = ctx.instances[0]?.constantSources[0];
    sources.stopAll();

    expect(quiet?.stopped, 'the silence outlived the graph it belonged to').toBe(true);
  });
});
