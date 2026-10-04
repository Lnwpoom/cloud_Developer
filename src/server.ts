/**
 * Thin HTTP layer: serves the page, pushes Monitor changes to it with
 * server-sent events, and exposes one endpoint per simulation preset.
 *
 *   GET  /                  the page
 *   GET  /events            SSE stream: `snapshot` once, then `alert` per change
 *   POST /simulate/:preset  feed one simulated announcement (204, or 404 if unknown)
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Alert, Monitor } from './monitor.ts';
import { isSimulationPreset } from './simulation.ts';
import type { Simulator } from './simulation.ts';

/** Sent once when a page connects; later tickets add fields beside `alerts`. */
export type Snapshot = { readonly alerts: readonly Alert[] };

const HEARTBEAT_MS = 15_000;

const sendEvent = (response: ServerResponse, event: string, data: unknown): void => {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

const streamEvents = (monitor: Monitor, request: IncomingMessage, response: ServerResponse): void => {
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
  const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), HEARTBEAT_MS);
  request.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
};

const reply = (response: ServerResponse, status: number, body = ''): void => {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(body);
};

export const createWebServer = (options: {
  readonly monitor: Monitor;
  readonly simulator: Simulator;
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
      streamEvents(options.monitor, request, response);
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
