/**
 * The offline demo: its committed VRP file shows the RPKI cases on the example
 * configuration, and `npm run demo` starts from a temp copy of that file.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { loadMonitorConfigFile } from '../src/monitor-config-file.ts';
import { createMonitor } from '../src/monitor.ts';
import { parseVrps } from '../src/parsers/vrps.ts';
import { createSimulator } from '../src/simulation.ts';

const DEMO_VRPS = new URL('../demo/vrps.demo.json', import.meta.url);
const DEMO_SCRIPT = new URL('./demo.ts', import.meta.url);
const EXAMPLE_CONFIG = new URL('../monitor.config.json', import.meta.url);

const demoVrps = async () => {
  const parsed = parseVrps(JSON.parse(await readFile(DEMO_VRPS, 'utf8')) as unknown);
  if (!parsed.ok) assert.fail(parsed.problem);
  return parsed.value.vrps;
};

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === 'string') reject(new TypeError('no port'));
        else resolve(address.port);
      });
    });
  });

describe('demo VRPs with the example monitor.config.json', () => {
  it('show a Loose ROA advisory and a Valid forged origin + more-specific', async () => {
    const [monitoredPrefixes, vrps] = await Promise.all([
      loadMonitorConfigFile(EXAMPLE_CONFIG.pathname),
      demoVrps(),
    ]);
    const monitor = createMonitor({ monitoredPrefixes, vrps });
    const simulator = createSimulator({ monitoredPrefixes, observe: monitor.observe, now: () => new Date() });

    assert.deepEqual(
      monitor.advisories().map(({ kind, monitoredPrefix, roa }) => ({ kind, monitoredPrefix, roa })),
      [{ kind: 'loose-roa', monitoredPrefix: '203.0.113.0/24', roa: { prefix: '203.0.113.0/24', maxLength: 25, asn: 64500 } }],
    );
    simulator.press('forged-origin-more-specific');
    assert.deepEqual(
      monitor.alerts().map(({ kind, validationState }) => ({ kind, validationState })),
      [{ kind: 'unexpected-more-specific', validationState: 'Valid' }],
    );
  });
});

describe('npm run demo', () => {
  it('serves the page from a temp copy of the demo VRPs and leaves the committed file alone', async () => {
    const before = await readFile(DEMO_VRPS, 'utf8');
    const port = await freePort();
    const child = spawn(process.execPath, [DEMO_SCRIPT.pathname], {
      env: { PORT: String(port), RIS_LIVE_URL: 'ws://127.0.0.1:9/' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));

    try {
      const deadline = Date.now() + 15_000;
      while (!output.includes(`http://localhost:${String(port)}/`)) {
        if (child.exitCode !== null) assert.fail(`demo exited early:\n${output}`);
        if (Date.now() > deadline) assert.fail(`demo did not start:\n${output}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const page = await fetch(`http://localhost:${String(port)}/`);
      assert.equal(page.status, 200);
      const cacheLine = /Loaded (\d+) VRPs from the cache (.+), saved/.exec(output);
      assert.ok(cacheLine, `no cache line in:\n${output}`);
      assert.equal(cacheLine[1], '12');
      assert.notEqual(cacheLine[2], DEMO_VRPS.pathname);
    } finally {
      child.kill('SIGTERM');
      await exited;
    }
    assert.equal(await readFile(DEMO_VRPS, 'utf8'), before);
  });
});
