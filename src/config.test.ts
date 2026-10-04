import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, parseConfig } from './config.ts';

describe('parseConfig', () => {
  it('uses sensible defaults when nothing is set', () => {
    assert.deepEqual(parseConfig({}), {
      port: 8080,
      monitorConfigFile: 'monitor.config.json',
      risLiveUrl: 'wss://ris-live.ripe.net/v1/ws/',
      risLiveClient: 'bgp-hijack-monitor',
    });
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
