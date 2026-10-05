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
      risLiveUrl: 'wss://ris-live.ripe.net/v1/ws/',
      risLiveClient: 'bgp-hijack-monitor',
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
    const { port, monitorConfigFile } = parseConfig({
      PORT: '3000',
      MONITOR_CONFIG_FILE: '/etc/monitor/prefixes.json',
    });
    assert.deepEqual({ port, monitorConfigFile }, { port: 3000, monitorConfigFile: '/etc/monitor/prefixes.json' });
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

  it('reads the RIS Live WebSocket URL and client identifier from the environment', () => {
    const { risLiveUrl, risLiveClient } = parseConfig({
      RIS_LIVE_URL: 'ws://127.0.0.1:9000/v1/ws/',
      RIS_LIVE_CLIENT: 'uni-noc-demo',
    });
    assert.deepEqual({ risLiveUrl, risLiveClient }, { risLiveUrl: 'ws://127.0.0.1:9000/v1/ws/', risLiveClient: 'uni-noc-demo' });
  });

  it('rejects a RIS Live URL that is not a ws:// or wss:// URL, naming the variable', () => {
    for (const RIS_LIVE_URL of ['', 'ris-live.ripe.net', 'https://ris-live.ripe.net/v1/ws/']) {
      assert.throws(() => parseConfig({ RIS_LIVE_URL }), /RIS_LIVE_URL/);
    }
  });

  it('rejects an empty RIS Live client identifier, naming the variable', () => {
    assert.throws(() => parseConfig({ RIS_LIVE_CLIENT: ' ' }), /RIS_LIVE_CLIENT/);
  });
});
