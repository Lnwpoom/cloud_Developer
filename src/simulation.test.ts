import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMonitor } from './monitor.ts';
import type { MonitoredPrefix, Origin } from './domain.ts';
import type { Alert } from './monitor.ts';
import { parsePrefix } from './prefix.ts';
import { createSimulator, isSimulationPreset, SimulatorSetupError } from './simulation.ts';

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

  const summary = (alert: Alert | undefined) => {
    assert.ok(alert);
    const { kind, source, monitoredPrefix, declaredOrigin, announcedPrefix, peerCount } = alert;
    return { kind, source, monitoredPrefix, declaredOrigin, announcedPrefix, peerCount };
  };

  it('"more-specific" raises a SIMULATED Unexpected more-specific for the first monitored prefix plus one bit, from a private-use AS', () => {
    const { monitor, simulator } = setUp([
      monitored('203.0.113.0/24', 64500),
      monitored('198.51.100.0/24', 64501),
    ]);

    simulator.press('more-specific');

    const [alert, ...others] = monitor.alerts();
    assert.deepEqual(others, []);
    assert.deepEqual(summary(alert), {
      kind: 'unexpected-more-specific',
      source: 'simulated',
      monitoredPrefix: '203.0.113.0/24',
      declaredOrigin: 64500,
      announcedPrefix: '203.0.113.0/25',
      peerCount: 1,
    });
    assert.ok(alert && isPrivateUseAsn(alert.origin), `origin ${JSON.stringify(alert?.origin)} is not private-use`);
  });

  it('"forged-origin-more-specific" announces the same longer prefix with path [foreign AS, declared origin]', () => {
    const { monitor, simulator } = setUp([monitored('2001:db8::/32', 64500)]);

    simulator.press('forged-origin-more-specific');

    const [alert, ...others] = monitor.alerts();
    assert.deepEqual(others, []);
    assert.deepEqual(summary(alert), {
      kind: 'unexpected-more-specific',
      source: 'simulated',
      monitoredPrefix: '2001:db8::/32',
      declaredOrigin: 64500,
      announcedPrefix: '2001:db8::/33',
      peerCount: 1,
    });
    assert.ok(alert);
    assert.deepEqual(alert.origin, { asn: 64500 });
    assert.equal(alert.examplePath.length, 2);
    const [foreign] = alert.examplePath;
    assert.ok(typeof foreign === 'number' && foreign !== 64500 && isPrivateUseAsn({ asn: foreign }));
  });

  it('repeated presses of each more-specific preset bump the peer count of one alert per preset', () => {
    const { monitor, simulator } = setUp([monitored('203.0.113.0/24', 64500)]);

    for (let press = 0; press < 3; press += 1) simulator.press('more-specific');
    for (let press = 0; press < 2; press += 1) simulator.press('forged-origin-more-specific');

    assert.deepEqual(
      monitor.alerts().map((alert) => [alert.kind, alert.origin, alert.peerCount]),
      [
        ['unexpected-more-specific', { asn: 64500 }, 2],
        ['unexpected-more-specific', { asn: 64666 }, 3],
      ],
    );
  });

  it('announces the upper half when the lower half is itself a monitored prefix, so the press still shows a more-specific', () => {
    const { monitor, simulator } = setUp([
      monitored('203.0.113.0/24', 64500),
      monitored('203.0.113.0/25', 64500),
    ]);

    simulator.press('more-specific');
    simulator.press('forged-origin-more-specific');

    assert.deepEqual(
      monitor.alerts().map((alert) => [alert.kind, alert.monitoredPrefix, alert.announcedPrefix]),
      [
        ['unexpected-more-specific', '203.0.113.0/24', '203.0.113.128/25'],
        ['unexpected-more-specific', '203.0.113.0/24', '203.0.113.128/25'],
      ],
    );
  });

  it('refuses a more-specific preset when the first monitored prefix has no longer prefix inside it, and observes nothing', () => {
    for (const text of ['192.0.2.1/32', '2001:db8::1/128']) {
      const { monitor, simulator } = setUp([monitored(text, 64500)]);

      const outcomes = [simulator.press('more-specific'), simulator.press('forged-origin-more-specific')];

      assert.deepEqual(
        outcomes.map((outcome) => outcome.ok),
        [false, false],
      );
      assert.deepEqual(monitor.alerts(), []);
      assert.deepEqual(simulator.press('origin-mismatch'), { ok: true });
    }
  });

  it('refuses to start without a monitored prefix, with a SimulatorSetupError', () => {
    assert.throws(
      () => createSimulator({ monitoredPrefixes: [], observe: () => undefined, now: () => new Date() }),
      (error: unknown) => {
        assert.ok(error instanceof SimulatorSetupError);
        assert.equal(error.name, 'SimulatorSetupError');
        assert.match(error.message, /at least one monitored prefix/);
        return true;
      },
    );
  });

  it('recognises only the known preset names', () => {
    assert.equal(isSimulationPreset('origin-mismatch'), true);
    assert.equal(isSimulationPreset('more-specific'), true);
    assert.equal(isSimulationPreset('forged-origin-more-specific'), true);
    assert.equal(isSimulationPreset('hijack'), false);
  });
});
