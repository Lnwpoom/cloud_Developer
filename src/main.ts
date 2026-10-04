/**
 * Entry point: parse the environment and configuration file, load the VRPs, wire the
 * Monitor to the simulator, the RIS Live feed and the web server, and listen.
 */
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { readConfig } from './config.ts';
import { createMonitor } from './monitor.ts';
import { loadMonitorConfigFile } from './monitor-config-file.ts';
import { createWebServer } from './server.ts';
import { createSimulator } from './simulation.ts';
import { startRisLiveFeed } from './ris-live-feed.ts';
import { loadVrps } from './vrp-source.ts';
import type { LoadedVrps } from './vrp-source.ts';

const PAGE_URL = new URL('../public/index.html', import.meta.url);

const listen = (server: Server, port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolve();
    });
  });

/** The error message followed by each `cause` in turn, unless already quoted above it. */
const describeError = (error: unknown): string => {
  const lines: string[] = [];
  let current: unknown = error;
  while (current !== undefined) {
    const line = current instanceof Error ? current.message : JSON.stringify(current);
    if (!lines.some((previous) => previous.includes(line))) lines.push(line);
    current = current instanceof Error ? current.cause : undefined;
  }
  return lines.join('\n  caused by: ');
};

const reportVrps = ({ vrps, skipped, source }: LoadedVrps): void => {
  const count = `${String(vrps.length)} VRPs`;
  if (source.kind === 'endpoint') {
    console.log(`Loaded ${count} from ${source.url}`);
    if (source.cacheWriteError !== undefined) {
      console.warn(`Could not update the VRP cache: ${source.cacheWriteError.message}`);
    }
  } else {
    console.warn(`VRP endpoint unavailable (${source.fetchProblem})`);
    console.warn(`Loaded ${count} from the cache ${source.file}, saved ${source.cachedAt.toISOString()}`);
  }
  if (skipped.length > 0) {
    console.warn(`Skipped ${String(skipped.length)} malformed VRP entries, e.g. ${skipped[0] ?? ''}`);
  }
};

const main = async (): Promise<void> => {
  const config = readConfig();
  const [monitoredPrefixes, page, loaded] = await Promise.all([
    loadMonitorConfigFile(config.monitorConfigFile),
    readFile(PAGE_URL, 'utf8'),
    loadVrps({ url: config.vrpUrl, cacheFile: config.vrpCacheFile }),
  ]);
  reportVrps(loaded);

  const monitor = createMonitor({ monitoredPrefixes, vrps: loaded.vrps });
  const simulator = createSimulator({ monitoredPrefixes, observe: monitor.observe, now: () => new Date() });
  const feed = startRisLiveFeed({
    url: config.risLiveUrl,
    client: config.risLiveClient,
    monitoredPrefixes,
    observe: monitor.observe,
    log: (message) => {
      console.warn(message);
    },
  });
  const server = createWebServer({ monitor, simulator, feed, page });

  try {
    await listen(server, config.port);
  } catch (cause) {
    feed.stop();
    throw new Error(`Cannot listen on port ${String(config.port)}`, { cause });
  }
  const watched = monitoredPrefixes
    .map((monitored) => `${monitored.prefix.text} (AS${String(monitored.declaredOrigin)})`)
    .join(', ');
  console.log(`BGP Hijack Monitor watching ${watched} on ${config.risLiveUrl}`);
  console.log(`Open http://localhost:${String(config.port)}/`);
};

main().catch((error: unknown) => {
  console.error(`BGP Hijack Monitor failed to start: ${describeError(error)}`);
  process.exitCode = 1;
});
