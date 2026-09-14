/**
 * LIVETAP dev-harness ingest - verification core.
 *
 * Answers one question: DID A REAL STREAM ARRIVE, AND WHAT WAS IT?
 *
 * The answer is assembled from two independent sources, and they check each
 * other:
 *
 *   1. The MediaMTX control API. Says whether a publisher is connected right
 *      now, how many bytes it has pushed, and what tracks the server itself
 *      parsed out of the RTMP handshake.
 *   2. ffprobe. Decodes the container for real, either from the live RTMP
 *      path or from a recorded segment on disk, and reports codec, profile,
 *      resolution, frame rate, sample rate, channels, duration and bitrate.
 *
 * The API alone is not evidence: it reports what the server believes. ffprobe
 * alone is not evidence either, because a stale recording from yesterday
 * probes perfectly. Together they are.
 */

import fs from 'node:fs';

import { apiRequest, listPaths, listPublishers, listRecordings, sleep, trimPath, ingestUrl } from './harness.mjs';
import { probeFile, probeLive, summarize } from './probe.mjs';

/**
 * Measure the live ingest bitrate from the control API.
 *
 * FLV over RTMP has no container bitrate field, so for a live probe the only
 * honest number is one measured over a real interval: sample bytesReceived
 * twice and divide. This is the actual rate the encoder is producing.
 */
async function measureLiveRate(cfg, pathName, windowMs = 1200) {
  const read = async () => {
    const paths = await listPaths(cfg);
    const found = paths.find((p) => p.name === pathName);
    return found ? found.bytesReceived : null;
  };
  const first = await read();
  if (first === null) return null;
  await sleep(windowMs);
  const second = await read();
  if (second === null || second < first) return null;
  const elapsedSec = windowMs / 1000;
  return {
    bytesDelta: second - first,
    windowSec: elapsedSec,
    bitrateBps: ((second - first) * 8) / elapsedSec,
  };
}

function normalizeCodec(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Run a verification.
 *
 * @param {object} cfg        harness config from loadConfig()
 * @param {object} options
 *   path               MediaMTX path to inspect (default cfg.defaultPath)
 *   source             'auto' | 'live' | 'record'
 *   file               explicit recording file, overrides source selection
 *   waitForPublisherMs how long to wait for a publisher before giving up
 *   expectVideo        expected video codec, e.g. 'h264'
 *   expectAudio        expected audio codec, e.g. 'aac'
 *   expectResolution   expected resolution, e.g. '1280x720'
 *   minDurationSec     minimum acceptable duration (recorded source only)
 *   minBytes           minimum bytes that must have reached the server
 * @returns {Promise<object>} result with pass/fail, reasons and the summary
 */
export async function verifyIngest(cfg, options = {}) {
  const pathName = trimPath(options.path ?? cfg.defaultPath);
  const source = options.source ?? 'auto';
  const waitMs = options.waitForPublisherMs ?? 0;
  const minBytes = options.minBytes ?? 1;

  const result = {
    path: pathName,
    pass: false,
    reasons: [],
    checks: [],
    api: { reachable: false, publishers: [], path: null, liveRate: null },
    probedSource: null,
    probeTarget: null,
    summary: null,
    probeError: null,
  };

  const fail = (reason) => {
    result.reasons.push(reason);
    return result;
  };

  // -- 1. Is the server even there? ----------------------------------------
  try {
    const res = await apiRequest(cfg, 'GET', '/v3/paths/list');
    if (res.status !== 200) return fail(`control API answered HTTP ${res.status}, expected 200`);
    result.api.reachable = true;
  } catch (err) {
    return fail(err.message);
  }

  // -- 2. Who is publishing? -----------------------------------------------
  const deadline = Date.now() + waitMs;
  let publishers = await listPublishers(cfg, pathName);
  while (publishers.length === 0 && Date.now() < deadline) {
    await sleep(250);
    publishers = await listPublishers(cfg, pathName);
  }
  result.api.publishers = publishers;

  const paths = await listPaths(cfg);
  result.api.path = paths.find((p) => p.name === pathName) ?? null;

  const livePublisher = publishers.length > 0;

  // -- 3. Choose what to probe ---------------------------------------------
  let probe = null;

  if (options.file) {
    if (!fs.existsSync(options.file)) return fail(`recording not found: ${options.file}`);
    result.probedSource = 'record';
    result.probeTarget = options.file;
    probe = await probeFile(options.file);
  } else if (source === 'live' || (source === 'auto' && livePublisher)) {
    if (!livePublisher) {
      return fail(
        `no publisher on path "${pathName}". Start a broadcast to this path, or run with --source=record to inspect the last recording.`,
      );
    }
    const url = ingestUrl(cfg, pathName);
    result.probedSource = 'live';
    result.probeTarget = url;
    probe = await probeLive(url);
    result.api.liveRate = await measureLiveRate(cfg, pathName);
  } else {
    const recordings = listRecordings(cfg, pathName);
    if (recordings.length === 0) {
      return fail(
        `nothing arrived: no publisher on "${pathName}" and no recording under ${cfg.recordingsDir}. ` +
          'The product never reached this server.',
      );
    }
    result.probedSource = 'record';
    result.probeTarget = recordings[0].file;
    result.recordingCount = recordings.length;
    if (livePublisher) {
      result.checks.push(
        'NOTE  a publisher is connected, so the newest segment is still being written; probing it anyway because --source=record was requested',
      );
    }
    probe = await probeFile(recordings[0].file);
  }

  if (!probe.ok) {
    result.probeError = probe.error;
    return fail(`ffprobe could not decode ${result.probedSource === 'live' ? 'the live path' : 'the recording'}: ${probe.error}`);
  }

  const summary = summarize(probe);
  result.summary = summary;

  // -- 4. Judge -------------------------------------------------------------
  if (!summary.video) fail('no video stream present');
  if (!summary.audio) fail('no audio stream present');

  if (summary.video && (summary.video.width === null || summary.video.height === null)) {
    fail('video stream carries no resolution');
  }

  const bytes = result.api.path ? result.api.path.bytesReceived : null;
  if (result.probedSource === 'live') {
    if (bytes !== null && bytes < minBytes) fail(`server received only ${bytes} bytes, expected at least ${minBytes}`);
    result.checks.push(`bytes received by server: ${bytes === null ? 'unknown' : bytes}`);
  } else {
    const size = summary.sizeBytes ?? 0;
    if (size < minBytes) fail(`recording is ${size} bytes, expected at least ${minBytes}`);
    result.checks.push(`recorded file size: ${size} bytes`);
  }

  if (options.expectVideo) {
    const want = normalizeCodec(options.expectVideo);
    const got = normalizeCodec(summary.video?.codec);
    if (got !== want) fail(`expected video codec ${options.expectVideo}, got ${summary.video?.codec ?? 'none'}`);
    else result.checks.push(`video codec is ${summary.video.codec} as expected`);
  }

  if (options.expectAudio) {
    const want = normalizeCodec(options.expectAudio);
    const got = normalizeCodec(summary.audio?.codec);
    if (got !== want) fail(`expected audio codec ${options.expectAudio}, got ${summary.audio?.codec ?? 'none'}`);
    else result.checks.push(`audio codec is ${summary.audio.codec} as expected`);
  }

  if (options.expectResolution) {
    const want = String(options.expectResolution).toLowerCase();
    const got = `${summary.video?.width ?? '?'}x${summary.video?.height ?? '?'}`;
    if (got !== want) fail(`expected resolution ${want}, got ${got}`);
    else result.checks.push(`resolution is ${got} as expected`);
  }

  if (options.minDurationSec !== undefined && options.minDurationSec !== null) {
    const dur = summary.durationSec;
    if (dur === null) {
      if (result.probedSource === 'record') fail('recording reports no duration');
      // A live probe has no container duration by design. Not a failure.
    } else if (dur < options.minDurationSec) {
      fail(`duration ${dur.toFixed(3)} s is below the required ${options.minDurationSec} s`);
    } else {
      result.checks.push(`duration ${dur.toFixed(3)} s meets the ${options.minDurationSec} s minimum`);
    }
  }

  result.pass = result.reasons.length === 0;
  return result;
}
