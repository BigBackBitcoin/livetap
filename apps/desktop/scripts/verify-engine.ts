/**
 * Headless verification harness for FfmpegEngine.
 *
 * Runs the real engine, with real ffmpeg child processes, against real local RTMP/SRT receivers —
 * no Electron, no renderer, no camera. A synthetic `testsrc2 + sine` source stands in for the
 * renderer's canvas stream (the `lavfi` source kind), which is the only substitution made.
 *
 * It proves or disproves, with numbers:
 *   1. two RTMP destinations fed from ONE encode                          (fan-out)
 *   2. killing one sender does not disturb the other or the recording     (isolation)
 *   3. the killed destination can be removed and re-added while live      (reconnect)
 *   4. encoder CPU at 1080p30 libx264 veryfast over 30 s                  (cost)
 *   5. the recording file is a valid, playable H.264/AAC file             (recording)
 *   6. SRT loopback publish                                              (srt)
 *   7. ffmpeg's `tee` muxer escaping, for the documented fallback topology
 *
 * Output is a JSON report on stdout; docs/qa/DESKTOP_ENGINE_VERIFICATION.md is written from it.
 *
 * Build + run:  npx tsup --config apps/desktop/tsup.verify.config.ts && node apps/desktop/dist/verify/verify-engine.cjs
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { IngestTarget } from '@livetap/core';

import type { DesktopEngineEvent, DesktopStartRequest } from '../src/shared/ipc.js';
import { buildTeeOutput, teeGlobalArgs } from '../src/main/ffmpeg/argv.js';
import { CpuSampler } from '../src/main/ffmpeg/cpu.js';
import { FfmpegEngine } from '../src/main/ffmpeg/FfmpegEngine.js';
import { probeEncoders } from '../src/main/ffmpeg/hardware.js';

const FFMPEG = process.env.LIVETAP_FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.LIVETAP_FFPROBE_PATH ?? 'ffprobe';
const WORK = path.join(os.tmpdir(), 'livetap-verify');

type Verdict = 'PASS' | 'FAIL' | 'SIMULATED' | 'UNVERIFIED';

interface Step {
  id: string;
  title: string;
  verdict: Verdict;
  detail: string;
  data?: Record<string, unknown>;
}

const steps: Step[] = [];
const events: DesktopEngineEvent[] = [];

function record(step: Step): void {
  steps.push(step);
  process.stderr.write(`[${step.verdict}] ${step.id} — ${step.detail}\n`);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function sizeOf(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

/** A local RTMP receiver: `ffmpeg -listen 1` accepts exactly one publisher, then exits. */
function startRtmpReceiver(port: number, appPath: string, outFile: string): ChildProcess {
  const argv = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-listen',
    '1',
    '-f',
    'flv',
    '-i',
    `rtmp://127.0.0.1:${port}/${appPath}`,
    '-map',
    '0',
    '-c',
    'copy',
    '-f',
    'mpegts',
    '-y',
    outFile,
  ];
  const child = spawn(FFMPEG, argv, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (d: string) => process.stderr.write(`  rtmp:${port} ${d.trim()}\n`));
  return child;
}

function startSrtReceiver(port: number, outFile: string): ChildProcess {
  const argv = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'mpegts',
    '-i',
    `srt://127.0.0.1:${port}?mode=listener&latency=200000`,
    '-map',
    '0',
    '-c',
    'copy',
    '-f',
    'mpegts',
    '-y',
    outFile,
  ];
  const child = spawn(FFMPEG, argv, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (d: string) => process.stderr.write(`  srt:${port} ${d.trim()}\n`));
  return child;
}

function runCapture(command: string, argv: string[], timeoutMs = 30_000): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, argv, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => {
      out += d;
    });
    child.stderr?.on('data', (d: string) => {
      err += d;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, out, err: err + error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

async function probeFile(file: string): Promise<Record<string, unknown>> {
  const { out, code } = await runCapture(FFPROBE, [
    '-hide_banner',
    '-v',
    'error',
    '-show_entries',
    'stream=index,codec_name,codec_type,profile,width,height,sample_rate,channels',
    '-show_entries',
    'format=format_name,duration,size,bit_rate',
    '-of',
    'json',
    file,
  ]);
  if (code !== 0) return { error: 'ffprobe failed', exitCode: code };
  try {
    return JSON.parse(out) as Record<string, unknown>;
  } catch {
    return { error: 'ffprobe output was not JSON' };
  }
}

function kill(child: ChildProcess | null): void {
  if (!child || child.exitCode !== null) return;
  try {
    child.kill('SIGKILL');
  } catch {
    // already gone
  }
}

async function main(): Promise<void> {
  if (existsSync(WORK)) rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

  const recvA = path.join(WORK, 'recv-a.ts');
  const recvB = path.join(WORK, 'recv-b.ts');
  const recvB2 = path.join(WORK, 'recv-b-readded.ts');
  const recvSrt = path.join(WORK, 'recv-srt.ts');

  /* -------------------------------------------------- 0. hardware probe */

  const report = await probeEncoders(FFMPEG);
  record({
    id: 'encoders',
    title: 'Hardware encoder probe (real 1-second encode per candidate)',
    verdict: report.all.some((r) => r.encoder === 'libx264' && r.status === 'PASS') ? 'PASS' : 'FAIL',
    detail: report.all.map((r) => `${r.encoder}=${r.status}`).join(' '),
    data: { ffmpegVersion: report.ffmpegVersion, recommended: report.recommended, results: report.all },
  });

  /* ------------------------------------------------------- 1. fan-out */

  let receiverA: ChildProcess | null = startRtmpReceiver(1935, 'live/a', recvA);
  let receiverB: ChildProcess | null = startRtmpReceiver(1936, 'live/b', recvB);
  await sleep(1200);

  const engine = new FfmpegEngine({
    ffmpegPath: FFMPEG,
    recordingsDir: path.join(WORK, 'recordings'),
    hardwareReport: report,
    cpuSampling: false,
    logger: {
      info: (m, meta) => process.stderr.write(`  engine ${m} ${JSON.stringify(meta ?? {})}\n`),
      warn: (m, meta) => process.stderr.write(`  engine WARN ${m} ${JSON.stringify(meta ?? {})}\n`),
      error: (m, meta) => process.stderr.write(`  engine ERROR ${m} ${JSON.stringify(meta ?? {})}\n`),
    },
  });
  engine.on((event) => {
    events.push(event);
    if (event.type !== 'metrics') process.stderr.write(`  event ${JSON.stringify(event)}\n`);
  });

  const ingestA: IngestTarget = { protocol: 'rtmp', url: 'rtmp://127.0.0.1:1935/live', streamKey: 'a' };
  const ingestB: IngestTarget = { protocol: 'rtmp', url: 'rtmp://127.0.0.1:1936/live', streamKey: 'b' };

  const request: DesktopStartRequest = {
    source: { kind: 'lavfi' },
    formats: {
      '16:9': {
        aspectRatio: '16:9',
        width: 1920,
        height: 1080,
        fps: 30,
        videoKbps: 4500,
        audioKbps: 160,
        codec: 'h264',
        keyframeIntervalSeconds: 2,
      },
    },
    outputs: [
      { destinationId: 'dest-a', aspectRatio: '16:9', ingest: ingestA },
      { destinationId: 'dest-b', aspectRatio: '16:9', ingest: ingestB },
    ],
    encoder: { preference: 'software', softwarePreset: 'veryfast', rateControl: 'cbr' },
    recording: { enabled: true, container: 'mp4', source: 'program' },
  };

  const startResult = await engine.start(request);
  const diagnostics = engine.diagnostics();
  await sleep(10_000);

  const aAfter10 = sizeOf(recvA);
  const bAfter10 = sizeOf(recvB);
  const recordingPath = diagnostics.recording;
  const recAfter10 = recordingPath ? sizeOf(recordingPath) : 0;

  record({
    id: 'fanout',
    title: 'Single encode fanned out to 2 RTMP destinations + 1 recording',
    verdict: aAfter10 > 100_000 && bAfter10 > 100_000 && recAfter10 > 100_000 ? 'PASS' : 'FAIL',
    detail: `after 10 s: recv-a=${aAfter10} B, recv-b=${bAfter10} B, recording=${recAfter10} B; encoder processes=${diagnostics.encoders.length}, sender processes=${diagnostics.senders.length}`,
    data: {
      startResult,
      encoderCount: diagnostics.encoders.length,
      senderCount: diagnostics.senders.length,
      encoderPids: diagnostics.encoders.map((e) => e.pid),
      senderPids: diagnostics.senders.map((s) => s.pid),
      bytes: { recvA: aAfter10, recvB: bAfter10, recording: recAfter10 },
      metrics: engine.metrics(),
    },
  });

  /* ---------------------------------------------- 2. encoder CPU over 30 s */

  const encoderPid = diagnostics.encoders[0]?.pid;
  const senderPids = diagnostics.senders.map((s) => s.pid).filter((p): p is number => typeof p === 'number');
  const sampler = new CpuSampler();
  let cpu: { encoderPerCorePct?: number; senderPerCorePct?: number; samples: number[] } = { samples: [] };
  if (typeof encoderPid === 'number') {
    await sampler.sample([encoderPid, ...senderPids]);
    const readings: number[] = [];
    let senderTotal = 0;
    let senderReadings = 0;
    for (let i = 0; i < 6; i += 1) {
      await sleep(5000);
      const s = await sampler.sample([encoderPid, ...senderPids]);
      const encoderPct = s.perPid.get(encoderPid);
      if (encoderPct !== undefined) readings.push(Number(encoderPct.toFixed(1)));
      for (const pid of senderPids) {
        const v = s.perPid.get(pid);
        if (v !== undefined) {
          senderTotal += v;
          senderReadings += 1;
        }
      }
    }
    const avg = readings.length > 0 ? readings.reduce((a, b) => a + b, 0) / readings.length : undefined;
    cpu = {
      samples: readings,
      ...(avg !== undefined ? { encoderPerCorePct: Number(avg.toFixed(1)) } : {}),
      ...(senderReadings > 0 ? { senderPerCorePct: Number((senderTotal / senderReadings).toFixed(1)) } : {}),
    };
  }
  record({
    id: 'cpu',
    title: 'Encoder CPU at 1080p30 libx264 veryfast, 30 s',
    verdict: cpu.encoderPerCorePct !== undefined ? 'PASS' : 'UNVERIFIED',
    detail:
      cpu.encoderPerCorePct !== undefined
        ? `encoder ${cpu.encoderPerCorePct}% of one core (${os.cpus().length} cores, ${((cpu.encoderPerCorePct / (os.cpus().length * 100)) * 100).toFixed(1)}% of machine); each sender ${cpu.senderPerCorePct ?? 0}% of one core`
        : 'CPU sampling unavailable on this host',
    data: { ...cpu, cores: os.cpus().length, cpuModel: os.cpus()[0]?.model, metrics: engine.metrics() },
  });

  /* ------------------------------------------------------- 3. isolation */

  const bPid = engine.diagnostics().senders.find((s) => s.destinationId === 'dest-b')?.pid;
  const aBeforeKill = sizeOf(recvA);
  const recBeforeKill = recordingPath ? sizeOf(recordingPath) : 0;
  if (typeof bPid === 'number') {
    // SIGKILL, not removeOutput: simulate a crashed/severed destination, the case that matters.
    try {
      process.kill(bPid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  await sleep(6000);
  const aAfterKill = sizeOf(recvA);
  const recAfterKill = recordingPath ? sizeOf(recordingPath) : 0;
  const lostEvent = events.find((e) => e.type === 'outputLost' && e.destinationId === 'dest-b');
  const survivorsStillLive = aAfterKill > aBeforeKill && recAfterKill > recBeforeKill;
  record({
    id: 'isolation',
    title: 'Killing sender B leaves A and the recording untouched',
    verdict: survivorsStillLive && lostEvent !== undefined ? 'PASS' : 'FAIL',
    detail: `killed pid ${String(bPid)}; recv-a grew ${aAfterKill - aBeforeKill} B, recording grew ${recAfterKill - recBeforeKill} B in 6 s; outputLost event: ${lostEvent ? JSON.stringify(lostEvent) : 'MISSING'}`,
    data: {
      killedPid: bPid,
      recvAGrowthBytes: aAfterKill - aBeforeKill,
      recordingGrowthBytes: recAfterKill - recBeforeKill,
      lostEvent,
      remainingSenders: engine.diagnostics().senders.map((s) => s.destinationId),
      encodersStillRunning: engine.diagnostics().encoders.length,
    },
  });

  /* ------------------------------------------------------- 4. reconnect */

  kill(receiverB);
  receiverB = null;
  const receiverB2 = startRtmpReceiver(1936, 'live/b', recvB2);
  await sleep(1200);
  await engine.removeOutput('dest-b'); // no-op if already gone; proves it is safe either way
  const readd = await engine.addOutput({ destinationId: 'dest-b', aspectRatio: '16:9', ingest: ingestB });
  const aBeforeReadd = sizeOf(recvA);
  await sleep(8000);
  const b2Size = sizeOf(recvB2);
  const aAfterReadd = sizeOf(recvA);
  record({
    id: 'reconnect',
    title: 'Re-adding destination B mid-broadcast, encoder untouched',
    verdict: readd.ok && b2Size > 100_000 && aAfterReadd > aBeforeReadd ? 'PASS' : 'FAIL',
    detail: `addOutput ok=${String(readd.ok)}; re-added destination received ${b2Size} B in 8 s while A kept growing (${aAfterReadd - aBeforeReadd} B); encoder pid unchanged: ${String(engine.diagnostics().encoders[0]?.pid === encoderPid)}`,
    data: {
      addOutputResult: readd,
      readdedBytes: b2Size,
      recvAGrowthBytes: aAfterReadd - aBeforeReadd,
      encoderPidBefore: encoderPid,
      encoderPidAfter: engine.diagnostics().encoders[0]?.pid,
      upEvents: events.filter((e) => e.type === 'outputUp'),
    },
  });

  /* ------------------------------------------------------------- 5. SRT */

  const srtReceiver = startSrtReceiver(8890, recvSrt);
  await sleep(1500);
  const srtIngest: IngestTarget = {
    protocol: 'srt',
    url: 'srt://127.0.0.1:8890',
    streamId: 'publish:live/srt',
  };
  const srtResult = await engine.addOutput({ destinationId: 'dest-srt', aspectRatio: '16:9', ingest: srtIngest });
  // The receiving ffmpeg must probe a stream it joined mid-flight before it writes its first output
  // byte, so measuring while it is still running reads 0 and means nothing. Give it 15 s, stop the
  // sender, then let the receiver flush and exit on its own before measuring.
  await sleep(15_000);
  const srtUpEvent = events.find((e) => e.type === 'outputUp' && e.destinationId === 'dest-srt');
  await engine.removeOutput('dest-srt');
  await sleep(1000);
  srtReceiver.kill('SIGTERM');
  await sleep(2500);
  const srtSize = sizeOf(recvSrt);
  const srtProbe = srtSize > 0 ? await probeFile(recvSrt) : { error: 'no bytes captured' };
  record({
    id: 'srt',
    title: 'SRT loopback publish (srt://127.0.0.1:8890, streamid=publish:live/srt)',
    verdict: srtResult.ok && srtSize > 100_000 ? 'PASS' : 'FAIL',
    detail: `addOutput ok=${String(srtResult.ok)}; outputUp=${srtUpEvent !== undefined ? 'yes' : 'no'}; SRT receiver captured ${srtSize} B`,
    data: { addOutputResult: srtResult, bytes: srtSize, upEvent: srtUpEvent, probe: srtProbe },
  });

  /* --------------------------------------------------------- 6. shutdown */

  const stopRecording = await engine.stopRecording();
  await engine.stop();
  await sleep(1500);
  kill(receiverA);
  receiverA = null;
  kill(receiverB2);
  // srtReceiver was already stopped in the SRT step.
  await sleep(1500);

  /* -------------------------------------------------------- 7. recording */

  const recordingFile = stopRecording.path ?? recordingPath;
  const recordingProbe = recordingFile && existsSync(recordingFile) ? await probeFile(recordingFile) : { error: 'no recording file' };
  const streams = Array.isArray((recordingProbe as { streams?: unknown }).streams)
    ? ((recordingProbe as { streams: Array<Record<string, unknown>> }).streams)
    : [];
  const hasVideo = streams.some((s) => s.codec_type === 'video' && s.codec_name === 'h264');
  const hasAudio = streams.some((s) => s.codec_type === 'audio' && s.codec_name === 'aac');
  const durationText = (recordingProbe as { format?: { duration?: string } }).format?.duration;
  const duration = durationText !== undefined ? Number(durationText) : 0;
  record({
    id: 'recording',
    title: 'Recording file is valid and playable',
    verdict: hasVideo && hasAudio && duration > 20 ? 'PASS' : 'FAIL',
    detail: `${recordingFile ?? 'none'} — ${String(duration)} s, h264=${String(hasVideo)}, aac=${String(hasAudio)}, ${sizeOf(recordingFile ?? '')} B`,
    data: { recordingFile, probe: recordingProbe, bytes: sizeOf(recordingFile ?? '') },
  });

  const probeA = existsSync(recvA) ? await probeFile(recvA) : { error: 'missing' };
  record({
    id: 'received-a',
    title: 'What destination A actually received (ffprobe of the captured RTMP stream)',
    verdict: sizeOf(recvA) > 100_000 ? 'PASS' : 'FAIL',
    detail: `${sizeOf(recvA)} B captured from rtmp://127.0.0.1:1935/live/a`,
    data: { probe: probeA, bytes: sizeOf(recvA) },
  });

  /* ------------------------------------------------- 8. tee escaping test */

  const teeFileA = path.join(WORK, 'tee-a.ts');
  const teeFileB = path.join(WORK, 'tee-b.ts');
  // Both slaves are local files, so the first doubles as the anchor (see buildTeeOutput).
  const teeOutput = buildTeeOutput([
    { format: 'mpegts', url: teeFileA, onfail: 'ignore' },
    { format: 'mpegts', url: teeFileB, onfail: 'ignore' },
  ]);
  const teeGlobal = teeGlobalArgs({
    attemptRecovery: true,
    recoverAnyError: true,
    recoveryWaitTime: 2,
    dropPktsOnOverflow: true,
    queueSize: 240,
  });
  const teeRun = await runCapture(
    FFMPEG,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=30:duration=3',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000',
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-t',
      '3',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-c:a',
      'aac',
      ...teeGlobal,
      teeOutput,
    ],
    60_000,
  );
  record({
    id: 'tee-escaping',
    title: 'tee muxer escaping (documented fallback topology)',
    verdict: teeRun.code === 0 && sizeOf(teeFileA) > 10_000 && sizeOf(teeFileB) > 10_000 ? 'PASS' : 'FAIL',
    detail: `exit ${String(teeRun.code)}; slave A ${sizeOf(teeFileA)} B, slave B ${sizeOf(teeFileB)} B; global fifo opts: ${teeGlobal.join(' ')}`,
    data: {
      teeOutput,
      teeGlobal,
      stderr: teeRun.err.trim().slice(0, 800),
      bytesA: sizeOf(teeFileA),
      bytesB: sizeOf(teeFileB),
    },
  });

  /* ----------------------------------------------------------- 9. report */

  const summary = {
    host: {
      platform: process.platform,
      release: os.release(),
      cpuModel: os.cpus()[0]?.model,
      cores: os.cpus().length,
      totalMemGb: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
      node: process.version,
      ffmpeg: report.ffmpegVersion,
    },
    steps,
    events: events.filter((e) => e.type !== 'metrics'),
    workDir: WORK,
    finishedAt: new Date().toISOString(),
  };
  process.stdout.write(`\n===VERIFY_JSON_START===\n${JSON.stringify(summary, null, 2)}\n===VERIFY_JSON_END===\n`);
  const failed = steps.filter((s) => s.verdict === 'FAIL');
  process.stderr.write(`\n${steps.length - failed.length}/${steps.length} steps passed\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  process.stderr.write(`verify-engine crashed: ${String(error)}\n`);
  if (error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
  process.exit(2);
});
