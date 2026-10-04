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
        validationState: 'NotFound',
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

  it('lists alerts newest raised first, even when a later-raised alert carries an earlier first-seen time', () => {
    const monitor = createMonitor({ monitoredPrefixes });

    monitor.observe(announcement({ source: 'simulated', asPath: [64666], seenAt: new Date('2026-10-04T12:00:00Z') }));
    monitor.observe(announcement({ source: 'live', asPath: [64777], seenAt: new Date('2026-10-04T11:00:00Z') }));
    monitor.observe(announcement({ source: 'simulated', asPath: [64666], peer: 'another-peer' }));

    assert.deepEqual(
      monitor.alerts().map((alert) => alert.id),
      ['origin-mismatch|live|203.0.113.0/24|AS64777', 'origin-mismatch|simulated|203.0.113.0/24|AS64666'],
    );
  });

  describe('more-specifics', () => {
    it('raises an Unexpected more-specific when a prefix strictly inside a monitored prefix is announced by a foreign origin', () => {
      const monitor = createMonitor({ monitoredPrefixes });

      monitor.observe(announcement({ announcedPrefix: prefix('203.0.113.128/25'), asPath: [64510, 64666] }));

      assert.deepEqual(monitor.alerts(), [
        {
          id: 'unexpected-more-specific|live|203.0.113.128/25|AS64666',
          kind: 'unexpected-more-specific',
          source: 'live',
          monitoredPrefix: '203.0.113.0/24',
          declaredOrigin: 64500,
          announcedPrefix: '203.0.113.128/25',
          origin: { asn: 64666 },
          validationState: 'NotFound',
          examplePath: [64510, 64666],
          firstSeen: new Date('2026-10-04T12:00:00Z'),
          peerCount: 1,
        },
      ]);
    });

    it('still raises an Unexpected more-specific when a forged path ends in the declared origin', () => {
      const monitor = createMonitor({ monitoredPrefixes });

      monitor.observe(announcement({ announcedPrefix: prefix('203.0.113.0/25'), asPath: [64510, 64666, 64500] }));

      assert.deepEqual(
        monitor.alerts().map(({ kind, announcedPrefix, origin }) => ({ kind, announcedPrefix, origin })),
        [{ kind: 'unexpected-more-specific', announcedPrefix: '203.0.113.0/25', origin: { asn: 64500 } }],
      );
    });

    it('ignores a less-specific announcement that covers a monitored prefix', () => {
      const monitor = createMonitor({ monitoredPrefixes: [{ prefix: prefix('198.51.100.0/24'), declaredOrigin: 64500 }] });

      for (const covering of ['198.51.100.0/23', '198.51.100.0/22', '0.0.0.0/0']) {
        monitor.observe(announcement({ announcedPrefix: prefix(covering) }));
      }

      assert.deepEqual(monitor.alerts(), []);
    });

    it('ignores an announcement outside every monitored prefix, even with the same length', () => {
      const monitor = createMonitor({ monitoredPrefixes });

      monitor.observe(announcement({ announcedPrefix: prefix('203.0.114.0/24') }));
      monitor.observe(announcement({ announcedPrefix: prefix('203.0.114.0/25') }));

      assert.deepEqual(monitor.alerts(), []);
    });
  });

  describe('IPv6', () => {
    const ipv6Monitored = [{ prefix: prefix('2001:db8::/32'), declaredOrigin: 64500 }];

    it('raises an Unexpected more-specific for an IPv6 prefix strictly inside a monitored IPv6 prefix', () => {
      const monitor = createMonitor({ monitoredPrefixes: ipv6Monitored });

      monitor.observe(announcement({ announcedPrefix: prefix('2001:db8:8000::/33'), asPath: [64510, 64666] }));
      monitor.observe(announcement({ announcedPrefix: prefix('2001:db8:1234::/48'), asPath: [64510, 64500] }));

      assert.deepEqual(
        monitor.alerts().map(({ kind, monitoredPrefix, announcedPrefix, origin }) => ({
          kind,
          monitoredPrefix,
          announcedPrefix,
          origin,
        })),
        [
          {
            kind: 'unexpected-more-specific',
            monitoredPrefix: '2001:db8::/32',
            announcedPrefix: '2001:db8:1234::/48',
            origin: { asn: 64500 },
          },
          {
            kind: 'unexpected-more-specific',
            monitoredPrefix: '2001:db8::/32',
            announcedPrefix: '2001:db8:8000::/33',
            origin: { asn: 64666 },
          },
        ],
      );
    });

    it('ignores an IPv6 less-specific that covers a monitored IPv6 prefix, and an IPv6 neighbour outside it', () => {
      const monitor = createMonitor({ monitoredPrefixes: ipv6Monitored });

      for (const text of ['2001:db8::/31', '2001::/16', '::/0', '2001:db9::/32', '2001:db9::/48']) {
        monitor.observe(announcement({ announcedPrefix: prefix(text) }));
      }

      assert.deepEqual(monitor.alerts(), []);
    });
  });

  describe('AS_SET origin', () => {
    it('raises an Origin mismatch with origin NONE when the path ends in an AS_SET, even one holding the declared origin', () => {
      const monitor = createMonitor({ monitoredPrefixes });

      monitor.observe(announcement({ asPath: [2497, 6453, 18705, 26281, [64500]] }));

      assert.deepEqual(
        monitor.alerts().map(({ id, kind, origin, examplePath }) => ({ id, kind, origin, examplePath })),
        [
          {
            id: 'origin-mismatch|live|203.0.113.0/24|NONE',
            kind: 'origin-mismatch',
            origin: 'NONE',
            examplePath: [2497, 6453, 18705, 26281, [64500]],
          },
        ],
      );
    });
  });

  describe('nested monitored prefixes', () => {
    const nested = [
      { prefix: prefix('203.0.113.0/24'), declaredOrigin: 64500 },
      { prefix: prefix('203.0.113.128/25'), declaredOrigin: 64501 },
    ];

    it('stays quiet when a declared /25 inside a monitored /24 is announced by its declared origin', () => {
      const monitor = createMonitor({ monitoredPrefixes: nested });

      monitor.observe(announcement({ announcedPrefix: prefix('203.0.113.128/25'), asPath: [64510, 64501] }));

      assert.deepEqual(monitor.alerts(), []);
    });

    it('raises an Origin mismatch against the /25, not the /24, when another AS announces the declared /25', () => {
      const monitor = createMonitor({ monitoredPrefixes: nested });

      monitor.observe(announcement({ announcedPrefix: prefix('203.0.113.128/25'), asPath: [64510, 64666] }));

      assert.deepEqual(
        monitor.alerts().map(({ kind, monitoredPrefix, declaredOrigin, announcedPrefix }) => ({
          kind,
          monitoredPrefix,
          declaredOrigin,
          announcedPrefix,
        })),
        [
          {
            kind: 'origin-mismatch',
            monitoredPrefix: '203.0.113.128/25',
            declaredOrigin: 64501,
            announcedPrefix: '203.0.113.128/25',
          },
        ],
      );
    });

    it('governs a more-specific by the most specific monitored prefix that contains it, whatever the list order', () => {
      const monitor = createMonitor({ monitoredPrefixes: [...nested].reverse() });

      monitor.observe(announcement({ announcedPrefix: prefix('203.0.113.192/26'), asPath: [64510, 64666] }));
      monitor.observe(announcement({ announcedPrefix: prefix('203.0.113.0/26'), asPath: [64510, 64666] }));

      assert.deepEqual(
        monitor.alerts().map(({ kind, monitoredPrefix, announcedPrefix }) => ({ kind, monitoredPrefix, announcedPrefix })),
        [
          { kind: 'unexpected-more-specific', monitoredPrefix: '203.0.113.0/24', announcedPrefix: '203.0.113.0/26' },
          { kind: 'unexpected-more-specific', monitoredPrefix: '203.0.113.128/25', announcedPrefix: '203.0.113.192/26' },
        ],
      );
    });
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
