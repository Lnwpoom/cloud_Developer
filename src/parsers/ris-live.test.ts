import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRisLiveFrame } from './ris-live.ts';

/** Real RIS Live frames; see fixtures/ris-live/README.md for their sources. */
const fixtureText = (name: string): string =>
  readFileSync(new URL(`fixtures/ris-live/${name}`, import.meta.url), 'utf8');
const fixture = (name: string): unknown => JSON.parse(fixtureText(name));

/** A well-formed UPDATE based on a real 2026 frame, with `overrides` applied to `data`. */
const update = (overrides: Record<string, unknown>): unknown => {
  const frame = fixture('ris-message-announce-and-withdraw-2026.json') as { data: Record<string, unknown> };
  const data = Object.fromEntries(
    Object.entries({ ...frame.data, ...overrides }).filter(([, value]) => value !== undefined),
  );
  return { ...frame, data };
};

const observationsOf = (input: unknown) => {
  const result = parseRisLiveFrame(input);
  if (!result.ok) assert.fail(`expected observations, got problem: ${result.problem}`);
  return result.value.observations.map((observation) => ({ ...observation, announcedPrefix: observation.announcedPrefix.text }));
};

describe('parseRisLiveFrame', () => {
  it('turns a real UPDATE into one live observation per announced prefix, carrying the peer and AS path', () => {
    assert.deepEqual(observationsOf(fixture('ris-message-announce-and-withdraw-2026.json')), [
      {
        announcedPrefix: '2806:320:340::/42',
        asPath: [13030, 2914, 32098, 28438],
        peer: '2001:7f8:1::a501:3030:1',
        source: 'live',
        seenAt: new Date(1789019606210),
      },
    ]);
  });

  it('yields every prefix of every announcement group when the groups carry different prefixes', () => {
    // The real 2019 frame, with its second group's prefixes replaced so the groups differ.
    const frame = fixture('ris-message-multi-announcement.json') as {
      data: { announcements: { prefixes: string[] }[] };
    };
    const second = frame.data.announcements[1];
    assert.ok(second);
    second.prefixes = ['2804:14c:8000::/40', '2804:14c::/32'];

    const observations = observationsOf(frame);

    assert.deepEqual(
      observations.map((observation) => observation.announcedPrefix),
      [
        '2804:14c:8586::/48',
        '2804:14c:85a4::/48',
        '2804:14c:8585::/48',
        '2804:14c:8584::/48',
        '2804:14c:8580::/48',
        '2804:14c:8000::/40',
        '2804:14c::/32',
      ],
    );
    for (const observation of observations) {
      assert.deepEqual(observation.asPath, [29686, 6453, 6762, 4230, 28573]);
      assert.equal(observation.peer, '2001:7f8::73f6:0:1');
    }
  });

  it('yields a prefix once when a second group repeats it for the link-local next hop (2019 frames)', () => {
    assert.deepEqual(
      observationsOf(fixture('ris-message-multi-announcement.json')).map((observation) => observation.announcedPrefix),
      ['2804:14c:8586::/48', '2804:14c:85a4::/48', '2804:14c:8585::/48', '2804:14c:8584::/48', '2804:14c:8580::/48'],
    );
  });

  it('yields nothing for withdrawal-only UPDATEs, whether the keys are absent (2019) or empty lists (2025)', () => {
    assert.deepEqual(observationsOf(fixture('ris-message-withdrawals-only-2019.json')), []);
    assert.deepEqual(observationsOf(fixture('ris-message-withdrawals-only-2025.json')), []);
  });

  it('yields nothing for real non-UPDATE ris_messages: KEEPALIVE, STATE, RIS_PEER_STATE, OPEN, NOTIFICATION', () => {
    const lines = [
      ...fixtureText('ris-live-frames-2026.jsonl').split('\n').slice(3, 7),
      ...fixtureText('ris-live-stream-2019-libbgpstream.jsonl').split('\n').filter((_, index) => [1, 3, 4, 5].includes(index)),
    ];
    const frames = lines.map((line) => JSON.parse(line) as { data: { type: string } });
    assert.deepEqual(
      frames.map((frame) => frame.data.type),
      ['KEEPALIVE', 'STATE', 'OPEN', 'NOTIFICATION', 'RIS_PEER_STATE', 'OPEN', 'NOTIFICATION', 'KEEPALIVE'],
    );
    for (const frame of frames) assert.deepEqual(observationsOf(frame), [], frame.data.type);
  });

  it('yields nothing for control frames such as ris_subscribe_ok and pong', () => {
    const subscribeOk = { type: 'ris_subscribe_ok', data: { subscription: { prefix: '203.0.113.0/24' } } };
    assert.deepEqual(observationsOf(subscribeOk), []);
    assert.deepEqual(observationsOf({ type: 'pong', data: null }), []);
  });

  it('reports a ris_error frame as a problem carrying the server message', () => {
    const line = fixtureText('ris-live-stream-2019-libbgpstream.jsonl').split('\n')[2] ?? '';

    const result = parseRisLiveFrame(JSON.parse(line));

    assert.deepEqual(result, { ok: false, problem: 'ris_error: this is a test error message' });
  });

  it('keeps an AS_SET at the end of a real path as a nested list of AS numbers', () => {
    assert.deepEqual(observationsOf(fixture('ris-message-as-set.json')), [
      {
        announcedPrefix: '2607:ffc0:1000::/36',
        asPath: [2497, 6453, 18705, 26281, [13340]],
        peer: '2001:504:1::a500:2497:1',
        source: 'live',
        seenAt: new Date(1573830861720),
      },
    ]);
  });

  it('normalises an uncompressed IPv6 prefix, as 2025+ frames send in withdrawals', () => {
    const frame = update({ announcements: [{ next_hop: '2001:db8::1', prefixes: ['2a12:ca42:0:0:0:0:0:0/32'] }] });

    assert.deepEqual(
      observationsOf(frame).map((observation) => observation.announcedPrefix),
      ['2a12:ca42::/32'],
    );
  });

  it('skips only the malformed prefixes of an UPDATE, keeping every valid observation and naming what it skipped', () => {
    const frame = update({
      announcements: [
        { next_hop: '192.0.2.1', prefixes: ['203.0.113.0/24', '203.0.113.7/24', 42, '198.51.100.0/24'] },
        { next_hop: '192.0.2.1' },
        { next_hop: '192.0.2.1', prefixes: ['2001:db8::/32'] },
      ],
    });

    const result = parseRisLiveFrame(frame);

    assert.ok(result.ok);
    assert.deepEqual(
      result.value.observations.map((observation) => observation.announcedPrefix.text),
      ['203.0.113.0/24', '198.51.100.0/24', '2001:db8::/32'],
    );
    assert.deepEqual(result.value.skipped, [
      'announced prefix "203.0.113.7/24" has host bits set',
      'announced prefix is not a string',
      'announcement group has no "prefixes" list',
    ]);
  });

  it('reports no skipped prefixes for a well-formed UPDATE', () => {
    const result = parseRisLiveFrame(fixture('ris-message-announce-and-withdraw-2026.json'));

    assert.ok(result.ok);
    assert.deepEqual(result.value.skipped, []);
  });

  describe('reports malformed input as a problem instead of throwing', () => {
    const cases: Record<string, unknown> = {
      'not an object': 'hello',
      null: null,
      'a list': [],
      'no type': { data: {} },
      'ris_message without data': { type: 'ris_message' },
      'UPDATE without peer': update({ peer: undefined }),
      'UPDATE with a string timestamp': update({ timestamp: '1789019606.210' }),
      'announcements that are not a list': update({ announcements: {} }),
      'a group without prefixes': update({ announcements: [{ next_hop: '192.0.2.1' }] }),
      'a prefix that is not a string': update({ announcements: [{ prefixes: [42] }] }),
      'an invalid prefix': update({ announcements: [{ prefixes: ['203.0.113.7/24'] }] }),
      'only invalid prefixes across groups': update({
        announcements: [{ prefixes: ['203.0.113.7/24', 42] }, { next_hop: '192.0.2.1' }],
      }),
      'announcements without a path': update({ path: undefined }),
      'announcements with an empty path': update({ path: [] }),
      'a path element that is a string': update({ path: [13030, '2914'] }),
      'a negative AS number': update({ path: [13030, -1] }),
      'an AS number above 2^32-1': update({ path: [13030, 4294967296] }),
      'a fractional AS number': update({ path: [13030, 2914.5] }),
      'an empty AS_SET': update({ path: [13030, []] }),
      'an AS_SET with a non-number member': update({ path: [13030, [1, 'x']] }),
    };
    for (const [name, input] of Object.entries(cases)) {
      it(name, () => {
        const result = parseRisLiveFrame(input);
        assert.equal(result.ok, false);
      });
    }
  });
});
