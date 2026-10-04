/**
 * Simulation presets: fixed simulated announcements derived from the first
 * monitored prefix, fed through the same path as live observations.
 */
import type { AsPath, MonitoredPrefix, Observation } from './monitor.ts';
import type { Prefix } from './prefix.ts';

/** A transit AS and the foreign origin AS, both from the private-use range (RFC 6996). */
const TRANSIT_AS = 64600;
const FOREIGN_AS = 64666;

type PresetAnnouncement = { readonly announcedPrefix: Prefix; readonly asPath: AsPath };

const PRESETS = {
  'origin-mismatch': (target: MonitoredPrefix, foreignAs: number): PresetAnnouncement => ({
    announcedPrefix: target.prefix,
    asPath: [TRANSIT_AS, foreignAs],
  }),
} satisfies Record<string, (target: MonitoredPrefix, foreignAs: number) => PresetAnnouncement>;

export type SimulationPreset = keyof typeof PRESETS;

export const isSimulationPreset = (name: string): name is SimulationPreset => Object.hasOwn(PRESETS, name);

export type Simulator = {
  /** Feeds one simulated announcement for `preset`; each press comes from a new synthetic peer. */
  readonly press: (preset: SimulationPreset) => void;
};

export const createSimulator = (options: {
  readonly monitoredPrefixes: readonly MonitoredPrefix[];
  readonly observe: (observation: Observation) => void;
  readonly now: () => Date;
}): Simulator => {
  const [target] = options.monitoredPrefixes;
  if (target === undefined) throw new Error('The simulator needs at least one monitored prefix');
  const foreignAs = target.declaredOrigin === FOREIGN_AS ? FOREIGN_AS + 1 : FOREIGN_AS;
  let presses = 0;

  const press = (preset: SimulationPreset): void => {
    presses += 1;
    options.observe({
      ...PRESETS[preset](target, foreignAs),
      peer: `simulated-peer-${String(presses)}`,
      source: 'simulated',
      seenAt: options.now(),
    });
  };

  return { press };
};
