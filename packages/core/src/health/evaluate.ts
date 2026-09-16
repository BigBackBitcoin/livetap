import type { EngineMetrics, HealthAssessment, HealthLevel } from '../types/health.js';

/**
 * Turn raw engine metrics into a beginner-readable assessment.
 * Thresholds follow common streaming guidance: >1% dropped frames is noticeable, >5% is serious.
 */
export interface DestinationHealthSummary {
  reconnecting: number;
  degraded: number;
  failed: number;
}

export function evaluateHealth(
  m: EngineMetrics | undefined,
  now = Date.now(),
  destinations?: DestinationHealthSummary,
): HealthAssessment {
  const base = evaluateEngineHealth(m, now);
  if (!destinations) return base;
  const { reconnecting, degraded, failed } = destinations;
  if (reconnecting > 0) {
    return {
      ...base,
      level: worseOf(base.level, 'poor'),
      headline: reconnecting === 1 ? 'One destination is reconnecting' : `${reconnecting} destinations are reconnecting`,
      detail: 'Your other destinations keep streaming. LIVETAP is bringing this one back automatically.',
      reasons: [...base.reasons, `${reconnecting} destination(s) reconnecting`],
    };
  }
  if (degraded > 0) {
    return {
      ...base,
      level: worseOf(base.level, 'fair'),
      headline: degraded === 1 ? 'One destination is struggling' : `${degraded} destinations are struggling`,
      detail: 'Viewers there may see stutter. Everything else is unaffected.',
      reasons: [...base.reasons, `${degraded} destination(s) degraded`],
    };
  }
  if (failed > 0) {
    return { ...base, reasons: [...base.reasons, `${failed} destination(s) stopped`] };
  }
  return base;
}

const ORDER: HealthLevel[] = ['excellent', 'good', 'fair', 'poor', 'critical'];
function worseOf(a: HealthLevel, b: HealthLevel): HealthLevel {
  if (a === 'unknown') return b;
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

function evaluateEngineHealth(m: EngineMetrics | undefined, now: number): HealthAssessment {
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
  return applyConnectionHealth(
    {
      level,
      headline: copy.headline,
      detail: networkIssue ? copy.network : encoderIssue ? copy.encoder : copy.generic,
      reasons: reasons.length ? reasons : ['all metrics within target'],
      suggestion,
    },
    m,
  );
}

/**
 * Let Bond's judgment of the network override the inference made from bitrate and dropped frames.
 *
 * Everything above is a PROXY: a stream running under target might be a congested uplink or an
 * encoder that cannot keep up, and the evaluator has to guess from the shape of the numbers. Bond
 * measures the path itself, so when it has an opinion it is evidence rather than inference — and
 * it carries the one thing this function could never produce before, a bitrate the network has
 * actually been shown to carry.
 *
 * ONLY EVER MAKES THE ASSESSMENT WORSE OR MORE SPECIFIC. A healthy path does not clear an encoder
 * that is dropping frames, and an excellent bond over a stalling encoder is still a bad broadcast.
 * Bond knows about the network and nothing else, so it is given authority over exactly that.
 */
function applyConnectionHealth(base: HealthAssessment, m: EngineMetrics): HealthAssessment {
  if (!m.connectionHealth) return base;
  const ceiling = m.recommendedKbps;
  // "Try 2500 kbps" is something a person can act on. "Lower your bitrate" is a homework
  // assignment, and the number was never available to this function until Bond supplied it.
  const advice = ceiling && ceiling > 0 ? ` Try about ${ceiling} kbps.` : '';

  switch (m.connectionHealth) {
    case 'offline':
      return {
        ...base,
        level: 'critical',
        headline: 'Your connection dropped',
        detail: 'Nothing is reaching LIVETAP. Check your network — the broadcast resumes by itself once it is back.',
        reasons: [...base.reasons, 'no usable network path'],
        suggestion: 'none',
      };
    case 'insufficient':
      return {
        ...base,
        level: worseOf(base.level, 'poor'),
        headline: 'Your connection cannot keep up',
        detail: `There is not enough upload bandwidth for this quality.${advice}`,
        reasons: [...base.reasons, ceiling ? `network carries about ${ceiling} kbps` : 'network below stream bitrate'],
        suggestion: 'lowerBitrate',
      };
    case 'degraded':
      return {
        ...base,
        level: worseOf(base.level, 'fair'),
        headline: 'Your connection is unsteady',
        detail: `Viewers may see stutter.${advice}`,
        reasons: [...base.reasons, 'network path degraded'],
        suggestion: base.suggestion === 'none' ? 'lowerBitrate' : base.suggestion,
      };
    default:
      // 'excellent' and 'protected': the network is fine, which says nothing about the encoder.
      return base;
  }
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
