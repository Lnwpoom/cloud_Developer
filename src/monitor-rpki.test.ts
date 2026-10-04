/**
 * The Monitor's RPKI context: the RFC 6811 validation state on each alert,
 * and Loose ROA advisories.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMonitor } from './monitor.ts';
import type { AsPath, MonitoredPrefix, Observation } from './monitor.ts';
import { parsePrefix } from './prefix.ts';
import type { Prefix } from './prefix.ts';
import type { Vrp } from './rpki.ts';

const prefix = (text: string): Prefix => {
  const parsed = parsePrefix(text);
  if (!parsed.ok) throw new Error(`bad test prefix ${text}: ${parsed.problem}`);
  return parsed.prefix;
};

const monitored = (text: string, declaredOrigin: number): MonitoredPrefix => ({
  prefix: prefix(text),
  declaredOrigin,
});

const vrp = (text: string, maxLength: number, asn: number): Vrp => ({ prefix: prefix(text), maxLength, asn });

const announcement = (prefixText: string, asPath: AsPath): Observation => ({
  announcedPrefix: prefix(prefixText),
  asPath,
  peer: '192.0.2.1',
  source: 'live',
  seenAt: new Date('2026-10-04T12:00:00Z'),
});

/** The validation state of the one alert raised by observing `observation`. */
const stateOf = (
  options: { monitoredPrefixes: readonly MonitoredPrefix[]; vrps: readonly Vrp[] },
  observation: Observation,
): string => {
  const monitor = createMonitor(options);
  monitor.observe(observation);
  const alerts = monitor.alerts();
  assert.equal(alerts.length, 1, 'expected exactly one alert');
  return alerts[0]?.validationState ?? '';
};

const ipv4 = [monitored('203.0.113.0/24', 64500)];

describe('Monitor validation state (RFC 6811)', () => {
  it('is Valid when a covering VRP matches the origin AS and the length', () => {
    const vrps = [vrp('203.0.113.0/24', 24, 64666)];

    assert.equal(stateOf({ monitoredPrefixes: ipv4, vrps }, announcement('203.0.113.0/24', [64510, 64666])), 'Valid');
  });

  it('is Invalid when the only covering VRP names another AS (wrong origin)', () => {
    const vrps = [vrp('203.0.113.0/24', 24, 64500)];

    assert.equal(stateOf({ monitoredPrefixes: ipv4, vrps }, announcement('203.0.113.0/24', [64510, 64666])), 'Invalid');
  });

  it('is Invalid when the route is longer than the maxLength of a VRP with the right AS', () => {
    const monitoredPrefixes = [monitored('203.0.113.0/24', 64500), monitored('203.0.113.0/25', 64500)];
    const vrps = [vrp('203.0.113.0/24', 24, 64666)];

    assert.equal(stateOf({ monitoredPrefixes, vrps }, announcement('203.0.113.0/25', [64510, 64666])), 'Invalid');
  });

  it('is NotFound when no VRP covers the route, even with VRPs for neighbouring and shorter-only space', () => {
    const vrps = [
      vrp('203.0.112.0/24', 24, 64666),
      vrp('203.0.113.0/25', 25, 64666),
      vrp('2001:db8::/32', 128, 64666),
    ];

    assert.equal(
      stateOf({ monitoredPrefixes: ipv4, vrps }, announcement('203.0.113.0/24', [64510, 64666])),
      'NotFound',
    );
  });

  it('is Invalid, never Valid, for a route covered by an AS0 VRP, even one whose path ends in AS 0', () => {
    const vrps = [vrp('203.0.113.0/24', 24, 0)];

    assert.equal(stateOf({ monitoredPrefixes: ipv4, vrps }, announcement('203.0.113.0/24', [64510, 64666])), 'Invalid');
    assert.equal(stateOf({ monitoredPrefixes: ipv4, vrps }, announcement('203.0.113.0/24', [64510, 0])), 'Invalid');
  });

  it('is never Valid for origin NONE (path ending in an AS_SET), even if the set holds the VRP AS', () => {
    const vrps = [vrp('203.0.113.0/24', 24, 64666)];

    assert.equal(
      stateOf({ monitoredPrefixes: ipv4, vrps }, announcement('203.0.113.0/24', [64510, [64666]])),
      'Invalid',
    );
    assert.equal(
      stateOf({ monitoredPrefixes: ipv4, vrps: [] }, announcement('203.0.113.0/24', [64510, [64666]])),
      'NotFound',
    );
  });

  it('works on IPv6: Valid, Invalid and NotFound', () => {
    const monitoredPrefixes = [monitored('2001:db8:ffff::/48', 64500)];
    const route = announcement('2001:db8:ffff::/48', [64510, 64666]);

    assert.equal(stateOf({ monitoredPrefixes, vrps: [vrp('2001:db8::/32', 48, 64666)] }, route), 'Valid');
    assert.equal(stateOf({ monitoredPrefixes, vrps: [vrp('2001:db8::/32', 32, 64666)] }, route), 'Invalid');
    assert.equal(stateOf({ monitoredPrefixes, vrps: [vrp('2001:db9::/32', 48, 64666)] }, route), 'NotFound');
    assert.equal(stateOf({ monitoredPrefixes, vrps: [vrp('2001:db8:fffe::/48', 48, 64666)] }, route), 'NotFound');
  });

  it('is Valid for a forged-origin more-specific under a loose ROA, and the alert is still raised (RFC 9319)', () => {
    const vrps = [vrp('203.0.113.0/24', 25, 64500)];
    const monitor = createMonitor({ monitoredPrefixes: ipv4, vrps });

    monitor.observe(announcement('203.0.113.0/25', [64510, 64666, 64500]));

    assert.deepEqual(
      monitor.alerts().map((alert) => [alert.kind, alert.validationState]),
      [['unexpected-more-specific', 'Valid']],
    );
  });

  it('is only context: an alert is raised whatever the state, and none for the declared origin even if Invalid', () => {
    const vrps = [vrp('203.0.113.0/24', 24, 64999)];
    const monitor = createMonitor({ monitoredPrefixes: ipv4, vrps });

    monitor.observe(announcement('203.0.113.0/24', [64510, 64500]));

    assert.deepEqual(monitor.alerts(), []);
  });
});

describe('Monitor Loose ROA advisories', () => {
  it('names the ROA and the monitored prefix when a VRP for the prefix allows a longer maxLength', () => {
    const monitor = createMonitor({ monitoredPrefixes: ipv4, vrps: [vrp('203.0.113.0/24', 25, 64500)] });

    assert.deepEqual(monitor.advisories(), [
      {
        id: 'loose-roa|203.0.113.0/24|203.0.113.0/24-25|AS64500',
        kind: 'loose-roa',
        monitoredPrefix: '203.0.113.0/24',
        roa: { prefix: '203.0.113.0/24', maxLength: 25, asn: 64500 },
      },
    ]);
  });

  it('gives none for an exact-length VRP', () => {
    const monitor = createMonitor({ monitoredPrefixes: ipv4, vrps: [vrp('203.0.113.0/24', 24, 64500)] });

    assert.deepEqual(monitor.advisories(), []);
  });

  const roasOf = (monitor: ReturnType<typeof createMonitor>): unknown =>
    monitor.advisories().map((advisory) => [advisory.monitoredPrefix, advisory.roa.prefix, advisory.roa.maxLength]);

  it('flags a covering ROA only when its maxLength is longer than the monitored prefix, not ROAs inside it', () => {
    const monitor = createMonitor({
      monitoredPrefixes: ipv4,
      vrps: [
        vrp('203.0.112.0/23', 24, 64500),
        vrp('203.0.112.0/22', 26, 64500),
        vrp('203.0.113.0/25', 32, 64500),
        vrp('198.51.100.0/24', 32, 64500),
      ],
    });

    assert.deepEqual(roasOf(monitor), [['203.0.113.0/24', '203.0.112.0/22', 26]]);
  });

  it('works on IPv6, alongside IPv4, per monitored prefix', () => {
    const monitor = createMonitor({
      monitoredPrefixes: [monitored('203.0.113.0/24', 64500), monitored('2001:db8::/32', 64500)],
      vrps: [
        vrp('2001:db8::/32', 48, 64500),
        vrp('2001:db8::/32', 32, 64501),
        vrp('2001:db9::/32', 48, 64500),
        vrp('203.0.113.0/24', 24, 64500),
      ],
    });

    assert.deepEqual(roasOf(monitor), [['2001:db8::/32', '2001:db8::/32', 48]]);
  });

  it('gives one advisory for a ROA listed twice in the VRPs', () => {
    const loose = vrp('203.0.113.0/24', 25, 64500);
    const monitor = createMonitor({ monitoredPrefixes: ipv4, vrps: [loose, loose] });

    assert.equal(monitor.advisories().length, 1);
  });
});
