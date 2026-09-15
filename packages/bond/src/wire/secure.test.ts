import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import {
  ReplayWindow,
  SecureChannel,
  clientFinish,
  clientHello,
  exportPublicKey,
  generateStaticKeyPair,
  importPublicKey,
  newSessionId,
  relayAccept,
  signToken,
  verifyToken,
  type SessionToken,
} from './secure.js';
import { COUNTER_LIMIT, encodeHeader, FrameType, nonceFor } from './frame.js';

const NOW = 1_800_000_000;

function freshToken(overrides: Partial<SessionToken> = {}): SessionToken {
  return {
    sessionId: 'abc123',
    expiresAt: NOW + 600,
    destinations: ['dest-1'],
    maxBitrateBps: 6_000_000,
    ...overrides,
  };
}

function setup() {
  const relayStatic = generateStaticKeyPair();
  const broker = generateKeyPairSync('ed25519');
  return { relayStatic, broker };
}

/** A completed handshake, for the record tests. */
function established() {
  const { relayStatic, broker } = setup();
  const tokenBlob = signToken(freshToken(), broker.privateKey);
  const hello = clientHello({
    relayStaticPublic: relayStatic.publicKey,
    tokenBlob,
    sessionId: newSessionId(),
  });
  const accepted = relayAccept({
    hello: hello.datagram,
    relayStatic,
    brokerPublicKey: broker.publicKey,
    nowSeconds: NOW,
  });
  if (!accepted.ok) throw new Error(`handshake failed: ${accepted.reason}`);
  const clientKey = clientFinish(hello.pending, accepted.datagram);
  if (!clientKey) throw new Error('client could not finish');
  return { relayStatic, broker, clientKey, relayKey: accepted.sessionKey, token: accepted.token };
}

describe('handshake', () => {
  it('both ends derive the same session key', () => {
    const { clientKey, relayKey } = established();
    expect(clientKey.equals(relayKey)).toBe(true);
    expect(clientKey.length).toBe(32);
  });

  it('a relay without the static private key cannot read the token', () => {
    // This is what authenticates the relay: the opening message is encrypted to its static key, so
    // an impostor on the same address learns nothing and cannot answer.
    const { relayStatic, broker } = setup();
    const impostor = generateStaticKeyPair();
    const hello = clientHello({
      relayStaticPublic: relayStatic.publicKey,
      tokenBlob: signToken(freshToken(), broker.privateKey),
      sessionId: newSessionId(),
    });
    const result = relayAccept({
      hello: hello.datagram,
      relayStatic: impostor,
      brokerPublicKey: broker.publicKey,
      nowSeconds: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('authentication');
  });

  it('the client refuses a WELCOME from anyone but the relay it dialled', () => {
    const { relayStatic, broker } = setup();
    const hello = clientHello({
      relayStaticPublic: relayStatic.publicKey,
      tokenBlob: signToken(freshToken(), broker.privateKey),
      sessionId: newSessionId(),
    });
    // A forged reply: valid-looking ephemeral, no knowledge of `es`.
    const forged = Buffer.concat([exportPublicKey(generateStaticKeyPair().publicKey), randomBytes(18)]);
    expect(clientFinish(hello.pending, forged)).toBeNull();
  });

  it('every handshake produces a different key', () => {
    // Forward secrecy depends on the ephemerals actually being fresh.
    const a = established();
    const b = established();
    expect(a.clientKey.equals(b.clientKey)).toBe(false);
  });

  it('refuses an expired token', () => {
    const { relayStatic, broker } = setup();
    const hello = clientHello({
      relayStaticPublic: relayStatic.publicKey,
      tokenBlob: signToken(freshToken({ expiresAt: NOW - 1 }), broker.privateKey),
      sessionId: newSessionId(),
    });
    const result = relayAccept({ hello: hello.datagram, relayStatic, brokerPublicKey: broker.publicKey, nowSeconds: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('expired');
  });

  it('refuses a token signed by the wrong broker', () => {
    const { relayStatic, broker } = setup();
    const attacker = generateKeyPairSync('ed25519');
    const hello = clientHello({
      relayStaticPublic: relayStatic.publicKey,
      tokenBlob: signToken(freshToken(), attacker.privateKey),
      sessionId: newSessionId(),
    });
    const result = relayAccept({ hello: hello.datagram, relayStatic, brokerPublicKey: broker.publicKey, nowSeconds: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('signature');
  });

  it('refuses a token whose body was edited after signing', () => {
    const { relayStatic, broker } = setup();
    const blob = signToken(freshToken({ maxBitrateBps: 6_000_000 }), broker.privateKey);
    // Raise the bitrate ceiling in place. The signature must stop it.
    const edited = Buffer.from(blob);
    const body = edited.subarray(2, 2 + edited.readUInt16BE(0)).toString('utf8');
    const tampered = Buffer.from(body.replace('6000000', '9000000'), 'utf8');
    if (tampered.length === body.length) tampered.copy(edited, 2);
    else edited.writeUInt8(edited.readUInt8(2) ^ 0x01, 2); // still an edit the signature must catch

    const hello = clientHello({ relayStaticPublic: relayStatic.publicKey, tokenBlob: edited, sessionId: newSessionId() });
    const result = relayAccept({ hello: hello.datagram, relayStatic, brokerPublicKey: broker.publicKey, nowSeconds: NOW });
    expect(result.ok).toBe(false);
  });

  it('allocates nothing for a truncated or junk hello', () => {
    // A public UDP port that does work before authenticating is a free amplifier.
    const { relayStatic, broker } = setup();
    for (const junk of [Buffer.alloc(0), randomBytes(8), randomBytes(47), randomBytes(200)]) {
      const result = relayAccept({ hello: junk, relayStatic, brokerPublicKey: broker.publicKey, nowSeconds: NOW });
      expect(result.ok).toBe(false);
    }
  });
});

describe('records', () => {
  it('round-trips a payload', () => {
    const { clientKey, relayKey } = established();
    const send = new SecureChannel(clientKey);
    const recv = new SecureChannel(relayKey);

    const counter = send.nextCounter(1);
    const header = encodeHeader({ version: 1, type: FrameType.DATA, pathId: 1, counter, sessionId: 7n });
    const payload = randomBytes(1316);
    const sealed = send.sealRecord(header, 1, counter, payload);

    expect(recv.openRecord(header, 1, counter, sealed)).toEqual(payload);
  });

  it('refuses a record whose cleartext header was altered', () => {
    // The header is routable, never believed. It is associated data, so editing it breaks the tag.
    const { clientKey, relayKey } = established();
    const send = new SecureChannel(clientKey);
    const recv = new SecureChannel(relayKey);

    const counter = send.nextCounter(1);
    const header = encodeHeader({ version: 1, type: FrameType.DATA, pathId: 1, counter, sessionId: 7n });
    const sealed = send.sealRecord(header, 1, counter, Buffer.from('media'));

    const forged = Buffer.from(header);
    forged.writeBigUInt64BE(9n, 16); // claim a different session
    expect(recv.openRecord(forged, 1, counter, sealed)).toBeNull();
  });

  it('refuses a record from a different session', () => {
    const a = established();
    const b = established();
    const send = new SecureChannel(a.clientKey);
    const recv = new SecureChannel(b.relayKey);

    const counter = send.nextCounter(1);
    const header = encodeHeader({ version: 1, type: FrameType.DATA, pathId: 1, counter, sessionId: 7n });
    const sealed = send.sealRecord(header, 1, counter, Buffer.from('media'));
    expect(recv.openRecord(header, 1, counter, sealed)).toBeNull();
  });

  it('refuses a flipped bit anywhere in the ciphertext', () => {
    const { clientKey, relayKey } = established();
    const send = new SecureChannel(clientKey);
    const recv = new SecureChannel(relayKey);

    /*
     * A FRESH COUNTER PER ATTEMPT, deliberately. The replay window accepts a counter the first time
     * it is offered, whatever happens afterwards, so re-using one counter here would mean the
     * second and third damaged records were refused by the replay check rather than by the
     * authenticator - and the test would pass while proving nothing about the tag.
     */
    for (const damage of [0, 10, -1]) {
      const counter = send.nextCounter(1);
      const header = encodeHeader({ version: 1, type: FrameType.DATA, pathId: 1, counter, sessionId: 7n });
      const sealed = send.sealRecord(header, 1, counter, randomBytes(64));
      const damaged = Buffer.from(sealed);
      const index = damage === -1 ? damaged.length - 1 : damage;
      damaged.writeUInt8(damaged.readUInt8(index) ^ 0x01, index);
      expect(recv.openRecord(header, 1, counter, damaged)).toBeNull();
    }
  });
});

describe('nonce discipline', () => {
  it('never issues the same counter twice on one path', () => {
    const channel = new SecureChannel(randomBytes(32));
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) {
      const counter = channel.nextCounter(3);
      expect(seen.has(counter.toString())).toBe(false);
      seen.add(counter.toString());
    }
  });

  it('partitions the nonce space so two paths can never collide', () => {
    /*
     * The single most important property in the protocol. ChaCha20-Poly1305 fails catastrophically
     * on nonce reuse, so paths are separated BY CONSTRUCTION: the first four bytes of the nonce are
     * the path id, so path 1 counter 5 and path 2 counter 5 are different nonces and always will be.
     */
    const channel = new SecureChannel(randomBytes(32));
    const nonces = new Set<string>();
    for (const pathId of [1, 2, 3, 4]) {
      for (let i = 0; i < 500; i += 1) {
        const nonce = nonceFor(pathId, channel.nextCounter(pathId)).toString('hex');
        expect(nonces.has(nonce)).toBe(false);
        nonces.add(nonce);
      }
    }
    expect(nonces.size).toBe(2000);
  });

  it('survives paths appearing, dying and coming back', () => {
    // A recovered path must not restart its counter, or it replays its own nonces.
    const channel = new SecureChannel(randomBytes(32));
    const first = channel.nextCounter(9);
    channel.nextCounter(9);
    channel.nextCounter(9);
    // ...path 9 fails, and later returns. Same channel, same path id.
    const afterRecovery = channel.nextCounter(9);
    expect(afterRecovery).toBeGreaterThan(first);
  });

  it('refuses to continue past the counter limit rather than wrapping', () => {
    const channel = new SecureChannel(randomBytes(32));
    // Reach in and pretend a very long broadcast. Wrapping would reuse nonces silently, which is
    // the one failure mode that must be loud.
    (channel as unknown as { counters: Map<number, bigint> }).counters.set(1, COUNTER_LIMIT - 2n);
    expect(() => channel.nextCounter(1)).not.toThrow();
    expect(() => channel.nextCounter(1)).toThrow(/rekey/);
  });
});

describe('replay protection', () => {
  it('accepts each counter once and refuses the second copy', () => {
    const window = new ReplayWindow();
    expect(window.accept(1n)).toBe(true);
    expect(window.accept(1n)).toBe(false);
  });

  it('accepts out-of-order arrivals inside the window', () => {
    // Normal on a bonded stream: a slow path delivers older counters after a fast one.
    const window = new ReplayWindow();
    expect(window.accept(100n)).toBe(true);
    expect(window.accept(98n)).toBe(true);
    expect(window.accept(99n)).toBe(true);
    expect(window.accept(98n)).toBe(false);
  });

  it('refuses anything too old to judge', () => {
    const window = new ReplayWindow(64);
    expect(window.accept(1000n)).toBe(true);
    expect(window.accept(1n)).toBe(false);
  });

  it('keeps working after a large forward jump', () => {
    const window = new ReplayWindow(64);
    expect(window.accept(1n)).toBe(true);
    expect(window.accept(100_000n)).toBe(true);
    expect(window.accept(100_001n)).toBe(true);
    expect(window.accept(100_000n)).toBe(false);
  });

  it('stops a captured datagram being replayed at the channel', () => {
    const { clientKey, relayKey } = established();
    const send = new SecureChannel(clientKey);
    const recv = new SecureChannel(relayKey);
    const counter = send.nextCounter(1);
    const header = encodeHeader({ version: 1, type: FrameType.DATA, pathId: 1, counter, sessionId: 7n });
    const sealed = send.sealRecord(header, 1, counter, Buffer.from('media'));

    expect(recv.openRecord(header, 1, counter, sealed)).not.toBeNull();
    // An attacker captures that exact datagram and sends it again.
    expect(recv.openRecord(header, 1, counter, sealed)).toBeNull();
  });

  it('keeps a separate window per path, so one path cannot block another', () => {
    const { clientKey, relayKey } = established();
    const send = new SecureChannel(clientKey);
    const recv = new SecureChannel(relayKey);

    for (const pathId of [1, 2]) {
      const counter = send.nextCounter(pathId);
      const header = encodeHeader({ version: 1, type: FrameType.DATA, pathId, counter, sessionId: 7n });
      const sealed = send.sealRecord(header, pathId, counter, Buffer.from('media'));
      expect(recv.openRecord(header, pathId, counter, sealed)).not.toBeNull();
    }
  });
});

describe('key handling', () => {
  it('round-trips a public key through its wire form', () => {
    const pair = generateStaticKeyPair();
    const raw = exportPublicKey(pair.publicKey);
    expect(raw.length).toBe(32);
    expect(exportPublicKey(importPublicKey(raw))).toEqual(raw);
  });

  it('refuses a key of the wrong length rather than guessing', () => {
    expect(() => importPublicKey(randomBytes(31))).toThrow();
    expect(() => importPublicKey(randomBytes(33))).toThrow();
  });

  it('refuses a session key of the wrong length', () => {
    expect(() => new SecureChannel(randomBytes(16))).toThrow(/32 bytes/);
  });
});

describe('token verification', () => {
  it('accepts a good token', () => {
    const broker = generateKeyPairSync('ed25519');
    const blob = signToken(freshToken(), broker.privateKey);
    const verdict = verifyToken(blob, broker.publicKey, NOW);
    expect(verdict.ok).toBe(true);
    expect(verdict.token?.destinations).toEqual(['dest-1']);
  });

  it('refuses truncated and malformed blobs without throwing', () => {
    const broker = generateKeyPairSync('ed25519');
    for (const junk of [Buffer.alloc(0), Buffer.alloc(2), randomBytes(50)]) {
      expect(() => verifyToken(junk, broker.publicKey, NOW)).not.toThrow();
      expect(verifyToken(junk, broker.publicKey, NOW).ok).toBe(false);
    }
  });
});
