# BGP Hijack Monitor

Watches BGP announcements of your **monitored prefixes** and raises an **alert** when one is announced in a way your **declared origin** does not support. Terms are defined in [GLOSSARY.md](GLOSSARY.md); why the declared origin drives alerts is in [ADR 0001](docs/adr/0001-declared-origin-primary-rpki-as-context.md).

## Run it

Needs Node.js 22.18 or later (it runs the TypeScript sources directly).

```sh
npm install
npm start
```

The service connects to RIPE RIS Live and subscribes to announcements of every monitored prefix and its more-specifics. The page shows the live feed status (connecting, connected, reconnecting) and how many announcements it has observed; alerts from the feed are marked LIVE. The documentation prefixes in the sample configuration never appear on the real Internet, so use a prefix that is actually announced to see the counter move.

Then open <http://localhost:8080/> and press **Simulate: Origin mismatch**. A SIMULATED Origin mismatch alert appears without a reload; press again and its peer count rises. **Simulate: more-specific** announces the first monitored prefix plus one bit from a foreign AS, and **Simulate: forged origin + more-specific** announces the same longer prefix with the path `[foreign AS, declared origin]` (the Celer Bridge pattern); both raise an Unexpected more-specific alert.

## Configure it

List your monitored prefixes and the declared origin of each in `monitor.config.json` (IPv4 or IPv6, host bits zero, AS numbers 1 to 4294967295):

```json
{
  "monitoredPrefixes": [
    { "prefix": "203.0.113.0/24", "declaredOrigin": 64500 },
    { "prefix": "2001:db8::/32", "declaredOrigin": 64500 }
  ]
}
```

The simulation buttons use the first monitored prefix. If the file is missing or malformed, the service refuses to start and names the file and the problem.

## RPKI

At startup the service fetches VRPs once from `VRP_URL` (rpki-client, Routinator or RIPEstat JSON) and saves the raw response to `VRP_CACHE_FILE`. If the fetch fails it uses that cache, and if there is no usable cache either it refuses to start. VRPs are not refreshed while it runs. Before a demo on an unreliable network, start it once with a working connection so the cache exists.

Every alert shows its RFC 6811 validation state (Valid, Invalid or NotFound) as context; it never decides whether an alert is raised. The **Advisories** section lists each **Loose ROA**: a ROA covering a monitored prefix whose maxLength is longer than the prefix.

Environment variables (all optional):

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port of the web page |
| `MONITOR_CONFIG_FILE` | `monitor.config.json` | Path to the configuration file |
| `VRP_URL` | `https://console.rpki-client.org/vrps.json` | VRP JSON endpoint fetched at startup |
| `VRP_CACHE_FILE` | `vrps.cache.json` | Last fetched VRP JSON, used when the endpoint is unreachable |
| `RIS_LIVE_URL` | `wss://ris-live.ripe.net/v1/ws/` | RIPE RIS Live WebSocket URL (`ws://` or `wss://`) |
| `RIS_LIVE_CLIENT` | `bgp-hijack-monitor` | `client` identifier sent to RIS Live; name your deployment |

For example: `PORT=3000 MONITOR_CONFIG_FILE=/etc/bgp/prefixes.json npm start`.

## Develop

```sh
npm run typecheck
npm run lint
npm test
```

Layout:

- `src/monitor.ts`: the Monitor, the detection core (no I/O).
- `src/prefix.ts`: IPv4/IPv6 prefix parsing and containment.
- `src/rpki.ts`: RFC 6811 validation state and Loose ROA advisories, used by the Monitor.
- `src/parsers/`: boundary parsers from `unknown` input (configuration file, VRP JSON, RIS Live frames). Real fixtures and their sources are in `src/parsers/fixtures/vrps/` and `src/parsers/fixtures/ris-live/`.
- `src/vrp-source.ts`: fetches the VRPs at startup, with the cache fallback.
- `src/ris-live-feed.ts`: the RIS Live WebSocket client (subscribe, count, ping, reconnect with backoff).
- `src/monitor-config-file.ts`: reads and parses the configuration file.
- `src/config.ts`: the only reader of `process.env`.
- `src/simulation.ts`: simulation presets, one synthetic peer per press.
- `src/server.ts`: the page, server-sent events at `/events` (`snapshot`, `alert`, `feed-status`, `observations`) and `POST /simulate/:preset`.
- `public/index.html`: the web page.
