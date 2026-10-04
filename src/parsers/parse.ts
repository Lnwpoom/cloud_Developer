/**
 * Helpers shared by the boundary parsers: each takes `unknown` and returns a
 * `ParseResult` instead of throwing.
 */

/** The largest 4-byte AS number (RFC 6793). */
export const MAX_ASN = 4_294_967_295;

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: string };

export const fail = (problem: string): { readonly ok: false; readonly problem: string } => ({ ok: false, problem });

/** A plain JSON object: not null and not a list. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
