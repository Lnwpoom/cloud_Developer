/**
 * Boundary parser for the operator's configuration file contents.
 *
 * Expected shape:
 *   { "monitoredPrefixes": [ { "prefix": "203.0.113.0/24", "declaredOrigin": 64500 } ] }
 */
import type { MonitoredPrefix } from '../domain.ts';
import { parsePrefix } from '../prefix.ts';
import { fail, isRecord, MAX_ASN } from './parse.ts';
import type { ParseResult } from './parse.ts';

const parseEntry = (entry: unknown, path: string): MonitoredPrefix | string => {
  if (!isRecord(entry)) return `${path} must be an object with "prefix" and "declaredOrigin"`;

  const { prefix: prefixText, declaredOrigin } = entry;
  if (typeof prefixText !== 'string') return `${path}.prefix must be a string such as "203.0.113.0/24"`;
  const prefix = parsePrefix(prefixText);
  if (!prefix.ok) return `${path}.prefix: ${prefix.problem}`;

  if (
    typeof declaredOrigin !== 'number' ||
    !Number.isInteger(declaredOrigin) ||
    declaredOrigin < 1 ||
    declaredOrigin > MAX_ASN
  ) {
    return `${path}.declaredOrigin must be an AS number from 1 to ${String(MAX_ASN)}`;
  }
  return { prefix: prefix.value, declaredOrigin };
};

export const parseMonitorConfig = (input: unknown): ParseResult<readonly MonitoredPrefix[]> => {
  if (!isRecord(input) || !Array.isArray(input['monitoredPrefixes'])) {
    return fail('expected an object with a "monitoredPrefixes" list');
  }
  const entries: unknown[] = input['monitoredPrefixes'];
  if (entries.length === 0) return fail('"monitoredPrefixes" must list at least one monitored prefix');

  const monitoredPrefixes: MonitoredPrefix[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const parsed = parseEntry(entry, `monitoredPrefixes[${String(index)}]`);
    if (typeof parsed === 'string') return fail(parsed);
    if (seen.has(parsed.prefix.text)) {
      return fail(`monitored prefix ${parsed.prefix.text} is listed more than once`);
    }
    seen.add(parsed.prefix.text);
    monitoredPrefixes.push(parsed);
  }
  return { ok: true, value: monitoredPrefixes };
};
