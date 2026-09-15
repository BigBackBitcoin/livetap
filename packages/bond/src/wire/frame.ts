/**
 * The bytes on the wire.
 *
 * A Bond datagram is a 24-byte cleartext header, an AEAD ciphertext, and a 16-byte tag. The header
 * is in the clear because the relay has to route a datagram to the right session before it can
 * decrypt it, and it must do that cheaply: a relay that tries every session's key against every
 * arriving datagram is a free CPU amplifier for anyone who can send UDP.
 *
 * The header is NOT trusted. Every byte of it is fed to the AEAD as associated data, so a forged or
 * altered header fails authentication and the datagram is dropped before it can touch session
 * state. Cleartext here means routable, never believed.
 *
 * Layout, big-endian throughout:
 *
 *   0   u8    version
 *   1   u8    type
 *   2   u16   reserved (must be zero)
 *   4   u32   pathId       which path this came down
 *   8   u64   counter      per-path, never reused: the AEAD nonce is pathId || counter
 *   16  u64   sessionId    opaque, random per broadcast
 *   24  ...   ciphertext
 *   -16 ...   tag
 *
 * The payload is 1316 bytes of MPEG-TS - seven 188-byte packets - which is the classic
 * TS-over-UDP payload and is chosen because it fits under every MTU worth caring about, including
 * cellular. With 40 bytes of overhead a full datagram is 1356 bytes, comfortably under 1400, so
 * nothing fragments and a lost fragment cannot cost a whole packet twice.
 */

/** Protocol version. Bumped when the layout changes in a way an old relay cannot parse. */
export const BOND_VERSION = 1;

export const HEADER_BYTES = 24;
export const TAG_BYTES = 16;

/** MPEG-TS packet size, and how many ride in one datagram. */
export const TS_PACKET_SIZE = 188;
export const TS_PACKETS_PER_CHUNK = 7;
export const CHUNK_PAYLOAD_BYTES = TS_PACKET_SIZE * TS_PACKETS_PER_CHUNK; // 1316

/** The largest datagram this protocol will ever send. */
export const MAX_DATAGRAM_BYTES = HEADER_BYTES + CHUNK_PAYLOAD_BYTES + TAG_BYTES + 16;

export const FrameType = {
  /** Media. */
  DATA: 1,
  /** Client opens a session: ephemeral public key plus an authenticated token. */
  HELLO: 2,
  /** Relay accepts: its own ephemeral public key plus session parameters. */
  WELCOME: 3,
  /** An additional path joining an established session. */
  PATH_HELLO: 4,
  /** Per-path delivery report, relay to client. */
  ACK: 5,
  /** Orderly shutdown. */
  BYE: 6,
} as const;

export type FrameTypeValue = (typeof FrameType)[keyof typeof FrameType];

export interface BondHeader {
  readonly version: number;
  readonly type: FrameTypeValue;
  readonly pathId: number;
  /** Per-path monotonic counter. Together with pathId this is the AEAD nonce. */
  readonly counter: bigint;
  readonly sessionId: bigint;
}

export function encodeHeader(header: BondHeader): Buffer {
  const buffer = Buffer.allocUnsafe(HEADER_BYTES);
  buffer.writeUInt8(header.version, 0);
  buffer.writeUInt8(header.type, 1);
  buffer.writeUInt16BE(0, 2);
  buffer.writeUInt32BE(header.pathId, 4);
  buffer.writeBigUInt64BE(header.counter, 8);
  buffer.writeBigUInt64BE(header.sessionId, 16);
  return buffer;
}

/**
 * Parse a header, or return null.
 *
 * Null rather than throwing, because this runs on every datagram arriving at a public UDP port and
 * most of the malformed ones will be hostile. An exception per junk packet is a denial-of-service
 * vector dressed up as error handling.
 */
export function decodeHeader(datagram: Buffer): BondHeader | null {
  if (datagram.length < HEADER_BYTES + TAG_BYTES) return null;
  const version = datagram.readUInt8(0);
  if (version !== BOND_VERSION) return null;
  const type = datagram.readUInt8(1) as FrameTypeValue;
  if (!Object.values(FrameType).includes(type)) return null;
  // Reserved bytes must be zero. A future version that uses them will bump `version` first, so a
  // datagram with them set today is either corrupt or probing.
  if (datagram.readUInt16BE(2) !== 0) return null;
  return {
    version,
    type,
    pathId: datagram.readUInt32BE(4),
    counter: datagram.readBigUInt64BE(8),
    sessionId: datagram.readBigUInt64BE(16),
  };
}

/**
 * The AEAD nonce for a datagram: pathId then counter, 12 bytes.
 *
 * This is the single most important function in the protocol. ChaCha20-Poly1305 fails
 * catastrophically on nonce reuse - it leaks the XOR of the two plaintexts and breaks the
 * authenticator outright - so the nonce space is partitioned by path BY CONSTRUCTION. Two paths
 * cannot collide because their first four bytes differ, and one path cannot repeat because its
 * counter only ever increases. There is no code path that reuses a nonce; there is no place to put
 * one.
 */
export function nonceFor(pathId: number, counter: bigint): Buffer {
  const nonce = Buffer.allocUnsafe(12);
  nonce.writeUInt32BE(pathId, 0);
  nonce.writeBigUInt64BE(counter, 4);
  return nonce;
}

/**
 * The counter value at which a path must rekey or stop.
 *
 * 2^48 datagrams is around 281 trillion, or roughly 380 million years of continuous broadcast at
 * 1316 bytes and 6 Mbps. The limit exists so that "what happens at exhaustion" has a defined
 * answer rather than a wrap-around, not because anyone will reach it.
 */
export const COUNTER_LIMIT = 1n << 48n;

/** Split a TS byte stream into whole datagram-sized chunks. Leftover is returned for next time. */
export function chunkTs(buffer: Buffer): { chunks: Buffer[]; rest: Buffer } {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (buffer.length - offset >= CHUNK_PAYLOAD_BYTES) {
    chunks.push(buffer.subarray(offset, offset + CHUNK_PAYLOAD_BYTES));
    offset += CHUNK_PAYLOAD_BYTES;
  }
  return { chunks, rest: buffer.subarray(offset) };
}

/**
 * Does this chunk carry the start of a keyframe?
 *
 * Read out of the MPEG-TS adaptation field's random access indicator, which is a standard container
 * field - byte 5 bit 6 of a packet whose adaptation_field_control says an adaptation field is
 * present. This is deliberately NOT H.264 parsing: section 20 of the brief warns against inventing
 * codec assumptions, and reading a documented container flag invents nothing.
 *
 * Used only to decide what to duplicate. A wrong answer costs a little bandwidth or a little
 * protection, never correctness, which is the right blast radius for a heuristic.
 */
export function hasRandomAccessPoint(chunk: Buffer): boolean {
  for (let offset = 0; offset + TS_PACKET_SIZE <= chunk.length; offset += TS_PACKET_SIZE) {
    if (chunk.readUInt8(offset) !== 0x47) continue; // not a TS packet boundary
    const adaptationControl = (chunk.readUInt8(offset + 3) >> 4) & 0b11;
    // 0b10 = adaptation field only, 0b11 = adaptation field followed by payload.
    if (adaptationControl !== 0b10 && adaptationControl !== 0b11) continue;
    const adaptationLength = chunk.readUInt8(offset + 4);
    if (adaptationLength === 0) continue;
    const flags = chunk.readUInt8(offset + 5);
    if ((flags & 0b0100_0000) !== 0) return true; // random_access_indicator
  }
  return false;
}
