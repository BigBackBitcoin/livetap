/**
 * LIVETAP Bond: adaptive multi-path broadcast networking.
 *
 * What is here today is the decision layer and the proving ground for it: the path model, the
 * capacity estimator, the scorer, the policy engine, and the Bond Lab that drives all of them
 * across simulated time. What is NOT here is a wire protocol or a relay - those come next, and
 * this file exports nothing that pretends otherwise.
 *
 * The layering is deliberate and is the reason this was built before any transport was chosen:
 * every decision above is transport-agnostic, so whichever of SRT, QUIC, MPTCP or a custom UDP
 * protocol the research settles on plugs in underneath without any of this changing.
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
  formatResult,
  runScenario,
  type LabEvent,
  type LabPath,
  type LabResult,
  type LabScenario,
  type LabTick,
  type LinkProfile,
} from './lab/lab.js';
