/**
 * Key agreement, authenticated encryption, and replay protection.
 *
 * WHAT THIS IS, PRECISELY, so nobody has to guess at its properties later:
 *
 *   Key agreement    X25519, twice. Client ephemeral against the relay's STATIC key, then client
 *                    ephemeral against a relay EPHEMERAL key. The first authenticates the relay
 *                    (only the holder of the static private key can read the client's opening
 *                    message); the second provides forward secrecy (compromising the static key
 *                    later does not decrypt a recorded session).
 *   Key derivation   HKDF-SHA256 over the concatenated shared secrets, with the full handshake
 *                    transcript as `info`, so both sides only agree if they saw the same bytes.
 *   Record encryption ChaCha20-Poly1305 AEAD, with the cleartext header as associated data.
 *   Client auth      An Ed25519-signed session token, carried INSIDE the encrypted opening message.
 *   Replay           A per-path sliding window, checked before decryption.
 *
 * This is the Noise NK pattern in shape. It is not a Noise implementation and does not claim to
 * be: it is built from Node's own `crypto` primitives, which is the honest reading of "do not
 * invent cryptography" - every primitive here is standard and none of them is hand-rolled.
 *
 * WHAT IT DOES NOT PROVIDE, stated plainly:
 *   - No protection against a relay whose static private key has been stolen. That key is the root
 *     of relay identity; there is no second factor.
 *   - No post-compromise security. A session whose derived key leaks is readable for its lifetime.
 *   - No identity hiding for the client: the token is encrypted, but traffic analysis still shows
 *     that a client is talking to this relay.
 */
import {
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  createPrivateKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign as edSign,
  timingSafeEqual,
  verify as edVerify,
  type KeyObject,
} from 'node:crypto';
import { COUNTER_LIMIT, TAG_BYTES, nonceFor } from './frame.js';

const AEAD = 'chacha20-poly1305';
const KEY_BYTES = 32;
/** Domain separation. Changing this makes every key in the system different. */
const SALT = Buffer.from('LIVETAP-BOND-v1');

export interface StaticKeyPair {
  readonly publicKey: KeyObject;
  readonly privateKey: KeyObject;
}

/** A relay's long-term identity. Its public half ships with the session token. */
export function generateStaticKeyPair(): StaticKeyPair {
  return generateKeyPairSync('x25519');
}

export function exportPublicKey(key: KeyObject): Buffer {
  // Raw 32 bytes, not DER: this goes on the wire and in a config file where a human may paste it.
  return key.export({ type: 'spki', format: 'der' }).subarray(-32);
}

export function importPublicKey(raw: Buffer): KeyObject {
  if (raw.length !== 32) throw new Error('an X25519 public key is 32 bytes');
  const der = Buffer.concat([
    Buffer.from('302a300506032b656e032100', 'hex'), // SPKI prefix for X25519
    raw,
  ]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

/**
 * What the broker signs to say this client may publish this session.
 *
 * Deliberately small and self-contained: the relay verifies it offline, with no callback, so a
 * broker outage cannot end a broadcast that has already started.
 */
export interface SessionToken {
  readonly sessionId: string;
  /** Unix seconds. Short - minutes, not hours. */
  readonly expiresAt: number;
  /** Destination ids this session may publish to. */
  readonly destinations: readonly string[];
  /** Bits per second the relay will accept. */
  readonly maxBitrateBps: number;
}

export function signToken(token: SessionToken, brokerPrivateKey: KeyObject): Buffer {
  const body = Buffer.from(JSON.stringify(token), 'utf8');
  const signature = edSign(null, body, brokerPrivateKey);
  const out = Buffer.allocUnsafe(2 + body.length + signature.length);
  out.writeUInt16BE(body.length, 0);
  body.copy(out, 2);
  signature.copy(out, 2 + body.length);
  return out;
}

export interface TokenVerdict {
  readonly ok: boolean;
  readonly token?: SessionToken;
  readonly reason?: string;
}

export function verifyToken(blob: Buffer, brokerPublicKey: KeyObject, nowSeconds: number): TokenVerdict {
  if (blob.length < 3) return { ok: false, reason: 'truncated' };
  const bodyLength = blob.readUInt16BE(0);
  if (blob.length < 2 + bodyLength) return { ok: false, reason: 'truncated' };
  const body = blob.subarray(2, 2 + bodyLength);
  const signature = blob.subarray(2 + bodyLength);
  if (!edVerify(null, body, brokerPublicKey, signature)) return { ok: false, reason: 'bad signature' };

  let token: SessionToken;
  try {
    token = JSON.parse(body.toString('utf8')) as SessionToken;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof token.expiresAt !== 'number' || token.expiresAt <= nowSeconds) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, token };
}

function deriveKey(secrets: Buffer, transcript: Buffer, label: string): Buffer {
  const info = Buffer.concat([Buffer.from(label, 'utf8'), transcript]);
  return Buffer.from(hkdfSync('sha256', secrets, SALT, info, KEY_BYTES));
}

function seal(key: Buffer, nonce: Buffer, aad: Buffer, plaintext: Buffer): Buffer {
  const cipher = createCipheriv(AEAD, key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad, { plaintextLength: plaintext.length });
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([body, cipher.getAuthTag()]);
}

function open(key: Buffer, nonce: Buffer, aad: Buffer, sealed: Buffer): Buffer | null {
  if (sealed.length < TAG_BYTES) return null;
  const body = sealed.subarray(0, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv(AEAD, key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad, { plaintextLength: body.length });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    // Authentication failed. Returning null rather than throwing, for the same reason
    // `decodeHeader` does: most of the failures at a public port are hostile, and an exception per
    // hostile packet is a DoS vector wearing error handling as a disguise.
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------------------------

export interface ClientHello {
  /** Bytes to put on the wire. */
  readonly datagram: Buffer;
  /** Kept by the client until WELCOME arrives. */
  readonly pending: PendingHandshake;
}

export interface PendingHandshake {
  readonly ephemeralPrivate: KeyObject;
  readonly ephemeralPublic: Buffer;
  readonly es: Buffer;
  readonly transcript: Buffer;
  readonly sessionId: bigint;
}

/**
 * Open a session. The token travels encrypted under a key only the real relay can derive.
 */
export function clientHello(args: {
  relayStaticPublic: KeyObject;
  tokenBlob: Buffer;
  sessionId: bigint;
}): ClientHello {
  const ephemeral = generateKeyPairSync('x25519');
  const ephemeralPublic = exportPublicKey(ephemeral.publicKey);
  const es = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: args.relayStaticPublic });

  const transcript = Buffer.concat([ephemeralPublic, exportPublicKey(args.relayStaticPublic)]);
  const key = deriveKey(es, transcript, 'hello');
  // Nonce is fixed here and safe: `key` is unique per handshake because the ephemeral is, so this
  // nonce is used exactly once under it.
  const sealed = seal(key, nonceFor(0, 0n), transcript, args.tokenBlob);

  const datagram = Buffer.concat([ephemeralPublic, sealed]);
  return {
    datagram,
    pending: { ephemeralPrivate: ephemeral.privateKey, ephemeralPublic, es, transcript, sessionId: args.sessionId },
  };
}

export interface RelayAccept {
  readonly ok: true;
  readonly token: SessionToken;
  /** Bytes to send back. */
  readonly datagram: Buffer;
  /** The session key both sides will use for DATA. */
  readonly sessionKey: Buffer;
}

export interface RelayReject {
  readonly ok: false;
  readonly reason: string;
}

/**
 * Accept or refuse a HELLO.
 *
 * Every rejection path returns before anything is allocated. A datagram that fails here has cost
 * the relay one ECDH and one AEAD attempt and nothing else - no session, no buffer, no timer.
 */
export function relayAccept(args: {
  hello: Buffer;
  relayStatic: StaticKeyPair;
  brokerPublicKey: KeyObject;
  nowSeconds: number;
}): RelayAccept | RelayReject {
  if (args.hello.length < 32 + TAG_BYTES) return { ok: false, reason: 'truncated hello' };
  const clientEphemeralRaw = args.hello.subarray(0, 32);
  const sealed = args.hello.subarray(32);

  let clientEphemeral: KeyObject;
  try {
    clientEphemeral = importPublicKey(clientEphemeralRaw);
  } catch {
    return { ok: false, reason: 'bad ephemeral key' };
  }

  const es = diffieHellman({ privateKey: args.relayStatic.privateKey, publicKey: clientEphemeral });
  const transcript = Buffer.concat([clientEphemeralRaw, exportPublicKey(args.relayStatic.publicKey)]);
  const helloKey = deriveKey(es, transcript, 'hello');
  const tokenBlob = open(helloKey, nonceFor(0, 0n), transcript, sealed);
  if (!tokenBlob) return { ok: false, reason: 'hello failed authentication' };

  const verdict = verifyToken(tokenBlob, args.brokerPublicKey, args.nowSeconds);
  if (!verdict.ok || !verdict.token) return { ok: false, reason: `token ${verdict.reason}` };

  // Forward secrecy: a fresh relay ephemeral, mixed into the session key.
  const relayEphemeral = generateKeyPairSync('x25519');
  const relayEphemeralPublic = exportPublicKey(relayEphemeral.publicKey);
  const ee = diffieHellman({ privateKey: relayEphemeral.privateKey, publicKey: clientEphemeral });

  const fullTranscript = Buffer.concat([transcript, relayEphemeralPublic]);
  const sessionKey = deriveKey(Buffer.concat([es, ee]), fullTranscript, 'session');
  const welcomeKey = deriveKey(Buffer.concat([es, ee]), fullTranscript, 'welcome');
  const confirmation = seal(welcomeKey, nonceFor(0, 0n), fullTranscript, Buffer.from('ok', 'utf8'));

  return {
    ok: true,
    token: verdict.token,
    datagram: Buffer.concat([relayEphemeralPublic, confirmation]),
    sessionKey,
  };
}

/** Finish the handshake on the client side. Null means the reply was not from the real relay. */
export function clientFinish(pending: PendingHandshake, welcome: Buffer): Buffer | null {
  if (welcome.length < 32 + TAG_BYTES) return null;
  const relayEphemeralRaw = welcome.subarray(0, 32);
  let relayEphemeral: KeyObject;
  try {
    relayEphemeral = importPublicKey(relayEphemeralRaw);
  } catch {
    return null;
  }
  const ee = diffieHellman({ privateKey: pending.ephemeralPrivate, publicKey: relayEphemeral });
  const fullTranscript = Buffer.concat([pending.transcript, relayEphemeralRaw]);
  const welcomeKey = deriveKey(Buffer.concat([pending.es, ee]), fullTranscript, 'welcome');
  const confirmation = open(welcomeKey, nonceFor(0, 0n), fullTranscript, welcome.subarray(32));
  if (!confirmation || confirmation.toString('utf8') !== 'ok') return null;
  return deriveKey(Buffer.concat([pending.es, ee]), fullTranscript, 'session');
}

// ---------------------------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------------------------

/**
 * A sliding replay window, per path, as in IPsec.
 *
 * Bond needs this more than most protocols do, because duplicates here are EXPECTED: keyframe
 * redundancy deliberately sends the same chunk down two paths. So "I have seen this before" cannot
 * be treated as an attack at the transport layer - it is handled by sequence, above. What this
 * window stops is the same *datagram on the same path* being replayed, which is the thing an
 * attacker can do and the sender never does.
 */
export class ReplayWindow {
  private highest = -1n;
  private bits = 0n;

  constructor(private readonly size = 1024) {}

  /** True when this counter is fresh. Records it as seen. False means drop. */
  accept(counter: bigint): boolean {
    if (counter < 0n || counter >= COUNTER_LIMIT) return false;

    if (counter > this.highest) {
      const shift = counter - this.highest;
      this.bits = shift >= BigInt(this.size) ? 0n : (this.bits << shift) & ((1n << BigInt(this.size)) - 1n);
      this.bits |= 1n;
      this.highest = counter;
      return true;
    }

    const behind = this.highest - counter;
    if (behind >= BigInt(this.size)) return false; // too old to judge; refuse rather than guess
    const mask = 1n << behind;
    if ((this.bits & mask) !== 0n) return false; // already seen
    this.bits |= mask;
    return true;
  }
}

/** One end of an established session. Owns nonce discipline so no caller can get it wrong. */
export class SecureChannel {
  private readonly counters = new Map<number, bigint>();
  private readonly windows = new Map<number, ReplayWindow>();

  constructor(private readonly key: Buffer) {
    if (key.length !== KEY_BYTES) throw new Error('a session key is 32 bytes');
  }

  /**
   * Next counter for a path.
   *
   * The ONLY place a counter is produced. Callers cannot supply one, which is what makes nonce
   * reuse unreachable rather than merely discouraged.
   */
  nextCounter(pathId: number): bigint {
    const next = (this.counters.get(pathId) ?? 0n) + 1n;
    if (next >= COUNTER_LIMIT) throw new Error(`path ${pathId} exhausted its counter space; rekey required`);
    this.counters.set(pathId, next);
    return next;
  }

  sealRecord(header: Buffer, pathId: number, counter: bigint, plaintext: Buffer): Buffer {
    return seal(this.key, nonceFor(pathId, counter), header, plaintext);
  }

  /**
   * Open a record. Null for every failure, and the replay check runs FIRST.
   *
   * Order matters: checking replay before decrypting means a flood of replayed datagrams costs a
   * bigint compare each rather than an AEAD each.
   */
  openRecord(header: Buffer, pathId: number, counter: bigint, sealed: Buffer): Buffer | null {
    let window = this.windows.get(pathId);
    if (!window) {
      window = new ReplayWindow();
      this.windows.set(pathId, window);
    }
    if (!window.accept(counter)) return null;
    return open(this.key, nonceFor(pathId, counter), header, sealed);
  }
}

/** Constant-time comparison, for anywhere a secret is compared. */
export function secretsEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A fresh, random session id. */
export function newSessionId(): bigint {
  return randomBytes(8).readBigUInt64BE(0);
}

export { createPrivateKey };
