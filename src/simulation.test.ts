import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMonitor } from './monitor.ts';
import type { MonitoredPrefix, Origin } from './monitor.ts';
import { parsePrefix } from './prefix.ts';
import { createSimulator, isSimulationPreset } from './simulation.ts';

const monitored = (text: string, declaredOrigin: number): MonitoredPrefix => {
  const parsed = parsePrefix(text);
  if (!parsed.ok) throw new Error(parsed.problem);
  return { prefix: parsed.prefix, declaredOrigin };
};

const isPrivateUseAsn = (origin: Origin): boolean =>
  origin !== 'NONE' &&
  ((origin.asn >= 64512 && origin.asn <= 65534) || (origin.asn >= 4200000000 && origin.asn <= 4294967294));

const setUp = (monitoredPrefixes: readonly MonitoredPrefix[]) => {
  const monitor = createMonitor({ monitoredPrefixes });
  let clock = Date.parse('2026-10-04T12:00:00Z');
  const simulator = createSimulator({
    monitoredPrefixes,
    observe: monitor.observe,
    now: () => new Date((clock += 1000)),
  });
  return { monitor, simulator };
};

describe('Simulator', () => {
  it('"origin-mismatch" raises a SIMULATED Origin mismatch on the first monitored prefix from a private-use AS', () => {
    const { monitor, simulator } = setUp([
      monitored('203.0.113.0/24', 64500),
      monitored('198.51.100.0/24', 64501),
    ]);

    simulator.press('origin-mismatch');

    const [alert, ...others] = monitor.alerts();
    assert.deepEqual(others, []);
    assert.ok(alert);
    const { kind, source, monitoredPrefix, declaredOrigin, announcedPrefix, firstSeen, peerCount } = alert;
    assert.deepEqual(
      { kind, source, monitoredPrefix, declaredOrigin, announcedPrefix, firstSeen, peerCount },
      {
        kind: 'origin-mismatch',
        source: 'simulated',
        monitoredPrefix: '203.0.113.0/24',
        declaredOrigin: 64500,
        announcedPrefix: '203.0.113.0/24',
        firstSeen: new Date('2026-10-04T12:00:01Z'),
        peerCount: 1,
      },
    );
    assert.ok(isPrivateUseAsn(alert.origin), `origin ${JSON.stringify(alert.origin)} is not private-use`);
  });

  it('never uses the declared origin as the foreign AS, even when the declared origin is private-use', () => {
    for (const declaredOrigin of [64512, 64666, 65000, 65534]) {
      const { monitor, simulator } = setUp([monitored('2001:db8::/32', declaredOrigin)]);

      simulator.press('origin-mismatch');

      assert.equal(monitor.alerts().length, 1, `no alert for declared origin AS${String(declaredOrigin)}`);
    }
  });

  it('pressing twice bumps the peer count of one alert, since each press is a distinct synthetic peer', () => {
    const { monitor, simulator } = setUp([monitored('203.0.113.0/24', 64500)]);

    simulator.press('origin-mismatch');
    simulator.press('origin-mismatch');

    assert.deepEqual(
      monitor.alerts().map((alert) => alert.peerCount),
      [2],
    );
  });

  it('recognises only the known preset names', () => {
    assert.equal(isSimulationPreset('origin-mismatch'), true);
    assert.equal(isSimulationPreset('hijack'), false);
  });
});
