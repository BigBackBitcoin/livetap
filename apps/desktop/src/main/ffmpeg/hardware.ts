/**
 * Honest hardware-encoder detection.
 *
 * `ffmpeg -encoders` lists what was COMPILED IN, which on a typical build includes nvenc, qsv and
 * amf whether or not the machine has the matching GPU or driver. Reporting that list as
 * "hardware encoders available" is the single most common lie in streaming software, and it fails
 * at GO LIVE rather than at start-up.
 *
 * So: list the compiled encoders, then actually run each candidate for one second against a
 * synthetic source into `-f null -`. Only an exit code of 0 counts as PASS. Everything else is
 * UNAVAILABLE with the driver's own reason attached for Pro-mode diagnostics.
 */

import { spawn } from 'node:child_process';
import { buildEncoderProbeArgv } from './argv.js';

export type HardwareKind = 'nvenc' | 'qsv' | 'amf' | 'videotoolbox';

export interface EncoderProbeResult {
  encoder: string;
  kind: HardwareKind | 'software';
  /** PASS: actually encoded a second of video. UNAVAILABLE: compiled in but failed to open. */
  status: 'PASS' | 'UNAVAILABLE' | 'NOT_COMPILED';
  /** First meaningful stderr line, for diagnostics. Never shown in Simple Mode. */
  detail?: string;
  elapsedMs: number;
}

export interface HardwareReport {
  ffmpegPath: string;
  ffmpegVersion: string;
  /** Encoders that actually work, in preference order. */
  working: EncoderProbeResult[];
  all: EncoderProbeResult[];
  /** Encoder the engine should use by default on this machine. */
  recommended: string;
  hardwareKinds: HardwareKind[];
}

const CANDIDATES: Array<{ encoder: string; kind: HardwareKind | 'software'; platforms?: NodeJS.Platform[] }> = [
  { encoder: 'h264_nvenc', kind: 'nvenc' },
  { encoder: 'h264_qsv', kind: 'qsv' },
  { encoder: 'h264_amf', kind: 'amf', platforms: ['win32', 'linux'] },
  { encoder: 'h264_videotoolbox', kind: 'videotoolbox', platforms: ['darwin'] },
  { encoder: 'libx264', kind: 'software' },
];

function run(
  ffmpegPath: string,
  argv: string[],
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    // ARGV ARRAY ONLY. No `shell: true`, ever.
    const child = spawn(ffmpegPath, argv, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => {
      if (stdout.length < 1_000_000) stdout += d;
    });
    child.stderr?.on('data', (d: string) => {
      if (stderr.length < 200_000) stderr += d;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${error.message}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/** Which encoders this ffmpeg build contains at all. */
export async function listCompiledEncoders(ffmpegPath: string): Promise<Set<string>> {
  const { stdout } = await run(ffmpegPath, ['-hide_banner', '-encoders'], 20_000);
  const names = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*[A-Z.]{6}\s+(\S+)/.exec(line);
    if (match?.[1]) names.add(match[1]);
  }
  return names;
}

export async function ffmpegVersion(ffmpegPath: string): Promise<string> {
  const { stdout, stderr } = await run(ffmpegPath, ['-hide_banner', '-version'], 20_000);
  const text = stdout.length > 0 ? stdout : stderr;
  return text.split(/\r?\n/)[0]?.trim() ?? 'unknown';
}

/**
 * Probe every candidate and return an honest report. Cached by the caller (FfmpegEngine) so the
 * ~1 s per candidate is paid once per app launch, not once per GO LIVE.
 */
export async function probeEncoders(ffmpegPath: string, platform: NodeJS.Platform = process.platform): Promise<HardwareReport> {
  const version = await ffmpegVersion(ffmpegPath);
  const compiled = await listCompiledEncoders(ffmpegPath);
  const all: EncoderProbeResult[] = [];

  for (const candidate of CANDIDATES) {
    if (candidate.platforms && !candidate.platforms.includes(platform)) continue;
    if (!compiled.has(candidate.encoder)) {
      all.push({ encoder: candidate.encoder, kind: candidate.kind, status: 'NOT_COMPILED', elapsedMs: 0 });
      continue;
    }
    const started = Date.now();
    const { code, stderr, timedOut } = await run(ffmpegPath, buildEncoderProbeArgv(candidate.encoder), 30_000);
    const elapsedMs = Date.now() - started;
    // ffmpeg exits 0 on success. A failed encoder open also prints to stderr; keep the first line.
    const firstError = stderr
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0 && /error|cannot|fail|unable|not supported|unknown/i.test(l));
    const ok = code === 0 && !timedOut && firstError === undefined;
    const result: EncoderProbeResult = {
      encoder: candidate.encoder,
      kind: candidate.kind,
      status: ok ? 'PASS' : 'UNAVAILABLE',
      elapsedMs,
    };
    if (!ok) result.detail = timedOut ? 'probe timed out' : (firstError ?? `exit code ${String(code)}`);
    all.push(result);
  }

  const working = all.filter((r) => r.status === 'PASS');
  const hardwareKinds = working
    .map((r) => r.kind)
    .filter((k): k is HardwareKind => k !== 'software');
  // Hardware first when it genuinely works, otherwise libx264.
  const recommended = working.find((r) => r.kind !== 'software')?.encoder ?? working[0]?.encoder ?? 'libx264';

  return { ffmpegPath, ffmpegVersion: version, working, all, recommended, hardwareKinds };
}

/** Resolve an EncoderSettings preference against what actually works here. */
export function chooseEncoder(preference: string, report: HardwareReport): string {
  if (preference === 'software') {
    return report.all.find((r) => r.encoder === 'libx264' && r.status === 'PASS')?.encoder ?? 'libx264';
  }
  if (preference !== 'auto' && preference !== 'webcodecs') {
    const wanted = `h264_${preference}`;
    const match = report.all.find((r) => r.encoder === wanted && r.status === 'PASS');
    if (match) return match.encoder;
    // Asked for hardware that does not work here: fall back instead of failing at GO LIVE.
  }
  return report.recommended;
}
