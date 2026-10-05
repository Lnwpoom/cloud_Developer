/**
 * Live feed client for RIPE RIS Live. Opens a WebSocket (Node's global
 * WebSocket), subscribes to announcements of each monitored prefix and its
 * more-specifics, passes every parsed observation on, counts them, and
 * reconnects with backoff when the connection drops or goes silent.
 */
import type { MonitoredPrefix, Observation } from './domain.ts';
import { createListeners } from './listeners.ts';
import { parseRisLiveFrame } from './parsers/ris-live.ts';

/** `connecting` only until the first attempt ends; any failed or dropped connection means `reconnecting`. */
export type FeedStatus = 'connecting' | 'connected' | 'reconnecting';
export type FeedState = { readonly status: FeedStatus; readonly observations: number };
export type FeedChange =
  | { readonly type: 'feed-status'; readonly status: FeedStatus }
  | { readonly type: 'observations'; readonly count: number };

export type RisLiveFeed = {
  readonly state: () => FeedState;
  /** Calls `listener` after every status change and every observation. Returns a function that unsubscribes. */
  readonly onChange: (listener: (change: FeedChange) => void) => () => void;
  /** Closes the connection for good. */
  readonly stop: () => void;
};

export type FeedTiming = {
  /** First reconnect delay; doubles per failed attempt up to `maxBackoffMs`. */
  readonly initialBackoffMs: number;
  readonly maxBackoffMs: number;
  /** How often to send RIS Live a `ping`. */
  readonly pingIntervalMs: number;
  /** Reconnect when nothing (not even a `pong`) has arrived for this long. */
  readonly idleTimeoutMs: number;
};

const DEFAULT_TIMING: FeedTiming = {
  initialBackoffMs: 1_000,
  maxBackoffMs: 30_000,
  pingIntervalMs: 20_000,
  idleTimeoutMs: 60_000,
};

const subscription = (monitored: MonitoredPrefix): string =>
  JSON.stringify({
    type: 'ris_subscribe',
    data: { type: 'UPDATE', prefix: monitored.prefix.text, moreSpecific: true, require: 'announcements' },
  });

export const startRisLiveFeed = (options: {
  /** RIS Live WebSocket URL, e.g. `wss://ris-live.ripe.net/v1/ws/`. */
  readonly url: string;
  /** Sent as the `client` query parameter, as RIS Live asks. */
  readonly client: string;
  readonly monitoredPrefixes: readonly MonitoredPrefix[];
  readonly observe: (observation: Observation) => void;
  /** Where skipped frames and connection problems are reported. */
  readonly log: (message: string) => void;
  readonly timing?: Partial<FeedTiming>;
}): RisLiveFeed => {
  const timing: FeedTiming = { ...DEFAULT_TIMING, ...options.timing };
  const url = new URL(options.url);
  url.searchParams.set('client', options.client);

  const listeners = createListeners<FeedChange>();
  let status: FeedStatus = 'connecting';
  let observations = 0;
  let backoffMs = timing.initialBackoffMs;
  let stopped = false;
  let socket: WebSocket | undefined;
  let retry: NodeJS.Timeout | undefined;
  let watchdog: NodeJS.Timeout | undefined;

  const setStatus = (next: FeedStatus): void => {
    if (next === status) return;
    status = next;
    listeners.notify({ type: 'feed-status', status });
  };

  const handleFrame = (data: unknown): void => {
    if (typeof data !== 'string') {
      options.log('RIS Live: skipped a non-text frame');
      return;
    }
    let input: unknown;
    try {
      input = JSON.parse(data);
    } catch {
      options.log(`RIS Live: skipped a frame that is not JSON: ${data.slice(0, 120)}`);
      return;
    }
    const parsed = parseRisLiveFrame(input);
    if (!parsed.ok) {
      options.log(`RIS Live: skipped a frame: ${parsed.problem}`);
      return;
    }
    for (const problem of parsed.value.skipped) options.log(`RIS Live: skipped part of a frame: ${problem}`);
    for (const observation of parsed.value.observations) {
      options.observe(observation);
      observations += 1;
      listeners.notify({ type: 'observations', count: observations });
    }
  };

  /** Forgets `dropped` and schedules the next attempt; ignores sockets already replaced. */
  const reconnectLater = (dropped: WebSocket): void => {
    if (dropped !== socket) return;
    socket = undefined;
    clearInterval(watchdog);
    if (stopped) return;
    setStatus('reconnecting');
    retry = setTimeout(connect, backoffMs);
    backoffMs = Math.min(backoffMs * 2, timing.maxBackoffMs);
  };

  function connect(): void {
    const current = new WebSocket(url);
    socket = current;
    let lastHeard = Date.now();

    current.addEventListener('open', () => {
      for (const monitored of options.monitoredPrefixes) current.send(subscription(monitored));
      backoffMs = timing.initialBackoffMs;
      lastHeard = Date.now();
      setStatus('connected');
      watchdog = setInterval(() => {
        if (Date.now() - lastHeard > timing.idleTimeoutMs) {
          options.log('RIS Live: connection went silent, reconnecting');
          current.close();
          reconnectLater(current);
          return;
        }
        current.send('{"type":"ping"}');
      }, timing.pingIntervalMs);
    });
    current.addEventListener('message', (event) => {
      lastHeard = Date.now();
      handleFrame(event.data);
    });
    current.addEventListener('close', (event) => {
      if (current === socket && !stopped) {
        options.log(`RIS Live: connection closed (code ${String(event.code)}), reconnecting`);
      }
      reconnectLater(current);
    });
    // Node 22 fires only `error`, never `close`, when the connection cannot be opened.
    current.addEventListener('error', () => {
      if (current === socket && !stopped) options.log(`RIS Live: cannot connect to ${url.origin}, retrying`);
      reconnectLater(current);
    });
  }

  connect();

  return {
    state: () => ({ status, observations }),
    onChange: listeners.add,
    stop: () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(watchdog);
      socket?.close();
      socket = undefined;
    },
  };
};
