/**
 * Drives the VRP loader against a local HTTP stand-in for the VRP endpoint
 * and a cache file in a temporary directory; no external network.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadVrps, VrpLoadError } from './vrp-source.ts';

const fixture = (name: string): Promise<string> =>
  readFile(new URL(`parsers/fixtures/vrps/${name}`, import.meta.url), 'utf8');

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A local VRP endpoint answering every request with `status` and `body`. */
const startEndpoint = async (status: number, body: string): Promise<string> => {
  const server = createServer((_request, response) => {
    response.writeHead(status, { 'content-type': 'application/json' }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  );
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/vrps.json`;
};

/** A path inside a fresh temporary directory, removed after the test. */
const cacheFile = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'vrp-source-test-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'vrps.cache.json');
};

describe('loadVrps', () => {
  it('loads the VRPs from the endpoint and keeps the raw response in the cache file', async () => {
    const body = await fixture('vrps-routinator-2021.json');
    const url = await startEndpoint(200, body);
    const file = await cacheFile();

    const loaded = await loadVrps({ url, cacheFile: file });

    assert.deepEqual(loaded.source, { kind: 'endpoint', url, cacheWriteError: undefined });
    assert.deepEqual(
      loaded.vrps.slice(0, 2).map(({ prefix, maxLength, asn }) => [prefix.text, maxLength, asn]),
      [
        ['1.0.0.0/24', 24, 13335],
        ['1.0.4.0/24', 24, 38803],
      ],
    );
    assert.equal(await readFile(file, 'utf8'), body);
  });

  it('falls back to the cache file when the endpoint fails, saying why and when the cache was saved', async () => {
    const url = await startEndpoint(503, 'down for maintenance');
    const file = await cacheFile();
    await writeFile(file, await fixture('vrps-routinator-2021.json'), 'utf8');

    const loaded = await loadVrps({ url, cacheFile: file });

    assert.equal(loaded.source.kind, 'cache');
    assert.equal(loaded.source.file, file);
    assert.match(loaded.source.fetchProblem, /HTTP 503/);
    assert.ok(loaded.source.cachedAt instanceof Date);
    assert.deepEqual(loaded.vrps[0]?.prefix.text, '1.0.0.0/24');
  });

  it('falls back to the cache file when the endpoint answers with something that is not VRP JSON', async () => {
    const url = await startEndpoint(200, '<html>captive portal</html>');
    const file = await cacheFile();
    await writeFile(file, await fixture('vrps-routinator-2021.json'), 'utf8');

    const loaded = await loadVrps({ url, cacheFile: file });

    assert.equal(loaded.source.kind, 'cache');
    assert.equal(await readFile(file, 'utf8'), await fixture('vrps-routinator-2021.json'));
  });

  it('rejects with a VrpLoadError carrying both causes when the endpoint and the cache both fail', async () => {
    const url = await startEndpoint(500, 'oops');
    const file = await cacheFile();

    await assert.rejects(loadVrps({ url, cacheFile: file }), (error: unknown) => {
      assert.ok(error instanceof VrpLoadError);
      assert.match(error.message, /HTTP 500/);
      assert.match(error.message, /ENOENT/);
      assert.ok(error.cause instanceof AggregateError);
      const [fetchError, cacheError] = error.cause.errors as unknown[];
      assert.ok(fetchError instanceof Error);
      assert.match(fetchError.message, /HTTP 500/);
      assert.equal((cacheError as NodeJS.ErrnoException).code, 'ENOENT');
      return true;
    });
  });
});
