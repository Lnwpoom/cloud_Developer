# RIS Live fixtures

Real RIPE RIS Live frames, copied byte for byte from public repositories that recorded them (retrieved 2026-10-04). This container cannot reach `ris-live.ripe.net`, so nothing here was captured by this project. Raw URL pattern: `https://raw.githubusercontent.com/<repo>/<commit>/<path>`.

| File | Source (repo @ commit : path) | Captured | Shows |
|---|---|---|---|
| `ris-message-multi-announcement.json` | morrowc/rislive @ 9aae7ad37824aa2c3abd934aaeea51697bb3fed1 : `testdata/1k-msgs` line 137 | 2019-05-23 | 2 announcement groups (global and link-local next hop) repeating the same 5 IPv6 prefixes |
| `ris-message-withdrawals-only-2019.json` | same file, line 207 | 2019-05-23 | withdrawal-only; `path`, `announcements` and `community` keys absent |
| `ris-message-as-set.json` | morrowc/rislive @ 9aae7ad37824aa2c3abd934aaeea51697bb3fed1 : `testdata/fail-as-set` line 1 | 2019-11-15 | `path` ending in an AS_SET as a nested array: `[2497,6453,18705,26281,[13340]]` |
| `ris-message-announce-and-withdraw-2026.json` | bgpkit/bgpkit-parser @ 005ad93a6219301782250a09c7913ebbc8331ba6 : `tests/fixtures/rislive/ris-live-frames.jsonl` line 2 | 2026-09-10 | one announcement plus uncompressed IPv6 withdrawals; comma-joined next hop |
| `ris-live-frames-2026.jsonl` | same file, whole | 2026-09-10 | one each of UPDATE, KEEPALIVE, `STATE`, OPEN and NOTIFICATION |
| `ris-message-withdrawals-only-2025.json` | bgpkit/bgpkit-parser @ 005ad93a6219301782250a09c7913ebbc8331ba6 : `src/parser/rislive/mod.rs` line 355 | 2025-02-26 | withdrawal-only, modern form: `path`, `community` and `announcements` sent as `[]`; uncompressed IPv6 |
| `ris-live-stream-2019-libbgpstream.jsonl` | CAIDA/libbgpstream @ 1993feadb6cdf4aea37ccb8e6a29a57d10de6127 : `test/ris-live-stream.json` | 2019-03-26 | UPDATE, `RIS_PEER_STATE`, `ris_error` (synthetic text), OPEN, NOTIFICATION, KEEPALIVE; line 7 is a truncated KEEPALIVE (invalid JSON) |

Differences from `docs/research/bgp-rpki-hijack-detection.md` section 5, confirmed by these frames:

- `peer_asn` is always a JSON string; `peer` is a string IP; `timestamp` is a decimal number of Unix seconds.
- `path` elements are integers; an AS_SET is a nested array of integers.
- Withdrawal-only frames omit `path` and `announcements` (2019) or send them as `[]` (2025+).
- IPv6 withdrawals can arrive uncompressed (`2a12:ca42:0:0:0:0:0:0/32`).
- 2019 frames repeat the prefixes in a second announcement group for the link-local next hop; 2024+ frames send one comma-joined `next_hop`.
- Peer state arrives as `"type":"STATE"` (2026), formerly `"RIS_PEER_STATE"`.
- `raw` is hex, not Base64.
