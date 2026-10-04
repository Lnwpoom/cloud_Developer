/**
 * Reads the operator's configuration file and parses it at the boundary.
 */
import { readFile } from 'node:fs/promises';
import type { MonitoredPrefix } from './domain.ts';
import { parseMonitorConfig } from './parsers/monitor-config.ts';

export class MonitorConfigFileError extends Error {
  override readonly name = 'MonitorConfigFileError';
}

export const loadMonitorConfigFile = async (path: string): Promise<readonly MonitoredPrefix[]> => {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new MonitorConfigFileError(`Configuration file ${path} cannot be read (${reason})`, { cause });
  }

  let contents: unknown;
  try {
    contents = JSON.parse(text);
  } catch (cause) {
    throw new MonitorConfigFileError(`Configuration file ${path} is not valid JSON`, { cause });
  }

  const parsed = parseMonitorConfig(contents);
  if (!parsed.ok) throw new MonitorConfigFileError(`Configuration file ${path} is invalid: ${parsed.problem}`);
  return parsed.value;
};
