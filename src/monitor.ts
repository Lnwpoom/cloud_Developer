/**
 * The Monitor: the detection core. It turns observed announcements into
 * alerts. No I/O; feed it observations and read or subscribe to its alerts.
 */
import { samePrefix } from './prefix.ts';
import type { Prefix } from './prefix.ts';

export type MonitoredPrefix = {
  readonly prefix: Prefix;
  readonly declaredOrigin: number;
};

/** One AS path element: an AS number, or an AS_SET of AS numbers. */
export type AsPathSegment = number | readonly number[];
export type AsPath = readonly AsPathSegment[];

export type Source = 'live' | 'simulated';

/** One announcement of one prefix, as seen from one peer. */
export type Observation = {
  readonly announcedPrefix: Prefix;
  readonly asPath: AsPath;
  readonly peer: string;
  readonly source: Source;
  readonly seenAt: Date;
};

export type AlertKind = 'origin-mismatch';

/** The origin AS, or NONE when the AS path ends in an AS_SET. */
export type Origin = { readonly asn: number } | 'NONE';

export type Alert = {
  /** Stable identity: alert kind, source, announced prefix and origin AS. */
  readonly id: string;
  readonly kind: AlertKind;
  readonly source: Source;
  readonly monitoredPrefix: string;
  readonly declaredOrigin: number;
  readonly announcedPrefix: string;
  readonly origin: Origin;
  readonly examplePath: AsPath;
  readonly firstSeen: Date;
  readonly peerCount: number;
};

/** What changed inside the Monitor; carries the alert as it now stands. */
export type MonitorChange = { readonly type: 'alert'; readonly alert: Alert };

export type Monitor = {
  readonly observe: (observation: Observation) => void;
  /** Current alerts, newest first. */
  readonly alerts: () => readonly Alert[];
  /** Calls `listener` after every change. Returns a function that unsubscribes. */
  readonly onChange: (listener: (change: MonitorChange) => void) => () => void;
};

type AlertRecord = {
  readonly alert: Omit<Alert, 'peerCount'>;
  readonly peers: Set<string>;
};

const originOf = (path: AsPath): Origin => {
  const last = path.at(-1);
  return typeof last === 'number' ? { asn: last } : 'NONE';
};

const originText = (origin: Origin): string =>
  origin === 'NONE' ? 'NONE' : `AS${String(origin.asn)}`;

const snapshot = (record: AlertRecord): Alert => ({ ...record.alert, peerCount: record.peers.size });

export const createMonitor = (options: {
  readonly monitoredPrefixes: readonly MonitoredPrefix[];
}): Monitor => {
  const records = new Map<string, AlertRecord>();
  const listeners = new Set<(change: MonitorChange) => void>();

  const notify = (change: MonitorChange): void => {
    for (const listener of listeners) listener(change);
  };

  const observe = (observation: Observation): void => {
    const governing = options.monitoredPrefixes.find((monitored) =>
      samePrefix(monitored.prefix, observation.announcedPrefix),
    );
    if (governing === undefined) return;
    const origin = originOf(observation.asPath);
    if (origin !== 'NONE' && origin.asn === governing.declaredOrigin) return;
    const kind: AlertKind = 'origin-mismatch';
    const id = [kind, observation.source, observation.announcedPrefix.text, originText(origin)].join('|');

    let record = records.get(id);
    if (record === undefined) {
      record = {
        alert: {
          id,
          kind,
          source: observation.source,
          monitoredPrefix: governing.prefix.text,
          declaredOrigin: governing.declaredOrigin,
          announcedPrefix: observation.announcedPrefix.text,
          origin,
          examplePath: observation.asPath,
          firstSeen: observation.seenAt,
        },
        peers: new Set(),
      };
      records.set(id, record);
    }
    if (record.peers.has(observation.peer)) return;
    record.peers.add(observation.peer);
    notify({ type: 'alert', alert: snapshot(record) });
  };

  const alerts = (): readonly Alert[] => [...records.values()].map(snapshot).reverse();

  const onChange = (listener: (change: MonitorChange) => void): (() => void) => {
    const subscription = (change: MonitorChange): void => {
      listener(change);
    };
    listeners.add(subscription);
    return () => listeners.delete(subscription);
  };

  return { observe, alerts, onChange };
};
