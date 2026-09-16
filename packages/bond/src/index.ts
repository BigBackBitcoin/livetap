/**
 * LIVETAP Bond: adaptive multi-path broadcast networking.
 *
 * What is here today: the decision layer (path model, capacity estimator, scorer, policy engine),
 * the transport logic that makes a bonded stream reconstructable (scheduler, reorder buffer), and
 * the Bond Lab that drives all of it across simulated time.
 *
 * What is NOT here: a wire protocol, a relay, or any platform network discovery. Nothing in this
 * package has opened a socket. It exports nothing that pretends otherwise.
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
  DEFAULT_REASSEMBLE,
  Reassembler,
  recommendedDeadlineMs,
  type BondChunk,
  type FrameType,
  type ReassembleOptions,
  type ReassembleStats,
} from './transport/reassemble.js';

export {
  BondScheduler,
  type ChunkAssignment,
  type SchedulerStats,
} from './transport/schedule.js';

/*
 * The network layer. Node-only: it uses `node:dgram`, so it runs in the Electron main process and
 * in the relay, and must never be pulled into the web bundle. A browser cannot bind a socket to an
 * interface, so there is nothing here it could use.
 */
export {
  BondClient,
  discoverDesktopPaths,
  type BondClientOptions,
  type BondClientTelemetry,
  type BondPathSpec,
  type BondPathTelemetry,
} from './net/BondClient.js';

export {
  BondMonitor,
  type BondMonitorOptions,
  type PathIdentity,
} from './monitor/BondMonitor.js';

export { BondSink, type BondSinkOptions } from './net/BondSink.js';

export {
  BondRelay,
  type BondRelayOptions,
  type RelaySessionStats,
} from './net/BondRelay.js';

export {
  BOND_VERSION,
  CHUNK_PAYLOAD_BYTES,
  // Renamed on the package surface: `FrameType` already means "key | inter | audio" here, and a
  // datagram type and a media frame class are different enough that sharing a name would be a bug
  // waiting to be written.
  FrameType as WireFrameType,
  MAX_DATAGRAM_BYTES,
  TS_PACKET_SIZE,
  hasRandomAccessPoint,
} from './wire/frame.js';

export {
  SecureChannel,
  exportPublicKey,
  generateStaticKeyPair,
  importPublicKey,
  newSessionId,
  signToken,
  verifyToken,
  type SessionToken,
  type StaticKeyPair,
} from './wire/secure.js';

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
