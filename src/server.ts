/**
 * Thin HTTP layer: serves the page, pushes Monitor changes to it with
 * server-sent events, and exposes one endpoint per simulation preset.
 *
 *   GET  /                  the page
 *   GET  /events            SSE stream: `snapshot` once (alerts and advisories), then `alert` per change;
 *                           `feed-status` ({ status }) and `observations` ({ count })
 *                           once on connect and then as the live feed changes
 *   POST /simulate/:preset  feed one simulated announcement (204; 404 if unknown;
 *                           409 if it cannot be built from the first monitored prefix)
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Alert, Monitor } from './monitor.ts';
import type { Advisory } from './rpki.ts';
import { isSimulationPreset } from './simulation.ts';
import type { Simulator } from './simulation.ts';
import type { RisLiveFeed } from './ris-live-feed.ts';

type Feed = Pick<RisLiveFeed, 'state' | 'onChange'>;

/** Sent once when a page connects. */
type Snapshot = {
  readonly alerts: readonly Alert[];
  /** Fixed at startup, so they are sent only here. */
  readonly advisories: readonly Advisory[];
};

/** The web server cannot listen on its port (taken, or not allowed). */
export class ListenError extends Error {
  override readonly name = 'ListenError';
}

/** Starts `server` listening on `port`; rejects with a ListenError carrying the socket error as `cause`. */
export const listen = (server: Server, port: number, host?: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const fail = (cause: Error): void => {
      reject(new ListenError(`Cannot listen on port ${String(port)}`, { cause }));
    };
    server.once('error', fail);
    server.listen(port, host, () => {
      server.off('error', fail);
      resolve();
    });
  });

const HEARTBEAT_MS = 15_000;
/** The observation counter is pushed at most this often; a busy feed sees many per second. */
const OBSERVATIONS_PUSH_MS = 250;

const sendEvent = (response: ServerResponse, event: string, data: unknown): void => {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

/** Pushes the feed status on every change and the observation counter at most every OBSERVATIONS_PUSH_MS. */
const streamFeed = (feed: Feed, response: ServerResponse): (() => void) => {
  const initial = feed.state();
  sendEvent(response, 'feed-status', { status: initial.status });
  sendEvent(response, 'observations', { count: initial.observations });
  let pending: NodeJS.Timeout | undefined;
  const unsubscribe = feed.onChange((change) => {
    if (change.type === 'feed-status') {
      sendEvent(response, 'feed-status', { status: change.status });
      return;
    }
    pending ??= setTimeout(() => {
      pending = undefined;
      sendEvent(response, 'observations', { count: feed.state().observations });
    }, OBSERVATIONS_PUSH_MS);
  });
  return () => {
    clearTimeout(pending);
    unsubscribe();
  };
};

const streamEvents = (
  monitor: Monitor,
  feed: Feed,
  request: IncomingMessage,
  response: ServerResponse,
): void => {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const snapshot: Snapshot = {
    alerts: monitor.alerts(),
    advisories: monitor.advisories(),
  };
  sendEvent(response, 'snapshot', snapshot);
  const unsubscribe = monitor.onChange((change) => {
    sendEvent(response, change.type, change.alert);
  });
  const unsubscribeFeed = streamFeed(feed, response);
  const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), HEARTBEAT_MS);
  request.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    unsubscribeFeed();
  });
};

const reply = (response: ServerResponse, status: number, body = ''): void => {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(body);
};

export const createWebServer = (options: {
  readonly monitor: Monitor;
  readonly simulator: Simulator;
  readonly feed: Feed;
  /** The page's HTML, read once at startup. */
  readonly page: string;
}): Server =>
  createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    const method = request.method ?? 'GET';

    if (pathname === '/' && method === 'GET') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(options.page);
      return;
    }
    if (pathname === '/events' && method === 'GET') {
      streamEvents(options.monitor, options.feed, request, response);
      return;
    }
    const simulate = /^\/simulate\/([a-z-]+)$/.exec(pathname);
    if (simulate !== null && method === 'POST') {
      const preset = simulate[1] ?? '';
      if (!isSimulationPreset(preset)) {
        reply(response, 404, `Unknown simulation preset "${preset}"\n`);
        return;
      }
      const outcome = options.simulator.press(preset);
      if (outcome.ok) reply(response, 204);
      else reply(response, 409, `${outcome.problem}\n`);
      return;
    }
    reply(response, 404, 'Not found\n');
  });
