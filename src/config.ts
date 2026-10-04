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

const parseFilePath = (name: string, value: string | undefined, fallback: string): string => {
  if (value === undefined) return fallback;
  if (value.trim() === '') throw new ConfigError(`${name} must not be empty`);
  return value;
};

const parseHttpUrl = (name: string, value: string | undefined, fallback: string): string => {
  if (value === undefined) return fallback;
  const url = URL.parse(value);
  if (url === null || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new ConfigError(`${name} must be an http or https URL, got "${value}"`);
  }
  return url.href;
};

const parseRisLiveUrl = (value: string | undefined): string => {
  if (value === undefined) return DEFAULTS.risLiveUrl;
  const url = URL.canParse(value) ? new URL(value) : undefined;
  if (url === undefined || (url.protocol !== 'ws:' && url.protocol !== 'wss:')) {
    throw new ConfigError(`RIS_LIVE_URL must be a ws:// or wss:// URL, got "${value}"`);
  }
  return value;
};

const parseRisLiveClient = (value: string | undefined): string => {
  if (value === undefined) return DEFAULTS.risLiveClient;
  if (value.trim() === '') throw new ConfigError('RIS_LIVE_CLIENT must not be empty');
  return value;
};

export const parseConfig = (env: Environment): Config => ({
  port: parsePort(env['PORT']),
  monitorConfigFile: parseFilePath('MONITOR_CONFIG_FILE', env['MONITOR_CONFIG_FILE'], DEFAULTS.monitorConfigFile),
  vrpUrl: parseHttpUrl('VRP_URL', env['VRP_URL'], DEFAULTS.vrpUrl),
  vrpCacheFile: parseFilePath('VRP_CACHE_FILE', env['VRP_CACHE_FILE'], DEFAULTS.vrpCacheFile),
  risLiveUrl: parseRisLiveUrl(env['RIS_LIVE_URL']),
  risLiveClient: parseRisLiveClient(env['RIS_LIVE_CLIENT']),
});

export const readConfig = (): Config => parseConfig(process.env);
