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
