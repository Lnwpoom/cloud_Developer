import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMonitorConfig } from './monitor-config.ts';

const monitoredPrefixTexts = (input: unknown): unknown => {
  const result = parseMonitorConfig(input);
  return result.ok
    ? result.value.map((monitored) => [monitored.prefix.text, monitored.declaredOrigin])
    : result.problem;
};

const problemOf = (input: unknown): string => {
  const result = parseMonitorConfig(input);
  assert.equal(result.ok, false, 'expected the configuration to be rejected');
  return result.problem;
};

describe('parseMonitorConfig', () => {
  it('reads monitored prefixes and their declared origins, IPv4 and IPv6, in file order', () => {
    assert.deepEqual(
      monitoredPrefixTexts({
        monitoredPrefixes: [
          { prefix: '203.0.113.0/24', declaredOrigin: 64500 },
          { prefix: '203.0.113.128/25', declaredOrigin: 64500 },
          { prefix: '2001:DB8:0:0::/32', declaredOrigin: 4200000000 },
        ],
      }),
      [
        ['203.0.113.0/24', 64500],
        ['203.0.113.128/25', 64500],
        ['2001:db8::/32', 4200000000],
      ],
    );
  });

  it('rejects input that is not an object with a monitoredPrefixes list', () => {
    assert.match(problemOf(null), /monitoredPrefixes/);
    assert.match(problemOf([]), /monitoredPrefixes/);
    assert.match(problemOf({ prefixes: [] }), /monitoredPrefixes/);
    assert.match(problemOf({ monitoredPrefixes: 'x' }), /monitoredPrefixes/);
  });

  it('rejects an empty monitoredPrefixes list, since the monitor would watch nothing', () => {
    assert.match(problemOf({ monitoredPrefixes: [] }), /at least one/);
  });

  it('names the entry and field of an invalid monitored prefix', () => {
    const problem = (entry: unknown): string =>
      problemOf({ monitoredPrefixes: [{ prefix: '203.0.113.0/24', declaredOrigin: 64500 }, entry] });

    assert.match(problem('203.0.113.0/24'), /monitoredPrefixes\[1\].*object/);
    assert.match(problem({ declaredOrigin: 64500 }), /monitoredPrefixes\[1\]\.prefix/);
    assert.match(problem({ prefix: '203.0.113.1/24', declaredOrigin: 64500 }), /monitoredPrefixes\[1\]\.prefix.*host bits/);
    assert.match(problem({ prefix: '203.0.113.0/33', declaredOrigin: 64500 }), /monitoredPrefixes\[1\]\.prefix/);
    assert.match(problem({ prefix: '203.0.113/24', declaredOrigin: 64500 }), /monitoredPrefixes\[1\]\.prefix/);
    assert.match(problem({ prefix: '2001:db8:::/32', declaredOrigin: 64500 }), /monitoredPrefixes\[1\]\.prefix/);
    assert.match(problem({ prefix: '2001:db8::/129', declaredOrigin: 64500 }), /monitoredPrefixes\[1\]\.prefix/);
  });

  it('accepts only a whole AS number from 1 to 4294967295 as the declared origin', () => {
    const problem = (declaredOrigin: unknown): string =>
      problemOf({ monitoredPrefixes: [{ prefix: '203.0.113.0/24', declaredOrigin }] });

    for (const bad of ['AS64500', 64500.5, 0, -1, 4294967296, undefined]) {
      assert.match(problem(bad), /monitoredPrefixes\[0\]\.declaredOrigin/, `accepted ${String(bad)}`);
    }
  });

  it('rejects the same monitored prefix listed twice', () => {
    assert.match(
      problemOf({
        monitoredPrefixes: [
          { prefix: '2001:db8::/32', declaredOrigin: 64500 },
          { prefix: '2001:0db8::/32', declaredOrigin: 64501 },
        ],
      }),
      /2001:db8::\/32.*more than once/,
    );
  });
});
