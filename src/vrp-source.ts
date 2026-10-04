/**
 * Loads VRPs once at startup: fetch the endpoint and keep the raw response in
 * a cache file; if the endpoint fails, fall back to that cache; if both fail,
 * throw a `VrpLoadError` carrying both causes. VRPs are never refreshed.
 */
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { parseVrps } from './parsers/vrps.ts';
import type { ParsedVrps } from './parsers/vrps.ts';
import type { Vrp } from './rpki.ts';

export type VrpSource =
  | { readonly kind: 'endpoint'; readonly url: string; readonly cacheWriteError: Error | undefined }
  | { readonly kind: 'cache'; readonly file: string; readonly cachedAt: Date; readonly fetchProblem: string };

export type LoadedVrps = {
  readonly vrps: readonly Vrp[];
  /** One problem per malformed entry that was skipped. */
  readonly skipped: readonly string[];
  readonly source: VrpSource;
};

export class VrpLoadError extends Error {
  override readonly name = 'VrpLoadError';
}

const FETCH_TIMEOUT_MS = 60_000;

const asError = (value: unknown): Error => (value instanceof Error ? value : new Error(String(value)));

/** The message, followed by the innermost cause's message when it adds something (fetch hides the network reason there). */
const reasonOf = (error: Error): string => {
  const inner = error.cause instanceof Error ? error.cause.message : '';
  return inner === '' || error.message.includes(inner) ? error.message : `${error.message}: ${inner}`;
};

const parseText = (text: string, where: string): ParsedVrps => {
  let contents: unknown;
  try {
    contents = JSON.parse(text);
  } catch (cause) {
    throw new VrpLoadError(`${where} is not valid JSON`, { cause });
  }
  const parsed = parseVrps(contents);
  if (!parsed.ok) throw new VrpLoadError(`${where} is not VRP JSON: ${parsed.problem}`);
  return parsed.value;
};

const fetchText = async (url: string): Promise<string> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new VrpLoadError(`HTTP ${String(response.status)} ${response.statusText}`.trimEnd());
  return response.text();
};

/** Write to a temporary file first so a crash never leaves a half-written cache. */
const writeCache = async (file: string, text: string): Promise<Error | undefined> => {
  try {
    await writeFile(`${file}.tmp`, text, 'utf8');
    await rename(`${file}.tmp`, file);
    return undefined;
  } catch (cause) {
    return asError(cause);
  }
};

const fromEndpoint = async (url: string, cacheFile: string): Promise<LoadedVrps> => {
  const text = await fetchText(url);
  const parsed = parseText(text, `The response from ${url}`);
  const cacheWriteError = await writeCache(cacheFile, text);
  return { ...parsed, source: { kind: 'endpoint', url, cacheWriteError } };
};

const fromCache = async (file: string, fetchError: Error): Promise<LoadedVrps> => {
  const [text, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
  const parsed = parseText(text, `The VRP cache ${file}`);
  return { ...parsed, source: { kind: 'cache', file, cachedAt: info.mtime, fetchProblem: reasonOf(fetchError) } };
};

export const loadVrps = async (options: { readonly url: string; readonly cacheFile: string }): Promise<LoadedVrps> => {
  let fetchError: Error;
  try {
    return await fromEndpoint(options.url, options.cacheFile);
  } catch (cause) {
    fetchError = asError(cause);
  }
  try {
    return await fromCache(options.cacheFile, fetchError);
  } catch (cause) {
    const cacheError = asError(cause);
    throw new VrpLoadError(
      `Cannot load VRPs: fetching ${options.url} failed (${reasonOf(fetchError)}) ` +
        `and the cache ${options.cacheFile} cannot be used (${reasonOf(cacheError)}). ` +
        'Check the network or VRP_URL, or point VRP_CACHE_FILE at a saved VRP JSON file.',
      { cause: new AggregateError([fetchError, cacheError], 'Cannot load VRPs') },
    );
  }
};
