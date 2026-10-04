/**
 * IP prefixes (IPv4 and IPv6) as validated values. Build them only with
 * `parsePrefix`; everything inside the boundary can then trust them.
 */
export type Prefix = {
  readonly family: 4 | 6;
  /** Network address as an unsigned integer, host bits always zero. */
  readonly network: bigint;
  readonly length: number;
  /** Canonical text form, e.g. `203.0.113.0/24` or `2001:db8::/32`. */
  readonly text: string;
};

export type PrefixParseResult =
  | { readonly ok: true; readonly prefix: Prefix }
  | { readonly ok: false; readonly problem: string };

const fail = (problem: string): PrefixParseResult => ({ ok: false, problem });

const parseIpv4 = (text: string): bigint | undefined => {
  const parts = text.split('.');
  if (parts.length !== 4) return undefined;
  let value = 0n;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
};

const formatIpv4 = (value: bigint): string =>
  [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 0xffn)).join('.');

const parseGroups = (text: string): number[] | undefined => {
  if (text === '') return [];
  const groups = text.split(':');
  if (!groups.every((group) => /^[0-9a-fA-F]{1,4}$/.test(group))) return undefined;
  return groups.map((group) => parseInt(group, 16));
};

const parseIpv6 = (text: string): bigint | undefined => {
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const head = parseGroups(halves[0] ?? '');
  const tail = halves.length === 2 ? parseGroups(halves[1] ?? '') : [];
  if (head === undefined || tail === undefined) return undefined;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return undefined;
  const groups = [...head, ...Array<number>(missing).fill(0), ...tail];
  return groups.reduce((value, group) => (value << 16n) | BigInt(group), 0n);
};

/** RFC 5952 text: lowercase, no leading zeros, longest run of 2+ zero groups as `::`. */
const formatIpv6 = (value: bigint): string => {
  const groups = Array.from({ length: 8 }, (_, index) =>
    Number((value >> BigInt((7 - index) * 16)) & 0xffffn),
  );
  let bestStart = -1;
  let bestLength = 1;
  for (let start = 0; start < 8; start += 1) {
    let end = start;
    while (end < 8 && groups[end] === 0) end += 1;
    if (end - start > bestLength) {
      bestStart = start;
      bestLength = end - start;
    }
  }
  const hex = (part: number[]): string => part.map((group) => group.toString(16)).join(':');
  if (bestStart === -1) return hex(groups);
  return `${hex(groups.slice(0, bestStart))}::${hex(groups.slice(bestStart + bestLength))}`;
};

const FAMILIES = {
  4: { bits: 32, parse: parseIpv4, format: formatIpv4 },
  6: { bits: 128, parse: parseIpv6, format: formatIpv6 },
} as const;

export const parsePrefix = (text: string): PrefixParseResult => {
  const slash = text.indexOf('/');
  if (slash === -1) return fail(`"${text}" is not a prefix (expected address/length)`);
  const addressText = text.slice(0, slash);
  const lengthText = text.slice(slash + 1);
  if (!/^\d{1,3}$/.test(lengthText)) return fail(`"${text}" has an invalid prefix length`);
  const length = Number(lengthText);

  const family = addressText.includes(':') ? 6 : 4;
  const { bits, parse, format } = FAMILIES[family];
  const address = parse(addressText);
  if (address === undefined) return fail(`"${text}" has an invalid IPv${String(family)} address`);
  if (length > bits) return fail(`"${text}" has a prefix length longer than ${String(bits)}`);
  const hostMask = (1n << BigInt(bits - length)) - 1n;
  if ((address & hostMask) !== 0n) return fail(`"${text}" has host bits set`);
  return {
    ok: true,
    prefix: { family, network: address, length, text: `${format(address)}/${String(length)}` },
  };
};

export const samePrefix = (a: Prefix, b: Prefix): boolean =>
  a.family === b.family && a.length === b.length && a.network === b.network;
