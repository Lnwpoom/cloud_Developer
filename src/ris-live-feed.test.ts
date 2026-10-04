/**
 * Drives the RIS Live feed client against a local WebSocket stand-in for
 * ris-live.ripe.net that replays real recorded frames.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import type { RawData, WebSocket } from 'ws';
import type { MonitoredPrefix, Observation } from './domain.ts';
import { parsePrefix } from './prefix.ts';
import { startRisLiveFeed } from './ris-live-feed.ts';
import type { FeedStatus, RisLiveFeed } from './ris-live-feed.ts';

const frame = (name: string): string =>
  readFileSync(new URL(`parsers/fixtures/ris-live/${name}`, import.meta.url), 'utf8').trim();
/** Real frames: one UPDATE announcing 2806:320:340::/42 and one announcing 2607:ffc0:1000::/36. */
const UPDATE = frame('ris-message-announce-and-withdraw-2026.json');
const AS_SET_UPDATE = frame('ris-message-as-set.json');
const KEEPALIVE = frame('ris-live-frames-2026.jsonl').split('\n')[3] ?? '';
const TRUNCATED = frame('ris-live-stream-2019-libbgpstream.jsonl').split('\n')[6] ?? '';

const monitored = (text: string, declaredOrigin: number): MonitoredPrefix => {
  const parsed = parsePrefix(text);
  if (!parsed.ok) throw new Error(parsed.problem);
  return { prefix: parsed.value, declaredOrigin };
};
const MONITORED = [monitored('2806:320::/32', 28438), monitored('2607:ffc0:1000::/36', 13340)];

const text = (data: RawData): string =>
  new TextDecoder().decode(Array.isArray(data) ? Buffer.concat(data) : data);

/** A local stand-in for RIS Live that records connections and what clients send. */
const startStandIn = async (port = 0) => {
  const server = new WebSocketServer({ host: '127.0.0.1', port });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const connections: { url: string; socket: WebSocket; received: unknown[] }[] = [];
  server.on('connection', (socket, request) => {
    const connection = { url: request.url ?? '', socket, received: [] as unknown[] };
    socket.on('message', (data) => {
      connection.received.push(JSON.parse(text(data)));
    });
    connections.push(connection);
  });
  const stop = (): Promise<void> => {
    for (const client of server.clients) client.terminate();
    return new Promise((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  };
  return { port: (server.address() as AddressInfo).port, connections, stop };
};

const waitFor = async (what: string, condition: () => boolean, timeoutMs = 3000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const setUp = async (timing = {}) => {
  const standIn = await startStandIn();
  cleanups.push(standIn.stop);
  const observed: Observation[] = [];
  const statuses: FeedStatus[] = [];
  const logs: string[] = [];
  const feed: RisLiveFeed = startRisLiveFeed({
    url: `ws://127.0.0.1:${String(standIn.port)}/v1/ws/`,
    client: 'test-client',
    monitoredPrefixes: MONITORED,
    observe: (observation) => observed.push(observation),
    log: (message) => logs.push(message),
    timing: { initialBackoffMs: 20, maxBackoffMs: 100, ...timing },
  });
  cleanups.push(feed.stop);
  feed.onChange((change) => {
    if (change.type === 'feed-status') statuses.push(change.status);
  });
  return { standIn, feed, observed, statuses, logs };
};

describe('RIS Live feed', () => {
  it('connects with its client identifier and subscribes once per monitored prefix to announcements of it and its more-specifics', async () => {
    const { standIn, feed } = await setUp();
    assert.equal(feed.state().status, 'connecting');

    await waitFor('two subscriptions', () => (standIn.connections[0]?.received.length ?? 0) >= 2);

    const [connection] = standIn.connections;
    assert.ok(connection);
    assert.equal(new URL(connection.url, 'ws://localhost').searchParams.get('client'), 'test-client');
    assert.deepEqual(connection.received, [
      { type: 'ris_subscribe', data: { type: 'UPDATE', prefix: '2806:320::/32', moreSpecific: true, require: 'announcements' } },
      { type: 'ris_subscribe', data: { type: 'UPDATE', prefix: '2607:ffc0:1000::/36', moreSpecific: true, require: 'announcements' } },
    ]);
    assert.equal(feed.state().status, 'connected');
  });

  it('passes each live observation on and counts it, skipping frames it cannot parse', async () => {
    const { standIn, feed, observed } = await setUp();
    await waitFor('connected', () => feed.state().status === 'connected');
    const counts: number[] = [];
    feed.onChange((change) => {
      if (change.type === 'observations') counts.push(change.count);
    });

    for (const text of [UPDATE, TRUNCATED, 'not json', KEEPALIVE, AS_SET_UPDATE]) {
      standIn.connections[0]?.socket.send(text);
    }
    await waitFor('two observations', () => observed.length >= 2);

    assert.deepEqual(
      observed.map((observation) => [observation.announcedPrefix.text, observation.source, observation.peer]),
      [
        ['2806:320:340::/42', 'live', '2001:7f8:1::a501:3030:1'],
        ['2607:ffc0:1000::/36', 'live', '2001:504:1::a500:2497:1'],
      ],
    );
    assert.deepEqual(counts, [1, 2]);
    assert.deepEqual(feed.state(), { status: 'connected', observations: 2 });
  });

  it('keeps the valid observations of an UPDATE with a malformed prefix and logs the prefix it skipped', async () => {
    const { standIn, feed, observed, logs } = await setUp();
    await waitFor('connected', () => feed.state().status === 'connected');
    const mixed = JSON.parse(UPDATE) as { data: Record<string, unknown> };
    mixed.data['announcements'] = [{ next_hop: '2001:db8::1', prefixes: ['2806:320:340::/42', '2806:320:340::1/42'] }];

    standIn.connections[0]?.socket.send(JSON.stringify(mixed));
    await waitFor('an observation', () => observed.length === 1);

    assert.deepEqual(
      observed.map((observation) => observation.announcedPrefix.text),
      ['2806:320:340::/42'],
    );
    assert.deepEqual(logs, ['RIS Live: skipped part of a frame: announced prefix "2806:320:340::1/42" has host bits set']);
  });

  it('after the connection drops, reports reconnecting, reconnects, re-subscribes and resumes observing', async () => {
    const { standIn, feed, observed, statuses } = await setUp();
    await waitFor('connected', () => feed.state().status === 'connected');

    standIn.connections[0]?.socket.terminate();
    await waitFor('a second subscribed connection', () => (standIn.connections[1]?.received.length ?? 0) >= 2);
    standIn.connections[1]?.socket.send(UPDATE);
    await waitFor('an observation', () => observed.length === 1);

    assert.deepEqual(statuses, ['connected', 'reconnecting', 'connected']);
    assert.deepEqual(feed.state(), { status: 'connected', observations: 1 });
  });

  it('keeps retrying while RIS Live is down and reconnects once it is back', async () => {
    const { standIn, feed, observed, statuses } = await setUp();
    await waitFor('connected', () => feed.state().status === 'connected');
    standIn.connections[0]?.socket.send(UPDATE);
    await waitFor('an observation', () => observed.length === 1);

    await standIn.stop();
    await waitFor('reconnecting', () => feed.state().status === 'reconnecting');
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(feed.state().status, 'reconnecting');

    const restarted = await startStandIn(standIn.port);
    cleanups.push(restarted.stop);
    await waitFor('re-subscribed', () => (restarted.connections[0]?.received.length ?? 0) >= 2);
    restarted.connections[0]?.socket.send(UPDATE);
    await waitFor('a second observation', () => observed.length === 2);

    assert.deepEqual(statuses, ['connected', 'reconnecting', 'connected']);
    assert.deepEqual(feed.state(), { status: 'connected', observations: 2 });
  });

  it('pings RIS Live and reconnects when the connection goes silent', async () => {
    const { standIn, feed } = await setUp({ pingIntervalMs: 20, idleTimeoutMs: 150 });
    await waitFor('connected', () => feed.state().status === 'connected');

    await waitFor('a ping', () =>
      standIn.connections[0]?.received.some((message) => JSON.stringify(message) === '{"type":"ping"}') ?? false,
    );
    await waitFor('a second connection after silence', () => standIn.connections.length >= 2, 2000);
  });

  it('stays connected while RIS Live answers its pings', async () => {
    const { standIn, feed, statuses } = await setUp({ pingIntervalMs: 20, idleTimeoutMs: 150 });
    await waitFor('connected', () => feed.state().status === 'connected');
    standIn.connections[0]?.socket.on('message', (data) => {
      if (text(data) === '{"type":"ping"}') standIn.connections[0]?.socket.send('{"type":"pong","data":null}');
    });

    await new Promise((resolve) => setTimeout(resolve, 400));

    assert.equal(standIn.connections.length, 1);
    assert.deepEqual(statuses, ['connected']);
  });

  it('reports reconnecting once the first connection attempt fails at startup, then connected once RIS Live is up', async () => {
    const standIn = await startStandIn();
    const { port } = standIn;
    await standIn.stop();
    const statuses: FeedStatus[] = [];
    const feed = startRisLiveFeed({
      url: `ws://127.0.0.1:${String(port)}/v1/ws/`,
      client: 'test-client',
      monitoredPrefixes: MONITORED,
      observe: () => undefined,
      log: () => undefined,
      timing: { initialBackoffMs: 20, maxBackoffMs: 40 },
    });
    cleanups.push(feed.stop);
    feed.onChange((change) => {
      if (change.type === 'feed-status') statuses.push(change.status);
    });
    assert.equal(feed.state().status, 'connecting');
    await waitFor('reconnecting', () => feed.state().status === 'reconnecting');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(feed.state().status, 'reconnecting');

    const restarted = await startStandIn(port);
    cleanups.push(restarted.stop);
    await waitFor('connected', () => feed.state().status === 'connected');

    assert.deepEqual(statuses, ['reconnecting', 'connected']);
  });
});
