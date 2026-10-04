import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, parseConfig } from './config.ts';

describe('parseConfig', () => {
  it('uses sensible defaults when nothing is set', () => {
    assert.deepEqual(parseConfig({}), {
      port: 8080,
      monitorConfigFile: 'monitor.config.json',
      vrpUrl: 'https://console.rpki-client.org/vrps.json',
      vrpCacheFile: 'vrps.cache.json',
    });
  });

  it('reads the VRP endpoint URL and the VRP cache file path from the environment', () => {
    const config = parseConfig({ VRP_URL: 'http://localhost:8323/json', VRP_CACHE_FILE: '/var/cache/vrps.json' });

    assert.equal(config.vrpUrl, 'http://localhost:8323/json');
    assert.equal(config.vrpCacheFile, '/var/cache/vrps.json');
  });

  it('rejects a VRP endpoint that is not an http or https URL, naming the variable', () => {
    for (const VRP_URL of ['', 'console.rpki-client.org/vrps.json', 'ftp://example.net/vrps.json']) {
      assert.throws(() => parseConfig({ VRP_URL }), /VRP_URL/);
    }
  });

  it('rejects an empty VRP cache file path, naming the variable', () => {
    assert.throws(() => parseConfig({ VRP_CACHE_FILE: ' ' }), /VRP_CACHE_FILE/);
  });

  it('reads the port and the configuration file path from the environment', () => {
    const config = parseConfig({ PORT: '3000', MONITOR_CONFIG_FILE: '/etc/monitor/prefixes.json' });

    assert.equal(config.port, 3000);
    assert.equal(config.monitorConfigFile, '/etc/monitor/prefixes.json');
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
