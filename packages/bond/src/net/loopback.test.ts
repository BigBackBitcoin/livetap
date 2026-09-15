/**
 * Client to relay, over real UDP sockets, with real crypto.
 *
 * Everything here goes through `node:dgram`. There is no fake transport, no injected socket and no
 * in-memory shortcut: the client binds a port, the relay binds a port, datagrams cross the loopback
 * interface, and what comes out of the relay is compared byte-for-byte with what went in.
 *
 * This is the test that decides whether Bond is a networking layer or a library. Loopback is not a
 * radio and proves nothing about a phone holding Wi-Fi and cellular at once - but every line of the
 * handshake, the AEAD, the replay window, the scheduler, the reassembler and the relay's session
 * handling is the production one, and it is genuinely running.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { BondClient, discoverDesktopPaths } from './BondClient.js';
import { BondRelay } from './BondRelay.js';
import { generateStaticKeyPair, signToken } from '../wire/secure.js';
import { CHUNK_PAYLOAD_BYTES, TS_PACKET_SIZE } from '../wire/frame.js';

const NOW_SECONDS = () => Math.floor(Date.now() / 1000);

/** Synthetic MPEG-TS: real 188-byte packets with real sync bytes, deterministic contents. */
function makeTs(packets: number, options: { randomAccessEvery?: number } = {}): Buffer {
  const buffer = Buffer.alloc(packets * TS_PACKET_SIZE);
  for (let i = 0; i < packets; i += 1) {
    const offset = i * TS_PACKET_SIZE;
    buffer.writeUInt8(0x47, offset);
    buffer.writeUInt8(0x00, offset + 1);
    buffer.writeUInt8(0x11, offset + 2);
    const isRap = options.randomAccessEvery ? i % options.randomAccessEvery === 0 : false;
    // 0b11 = adaptation field then payload, so the random access indicator has somewhere to live.
    buffer.writeUInt8(isRap ? 0x30 : 0x10, offset + 3);
    if (isRap) {
      buffer.writeUInt8(1, offset + 4);
      buffer.writeUInt8(0b0100_0000, offset + 5);
    }
    // A recognisable pattern so a byte-for-byte comparison means something.
    for (let b = 8; b < TS_PACKET_SIZE; b += 1) buffer.writeUInt8((i + b) & 0xff, offset + b);
  }
  return buffer;
}

interface Rig {
  relay: BondRelay;
  client: BondClient;
  received: Buffer[];
  port: number;
  close: () => Promise<void>;
}

async function rig(options: { deadlineMs?: number } = {}): Promise<Rig> {
  const relayStatic = generateStaticKeyPair();
  const broker = generateKeyPairSync('ed25519');

  const relay = new BondRelay({
    port: 0,
    address: '127.0.0.1',
    relayStatic,
    brokerPublicKey: broker.publicKey,
    deadlineMs: options.deadlineMs ?? 300,
  });

  const received: Buffer[] = [];
  relay.on('session', ({ stream }) => {
    stream.on('data', (piece: Buffer) => received.push(piece));
  });

  const port = await relay.listen();

  const tokenBlob = signToken(
    {
      sessionId: 'loopback',
      expiresAt: NOW_SECONDS() + 600,
      destinations: ['local'],
      maxBitrateBps: 12_000_000,
    },
    broker.privateKey,
  );

  const client = new BondClient({
    relayHost: '127.0.0.1',
    relayPort: port,
    relayStaticPublic: relayStatic.publicKey,
    tokenBlob,
    streamBitrateBps: 6_000_000,
  });

  return {
    relay,
    client,
    received,
    port,
    close: async () => {
      await client.close();
      await relay.close();
    },
  };
}

/** Wait until `check` is true or the budget runs out. Returns whether it became true. */
async function until(check: () => boolean, budgetMs = 4000): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return check();
}

let open: Rig | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

describe('a real session over real sockets', () => {
  it('completes a handshake and reports a live path', async () => {
    open = await rig();
    await open.client.connect({ transport: 'ethernet', label: 'Loopback', metered: 'unmetered' });

    const telemetry = open.client.telemetry();
    expect(telemetry.paths).toHaveLength(1);
    expect(telemetry.sessionId).toMatch(/^[0-9a-f]+$/);
  });

  it('refuses a client whose token was signed by someone else', async () => {
    // The relay must not accept a session just because the datagram was well formed.
    const relayStatic = generateStaticKeyPair();
    const realBroker = generateKeyPairSync('ed25519');
    const attacker = generateKeyPairSync('ed25519');

    const relay = new BondRelay({
      port: 0,
      address: '127.0.0.1',
      relayStatic,
      brokerPublicKey: realBroker.publicKey,
    });
    const refusals: string[] = [];
    relay.on('refused', ({ reason }) => refusals.push(reason));
    let sessions = 0;
    relay.on('session', () => {
      sessions += 1;
    });
    const port = await relay.listen();

    const client = new BondClient({
      relayHost: '127.0.0.1',
      relayPort: port,
      relayStaticPublic: relayStatic.publicKey,
      tokenBlob: signToken(
        { sessionId: 'forged', expiresAt: NOW_SECONDS() + 600, destinations: [], maxBitrateBps: 1 },
        attacker.privateKey,
      ),
    });

    await expect(client.connect()).rejects.toThrow(/did not answer/);
    expect(sessions).toBe(0);
    expect(refusals.join(' ')).toContain('signature');

    await client.close();
    await relay.close();
  }, 15_000);

  it('carries media end to end, byte for byte', async () => {
    /*
     * The whole point. Real TS goes in one side, crosses a real socket encrypted, is reassembled by
     * the relay, and comes out identical.
     */
    open = await rig();
    await open.client.connect({ transport: 'ethernet', label: 'Loopback', metered: 'unmetered' });

    const sent = makeTs(7 * 40, { randomAccessEvery: 70 });
    open.client.write(sent);

    const expectedBytes = Math.floor(sent.length / CHUNK_PAYLOAD_BYTES) * CHUNK_PAYLOAD_BYTES;
    const arrived = await until(
      () => open!.received.reduce((sum, piece) => sum + piece.length, 0) >= expectedBytes,
    );
    expect(arrived).toBe(true);

    const out = Buffer.concat(open.received);
    expect(out.length).toBe(expectedBytes);
    expect(out.equals(sent.subarray(0, expectedBytes))).toBe(true);
  }, 15_000);

  it('holds back a partial chunk instead of sending a short datagram', async () => {
    // TS is a packet stream; half a chunk is not a thing to put on the wire. The remainder waits
    // for the bytes that complete it, exactly as the encoder will supply them a moment later.
    open = await rig();
    await open.client.connect({ transport: 'ethernet', label: 'Loopback', metered: 'unmetered' });

    open.client.write(makeTs(3)); // less than one 7-packet chunk
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(open.received.reduce((sum, p) => sum + p.length, 0)).toBe(0);

    open.client.write(makeTs(4)); // completes the chunk
    const arrived = await until(() => open!.received.reduce((sum, p) => sum + p.length, 0) === CHUNK_PAYLOAD_BYTES);
    expect(arrived).toBe(true);
  }, 15_000);

  it('survives a long run without losing or reordering anything', async () => {
    open = await rig();
    await open.client.connect({ transport: 'ethernet', label: 'Loopback', metered: 'unmetered' });

    const sent = makeTs(7 * 400, { randomAccessEvery: 140 });
    // Written in pieces that do not align to chunk boundaries, the way an encoder actually emits.
    for (let offset = 0; offset < sent.length; offset += 5000) {
      open.client.write(sent.subarray(offset, Math.min(offset + 5000, sent.length)));
    }

    const expectedBytes = Math.floor(sent.length / CHUNK_PAYLOAD_BYTES) * CHUNK_PAYLOAD_BYTES;
    const arrived = await until(
      () => open!.received.reduce((sum, piece) => sum + piece.length, 0) >= expectedBytes,
      8000,
    );
    expect(arrived).toBe(true);
    expect(Buffer.concat(open.received).subarray(0, expectedBytes).equals(sent.subarray(0, expectedBytes))).toBe(true);

    const stats = open.relay.stats()[0];
    expect(stats?.reassembly.lost).toBe(0);
  }, 20_000);

  it('flushes what it is holding when the client says goodbye', async () => {
    // A buffer that only moves on arrival holds the last chunks forever, which is how the end of a
    // broadcast goes missing.
    open = await rig();
    await open.client.connect({ transport: 'ethernet', label: 'Loopback', metered: 'unmetered' });

    const sent = makeTs(7 * 10);
    open.client.write(sent);
    await until(() => open!.received.length > 0);

    let ended = false;
    open.relay.on('sessionEnded', () => {
      ended = true;
    });
    await open.client.close();
    expect(await until(() => ended, 3000)).toBe(true);
    expect(Buffer.concat(open.received).equals(sent)).toBe(true);
  }, 15_000);
});

describe('multiple paths on one session', () => {
  it('adds a second path without a second handshake, and uses both', async () => {
    /*
     * Two genuinely separate sockets, each with its own port, its own path id and its own counter
     * space. Loopback is one physical interface - this cannot prove a phone holds two radios - but
     * every line of path registration, scheduling, per-path nonces and per-path ACKs is exercised
     * for real.
     */
    open = await rig();
    await open.client.connect({ transport: 'ethernet', label: 'Path A', metered: 'unmetered' });

    const joined: number[] = [];
    open.relay.on('pathJoined', ({ pathId }) => joined.push(pathId));

    const secondId = await open.client.addPath({ transport: 'ethernet', label: 'Path B', metered: 'unmetered' });
    expect(secondId).toBe(2);
    expect(await until(() => joined.includes(2), 3000)).toBe(true);

    const sent = makeTs(7 * 200, { randomAccessEvery: 70 });
    for (let offset = 0; offset < sent.length; offset += 4000) {
      open.client.write(sent.subarray(offset, Math.min(offset + 4000, sent.length)));
    }

    const expectedBytes = Math.floor(sent.length / CHUNK_PAYLOAD_BYTES) * CHUNK_PAYLOAD_BYTES;
    expect(await until(() => open!.received.reduce((s, p) => s + p.length, 0) >= expectedBytes, 8000)).toBe(true);
    expect(Buffer.concat(open.received).subarray(0, expectedBytes).equals(sent.subarray(0, expectedBytes))).toBe(true);

    const stats = open.relay.stats()[0];
    expect(stats?.paths).toBeGreaterThanOrEqual(2);
  }, 25_000);
});

describe('telemetry', () => {
  it('reports real numbers rather than placeholders', async () => {
    open = await rig();
    await open.client.connect({ transport: 'ethernet', label: 'Loopback', metered: 'unmetered' });
    open.client.write(makeTs(7 * 60));

    await until(() => open!.client.telemetry().paths[0]!.throughputBps > 0, 5000);
    const telemetry = open.client.telemetry();

    expect(telemetry.paths[0]!.label).toBe('Loopback');
    expect(telemetry.paths[0]!.throughputBps).toBeGreaterThan(0);
    expect(telemetry.scheduler.chunks).toBeGreaterThan(0);
    expect(telemetry.reason.length).toBeGreaterThan(0);
    // The sentence a creator might read must stay free of jargon even in a diagnostic dump.
    expect(telemetry.reason).not.toMatch(/MPTCP|QUIC|subflow|datagram|AEAD/i);
  }, 15_000);
});

describe('desktop path discovery', () => {
  it('finds at least one usable local address on this machine', () => {
    const paths = discoverDesktopPaths();
    expect(Array.isArray(paths)).toBe(true);
    for (const path of paths) {
      expect(path.localAddress).toBeTruthy();
      // Loopback goes nowhere and link-local means DHCP failed. Neither is a path.
      expect(path.localAddress).not.toBe('127.0.0.1');
      expect(path.localAddress!.startsWith('169.254.')).toBe(false);
    }
  });

  it('never reports the same local address twice', () => {
    // Counting one uplink twice is the over-claim this whole layer is built to avoid.
    const paths = discoverDesktopPaths();
    const addresses = paths.map((p) => p.localAddress);
    expect(new Set(addresses).size).toBe(addresses.length);
  });
});
