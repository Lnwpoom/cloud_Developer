/**
 * Domain types shared by the Monitor, the RPKI checks, the parsers, the
 * live feed and the simulator (terms as in GLOSSARY.md), and the AS number
 * text form.
 */
import type { Prefix } from './prefix.ts';

/** A prefix the operator wants watched, with the AS that should originate it. */
export type MonitoredPrefix = {
  readonly prefix: Prefix;
  readonly declaredOrigin: number;
};

/** One AS path element: an AS number, or an AS_SET of AS numbers. */
export type AsPathSegment = number | readonly number[];
export type AsPath = readonly AsPathSegment[];

/** Where an observation came from: the live feed, or a simulation preset. */
export type ObservationSource = 'live' | 'simulated';

/** One announcement of one prefix, as seen from one peer. */
export type Observation = {
  readonly announcedPrefix: Prefix;
  readonly asPath: AsPath;
  readonly peer: string;
  readonly source: ObservationSource;
  readonly seenAt: Date;
};

/** The origin AS, or NONE when the AS path ends in an AS_SET. */
export type Origin = { readonly asn: number } | 'NONE';

/** An AS number as text, e.g. `AS64500`. */
export const formatAsn = (asn: number): string => `AS${String(asn)}`;
