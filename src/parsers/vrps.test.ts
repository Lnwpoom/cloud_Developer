/**
 * Fixtures in ./fixtures/vrps are copies of real VRP files from public
 * repositories; their sources are listed in the README there. No real
 * RIPEstat rpki-roas response could be found, so the RIPEstat case is
 * written inline from the shape third-party clients read (`data.roas[]`).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseVrps } from './vrps.ts';

const fixture = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(new URL(`./fixtures/vrps/${name}`, import.meta.url), 'utf8'));

type VrpRow = readonly [prefix: string, maxLength: number, asn: number];

const rowsOf = (input: unknown): readonly VrpRow[] => {
  const result = parseVrps(input);
  if (!result.ok) assert.fail(`expected the VRPs to parse, got: ${result.problem}`);
  return result.value.vrps.map((vrp) => [vrp.prefix.text, vrp.maxLength, vrp.asn] as const);
};

describe('parseVrps', () => {
  it('reads an rpki-client file, where asn is an integer', async () => {
    const rows = rowsOf(await fixture('vrps-rpki-client-2023.json'));

    assert.equal(rows.length, 11);
    assert.deepEqual(rows.slice(0, 3), [
      ['1.0.0.0/24', 24, 13335],
      ['1.0.4.0/24', 24, 38803],
      ['1.0.4.0/22', 22, 38803],
    ]);
    assert.deepEqual(rows.at(-3), ['2c0f:7400::/32', 48, 328720]);
  });

  it('ignores rpki-client metadata whatever its field types (2021 counters are strings)', async () => {
    const rows = rowsOf(await fixture('vrps-rpki-client-2021.json'));

    assert.equal(rows.length, 70);
    assert.deepEqual(rows[0], ['1.0.0.0/24', 24, 13335]);
  });

  it('reads a Routinator jsonext file, where asn is an "AS<n>" string', async () => {
    assert.deepEqual(rowsOf(await fixture('vrps-routinator-jsonext-2025.json')), [
      ['1.0.0.0/24', 24, 13335],
      ['2c0f:fff0::/32', 128, 37125],
    ]);
  });

  it('normalises an uppercase IPv6 prefix to its canonical text', async () => {
    assert.deepEqual(rowsOf(await fixture('vrps-rtrtr-cloudflare-style.json')), [
      ['192.0.2.0/24', 24, 64512],
      ['2001:db8::/32', 32, 4200000000],
    ]);
  });

  it('reads the RIPEstat shape, with roas under data and numbers possibly written as strings', () => {
    const ripestat: unknown = {
      status: 'ok',
      data_call_name: 'rpki-roas',
      data: {
        roas: [
          { asn: 13335, prefix: '1.0.0.0/24', maxLength: 24, ta: 'apnic' },
          { asn: '37125', prefix: '2c0f:fff0::/32', maxLength: '128', ta: 'afrinic' },
        ],
      },
    };

    assert.deepEqual(rowsOf(ripestat), [
      ['1.0.0.0/24', 24, 13335],
      ['2c0f:fff0::/32', 128, 37125],
    ]);
  });

  it('skips entries with host bits set or an impossible maxLength and names each one, keeping the rest', async () => {
    const result = parseVrps(await fixture('vrps-routinator-2021.json'));

    assert.ok(result.ok);
    assert.deepEqual(
      result.value.vrps.map((vrp) => [vrp.prefix.text, vrp.maxLength, vrp.asn]),
      [
        ['1.0.0.0/24', 24, 13335],
        ['1.0.4.0/24', 24, 38803],
        ['1.0.4.0/22', 23, 38803],
        ['2001:678:cdc::/48', 128, 210660],
        ['50.128.0.0/9', 9, 7922],
        ['73.0.0.0/8', 9, 7922],
      ],
    );
    assert.equal(result.value.skipped.length, 4);
    assert.match(result.value.skipped[0] ?? '', /roas\[3\].*1\.0\.4\.0\/21.*host bits/);
    assert.match(result.value.skipped[1] ?? '', /roas\[4\].*maxLength/);
    assert.match(result.value.skipped[2] ?? '', /roas\[5\].*maxLength/);
    assert.match(result.value.skipped[3] ?? '', /roas\[6\].*maxLength/);
  });

  it('skips entries with a missing or malformed prefix, maxLength or asn', () => {
    const good = { asn: 'AS64500', prefix: '203.0.113.0/24', maxLength: 24 };
    const result = parseVrps({
      roas: [
        good,
        'not an object',
        { ...good, prefix: '203.0.113.1/24' },
        { ...good, prefix: 42 },
        { ...good, maxLength: 24.5 },
        { ...good, maxLength: undefined },
        { ...good, asn: 'ASX' },
        { ...good, asn: -1 },
        { ...good, asn: 4294967296 },
        { ...good, asn: null },
      ],
    });

    assert.ok(result.ok);
    assert.deepEqual(
      result.value.vrps.map((vrp) => [vrp.prefix.text, vrp.maxLength, vrp.asn]),
      [['203.0.113.0/24', 24, 64500]],
    );
    assert.deepEqual(
      result.value.skipped.map((problem) => /roas\[(\d+)\]/.exec(problem)?.[1]),
      ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
    );
  });

  it('accepts an AS0 VRP, which RFC 6811 uses to mark a prefix as never Valid', () => {
    assert.deepEqual(rowsOf({ roas: [{ asn: 0, prefix: '203.0.113.0/24', maxLength: 24 }] }), [
      ['203.0.113.0/24', 24, 0],
    ]);
  });

  it('rejects input without a roas list', () => {
    for (const input of [null, [], 'roas', { roas: {} }, { data: { roas: 'x' } }, { vrps: [] }]) {
      const result = parseVrps(input);
      assert.ok(!result.ok, 'expected the input to be rejected');
      assert.match(result.problem, /roas/);
    }
  });

  it('rejects a file with no usable VRPs, since every state would wrongly be NotFound', () => {
    for (const roas of [[], [{ asn: 'AS1', prefix: 'nope', maxLength: 24 }]]) {
      const result = parseVrps({ roas });
      assert.ok(!result.ok, 'expected the input to be rejected');
      assert.match(result.problem, /no usable VRPs/);
    }
  });
});
