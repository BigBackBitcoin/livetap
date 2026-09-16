/**
 * The part of Bond a browser can take part in.
 *
 * `index.ts` exports the network layer, which uses `node:dgram` and therefore cannot be pulled
 * into a web bundle — a browser cannot bind a socket to an interface, so it can never run Bond's
 * wire protocol. That fact has until now meant "Bond is not for web", which is a confusion between
 * two different things: a browser cannot BOND, but it can absolutely be MEASURED and DECIDED
 * about, and doing that in the same model as every other surface is what keeps one definition of
 * "unhealthy" across the product.
 *
 * So this entry carries the decision layer and nothing platform-bound. Importing it can never drag
 * a Node builtin into a bundle, which is enforced by a test rather than by this comment.
 */
export type {
  BondMode,
  BondPolicy,
  MeteredState,
  NetworkPath,
  PathCandidate,
  PathIndependence,
  PathSample,
  PathState,
  PathTransport,
} from './path/types.js';
export { DEFAULT_BOND_POLICY } from './path/types.js';

export {
  DEFAULT_THRESHOLDS,
  classifySample,
  isPending,
  isUsable,
  nextPathState,
  type PathContext,
  type PathEvent,
  type PathThresholds,
} from './path/stateMachine.js';

export {
  estimateCapacity,
  usefulCeilingFor,
  type CapacityEstimate,
  type CapacityInput,
} from './path/capacity.js';

export {
  DEFAULT_WEIGHTS,
  rankPaths,
  scorePath,
  type PathScore,
  type ScoreContext,
  type ScoreWeights,
} from './scoring/score.js';

export {
  DEFAULT_TUNING,
  decide,
  type BondDecision,
  type BondHealth,
  type BondTuning,
  type DecideInput,
  type PathAllocation,
  type RedundancyLevel,
} from './policy/decide.js';

export {
  BondMonitor,
  type BondMonitorOptions,
  type PathIdentity,
} from './monitor/BondMonitor.js';
