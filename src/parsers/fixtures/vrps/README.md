# VRP fixtures

Real VRP JSON files, copied from public repositories (retrieved 2026-10-04). This container cannot reach `console.rpki-client.org`, `rpki.cloudflare.com` or `stat.ripe.net`, so nothing here was fetched by this project. Raw URL pattern: `https://raw.githubusercontent.com/<repo>/<commit>/<path>`.

| File | Source (repo @ commit : path) | Shape | Notes |
|---|---|---|---|
| `vrps-rpki-client-2023.json` | jeffsw/rpkilog @ 9e83202dc4d92411a7c4ed744565846cb6c502e8 : `python/rpkilog/tests/roa_test.rpkiclient2023_json` | rpki-client `-j`, 2023-10-01 build | cut to lines 1–52 and 421–end (11 of 379 roas); lines unchanged; `bgpsec_keys` and `aspas` complete |
| `vrps-rpki-client-2021.json` | same repo and commit : `python/rpkilog/tests/roa_test.rpkiclient2021_json` | rpki-client, 2021 | whole file (70 roas); older `metadata` with string counters and a space-separated `talfiles` |
| `vrps-routinator-2021.json` | mellowdrifter/rpkirtr @ ef69b737c06a96fccb4a93567bec599fe08d54e8 : `data/string.json` | Routinator `json`, 2021-10-22 | real header and first entries, but the upstream author inserted invalid entries (host bits set, maxLength 33 on IPv4, 129, 0 and 47 on IPv6 /48s) |
| `vrps-routinator-jsonext-2025.json` | jeffsw/rpkilog @ 9e83202dc4d92411a7c4ed744565846cb6c502e8 : `python/rpkilog/tests/roa_test.routinator_jsonext` | Routinator `jsonext`, 2025-03-09 | real entries; `source[]` in place of `ta` |
| `vrps-rtrtr-cloudflare-style.json` | NLnetLabs/rtrtr @ 81a01421155649dd0dda38ffc78e2015b556f96e : `test-data/vrps-metadata.json` | Cloudflare `rpki.json` style | hand-written upstream (documentation prefixes, uppercase IPv6) |

Not here: no real RIPEstat `rpki-roas` response could be found, so the parser's `data.roas[]` support is tested only with an inline, hand-written sample and is unconfirmed against real data.

Confirmed by these files: rpki-client writes `asn` as an integer, Routinator as an `"AS<n>"` string; both write `maxLength` as an integer. rpki-client `metadata` field types change between versions, so the parser ignores `metadata`.
