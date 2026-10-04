/**
 * Thin HTTP layer: serves the page, pushes Monitor changes to it with
 * server-sent events, and exposes one endpoint per simulation preset.
 *
 *   GET  /                  the page
 *   GET  /events            SSE stream: `snapshot` once, then `alert` per change;
 *                           `feed-status` ({ status }) and `observations` ({ count })
 *                           once on connect and then as the live feed changes
 *   POST /simulate/:preset  feed one simulated announcement (204, or 404 if unknown)
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Alert, Monitor } from './monitor.ts';
import { isSimulationPreset } from './simulation.ts';
import type { Simulator } from './simulation.ts';
import type { RisLiveFeed } from './ris-live-feed.ts';

type Feed = Pick<RisLiveFeed, 'state' | 'onChange'>;

/** Sent once when a page connects; later tickets add fields beside `alerts`. */
export type Snapshot = { readonly alerts: readonly Alert[] };

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
  const snapshot: Snapshot = { alerts: monitor.alerts() };
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
      options.simulator.press(preset);
      reply(response, 204);
      return;
    }
    reply(response, 404, 'Not found\n');
  });
