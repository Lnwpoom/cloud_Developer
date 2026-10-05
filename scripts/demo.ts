/**
 * `npm run demo`: starts the service offline. VRP_URL points at a closed local
 * port, so the VRPs always come from the cache, and VRP_CACHE_FILE points at a
 * temp copy of demo/vrps.demo.json, so the committed file is never rewritten.
 * The temp directory is removed when the service exits.
 */
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEMO_VRPS = new URL('../demo/vrps.demo.json', import.meta.url);
const MAIN = new URL('../src/main.ts', import.meta.url);
/** Port 9 is on the Fetch spec's blocked-port list: fetch refuses it before opening a socket. */
const UNREACHABLE_VRP_URL = 'http://127.0.0.1:9/vrps.json';

const dir = await mkdtemp(join(tmpdir(), 'bgp-hijack-monitor-demo-'));
const cacheFile = join(dir, 'vrps.cache.json');
const envFile = join(dir, 'demo.env');
await Promise.all([
  copyFile(DEMO_VRPS, cacheFile),
  // --env-file adds these to the inherited environment without this script reading it.
  writeFile(envFile, `VRP_URL=${UNREACHABLE_VRP_URL}\nVRP_CACHE_FILE=${cacheFile}\n`, 'utf8'),
]);

const child = spawn(process.execPath, [`--env-file=${envFile}`, MAIN.pathname], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}
child.once('exit', (code, signal) => {
  void rm(dir, { recursive: true, force: true }).finally(() => {
    process.exitCode = code ?? (signal === null ? 1 : 0);
  });
});
