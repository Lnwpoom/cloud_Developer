/**
 * The only module that reads `process.env`. Parse once at startup with
 * `readConfig()` and pass the values down.
 *
 *   PORT                 HTTP port for the web page (default 8080)
 *   MONITOR_CONFIG_FILE  path to the JSON configuration file (default monitor.config.json)
 *   VRP_URL              VRP JSON endpoint fetched once at startup
 *                        (default https://console.rpki-client.org/vrps.json)
 *   VRP_CACHE_FILE       where the last fetched VRP JSON is kept, used when the
 *                        endpoint is unreachable (default vrps.cache.json)
 *   RIS_LIVE_URL         RIS Live WebSocket URL (default wss://ris-live.ripe.net/v1/ws/)
 *   RIS_LIVE_CLIENT      `client` identifier sent to RIS Live (default bgp-hijack-monitor)
 */
export type Config = {
  readonly port: number;
  readonly monitorConfigFile: string;
  readonly vrpUrl: string;
  readonly vrpCacheFile: string;
  readonly risLiveUrl: string;
  readonly risLiveClient: string;
};

export type Environment = Readonly<Record<string, string | undefined>>;

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

const DEFAULTS: Config = {
  port: 8080,
  monitorConfigFile: 'monitor.config.json',
  vrpUrl: 'https://console.rpki-client.org/vrps.json',
  vrpCacheFile: 'vrps.cache.json',
  risLiveUrl: 'wss://ris-live.ripe.net/v1/ws/',
  risLiveClient: 'bgp-hijack-monitor',
};

const parsePort = (value: string | undefined): number => {
  if (value === undefined) return DEFAULTS.port;
  const port = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ConfigError(`PORT must be a whole number from 1 to 65535, got "${value}"`);
  }
  return port;
};

/** A variable that, when set, must not be blank (a file path or an identifier). */
const parseNonEmpty = (name: string, value: string | undefined, fallback: string): string => {
  if (value === undefined) return fallback;
  if (value.trim() === '') throw new ConfigError(`${name} must not be empty`);
  return value;
};

/** A variable that, when set, must be a URL with one of `protocols` (e.g. `'https:'`). */
const parseUrl = (
  name: string,
  value: string | undefined,
  fallback: string,
  protocols: readonly string[],
): string => {
  if (value === undefined) return fallback;
  const url = URL.parse(value);
  if (url === null || !protocols.includes(url.protocol)) {
    const allowed = protocols.map((protocol) => `${protocol}//`).join(' or ');
    throw new ConfigError(`${name} must be a URL starting with ${allowed}, got "${value}"`);
  }
  return url.href;
};

export const parseConfig = (env: Environment): Config => ({
  port: parsePort(env['PORT']),
  monitorConfigFile: parseNonEmpty('MONITOR_CONFIG_FILE', env['MONITOR_CONFIG_FILE'], DEFAULTS.monitorConfigFile),
  vrpUrl: parseUrl('VRP_URL', env['VRP_URL'], DEFAULTS.vrpUrl, ['http:', 'https:']),
  vrpCacheFile: parseNonEmpty('VRP_CACHE_FILE', env['VRP_CACHE_FILE'], DEFAULTS.vrpCacheFile),
  risLiveUrl: parseUrl('RIS_LIVE_URL', env['RIS_LIVE_URL'], DEFAULTS.risLiveUrl, ['ws:', 'wss:']),
  risLiveClient: parseNonEmpty('RIS_LIVE_CLIENT', env['RIS_LIVE_CLIENT'], DEFAULTS.risLiveClient),
});

export const readConfig = (): Config => parseConfig(process.env);
