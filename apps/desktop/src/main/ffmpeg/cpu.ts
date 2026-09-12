/**
 * Best-effort per-process CPU sampling.
 *
 * Node has no cross-platform per-pid CPU API, so this shells out to the OS tool (argv array, no
 * shell) and computes a percentage from the delta in cumulative CPU time. It is deliberately
 * low-frequency and entirely optional: if sampling fails, EngineMetrics.cpuPct is simply absent
 * rather than guessed. Used by the engine for the health signal and by scripts/verify-engine.ts to
 * produce the numbers in docs/qa/DESKTOP_ENGINE_VERIFICATION.md.
 */

import { spawn } from 'node:child_process';
import os from 'node:os';

interface Sample {
  cpuSeconds: number;
  atMs: number;
}

function runCapture(command: string, argv: string[], timeoutMs = 8000): Promise<string> {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(command, argv, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => {
      if (out.length < 100_000) out += d;
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve('');
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
}

/** Cumulative CPU seconds consumed by a pid, or undefined when it cannot be determined. */
export async function cpuSeconds(pid: number, platform: NodeJS.Platform = process.platform): Promise<number | undefined> {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  if (platform === 'win32') {
    const out = await runCapture('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).CPU`,
    ]);
    const value = Number(out.trim().replace(',', '.'));
    return Number.isFinite(value) ? value : undefined;
  }
  // macOS / Linux: `ps -o cputime=` gives [dd-]hh:mm:ss.
  const out = await runCapture('ps', ['-p', String(pid), '-o', 'cputime=']);
  const match = /(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/.exec(out.trim());
  if (!match) return undefined;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  return ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
}

/**
 * Tracks one or more pids and converts cumulative CPU time into a percentage of ONE core
 * (so 180 % means one and four fifths of a core — the number that actually matters for an encoder),
 * plus a percentage of the whole machine.
 */
export class CpuSampler {
  private readonly previous = new Map<number, Sample>();
  private readonly cores: number;

  constructor(cores = os.cpus().length) {
    this.cores = Math.max(1, cores);
  }

  /** Sample now. First call for a pid returns undefined (a delta needs two points). */
  async sample(pids: number[]): Promise<{ perCorePct?: number; machinePct?: number; perPid: Map<number, number> }> {
    const perPid = new Map<number, number>();
    let totalPct = 0;
    let measured = 0;
    const now = Date.now();
    for (const pid of pids) {
      const seconds = await cpuSeconds(pid);
      if (seconds === undefined) {
        this.previous.delete(pid);
        continue;
      }
      const prev = this.previous.get(pid);
      this.previous.set(pid, { cpuSeconds: seconds, atMs: now });
      if (!prev) continue;
      const wallSeconds = (now - prev.atMs) / 1000;
      if (wallSeconds <= 0.1) continue;
      const pct = ((seconds - prev.cpuSeconds) / wallSeconds) * 100;
      if (!Number.isFinite(pct) || pct < 0) continue;
      perPid.set(pid, pct);
      totalPct += pct;
      measured += 1;
    }
    if (measured === 0) return { perPid };
    return { perCorePct: totalPct, machinePct: totalPct / this.cores, perPid };
  }

  forget(pid: number): void {
    this.previous.delete(pid);
  }
}
