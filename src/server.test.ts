/**
 * Drives the web server over real HTTP on an ephemeral port, with a real
 * Monitor and Simulator and a stand-in for the live feed.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { createMonitor } from './monitor.ts';
import type { MonitoredPrefix } from './monitor.ts';
import { parsePrefix } from './prefix.ts';
import { createSimulator } from './simulation.ts';
import { createWebServer, listen, ListenError } from './server.ts';

const monitored = (text: string, declaredOrigin: number): MonitoredPrefix => {
  const parsed = parsePrefix(text);
  if (!parsed.ok) throw new Error(parsed.problem);
  return { prefix: parsed.prefix, declaredOrigin };
};

const PAGE = '<!doctype html><title>BGP Hijack Monitor</title>';

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const close = (server: { close: (callback: () => void) => unknown }): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });

const setUp = (monitoredPrefixes: readonly MonitoredPrefix[] = [monitored('203.0.113.0/24', 64500)]) => {
  const monitor = createMonitor({ monitoredPrefixes });
  const simulator = createSimulator({ monitoredPrefixes, observe: monitor.observe, now: () => new Date() });
  const feed = {
    state: () => ({ status: 'reconnecting', observations: 7 }) as const,
    onChange: () => () => undefined,
  };
  return { monitor, server: createWebServer({ monitor, simulator, feed, page: PAGE }) };
};

describe('listen', () => {
  it('rejects with a ListenError naming the port and carrying the cause when the port is taken', async () => {
    const occupier = createServer();
    await new Promise<void>((resolve) => occupier.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => close(occupier));
    const { port } = occupier.address() as AddressInfo;
    const { server } = setUp();

    await assert.rejects(listen(server, port, '127.0.0.1'), (error: unknown) => {
      assert.ok(error instanceof ListenError);
      assert.equal(error.name, 'ListenError');
      assert.match(error.message, new RegExp(`port ${String(port)}`));
      assert.equal((error.cause as NodeJS.ErrnoException).code, 'EADDRINUSE');
      return true;
    });
  });
});

/** Starts a web server on an ephemeral port and returns its base URL. */
const start = async (monitoredPrefixes?: readonly MonitoredPrefix[]) => {
  const { monitor, server } = setUp(monitoredPrefixes);
  await listen(server, 0, '127.0.0.1');
  cleanups.push(() => {
    server.closeAllConnections();
    return close(server);
  });
  const { port } = server.address() as AddressInfo;
  return { monitor, base: `http://127.0.0.1:${String(port)}` };
};

type ServerSentEvent = { readonly event: string; readonly data: unknown };

/** Reads server-sent events from `url` until `count` have arrived, then disconnects. */
const readEvents = async (url: string, count: number): Promise<{ type: string; events: ServerSentEvent[] }> => {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  assert.ok(response.body);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  const events: ServerSentEvent[] = [];
  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (event !== undefined && data !== undefined) events.push({ event, data: JSON.parse(data) });
    }
  }
  controller.abort();
  return { type: response.headers.get('content-type') ?? '', events };
};

describe('web server', () => {
  it('GET / serves the page as HTML', async () => {
    const { base } = await start();

    const response = await fetch(`${base}/`);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
    assert.equal(await response.text(), PAGE);
  });

  it('GET /events sends the snapshot of alerts and advisories first, then the feed status and observation count', async () => {
    const { base, monitor } = await start();
    monitor.observe({
      announcedPrefix: monitored('203.0.113.0/24', 0).prefix,
      asPath: [64510, 64666],
      peer: '192.0.2.1',
      source: 'live',
      seenAt: new Date('2026-10-04T12:00:00Z'),
    });

    const { type, events } = await readEvents(`${base}/events`, 3);

    assert.match(type, /^text\/event-stream/);
    assert.deepEqual(
      events.map(({ event }) => event),
      ['snapshot', 'feed-status', 'observations'],
    );
    const snapshot = events[0]?.data as { alerts: { id: string; peerCount: number }[]; advisories: unknown[] };
    assert.deepEqual(
      snapshot.alerts.map(({ id, peerCount }) => ({ id, peerCount })),
      [{ id: 'origin-mismatch|live|203.0.113.0/24|AS64666', peerCount: 1 }],
    );
    assert.deepEqual(snapshot.advisories, []);
    assert.deepEqual(events[1]?.data, { status: 'reconnecting' });
    assert.deepEqual(events[2]?.data, { count: 7 });
  });

  it('POST /simulate/:preset feeds a simulated announcement and answers 204', async () => {
    const { base, monitor } = await start();

    const response = await fetch(`${base}/simulate/origin-mismatch`, { method: 'POST' });

    assert.equal(response.status, 204);
    assert.deepEqual(
      monitor.alerts().map(({ kind, source }) => ({ kind, source })),
      [{ kind: 'origin-mismatch', source: 'simulated' }],
    );
  });

  it('POST /simulate/:preset answers 404 for an unknown preset and observes nothing', async () => {
    const { base, monitor } = await start();

    const response = await fetch(`${base}/simulate/route-leak`, { method: 'POST' });

    assert.equal(response.status, 404);
    assert.match(await response.text(), /Unknown simulation preset "route-leak"/);
    assert.deepEqual(monitor.alerts(), []);
  });

  it('POST /simulate/:preset answers 409 when the preset cannot be built from the first monitored prefix', async () => {
    const { base, monitor } = await start([monitored('203.0.113.7/32', 64500)]);

    const response = await fetch(`${base}/simulate/more-specific`, { method: 'POST' });

    assert.equal(response.status, 409);
    assert.match(await response.text(), /203\.0\.113\.7\/32 has no longer prefix inside it/);
    assert.deepEqual(monitor.alerts(), []);
  });
});
