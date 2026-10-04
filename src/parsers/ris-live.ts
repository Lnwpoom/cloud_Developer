/**
 * Boundary parser for RIPE RIS Live frames (already JSON-decoded).
 *
 * One `ris_message` UPDATE becomes one live observation per announced
 * prefix. Every other well-formed frame yields none. A malformed prefix or
 * announcement group is skipped and described in `skipped`, so it never
 * costs the valid observations beside it; an UPDATE with announcements but
 * no valid prefix at all is a problem.
 */
import type { AsPath, AsPathSegment, Observation } from '../domain.ts';
import { parsePrefix } from '../prefix.ts';

export type RisLiveParseResult =
  | { readonly ok: true; readonly observations: readonly Observation[]; readonly skipped: readonly string[] }
  | { readonly ok: false; readonly problem: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const fail = (problem: string): RisLiveParseResult => ({ ok: false, problem });

const NONE: RisLiveParseResult = { ok: true, observations: [], skipped: [] };

const parseAsn = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4_294_967_295 ? value : undefined;

const parseSegment = (value: unknown): AsPathSegment | undefined => {
  if (!Array.isArray(value)) return parseAsn(value);
  const asSet: unknown[] = value;
  const members = asSet.map(parseAsn);
  return members.length > 0 && members.every((asn) => asn !== undefined) ? members : undefined;
};

const parsePath = (value: unknown): AsPath | undefined => {
  if (!Array.isArray(value)) return undefined;
  const elements: unknown[] = value;
  const path = elements.map(parseSegment);
  return path.every((segment) => segment !== undefined) ? path : undefined;
};

const parseUpdate = (data: Record<string, unknown>): RisLiveParseResult => {
  const { peer, timestamp, path: pathValue, announcements: groups } = data;
  if (typeof peer !== 'string' || peer === '') return fail('UPDATE has no "peer"');
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return fail('UPDATE has no numeric "timestamp"');
  // Withdrawal-only: 2019 frames omit "announcements" and "path"; 2025+ frames send [].
  if (groups === undefined) return NONE;
  if (!Array.isArray(groups)) return fail('UPDATE "announcements" is not a list');
  if (groups.length === 0) return NONE;

  const path = parsePath(pathValue);
  if (path === undefined || path.length === 0) {
    return fail('UPDATE with announcements has no "path" of AS numbers and AS_SETs');
  }

  const seenAt = new Date(Math.round(timestamp * 1000));
  const observations: Observation[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const group of groups as unknown[]) {
    if (!isRecord(group) || !Array.isArray(group['prefixes'])) {
      skipped.push('announcement group has no "prefixes" list');
      continue;
    }
    for (const prefixText of group['prefixes'] as unknown[]) {
      if (typeof prefixText !== 'string') {
        skipped.push('announced prefix is not a string');
        continue;
      }
      const parsed = parsePrefix(prefixText);
      if (!parsed.ok) {
        skipped.push(`announced prefix ${parsed.problem}`);
        continue;
      }
      if (seen.has(parsed.prefix.text)) continue;
      seen.add(parsed.prefix.text);
      observations.push({ announcedPrefix: parsed.prefix, asPath: path, peer, source: 'live', seenAt });
    }
  }
  if (observations.length === 0 && skipped.length > 0) return fail(skipped.join('; '));
  return { ok: true, observations, skipped };
};

export const parseRisLiveMessage = (input: unknown): RisLiveParseResult => {
  if (!isRecord(input) || typeof input['type'] !== 'string') return fail('expected an object with a "type"');
  const { type, data } = input;
  if (type === 'ris_error') {
    const message = isRecord(data) && typeof data['message'] === 'string' ? data['message'] : JSON.stringify(data);
    return fail(`ris_error: ${message}`);
  }
  if (type !== 'ris_message') return NONE;
  if (!isRecord(data)) return fail('ris_message has no "data" object');
  if (data['type'] !== 'UPDATE') return NONE;
  return parseUpdate(data);
};
