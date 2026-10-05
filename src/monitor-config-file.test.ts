import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMonitorConfigFile, MonitorConfigFileError } from './monitor-config-file.ts';

describe('loadMonitorConfigFile', () => {
  let directory = '';
  before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'monitor-config-'));
  });
  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const fileWith = async (name: string, contents: string): Promise<string> => {
    const path = join(directory, name);
    await writeFile(path, contents);
    return path;
  };

  const rejection = async (path: string): Promise<MonitorConfigFileError> => {
    try {
      await loadMonitorConfigFile(path);
    } catch (error) {
      assert.ok(error instanceof MonitorConfigFileError, `unexpected error ${String(error)}`);
      return error;
    }
    throw new assert.AssertionError({ message: `expected ${path} to be rejected` });
  };

  it('loads the monitored prefixes from a good file', async () => {
    const path = await fileWith(
      'good.json',
      JSON.stringify({ monitoredPrefixes: [{ prefix: '203.0.113.0/24', declaredOrigin: 64500 }] }),
    );

    const monitoredPrefixes = await loadMonitorConfigFile(path);

    assert.deepEqual(
      monitoredPrefixes.map((monitored) => [monitored.prefix.text, monitored.declaredOrigin]),
      [['203.0.113.0/24', 64500]],
    );
  });

  it('names the file when it does not exist, keeping the cause', async () => {
    const path = join(directory, 'missing.json');

    const error = await rejection(path);

    assert.match(error.message, new RegExp(`${path}.*cannot be read`));
    assert.ok(error.cause instanceof Error);
  });

  it('names the file when it is not valid JSON', async () => {
    const path = await fileWith('broken.json', '{ "monitoredPrefixes": [ ');

    const error = await rejection(path);

    assert.match(error.message, new RegExp(`${path}.*not valid JSON`));
  });

  it('names the file and the problem when the contents are malformed', async () => {
    const path = await fileWith(
      'bad-origin.json',
      JSON.stringify({ monitoredPrefixes: [{ prefix: '203.0.113.0/24', declaredOrigin: 'AS64500' }] }),
    );

    const error = await rejection(path);

    assert.match(error.message, new RegExp(`${path}.*monitoredPrefixes\\[0\\]\\.declaredOrigin`));
  });
});
