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
 */
export type Config = {
  readonly port: number;
  readonly monitorConfigFile: string;
  readonly vrpUrl: string;
  readonly vrpCacheFile: string;
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

export const parseConfig = (env: Environment): Config => ({
  port: parsePort(env['PORT']),
  monitorConfigFile: parseFilePath('MONITOR_CONFIG_FILE', env['MONITOR_CONFIG_FILE'], DEFAULTS.monitorConfigFile),
  vrpUrl: parseHttpUrl('VRP_URL', env['VRP_URL'], DEFAULTS.vrpUrl),
  vrpCacheFile: parseFilePath('VRP_CACHE_FILE', env['VRP_CACHE_FILE'], DEFAULTS.vrpCacheFile),
});

export const readConfig = (): Config => parseConfig(process.env);
