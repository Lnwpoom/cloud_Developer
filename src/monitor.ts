/**
 * The Monitor: the detection core. It turns observed announcements into
 * alerts. No I/O; feed it observations and read or subscribe to its alerts.
 */
import { formatAsn } from './domain.ts';
import type { AsPath, MonitoredPrefix, Observation, Origin, ObservationSource } from './domain.ts';
import { createListeners } from './listeners.ts';
import { containsPrefix, samePrefix } from './prefix.ts';
import type { Prefix } from './prefix.ts';
import { looseRoaAdvisories, relevantVrps, validationState } from './rpki.ts';
import type { Advisory, ValidationState, Vrp } from './rpki.ts';

export type AlertKind = 'origin-mismatch' | 'unexpected-more-specific';

export type Alert = {
  /** Stable identity: alert kind, source, announced prefix and origin AS. */
  readonly id: string;
  readonly kind: AlertKind;
  readonly source: ObservationSource;
  readonly monitoredPrefix: string;
  readonly declaredOrigin: number;
  readonly announcedPrefix: string;
  readonly origin: Origin;
  /** RFC 6811 state against the VRPs loaded at startup. Context only: it never decides whether an alert is raised. */
  readonly validationState: ValidationState;
  readonly examplePath: AsPath;
  readonly firstSeen: Date;
  readonly peerCount: number;
};

/** What changed inside the Monitor; carries the alert as it now stands. */
export type MonitorChange = { readonly type: 'alert'; readonly alert: Alert };

export type Monitor = {
  readonly observe: (observation: Observation) => void;
  /**
   * Current alerts, newest raised first: the order the Monitor raised them, not
   * `firstSeen`, which comes from the RIS timestamp for live alerts but the
   * server clock for simulated ones. A later peer never reorders an alert.
   */
  readonly alerts: () => readonly Alert[];
  /** Loose ROA advisories, computed once at creation from the VRPs; they never change. */
  readonly advisories: () => readonly Advisory[];
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
  origin === 'NONE' ? 'NONE' : formatAsn(origin.asn);

const snapshot = (record: AlertRecord): Alert => ({ ...record.alert, peerCount: record.peers.size });

export const createMonitor = (options: {
  readonly monitoredPrefixes: readonly MonitoredPrefix[];
  /** VRPs loaded at startup; none means every validation state is NotFound. */
  readonly vrps?: readonly Vrp[];
}): Monitor => {
  const vrps = relevantVrps(options.monitoredPrefixes, options.vrps ?? []);
  const advisoryList = looseRoaAdvisories(options.monitoredPrefixes, vrps);
  const records = new Map<string, AlertRecord>();
  const listeners = createListeners<MonitorChange>();

  /** The most specific monitored prefix that equals or contains `announced`, if any. */
  const governingPrefixOf = (announced: Prefix): MonitoredPrefix | undefined =>
    options.monitoredPrefixes
      .filter((monitored) => containsPrefix(monitored.prefix, announced))
      .reduce<MonitoredPrefix | undefined>(
        (best, monitored) => (best === undefined || monitored.prefix.length > best.prefix.length ? monitored : best),
        undefined,
      );

  const observe = (observation: Observation): void => {
    const governing = governingPrefixOf(observation.announcedPrefix);
    if (governing === undefined) return;
    const origin = originOf(observation.asPath);
    const kind: AlertKind = samePrefix(governing.prefix, observation.announcedPrefix)
      ? 'origin-mismatch'
      : 'unexpected-more-specific';
    if (kind === 'origin-mismatch' && origin !== 'NONE' && origin.asn === governing.declaredOrigin) return;
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
          validationState: validationState(vrps, observation.announcedPrefix, origin),
          examplePath: observation.asPath,
          firstSeen: observation.seenAt,
        },
        peers: new Set(),
      };
      records.set(id, record);
    }
    if (record.peers.has(observation.peer)) return;
    record.peers.add(observation.peer);
    listeners.notify({ type: 'alert', alert: snapshot(record) });
  };

  const alerts = (): readonly Alert[] => [...records.values()].map(snapshot).reverse();

  const advisories = (): readonly Advisory[] => advisoryList;

  return { observe, alerts, advisories, onChange: listeners.add };
};
