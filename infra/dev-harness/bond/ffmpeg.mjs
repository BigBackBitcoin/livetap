/**
 * Where ffmpeg and ffprobe live, for the Bond harness.
 *
 * The desktop app bundles its own build under apps/desktop/resources/ffmpeg, which is the one the
 * product actually uses - so the harness uses it too. A proof that runs against a different ffmpeg
 * from the one that ships is a proof about somebody else's ffmpeg.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

function bundled(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const dir = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  return path.join(REPO_ROOT, 'apps', 'desktop', 'resources', 'ffmpeg', dir, exe);
}

function resolve(name, envVar) {
  const override = process.env[envVar];
  if (override && existsSync(override)) return override;
  const candidate = bundled(name);
  if (existsSync(candidate)) return candidate;
  // Fall back to PATH and let the spawn fail loudly if it is not there, rather than guessing.
  return name;
}

export function resolveFfmpeg() {
  return resolve('ffmpeg', 'LIVETAP_FFMPEG_PATH');
}

export function resolveFfprobe() {
  return resolve('ffprobe', 'LIVETAP_FFPROBE_PATH');
}
