/**
 * Boundary parser for VRP (validated ROA payload) JSON.
 *
 * Accepted shapes, each a list of `{ "prefix", "maxLength", "asn" }`:
 *   rpki-client  `{ "roas": [...] }` with `asn` an integer
 *   Routinator   `{ "roas": [...] }` with `asn` an `"AS<n>"` string
 *   RIPEstat     `{ "data": { "roas": [...] } }`, numbers possibly written as strings
 * Every other field (`metadata`, `ta`, `expires`, ...) is ignored.
 *
 * A malformed entry is skipped and described in `skipped`, so one bad ROA in
 * a dump of half a million does not stop the monitor. A file with no usable
 * VRPs at all is rejected.
 */
import { parsePrefix } from '../prefix.ts';
import type { Vrp } from '../rpki.ts';

export type VrpParseResult =
  | { readonly ok: true; readonly vrps: readonly Vrp[]; readonly skipped: readonly string[] }
  | { readonly ok: false; readonly problem: string };

const MAX_ASN = 4_294_967_295;
const ADDRESS_BITS = { 4: 32, 6: 128 } as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const fail = (problem: string): VrpParseResult => ({ ok: false, problem });

/** A whole number written as a JSON number or as a string of digits. */
const parseWholeNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : undefined;
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : undefined;
};

/** `asn` as an integer (rpki-client), `"AS<n>"` (Routinator) or `"<n>"`. */
const parseAsn = (value: unknown): number | undefined => {
  const digits = typeof value === 'string' ? /^(?:AS)?(\d+)$/i.exec(value)?.[1] : value;
  const asn = parseWholeNumber(digits);
  return asn !== undefined && asn <= MAX_ASN ? asn : undefined;
};

const parseEntry = (entry: unknown, path: string): Vrp | string => {
  if (!isRecord(entry)) return `${path} must be an object with "prefix", "maxLength" and "asn"`;

  const { prefix: prefixText } = entry;
  if (typeof prefixText !== 'string') return `${path}.prefix must be a string`;
  const parsed = parsePrefix(prefixText);
  if (!parsed.ok) return `${path}.prefix: ${parsed.problem}`;
  const { prefix } = parsed;

  const maxLength = parseWholeNumber(entry['maxLength']);
  const bits = ADDRESS_BITS[prefix.family];
  if (maxLength === undefined || maxLength < prefix.length || maxLength > bits) {
    return `${path}.maxLength must be a whole number from ${String(prefix.length)} to ${String(bits)} for ${prefix.text}`;
  }

  const asn = parseAsn(entry['asn']);
  if (asn === undefined) return `${path}.asn must be an AS number such as 64500 or "AS64500"`;
  return { prefix, maxLength, asn };
};

const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

const roasOf = (input: unknown): readonly unknown[] | undefined => {
  if (!isRecord(input)) return undefined;
  if (isList(input['roas'])) return input['roas'];
  const data = input['data'];
  return isRecord(data) && isList(data['roas']) ? data['roas'] : undefined;
};

export const parseVrps = (input: unknown): VrpParseResult => {
  const entries = roasOf(input);
  if (entries === undefined) return fail('expected an object with a "roas" list, at the top level or under "data"');

  const vrps: Vrp[] = [];
  const skipped: string[] = [];
  for (const [index, entry] of entries.entries()) {
    const parsed = parseEntry(entry, `roas[${String(index)}]`);
    if (typeof parsed === 'string') skipped.push(parsed);
    else vrps.push(parsed);
  }
  if (vrps.length === 0) {
    const reason = entries.length === 0 ? 'the "roas" list is empty' : `every entry is malformed (${skipped[0] ?? ''})`;
    return fail(`no usable VRPs: ${reason}`);
  }
  return { ok: true, vrps, skipped };
};
