/**
 * RPKI facts the Monitor attaches to its output: the RFC 6811 validation
 * state of an announcement, and Loose ROA advisories.
 */
import type { MonitoredPrefix, Origin } from './monitor.ts';
import { covers } from './prefix.ts';
import type { Prefix } from './prefix.ts';

/** A validated ROA payload: `asn` may originate `prefix` and its more-specifics up to `maxLength`. */
export type Vrp = {
  readonly prefix: Prefix;
  readonly maxLength: number;
  /** 0 for an AS0 VRP, which never makes a route Valid. */
  readonly asn: number;
};

export type ValidationState = 'Valid' | 'Invalid' | 'NotFound';

/**
 * The RFC 6811 validation state of a route with `routePrefix` and `origin`:
 * NotFound when no VRP covers the route, Valid when a covering VRP matches
 * its origin AS and length, Invalid otherwise. Origin NONE (an AS_SET) and
 * AS0 VRPs never match.
 */
export const validationState = (vrps: readonly Vrp[], routePrefix: Prefix, origin: Origin): ValidationState => {
  const covering = vrps.filter((vrp) => covers(vrp.prefix, routePrefix));
  if (covering.length === 0) return 'NotFound';
  const matched = covering.some(
    (vrp) =>
      routePrefix.length <= vrp.maxLength && origin !== 'NONE' && vrp.asn !== 0 && vrp.asn === origin.asn,
  );
  return matched ? 'Valid' : 'Invalid';
};

/**
 * The VRPs that can cover an announcement equal to or inside a monitored
 * prefix: those covering a monitored prefix, and those inside one. Keeps
 * per-announcement validation cheap against a dump of half a million VRPs.
 */
export const relevantVrps = (monitoredPrefixes: readonly MonitoredPrefix[], vrps: readonly Vrp[]): readonly Vrp[] =>
  vrps.filter((vrp) =>
    monitoredPrefixes.some(({ prefix }) => covers(vrp.prefix, prefix) || covers(prefix, vrp.prefix)),
  );

/** Advice about the operator's own RPKI setup; nobody else has announced anything. */
export type Advisory = {
  readonly id: string;
  /** Loose ROA: a ROA covering a monitored prefix allows a maxLength longer than the prefix. */
  readonly kind: 'loose-roa';
  readonly monitoredPrefix: string;
  readonly roa: { readonly prefix: string; readonly maxLength: number; readonly asn: number };
};

/** One Loose ROA advisory per (monitored prefix, ROA), in monitored-prefix then VRP order. */
export const looseRoaAdvisories = (
  monitoredPrefixes: readonly MonitoredPrefix[],
  vrps: readonly Vrp[],
): readonly Advisory[] => {
  const advisories = new Map<string, Advisory>();
  for (const { prefix } of monitoredPrefixes) {
    for (const vrp of vrps) {
      if (!covers(vrp.prefix, prefix) || vrp.maxLength <= prefix.length) continue;
      const roa = { prefix: vrp.prefix.text, maxLength: vrp.maxLength, asn: vrp.asn };
      const id = ['loose-roa', prefix.text, `${roa.prefix}-${String(roa.maxLength)}`, `AS${String(roa.asn)}`].join('|');
      advisories.set(id, { id, kind: 'loose-roa', monitoredPrefix: prefix.text, roa });
    }
  }
  return [...advisories.values()];
};
