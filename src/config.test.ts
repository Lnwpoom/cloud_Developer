import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, parseConfig } from './config.ts';

describe('parseConfig', () => {
  it('uses sensible defaults when nothing is set', () => {
    assert.deepEqual(parseConfig({}), { port: 8080, monitorConfigFile: 'monitor.config.json' });
  });

  it('reads the port and the configuration file path from the environment', () => {
    assert.deepEqual(parseConfig({ PORT: '3000', MONITOR_CONFIG_FILE: '/etc/monitor/prefixes.json' }), {
      port: 3000,
      monitorConfigFile: '/etc/monitor/prefixes.json',
    });
  });

  it('rejects a port that is not a whole number from 1 to 65535, naming the variable', () => {
    for (const PORT of ['', 'http', '80.5', '0', '65536', '-1']) {
      assert.throws(() => parseConfig({ PORT }), (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /PORT/);
        return true;
      });
    }
  });

  it('rejects an empty configuration file path, naming the variable', () => {
    assert.throws(() => parseConfig({ MONITOR_CONFIG_FILE: '' }), /MONITOR_CONFIG_FILE/);
  });
});
