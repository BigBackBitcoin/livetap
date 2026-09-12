import type { EngineMetrics, HealthAssessment, HealthLevel } from '../types/health.js';

/**
 * Turn raw engine metrics into a beginner-readable assessment.
 * Thresholds follow common streaming guidance: >1% dropped frames is noticeable, >5% is serious.
 */
export function evaluateHealth(m: EngineMetrics | undefined, now = Date.now()): HealthAssessment {
  if (!m || now - m.updatedAt > 10_000) {
    return {
      level: 'unknown',
      headline: 'Waiting for stream data',
      detail: 'Health appears once the encoder starts sending.',
      reasons: ['no recent metrics'],
      suggestion: 'none',
    };
  }

  const reasons: string[] = [];
  let score = 100;

  const bitrateRatio = m.targetKbps > 0 ? m.encodedKbps / m.targetKbps : 1;
  if (bitrateRatio < 0.5) {
    score -= 45;
    reasons.push(`bitrate ${Math.round(m.encodedKbps)} kbps is under 50% of target ${m.targetKbps} kbps`);
  } else if (bitrateRatio < 0.8) {
    score -= 20;
    reasons.push(`bitrate ${Math.round(m.encodedKbps)} kbps is under 80% of target ${m.targetKbps} kbps`);
  }

  if (m.networkDroppedPct >= 5) {
    score -= 45;
    reasons.push(`network dropped frames ${m.networkDroppedPct.toFixed(1)}%`);
  } else if (m.networkDroppedPct >= 1) {
    score -= 20;
    reasons.push(`network dropped frames ${m.networkDroppedPct.toFixed(1)}%`);
  }

  if (m.encoderDroppedPct >= 5) {
    score -= 40;
    reasons.push(`encoder lag ${m.encoderDroppedPct.toFixed(1)}% frames`);
  } else if (m.encoderDroppedPct >= 1) {
    score -= 15;
    reasons.push(`encoder lag ${m.encoderDroppedPct.toFixed(1)}% frames`);
  }

  const fpsRatio = m.targetFps > 0 ? m.renderFps / m.targetFps : 1;
  if (fpsRatio < 0.7) {
    score -= 25;
    reasons.push(`render ${m.renderFps.toFixed(0)} fps vs target ${m.targetFps}`);
  } else if (fpsRatio < 0.9) {
    score -= 10;
    reasons.push(`render ${m.renderFps.toFixed(0)} fps vs target ${m.targetFps}`);
  }

  if (m.cpuPct !== undefined && m.cpuPct >= 90) {
    score -= 15;
    reasons.push(`cpu ${m.cpuPct.toFixed(0)}%`);
  }

  const level = scoreToLevel(score);
  const networkIssue = m.networkDroppedPct >= 1 || bitrateRatio < 0.8;
  const encoderIssue = m.encoderDroppedPct >= 1 || fpsRatio < 0.9 || (m.cpuPct ?? 0) >= 90;

  let suggestion: HealthAssessment['suggestion'] = 'none';
  if (networkIssue && (level === 'poor' || level === 'critical')) suggestion = 'lowerBitrate';
  else if (encoderIssue && (level === 'poor' || level === 'critical')) {
    suggestion = m.encoderDroppedPct >= 5 ? 'lowerResolution' : 'lowerFps';
  }

  const copy = COPY[level];
  return {
    level,
    headline: copy.headline,
    detail: networkIssue ? copy.network : encoderIssue ? copy.encoder : copy.generic,
    reasons: reasons.length ? reasons : ['all metrics within target'],
    suggestion,
  };
}

function scoreToLevel(score: number): HealthLevel {
  if (score >= 95) return 'excellent';
  if (score >= 80) return 'good';
  if (score >= 60) return 'fair';
  if (score >= 35) return 'poor';
  return 'critical';
}

const COPY: Record<HealthLevel, { headline: string; network: string; encoder: string; generic: string }> = {
  excellent: {
    headline: 'Stream is excellent',
    network: 'Your connection is solid.',
    encoder: 'Your device is keeping up easily.',
    generic: 'Everything is running smoothly.',
  },
  good: {
    headline: 'Stream is healthy',
    network: 'Minor network wobble, nothing viewers will notice.',
    encoder: 'Minor encoder load, nothing viewers will notice.',
    generic: 'Everything looks good.',
  },
  fair: {
    headline: 'Stream is a little unstable',
    network: 'Your upload is dipping now and then. Viewers may see brief stutter.',
    encoder: 'Your device is close to its limit. Viewers may see brief stutter.',
    generic: 'Some frames are being skipped.',
  },
  poor: {
    headline: 'Stream quality is suffering',
    network: 'Your connection cannot sustain this quality. LIVETAP is adapting.',
    encoder: 'Your device cannot keep up with this quality. LIVETAP is adapting.',
    generic: 'Many frames are being skipped.',
  },
  critical: {
    headline: 'Stream is at risk',
    network: 'Very little data is reaching the platforms. Check your internet connection now.',
    encoder: 'Your device has nearly stalled encoding. Close other apps or lower quality now.',
    generic: 'Most frames are being lost.',
  },
  unknown: {
    headline: 'Waiting for stream data',
    network: '',
    encoder: '',
    generic: 'Health appears once the encoder starts sending.',
  },
};
