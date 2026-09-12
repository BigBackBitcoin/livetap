// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineMetrics } from '@livetap/core';
import type { EngineOutput, EngineOutputEvent, EngineStartRequest } from '@livetap/core';
import { defaultMoments, formatForPreset } from '@livetap/core';
import { MockEngine, mulberry32, type MockEngineOptions } from './MockEngine.js';
import { createFakeCanvas } from '../testing/fakes.js';

function output(destinationId: string, protocol: 'rtmps' | 'whip' = 'rtmps'): EngineOutput {
  return {
    destinationId,
    aspectRatio: '16:9',
    ingest: { protocol, url: protocol === 'whip' ? 'https://i.test/whip' : 'rtmps://live.test/app', streamKey: 'k' },
  };
}

function request(outputs: EngineOutput[], recording = false): EngineStartRequest {
  return {
    formats: { '16:9': formatForPreset('1080p30', '16:9'), '9:16': undefined, '1:1': undefined },
    outputs,
    encoder: { preference: 'auto', softwarePreset: 'veryfast', rateControl: 'cbr' },
    recording: { enabled: recording, container: 'mp4', source: 'program' },
  };
}

describe('MockEngine', () => {
  let engine: MockEngine;
  let outputs: EngineOutputEvent[];
  let metrics: EngineMetrics[];

  function build(options: MockEngineOptions = {}): MockEngine {
    const created = new MockEngine({ createCanvas: () => createFakeCanvas(1280, 720).canvas, ...options });
    outputs = [];
    metrics = [];
    created.on('output', (event) => outputs.push(event));
    created.on('metrics', (sample) => metrics.push(sample));
    return created;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    engine = build();
  });

  afterEach(() => {
    engine.dispose();
    vi.useRealTimers();
  });

  it('identifies itself as a simulation, never as a verified engine', async () => {
    const caps = await engine.capabilities();
    expect(engine.kind).toBe('mock');
    expect(caps.verification).toBe('SIMULATED');
    expect(caps.maxFormats).toBe(3);
  });

  it('emits outputUp after the connect delay and not before', async () => {
    await engine.start(request([output('a'), output('b')]));
    vi.advanceTimersByTime(799);
    expect(outputs).toHaveLength(0);
    vi.advanceTimersByTime(2);
    expect(outputs.map((e) => [e.type, e.destinationId])).toEqual([
      ['outputUp', 'a'],
      ['outputUp', 'b'],
    ]);
  });

  it('honours a custom connectDelayMs', async () => {
    engine.dispose();
    engine = build({ connectDelayMs: 50 });
    await engine.start(request([output('a')]));
    vi.advanceTimersByTime(60);
    expect(outputs).toHaveLength(1);
  });

  it('emits metrics every second with a valid EngineMetrics shape', async () => {
    await engine.start(request([output('a')]));
    vi.advanceTimersByTime(3500);
    expect(metrics.length).toBe(3);
    for (const sample of metrics) {
      expect(sample.targetKbps).toBe(4500 + 160);
      expect(sample.encodedKbps).toBeGreaterThan(0);
      expect(sample.encodedKbps).toBeLessThan(sample.targetKbps * 1.2);
      expect(sample.targetFps).toBe(30);
      expect(sample.renderFps).toBeGreaterThan(0);
      expect(sample.renderFps).toBeLessThanOrEqual(sample.targetFps);
      expect(sample.networkDroppedPct).toBeGreaterThanOrEqual(0);
      expect(sample.encoderDroppedPct).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(sample.updatedAt)).toBe(true);
    }
  });

  it('produces the same metrics curve for the same seed', async () => {
    const a = build({ seed: 42 });
    await a.start(request([output('a')]));
    vi.advanceTimersByTime(3000);
    const first = metrics.map((m) => m.encodedKbps);
    a.dispose();

    const b = build({ seed: 42 });
    await b.start(request([output('a')]));
    vi.advanceTimersByTime(3000);
    const second = metrics.map((m) => m.encodedKbps);
    b.dispose();

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(1);
  });

  it('drops a scripted output after the configured delay, then reconnects via addOutput', async () => {
    engine.dispose();
    engine = build({ scenario: { failOutput: { destinationId: 'b', afterMs: 3000, code: 'INGEST_DISCONNECTED' } } });
    await engine.start(request([output('a'), output('b')]));

    vi.advanceTimersByTime(900);
    expect(outputs.filter((e) => e.type === 'outputUp')).toHaveLength(2);

    vi.advanceTimersByTime(2000);
    expect(outputs.filter((e) => e.type === 'outputLost')).toHaveLength(0);

    vi.advanceTimersByTime(200);
    const lost = outputs.filter((e) => e.type === 'outputLost');
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatchObject({ destinationId: 'b', code: 'INGEST_DISCONNECTED' });

    // The other output is untouched: one destination failing never affects another.
    expect(outputs.filter((e) => e.destinationId === 'a' && e.type !== 'outputUp')).toHaveLength(0);

    outputs.length = 0;
    await engine.addOutput(output('b'));
    vi.advanceTimersByTime(900);
    expect(outputs.map((e) => [e.type, e.destinationId])).toEqual([['outputUp', 'b']]);
  });

  it('defaults failOutput to INGEST_DISCONNECTED', async () => {
    engine.dispose();
    engine = build({ scenario: { failOutput: { destinationId: 'a', afterMs: 10 } } });
    await engine.start(request([output('a')]));
    vi.advanceTimersByTime(1000);
    expect(outputs.find((e) => e.type === 'outputLost')).toMatchObject({ code: 'INGEST_DISCONNECTED' });
  });

  it('fails addOutput reconnectFailsTimes times before succeeding', async () => {
    engine.dispose();
    engine = build({ reconnectFailsTimes: 2 });
    await engine.start(request([output('a')]));
    await expect(engine.addOutput(output('a'))).rejects.toThrow(/attempt 1 failed/);
    await expect(engine.addOutput(output('a'))).rejects.toThrow(/attempt 2 failed/);
    await expect(engine.addOutput(output('a'))).resolves.toBeUndefined();
  });

  it('degrades and recovers an output on schedule', async () => {
    engine.dispose();
    engine = build({ scenario: { degradeOutput: { destinationId: 'a', afterMs: 2000, recoverAfterMs: 1000 } } });
    await engine.start(request([output('a')]));
    vi.advanceTimersByTime(900);
    vi.advanceTimersByTime(1200);
    expect(outputs.some((e) => e.type === 'outputDegraded')).toBe(true);
    // While degraded the metrics dip well under target.
    const degradedSample = metrics[metrics.length - 1]!;
    expect(degradedSample.encodedKbps).toBeLessThan(degradedSample.targetKbps * 0.8);
    vi.advanceTimersByTime(1100);
    expect(outputs.some((e) => e.type === 'outputRecovered')).toBe(true);
  });

  it('emits deviceLost for a scripted device drop', async () => {
    engine.dispose();
    engine = build({ scenario: { dropDevice: { kind: 'camera', afterMs: 500 } } });
    const lost: Array<{ kind: string }> = [];
    engine.on('deviceLost', (payload) => lost.push(payload));
    await engine.start(request([output('a')]));
    vi.advanceTimersByTime(600);
    expect(lost).toEqual([{ kind: 'camera' }]);
  });

  it('crashes the encoder and drops every output', async () => {
    engine.dispose();
    engine = build({ scenario: { encoderCrashAfterMs: 1500 } });
    const errors: Array<{ code: string }> = [];
    engine.on('engineError', (payload) => errors.push(payload));
    await engine.start(request([output('a'), output('b')]));
    vi.advanceTimersByTime(2000);
    expect(errors[0]?.code).toBe('ENCODER_FAILED');
    expect(outputs.filter((e) => e.type === 'outputLost')).toHaveLength(2);
  });

  it('emits recording started/stopped', async () => {
    const states: string[] = [];
    engine.on('recording', (event) => states.push(event.state));
    await engine.start(request([output('a')], true));
    expect(states).toEqual(['started']);
    const result = await engine.stopRecording();
    expect(states).toEqual(['started', 'stopped']);
    expect(result.path).toBe('mock://recording.mp4');
  });

  it('stopRecording is a no-op when nothing is recording', async () => {
    const states: string[] = [];
    engine.on('recording', (event) => states.push(event.state));
    expect(await engine.stopRecording()).toEqual({});
    expect(states).toEqual([]);
  });

  it('stop() stops every output and the recorder', async () => {
    await engine.start(request([output('a'), output('b')], true));
    vi.advanceTimersByTime(900);
    outputs.length = 0;
    await engine.stop();
    expect(outputs.map((e) => e.type)).toEqual(['outputStopped', 'outputStopped']);
    // Metrics stop once the production is over.
    metrics.length = 0;
    vi.advanceTimersByTime(3000);
    expect(metrics).toHaveLength(0);
  });

  it('removeOutput emits outputStopped for that destination only', async () => {
    await engine.start(request([output('a'), output('b')]));
    vi.advanceTimersByTime(900);
    outputs.length = 0;
    await engine.removeOutput('a');
    expect(outputs).toEqual([{ type: 'outputStopped', destinationId: 'a' }]);
    await engine.removeOutput('missing');
    expect(outputs).toHaveLength(1);
  });

  it('exposes no previewStream but draws a generated pattern into a canvas', async () => {
    const fake = createFakeCanvas(1280, 720);
    engine.dispose();
    engine = build({ createCanvas: () => fake.canvas });
    const moment = defaultMoments()[1]!;
    await engine.startPreview(moment, '16:9');

    expect(engine.previewStream).toBeNull();
    expect(engine.previewCanvas).toBe(fake.canvas);
    expect(fake.texts()).toContain('DEMO PREVIEW');
    expect(fake.texts()).toContain(moment.name);

    const framesBefore = fake.ops('fillRect').length;
    vi.advanceTimersByTime(500);
    expect(fake.ops('fillRect').length).toBeGreaterThan(framesBefore);
  });

  it('redraws the pattern with the new Moment name on setMoment', async () => {
    const fake = createFakeCanvas(1280, 720);
    engine.dispose();
    engine = build({ createCanvas: () => fake.canvas });
    const moments = defaultMoments();
    await engine.startPreview(moments[1]!, '16:9');
    fake.calls.length = 0;
    await engine.setMoment(moments[4]!);
    expect(fake.texts()).toContain(moments[4]!.name);
  });

  it('attaches the pattern stream to a video element', async () => {
    const fake = createFakeCanvas(1280, 720);
    engine.dispose();
    engine = build({ createCanvas: () => fake.canvas });
    await engine.startPreview(defaultMoments()[1]!, '16:9');
    const video = document.createElement('video');
    engine.attachPreview(video);
    expect(fake.captureStreamCalls.length).toBeGreaterThan(0);
    engine.attachPreview(null);
  });

  it('stops the pattern loop on stopPreview', async () => {
    const fake = createFakeCanvas(1280, 720);
    engine.dispose();
    engine = build({ createCanvas: () => fake.canvas });
    await engine.startPreview(defaultMoments()[1]!, '16:9');
    await engine.stopPreview();
    const before = fake.calls.length;
    vi.advanceTimersByTime(2000);
    expect(fake.calls.length).toBe(before);
    expect(engine.isPreviewing).toBe(false);
  });

  it('survives having no canvas implementation at all', async () => {
    engine.dispose();
    engine = build({
      createCanvas: () => {
        throw new Error('no canvas here');
      },
    });
    await engine.startPreview(defaultMoments()[0]!, '9:16');
    expect(engine.previewCanvas).toBeNull();
    expect(() => engine.attachPreview(null)).not.toThrow();
  });
});

describe('mulberry32', () => {
  it('is deterministic per seed and stays in [0,1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 50; i += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('differs between seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});
