import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMonitor } from './monitor.ts';
import type { MonitorChange, Observation, Source } from './monitor.ts';
import { parsePrefix } from './prefix.ts';
import type { Prefix } from './prefix.ts';

const prefix = (text: string): Prefix => {
  const parsed = parsePrefix(text);
  if (!parsed.ok) throw new Error(`bad test prefix ${text}: ${parsed.problem}`);
  return parsed.prefix;
};

const monitoredPrefixes = [{ prefix: prefix('203.0.113.0/24'), declaredOrigin: 64500 }];

const announcement = (overrides: Partial<Observation> = {}): Observation => ({
  announcedPrefix: prefix('203.0.113.0/24'),
  asPath: [64510, 64666],
  peer: '192.0.2.1',
  source: 'live',
  seenAt: new Date('2026-10-04T12:00:00Z'),
  ...overrides,
});

describe('Monitor', () => {
  it('raises an Origin mismatch when a monitored prefix is announced by a foreign origin AS', () => {
    const monitor = createMonitor({ monitoredPrefixes });

    monitor.observe(announcement());

    assert.deepEqual(monitor.alerts(), [
      {
        id: 'origin-mismatch|live|203.0.113.0/24|AS64666',
        kind: 'origin-mismatch',
        source: 'live',
        monitoredPrefix: '203.0.113.0/24',
        declaredOrigin: 64500,
        announcedPrefix: '203.0.113.0/24',
        origin: { asn: 64666 },
        examplePath: [64510, 64666],
        firstSeen: new Date('2026-10-04T12:00:00Z'),
        peerCount: 1,
      },
    ]);
  });

  it('raises no alert when the declared origin announces its monitored prefix', () => {
    const monitor = createMonitor({ monitoredPrefixes });

    monitor.observe(announcement({ asPath: [64510, 64500] }));

    assert.deepEqual(monitor.alerts(), []);
  });

  it('collapses the same announcement from N distinct peers into one alert with peer count N', () => {
    const monitor = createMonitor({ monitoredPrefixes });

    for (const peer of ['192.0.2.1', '192.0.2.2', '2001:db8::3']) {
      monitor.observe(announcement({ peer }));
    }

    const alerts = monitor.alerts();
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]?.peerCount, 3);
  });

  it('counts the same peer twice only once', () => {
    const monitor = createMonitor({ monitoredPrefixes });

    monitor.observe(announcement({ peer: '192.0.2.1' }));
    monitor.observe(announcement({ peer: '192.0.2.1', seenAt: new Date('2026-10-04T12:05:00Z') }));

    assert.deepEqual(
      monitor.alerts().map((alert) => alert.peerCount),
      [1],
    );
  });

  it('keeps every alert field from the first sighting when later peers report it', () => {
    const monitor = createMonitor({ monitoredPrefixes });

    monitor.observe(announcement({ peer: '192.0.2.1' }));
    monitor.observe(
      announcement({
        peer: '192.0.2.2',
        asPath: [64511, 64512, 64666],
        seenAt: new Date('2026-10-04T12:05:00Z'),
      }),
    );

    const [alert] = monitor.alerts();
    assert.ok(alert);
    assert.deepEqual(alert.examplePath, [64510, 64666]);
    assert.deepEqual(alert.firstSeen, new Date('2026-10-04T12:00:00Z'));
    assert.equal(alert.peerCount, 2);
  });

  it('never merges a live and a simulated announcement of the same prefix and origin', () => {
    const monitor = createMonitor({ monitoredPrefixes });

    monitor.observe(announcement({ source: 'live', peer: 'peer-a' }));
    monitor.observe(announcement({ source: 'simulated', peer: 'peer-a' }));

    const sources: Source[] = monitor.alerts().map((alert) => alert.source);
    assert.deepEqual(sources.sort(), ['live', 'simulated']);
    assert.deepEqual(
      monitor.alerts().map((alert) => alert.peerCount),
      [1, 1],
    );
  });

  it('lists alerts newest first', () => {
    const monitor = createMonitor({ monitoredPrefixes });

    monitor.observe(announcement({ asPath: [64666], seenAt: new Date('2026-10-04T12:00:00Z') }));
    monitor.observe(announcement({ asPath: [64777], seenAt: new Date('2026-10-04T12:01:00Z') }));

    assert.deepEqual(
      monitor.alerts().map((alert) => alert.origin),
      [{ asn: 64777 }, { asn: 64666 }],
    );
  });

  describe('onChange', () => {
    it('reports a newly raised alert and each later peer count rise', () => {
      const monitor = createMonitor({ monitoredPrefixes });
      const changes: MonitorChange[] = [];
      monitor.onChange((change) => changes.push(change));

      monitor.observe(announcement({ peer: 'peer-a' }));
      monitor.observe(announcement({ peer: 'peer-b' }));

      assert.deepEqual(
        changes.map((change) => [change.type, change.alert.id, change.alert.peerCount]),
        [
          ['alert', 'origin-mismatch|live|203.0.113.0/24|AS64666', 1],
          ['alert', 'origin-mismatch|live|203.0.113.0/24|AS64666', 2],
        ],
      );
    });

    it('stays silent when nothing changed: a quiet announcement or a peer already counted', () => {
      const monitor = createMonitor({ monitoredPrefixes });
      monitor.observe(announcement({ peer: 'peer-a' }));
      const changes: MonitorChange[] = [];
      monitor.onChange((change) => changes.push(change));

      monitor.observe(announcement({ asPath: [64500] }));
      monitor.observe(announcement({ peer: 'peer-a' }));

      assert.deepEqual(changes, []);
    });

    it('stops reporting to a listener once it unsubscribes', () => {
      const monitor = createMonitor({ monitoredPrefixes });
      const changes: MonitorChange[] = [];
      const unsubscribe = monitor.onChange((change) => changes.push(change));

      unsubscribe();
      monitor.observe(announcement());

      assert.deepEqual(changes, []);
    });
  });
});
