/**
 * The only module that reads `process.env`. Parse once at startup with
 * `readConfig()` and pass the values down.
 *
 *   PORT                 HTTP port for the web page (default 8080)
 *   MONITOR_CONFIG_FILE  path to the JSON configuration file (default monitor.config.json)
 */
export type Config = {
  readonly port: number;
  readonly monitorConfigFile: string;
};

export type Environment = Readonly<Record<string, string | undefined>>;

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

const DEFAULTS: Config = { port: 8080, monitorConfigFile: 'monitor.config.json' };

const parsePort = (value: string | undefined): number => {
  if (value === undefined) return DEFAULTS.port;
  const port = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ConfigError(`PORT must be a whole number from 1 to 65535, got "${value}"`);
  }
  return port;
};

const parseMonitorConfigFile = (value: string | undefined): string => {
  if (value === undefined) return DEFAULTS.monitorConfigFile;
  if (value.trim() === '') throw new ConfigError('MONITOR_CONFIG_FILE must not be empty');
  return value;
};

export const parseConfig = (env: Environment): Config => ({
  port: parsePort(env['PORT']),
  monitorConfigFile: parseMonitorConfigFile(env['MONITOR_CONFIG_FILE']),
});

export const readConfig = (): Config => parseConfig(process.env);
