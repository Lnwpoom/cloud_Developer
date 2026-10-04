/**
 * Simulation presets: fixed simulated announcements derived from the first
 * monitored prefix, fed through the same path as live observations.
 */
import type { AsPath, MonitoredPrefix, Observation } from './domain.ts';
import { halvesOf, samePrefix } from './prefix.ts';
import type { Prefix } from './prefix.ts';

/** A transit AS and the foreign origin AS, both from the private-use range (RFC 6996). */
const TRANSIT_AS = 64600;
const FOREIGN_AS = 64666;

type PresetContext = {
  readonly target: MonitoredPrefix;
  readonly monitoredPrefixes: readonly MonitoredPrefix[];
  readonly foreignAs: number;
};

type PresetAnnouncement = { readonly announcedPrefix: Prefix; readonly asPath: AsPath };

type PresetResult =
  | { readonly ok: true; readonly announcement: PresetAnnouncement }
  | { readonly ok: false; readonly problem: string };

/**
 * The target prefix plus one bit. Prefers a half the operator has not declared
 * as a monitored prefix itself, so the announcement stays a more-specific.
 */
const moreSpecificOf = (context: PresetContext, asPath: AsPath): PresetResult => {
  const halves = halvesOf(context.target.prefix);
  if (halves === undefined) {
    return { ok: false, problem: `${context.target.prefix.text} has no longer prefix inside it` };
  }
  const undeclared = halves.find(
    (half) => !context.monitoredPrefixes.some((monitored) => samePrefix(monitored.prefix, half)),
  );
  return { ok: true, announcement: { announcedPrefix: undeclared ?? halves[0], asPath } };
};

const PRESETS = {
  'origin-mismatch': (context) => ({
    ok: true,
    announcement: { announcedPrefix: context.target.prefix, asPath: [TRANSIT_AS, context.foreignAs] },
  }),
  'more-specific': (context) => moreSpecificOf(context, [TRANSIT_AS, context.foreignAs]),
  /** The Celer Bridge pattern: the foreign AS forges the declared origin at the end of the path. */
  'forged-origin-more-specific': (context) =>
    moreSpecificOf(context, [context.foreignAs, context.target.declaredOrigin]),
} satisfies Record<string, (context: PresetContext) => PresetResult>;

export type SimulationPreset = keyof typeof PRESETS;

/** The simulator cannot be built from the configuration it was given. */
export class SimulatorSetupError extends Error {
  override readonly name = 'SimulatorSetupError';
}

export const isSimulationPreset = (name: string): name is SimulationPreset => Object.hasOwn(PRESETS, name);

export type PressOutcome = { readonly ok: true } | { readonly ok: false; readonly problem: string };

export type Simulator = {
  /**
   * Feeds one simulated announcement for `preset`; each press comes from a new
   * synthetic peer. Fails, observing nothing, when the preset cannot be built
   * from the first monitored prefix.
   */
  readonly press: (preset: SimulationPreset) => PressOutcome;
};

export const createSimulator = (options: {
  readonly monitoredPrefixes: readonly MonitoredPrefix[];
  readonly observe: (observation: Observation) => void;
  readonly now: () => Date;
}): Simulator => {
  const [target] = options.monitoredPrefixes;
  if (target === undefined) throw new SimulatorSetupError('The simulator needs at least one monitored prefix');
  const foreignAs = target.declaredOrigin === FOREIGN_AS ? FOREIGN_AS + 1 : FOREIGN_AS;
  const context: PresetContext = { target, monitoredPrefixes: options.monitoredPrefixes, foreignAs };
  let presses = 0;

  const press = (preset: SimulationPreset): PressOutcome => {
    const result: PresetResult = PRESETS[preset](context);
    if (!result.ok) return { ok: false, problem: `Cannot simulate "${preset}": ${result.problem}` };
    presses += 1;
    options.observe({
      ...result.announcement,
      peer: `simulated-peer-${String(presses)}`,
      source: 'simulated',
      seenAt: options.now(),
    });
    return { ok: true };
  };

  return { press };
};
