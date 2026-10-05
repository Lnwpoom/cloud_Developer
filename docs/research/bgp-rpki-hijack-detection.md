# BGP hijack detection with RPKI Route Origin Validation: primary-source research

Research date: 2026-10-04. Scope: the facts a TypeScript/Node.js BGP hijack detector built on RPKI ROV needs, traced to IETF, RIPE NCC, tool and first-party incident sources.

## How the facts were checked (read this first)

The research sandbox blocked direct HTTP access to most primary hosts: rfc-editor.org, datatracker.ietf.org, ietf.org, ripe.net, ris-live.ripe.net, data.ris.ripe.net, the RouteViews archive, the CAIDA BGPStream site, the Cloudflare blog, console.rpki-client.org and manrs.org. GitHub and the npm registry were reachable. Each claim below is tagged with how it was checked:

- **[read]**: read in full from the primary artifact. That means the RFC text, the tool's own source code or documentation on GitHub (the RIPE NCC `ris-docs` repo, NLnet Labs Routinator docs, rpki-client source and man page, BGPalerter source), or the npm registry. RFC text came from a GitHub-hosted verbatim copy of the RFC (`tex2e/rfc-translater`, which keeps the original English text next to a translation). The citation still links the canonical rfc-editor.org URL.
- **[extract]**: confirmed only through search-engine extracts of the primary page. The linked page was not opened. Re-read it before quoting in the final report.
- **[unconfirmed]**: could not be confirmed from a primary source. Treat it as a lead, not a fact.

## Summary

- **ROV (RFC 6811)** compares each route's (prefix, origin AS) with the set of VRPs that *cover* it. The result is **Valid** if some covering VRP also *matches* (prefix length ≤ maxLength and origin AS equal), **Invalid** if VRPs cover it but none match, and **NotFound** if no VRP covers it. An AS_PATH that ends in an AS_SET has origin "NONE", which can never match. A VRP for AS 0 never matches. [read] ([RFC 6811 §2](https://www.rfc-editor.org/rfc/rfc6811.html#section-2))
- **RFC 9319 (BCP 185)** says operators SHOULD use minimal ROAs and SHOULD avoid maxLength. A loose maxLength lets an attacker forge the origin AS on a sub-prefix and get an RPKI-*Valid* route. That is the "forged-origin sub-prefix hijack", the same pattern used in the 2022 Celer Bridge theft. [read] ([RFC 9319 §3, §5](https://www.rfc-editor.org/rfc/rfc9319.html#section-3))
- **RTR v1 (RFC 8210)** is a binary, stateful TCP protocol (port 323) built for routers. No maintained Node.js RTR client turned up on npm. Validator JSON (Routinator `/json`, rpki-client `-j`, public dumps) is the pragmatic input for a Node app. [read]
- **ASPA** is still two active Internet-Drafts: `draft-ietf-sidrops-aspa-profile` and `draft-ietf-sidrops-aspa-verification`. It verifies the AS_PATH against signed customer-to-provider attestations. It catches route leaks and some forged-origin/forged-path hijacks that ROV cannot see, with outcomes Valid / Invalid / Unknown. [extract]
- **RIS Live** is a free WebSocket feed at `wss://ris-live.ripe.net/v1/ws/` (send `?client=<id>`). Subscriptions are JSON `ris_subscribe` messages with filters: `host`, `type`, `require`, `peer`, `path`, `prefix`, `moreSpecific`, `lessSpecific`, and `socketOptions` (`includeRaw`, `acknowledge`). The manual publishes no numeric rate limit. A client that cannot keep up is disconnected. [extract]
- **VRP JSON**: Routinator emits `{"roas":[{"asn":"AS196615","prefix":…,"maxLength":24,"ta":"ripe"}]}` with the ASN as a *string*. rpki-client emits `asn` as an *integer* and adds `expires`. Normalise both. [read] Public dumps exist (rpki-client console, NTT, RIPEstat, Cloudflare). Their URLs are confirmed only through client code that fetches them. [read, from third-party code]
- **Replay**: RIS MRT files live at `https://data.ris.ripe.net/rrcXX/YYYY.MM/{bview|updates}.YYYYMMDD.HHmm.gz` (bview every 8 h, updates every 5 min). [read] For Node, `@bgpkit/parser` (WASM, MIT) parses MRT and RIS Live JSON, but it holds the whole decompressed file in memory. A `bgpdump -m` or pybgpstream bridge is the robust fallback for full RIBs. [read]
- **Ground truth**: 8 incidents are documented below. Only Celer Bridge (2022) exercises ROV's blind spot (forged origin). YouTube 2008 and Route 53 2018 are classic origin/more-specific hijacks. Verizon/DQE 2019 and Safe Host/China Telecom 2019 are route leaks that ROV cannot flag.

---

## 1. RFC 6811: BGP prefix origin validation

RFC 6811, *BGP Prefix Origin Validation*, Standards Track, January 2013 (Mohapatra, Scudder, Ward, Bush, Austein). [read] ([RFC 6811](https://www.rfc-editor.org/rfc/rfc6811.html)) It is updated by RFC 8481 (September 2018). [read] ([RFC 8481](https://www.rfc-editor.org/rfc/rfc8481.html))

Table of contents for orientation: §2 Prefix-to-AS Mapping Database, §2.1 Pseudo-Code, §3 Policy Control, §4 Interaction with Local Cache, §5 Deployment Considerations. [read]

### Definitions (§2) [read]

| Term | RFC 6811 definition (verbatim or close paraphrase) |
|---|---|
| Prefix | "(IP address, prefix length), interpreted as is customary" |
| Route Prefix | "The Prefix derived from a route." |
| Covered | "A Route Prefix is said to be Covered by a VRP when the VRP prefix length is less than or equal to the Route prefix length", and the address bits match for the VRP's prefix length. In other words, the route is the VRP prefix or a more-specific of it. |
| Matched | "A Route Prefix is said to be Matched by a VRP when the Route Prefix is Covered by that VRP, the Route prefix length is less than or equal to the VRP maximum length, and the Route Origin ASN is equal to the VRP ASN." |
| **NotFound** | "No VRP Covers the Route Prefix." |
| **Valid** | "At least one VRP Matches the Route Prefix." |
| **Invalid** | "At least one VRP Covers the Route Prefix, but no VRP Matches it." |

Source: [RFC 6811 §2](https://www.rfc-editor.org/rfc/rfc6811.html#section-2).

### Determining the route origin ASN (§2) [read]

- The origin is the rightmost AS in the final segment of AS_PATH if that segment is an AS_SEQUENCE.
- It is the BGP speaker's own AS if the final segment is AS_CONFED_SEQUENCE or AS_CONFED_SET, or if AS_PATH is empty.
- Otherwise, which includes a final **AS_SET**, the origin is the distinguished value **NONE**. NONE can never match, so such a route is Invalid when covered and NotFound when not.
- "no valid Route can have an Origin ASN of zero … Thus, no Route can be Matched by a VRP whose ASN is zero." This means AS0 VRPs make covered routes Invalid.

Source: [RFC 6811 §2](https://www.rfc-editor.org/rfc/rfc6811.html#section-2).

### Algorithm (§2.1 pseudo-code, verbatim) [read]

```
result = BGP_PFXV_STATE_NOT_FOUND;
entry = next_lookup_result(pfx_validate_table, route_prefix);   // covering VRPs
while (entry != NULL) {
  prefix_exists = TRUE;
  if (route_prefix_length <= entry->max_length) {
    if (route_origin_as != NONE
        && entry->origin_as != 0
        && route_origin_as == entry->origin_as) {
      result = BGP_PFXV_STATE_VALID;
      return (result);
    }
  }
  entry = next_lookup_result(pfx_validate_table, input.prefix);
}
if (prefix_exists == TRUE) {
  result = BGP_PFXV_STATE_INVALID;
}
return (result);
```

Source: [RFC 6811 §2.1](https://www.rfc-editor.org/rfc/rfc6811.html#section-2.1). The RFC notes that VRPs may be visited in any order and that "the validation state output is fully determined". [read]

### Policy (§2, §3, §5; RFC 8481) [read]

- The validation state alone does not drop routes: "An implementation MUST NOT exclude a route from the Adj-RIB-In or from consideration in the decision process as a side effect of its validation state, unless explicitly configured to do so." ([§2](https://www.rfc-editor.org/rfc/rfc6811.html#section-2))
- Implementations MUST let route policy match and set validation state ([§3](https://www.rfc-editor.org/rfc/rfc6811.html#section-3)). Examples of policy include rejecting Invalid routes or lowering their preference ([§5](https://www.rfc-editor.org/rfc/rfc6811.html#section-5)).
- RFC 8481 §4: a router "MUST evaluate and set the validation state of all routes in BGP coming from any source". RFC 8481 §5: absent operator configuration, policy MUST NOT be applied. ([RFC 8481](https://www.rfc-editor.org/rfc/rfc8481.html))

**Implication for the prototype:** the existing Valid/Invalid/NotFound logic should also handle origin = NONE for AS_SET-terminated paths and AS0 VRPs. A detector *reports* the state; it does not filter.

---

## 2. RFC 9319: avoid maxLength; the forged-origin sub-prefix hijack

RFC 9319, *The Use of maxLength in the Resource Public Key Infrastructure (RPKI)*, BCP 185, October 2022 (Gilad, Goldberg, Sriram, Snijders, Maddison). [read] ([RFC 9319](https://www.rfc-editor.org/rfc/rfc9319.html))

### The attack (§3) [read]

- **Setup:** AS 64496 holds 192.168.0.0/16 and originates the /16 plus 192.168.225.0/24. It publishes the loose ROA `(192.168.0.0/16-24, AS 64496)`.
- **Attack:** the hijacker AS 64511 announces "192.168.0.0/24: AS 64511, AS 64496". This falsely claims adjacency to AS 64496 and claims that AS 64496 originates the /24.
- **Why it works:** "The hijacker's BGP announcement is valid according to the RPKI since the ROA (192.168.0.0/16-24, AS 64496) authorizes AS 64496 to originate BGP routes for 192.168.0.0/24." The /24 was never really announced, so longest-prefix match sends its traffic to the hijacker.
- **Fix:** a minimal ROA, `(192.168.0.0/16, 192.168.225.0/24, AS 64496)`. The forged /24 is then Invalid by length.

Source: [RFC 9319 §3](https://www.rfc-editor.org/rfc/rfc9319.html#section-3).

### Normative recommendations (§5) [read]

- "Operators SHOULD use minimal ROAs whenever possible. A minimal ROA contains only those IP prefixes that are actually originated by an AS in BGP and no other IP prefixes."
- "In general, operators SHOULD avoid using the maxLength attribute in their ROAs, since its inclusion will usually make the ROA non-minimal."
- Allowed exceptions:
  - when *all* more-specifics permitted by maxLength are actually announced;
  - when maxLength is much larger than the prefix length *and* a large number of more-specifics in that range are announced;
  - DDoS-mitigation and defensive de-aggregation cases (§5.1, §5.2). RFC 9319 warns that these leave address space exposed while the covering prefix is not originated.
- §4 measurement (June 2017): 12% of prefixes in ROAs had maxLength > prefix length, and 84% of those were non-minimal.

Source: [RFC 9319 §4–§5](https://www.rfc-editor.org/rfc/rfc9319.html#section-5).

**Implication:** a detector can compute a "loose ROA" warning offline. Flag a VRP whose maxLength allows more-specifics that are not seen in BGP, because it can be abused by a forged-origin hijack. That is a cheap, ROV-only detector that adds value.

---

## 3. RFC 8210: RPKI-to-Router protocol v1

RFC 8210, *The RPKI to Router Protocol, Version 1*, Standards Track, September 2017 (Bush, Austein). It updates RFC 6810. [read] ([RFC 8210](https://www.rfc-editor.org/rfc/rfc8210.html))

**What it carries.** The abstract says routers need "a simple but reliable mechanism to receive [RPKI] prefix origin data and router keys from a trusted cache". [read] PDU types (§5) [read]:

| Type | PDU | Notes |
|---|---|---|
| 0 | Serial Notify | cache tells the router that new data is available |
| 1 | Serial Query | router asks for the delta since a serial |
| 2 | Reset Query | router asks for the full set |
| 3 | Cache Response | starts the payload; carries the Session ID |
| 4 | IPv4 Prefix | flags (low bit 1 = announce, 0 = withdraw), prefix length, max length, prefix, 32-bit ASN |
| 6 | IPv6 Prefix | same layout for IPv6 |
| 7 | End of Data | ends the payload; carries the serial and the Refresh/Retry/Expire timers |
| 8 | Cache Reset | the cache cannot serve the delta; the router must Reset Query |
| 9 | Router Key | new in v1: SKI (20 octets), ASN, Subject Public Key Info (BGPsec) |
| 10 | Error Report | |

**Timers (§6)** [read]:

| Timer | Range | Recommended default |
|---|---|---|
| Refresh | 1–86400 s | 3600 s |
| Retry | 1–7200 s | 600 s |
| Expire | 600–172800 s | 7200 s |

A Serial Notify tells the router to query immediately.

**Transport (§9).** Options are SSH, TLS, TCP-MD5 and TCP-AO [read]. "Caches and routers MUST implement unprotected transport over TCP using a port, rpki-rtr (323)" [extract]. Routinator documents port 323 for RTR and 324 for RTR over TLS, and supports RTR v1 and v0 [read] ([Routinator RTR docs](https://github.com/NLnetLabs/routinator/blob/main/doc/manual/source/rtr-service.rst)).

**RTR v2.** `draft-ietf-sidrops-8210bis` adds an ASPA PDU. It is an active Internet-Draft. Search results show revisions up to -27 and an IESG ballot page, but its current state could not be confirmed directly. [extract] ([datatracker](https://datatracker.ietf.org/doc/draft-ietf-sidrops-8210bis/))

### Can a Node.js app consume RTR?

**It is feasible but not worth it for this project.**

The protocol is a small set of fixed-layout binary PDUs over plain TCP. A `node:net` socket plus a `Buffer` parser is a few hundred lines of code. It also brings incremental updates and the session/serial state machine.

No maintained npm RTR client turned up: npm registry searches for "rpki", "rpki rtr" and "rtr" returned only validators and monitors that use JSON. [read] ([npm search](https://registry.npmjs.org/-/v1/search?text=rpki&size=25))

**Validator JSON is simpler:**

- Routinator serves the full VRP set at `/json` (default HTTP port 8323 in its examples). It can filter with `select-asn`, `select-prefix` and `more-specifics`. [read] ([Routinator HTTP service](https://github.com/NLnetLabs/routinator/blob/main/doc/manual/source/http-service.rst))
- It also offers incremental `/json-delta?session=…&serial=…` and `/json-delta/notify`. That gives RTR-like deltas over HTTP. [read] ([Routinator API endpoints](https://github.com/NLnetLabs/routinator/blob/main/doc/manual/source/api-endpoints.rst))

Recommendation: JSON over HTTP. Keep RTR as an optional stretch goal.

---

## 4. ASPA: AS_PATH verification

### Drafts and status [extract]

- **`draft-ietf-sidrops-aspa-profile`** (*A Profile for Autonomous System Provider Authorization*) is an active WG draft, intended Proposed Standard. The latest revision seen is -29 (late July / early August 2026), not yet an RFC. ([datatracker](https://datatracker.ietf.org/doc/draft-ietf-sidrops-aspa-profile/))
  - It defines the CMS content type id-ct-ASPA (OID 1.2.840.113549.1.9.16.1.49).
  - The eContent is `ASProviderAttestation { version, customerASID, providers }`. [extract]
- **`draft-ietf-sidrops-aspa-verification`** (*BGP AS_PATH Verification Based on Autonomous System Provider Authorization (ASPA) Objects*) is an active WG draft. The latest revision seen is -28, dated 2026-08-24 and expiring 2027-02-25. ([datatracker](https://datatracker.ietf.org/doc/draft-ietf-sidrops-aspa-verification/)) [extract]

rpki-client's man page lists `draft-ietf-sidrops-aspa-profile` (February 2026) under STANDARDS, which shows that a deployed validator implements it. [read] ([rpki-client.8](https://github.com/rpki-client/rpki-client-openbsd/blob/master/src/usr.sbin/rpki-client/rpki-client.8))

**Exact draft revision numbers and IESG state are [extract] only. Re-check them on datatracker before citing them.**

### What ASPA detects that ROV cannot [extract]

ROV only checks the last AS in the path. ASPA's abstract says it "enhances routing security by adding means to detect and mitigate route leaks and AS_PATH manipulations". It provides "protection, to some degree, against prefix hijacks with forged-origin or forged-path-segment". ([draft-ietf-sidrops-aspa-verification](https://datatracker.ietf.org/doc/html/draft-ietf-sidrops-aspa-verification))

Concretely:

- **Route leaks:** a customer re-advertises provider or peer routes upward (a "valley"). See RFC 7908 types 1–4, e.g. Verizon/DQE 2019 and Safe Host 2019.
- **Forged adjacency:** the hijacker writes "… attacker, victim" in the path. If the victim registered an ASPA that does not list the attacker as a provider, the hop is "Not Provider+" and the path becomes Invalid. That protection depends on the victim having published an ASPA.

### Verification mechanics and outcomes [extract]

- **Hop check** `hop(AS(i), AS(j))` looks up the customer AS(i) in the validated ASPA set (VAP-SPAS). It returns one of:
  - **"No Attestation"**: no ASPA for AS(i);
  - **"Provider+"**: AS(j) is listed. Provider+ covers a provider, a non-transparent route server, or a mutual-transit neighbour;
  - **"Not Provider+"**: otherwise.
- **Path outcomes** are **Valid**, **Invalid** and **Unknown**.
- Two algorithms exist:
  - **upstream verification:** used when the route comes from a customer or lateral peer, or by an RS-client at an IXP route server. Every hop must be customer-to-provider;
  - **downstream verification:** used when the route comes from a provider. It allows an up-ramp (customer-to-provider hops from the origin to the apex) followed by a down-ramp.

Source: [draft-ietf-sidrops-aspa-verification](https://datatracker.ietf.org/doc/html/draft-ietf-sidrops-aspa-verification).

The exact step-by-step algorithm text of revision -28 was **not read directly**. Implement against the draft text, not this summary.

### Route-leak taxonomy (RFC 7908, Informational, June 2016) [read]

A route leak is "the propagation of routing announcement(s) beyond their intended scope". Types:

1. Hairpin turn with full prefix
2. Lateral ISP-ISP-ISP leak
3. Leak of transit-provider prefixes to a peer
4. Leak of peer prefixes to a transit provider
5. Prefix re-origination with a data path to the legitimate origin
6. Accidental leak of internal prefixes and more-specifics

Source: [RFC 7908 §2–§3](https://www.rfc-editor.org/rfc/rfc7908.html#section-3).

### Data availability

- Routinator includes validated ASPAs in JSON as `"aspas":[{"customer":"AS64496","afi":"ipv6","providers":["AS64499"],"ta":"ripe"}]` when run with `--enable-aspa` (added in 0.13.0). [read] ([output formats](https://github.com/NLnetLabs/routinator/blob/main/doc/manual/source/output-formats.rst), [advanced features](https://github.com/NLnetLabs/routinator/blob/main/doc/manual/source/advanced-features.rst))
- rpki-client JSON includes `"aspas":[{"customer_asid":…,"providers":[…],"expires":…}]` with integer ASNs. `-A` excludes them. [read] ([output-json.c](https://github.com/rpki-client/rpki-client-openbsd/blob/master/src/usr.sbin/rpki-client/output-json.c))
- OpenBGPD implements ASPA path validation, with states including `ASPA_VALID`, `ASPA_INVALID` and `ASPA_UNKNOWN`, in `rde_aspa.c`. This is a useful reference implementation. [read] ([rde_aspa.c](https://github.com/openbsd/src/blob/master/usr.sbin/bgpd/rde_aspa.c))
- **[unconfirmed]** How many ASes have published ASPAs today. ASPA coverage is expected to be sparse, so most paths will be "Unknown".

---

## 5. RIPE RIS Live

RIPE NCC's RIS documentation (GitHub `RIPE-NCC/ris-docs`) only links out to the manual at https://ris-live.ripe.net/manual/ [read] ([25_ris_live.md](https://github.com/RIPE-NCC/ris-docs/blob/main/docs/25_ris_live.md)). That manual could not be opened, so everything in this section is **[extract]** of the manual unless marked otherwise. Open the manual and confirm field names before coding the validator.

### Endpoint and access

- WebSocket: **`wss://ris-live.ripe.net/v1/ws/`**. No authentication is required. Including `?client=<some-meaningful-identifier>` in all URLs is "highly recommended". [extract] ([manual](https://ris-live.ripe.net/manual/))
- A non-interactive full stream ("firehose") also exists. Its exact URL was not confirmed. [extract]
- BGPalerter, NTT's Node.js monitor (BSD-3), uses `ws://ris-live.ripe.net/v1/ws/` with `perMessageDeflate: true`. [read] ([BGPalerter config.yml.example](https://github.com/nttgin/BGPalerter/blob/main/config.yml.example))
- **Rate limits and terms:** the manual extract gives no numeric rate or connection limit. It says that if a client "is unable to keep up with the incoming data, then a final error message will be sent and the connection will be closed". [extract] RIPE NCC publishes separate *RIS Commercial Use Terms and Conditions*, which were not read. [unconfirmed] ([RIPE NCC](https://www.ripe.net/analyse/internet-measurements/routing-information-service-ris/commercial-use/))

### Subscribe message [extract]

```json
{ "type": "ris_subscribe",
  "data": {
    "host": "rrc01",
    "type": "UPDATE",
    "require": "announcements",
    "path": "64496,64497$",
    "prefix": "192.0.2.0/24",
    "moreSpecific": true,
    "lessSpecific": false,
    "peer": "192.0.2.1",
    "socketOptions": { "includeRaw": false, "acknowledge": true }
  } }
```

Filters and their meaning, as found:

| Filter | Meaning |
|---|---|
| `host` | Route collector, e.g. `rrc21`. Omitted means all collectors. |
| `type` | `UPDATE`, `OPEN`, `NOTIFICATION`, `KEEPALIVE` or `RIS_PEER_STATE`. The list comes from the bgpkit `ris-live-rs` CLI docs. [read] ([ris-live-rs](https://github.com/bgpkit/ris-live-rs)) |
| `require` | Only messages that contain the key, e.g. `announcements` or `withdrawals`. |
| `peer` | IP address of the RIS peer. |
| `path` | Pattern on the AS path: comma-separated ASNs, optional `^` (start) and `$` (end). The path is listed peer to origin, so `"13335$"` means "originated by AS13335". BGPalerter subscribes per monitored AS with `path: "<asn>$"`. [read] ([connectorRIS.js](https://github.com/nttgin/BGPalerter/blob/main/src/connectors/connectorRIS.js)) |
| `prefix` + `moreSpecific` / `lessSpecific` | Messages for the prefix and its sub-prefixes or super-prefixes. A `ris_subscribe_ok` echo seen in practice shows `moreSpecific: true, lessSpecific: false`, which suggests those are the defaults. **[unconfirmed as defaults]** |
| `socketOptions.includeRaw` | Adds the Base64 raw BGP message. |
| `socketOptions.acknowledge` | The server replies `ris_subscribe_ok` per subscription. |

Other client messages are `ris_unsubscribe` and `ping`. **[unconfirmed]** for `ping`.

### `ris_message` UPDATE shape [extract, partly read via BGPalerter's parser]

```json
{ "type": "ris_message",
  "data": {
    "timestamp": 1700000000.12, "peer": "192.0.2.1", "peer_asn": "64500",
    "id": "…", "host": "rrc21", "type": "UPDATE",
    "path": [64500, 64510, 64496],
    "community": [[64500, 1]],
    "announcements": [ { "next_hop": "192.0.2.1", "prefixes": ["198.51.100.0/24"] } ],
    "withdrawals": ["203.0.113.0/24"]
  } }
```

- The common header fields `timestamp`, `peer`, `peer_asn`, `id`, `host` and `type` come from the manual. [extract]
- BGPalerter's parser reads `announcements[].next_hop`, `announcements[].prefixes`, `withdrawals`, `path`, `peer`, `peer_asn`, `timestamp`, `community` and `aggregator`. [read] ([connectorRIS.js](https://github.com/nttgin/BGPalerter/blob/main/src/connectors/connectorRIS.js))
- One message can carry several announcement groups, each with a different `next_hop`. [extract]
- **[unconfirmed]**: the JSON type of `peer_asn` (string or number); the presence and shape of `origin`, `med` and `raw`; how an AS_SET appears inside `path` (expected to be a nested array). Validate all of these at the boundary as `unknown` and handle them defensively.

---

## 6. VRP data formats and public endpoints

### Routinator `vrps` / HTTP `/json` [read]

Source: [output-formats.rst](https://github.com/NLnetLabs/routinator/blob/main/doc/manual/source/output-formats.rst).

```json
{
  "metadata": { "generated": 1685455841, "generatedTime": "2023-05-30T14:10:41Z" },
  "roas":       [ { "asn": "AS196615", "prefix": "93.175.147.0/24", "maxLength": 24, "ta": "ripe" } ],
  "routerKeys": [ { "asn": "AS211321", "SKI": "…", "routerPublicKey": "…", "ta": "ripe" } ],
  "aspas":      [ { "customer": "AS64496", "afi": "ipv6", "providers": ["AS64499"], "ta": "ripe" } ]
}
```

- `asn` is a string with an `AS` prefix.
- Other formats: `jsonext` (replaces `ta` with a `source` array: type, tal, uri, validity, stale), `csv` (`ASN,IP Prefix,Max Length,Trust Anchor`), `csvcompat`, `csvext`, `slurm` and `openbgpd`.
- The HTTP service serves each format by path, e.g. `http://host:8323/json`. [read] ([http-service.rst](https://github.com/NLnetLabs/routinator/blob/main/doc/manual/source/http-service.rst))

### rpki-client `-j` [read]

- The JSON goes to the file `json` in the output directory (default `/var/db/rpki-client/`). [read] ([rpki-client.8](https://github.com/rpki-client/rpki-client-openbsd/blob/master/src/usr.sbin/rpki-client/rpki-client.8))
- Top-level keys are `metadata`, `roas`, `aspas`, `bgpsec_keys` and `nonfunc_cas` (plus `signedprefixlists`). [read] ([output-json.c](https://github.com/rpki-client/rpki-client-openbsd/blob/master/src/usr.sbin/rpki-client/output-json.c))
- Each `roas` element is `{ "asn": <uint>, "prefix": "…", "maxLength": <int>, "ta": "…", "expires": <unix time> }`. `asn` is an integer, emitted with `json_do_uint`. [read]
- `metadata` holds counters such as `roas`, `vrps`, `uniquevrps`, `buildtime` and `elapsedtime`. [read]

**Normalisation rule:** parse `asn` as `number | "AS<n>"` and use `maxLength` as-is. Treat `ta` as an opaque label.

### Public VRP JSON endpoints (no validator needed)

These URLs come from **third-party client source code** that fetches them, namely the `rpki-validator` npm package's connectors. The endpoints themselves could not be opened from the sandbox. Confirm availability and terms before relying on them.

| Provider | URL | Shape | Evidence |
|---|---|---|---|
| rpki-client console | `https://console.rpki-client.org/vrps.json` | rpki-client `-j` format (`roas[].asn/prefix/maxLength/ta/expires`) | [RpkiClientConnector.js](https://github.com/massimocandela/rpki-validator/blob/master/src/connectors/RpkiClientConnector.js) [read]; BGPalerter's default `vrpProvider: rpkiclient` [read] |
| NTT | `https://rpki.gin.ntt.net/api/export.json` | `roas[]` with `prefix`, `maxLength`, `asn` (may be `"AS…"`), `ta`, `expires` | [NTTConnector.js](https://github.com/massimocandela/rpki-validator/blob/master/src/connectors/NTTConnector.js) [read] |
| RIPE NCC (RIPEstat) | `https://stat.ripe.net/data/rpki-roas/data.json` | `data.roas[]` with `prefix`, `maxLength`, `asn`, `ta` | [RIPEConnector.js](https://github.com/massimocandela/rpki-validator/blob/master/src/connectors/RIPEConnector.js) [read] |
| Cloudflare | `https://rpki.cloudflare.com/rpki.json` | `roas[]` with `prefix`, `maxLength`, `asn` (code strips `"AS"`), `ta` | [CloudflareConnector.js](https://github.com/massimocandela/rpki-validator/blob/master/src/connectors/CloudflareConnector.js) [read]. **[unconfirmed]** whether still maintained |

The same package enforces minimum refresh intervals: rpki-client 5 min, RIPE 10 min, NTT 15 min, Cloudflare 20 min. Those are the library author's politeness limits, **not published provider limits**. [read] ([README](https://github.com/massimocandela/rpki-validator/blob/master/README.md))

**[unconfirmed]** Historical VRP archives, needed to validate past incidents against the RPKI state at the time. A dated archive of rpki-client console outputs or RIPE NCC RPKI repository snapshots likely exists, but none was confirmed.

---

## 7. Historical replay

### RIPE RIS raw data [read]

Source: [20_raw_data_mrt.md](https://github.com/RIPE-NCC/ris-docs/blob/main/docs/20_raw_data_mrt.md).

- URL scheme: `https://data.ris.ripe.net/rrcXX/YYYY.MM/TYPE.YYYYMMDD.HHmm.gz`.
  - TYPE is `bview` (RIB dumps) or the updates file. The doc text says "update", but published filenames use `updates.`, e.g. `updates.20151010.1610.gz` [extract].
  - Dumps are written every 8 hours and updates every 5 minutes.
  - Format is MRT (RFC 6396) with TABLE_DUMP_V2 and BGP4MP, gzip-compressed.
- Parsers the doc lists: bgpdump (C), CAIDA BGPStream (CLI, C and Python), BGPKIT (Rust), microbgp and java-mrt.
- Collectors [read] ([10_routecollectors.md](https://github.com/RIPE-NCC/ris-docs/blob/main/docs/10_routecollectors.md)):
  - active: rrc00, 01, 03–07, 10–16, 18–26;
  - inactive: rrc02, 08, 09;
  - **multihop (global) collectors:** rrc00 (Amsterdam), rrc24 (Montevideo) and rrc25 (Amsterdam). These are the best single collectors for a global view.
- MRT basics [read] ([RFC 6396](https://www.rfc-editor.org/rfc/rfc6396.html)):
  - the common header is Timestamp (4 octets), Type (2), Subtype (2), Length (4);
  - TABLE_DUMP_V2 = 13, with subtypes PEER_INDEX_TABLE=1, RIB_IPV4_UNICAST=2, RIB_IPV6_UNICAST=4, …;
  - BGP4MP = 16, with subtypes BGP4MP_MESSAGE=1, BGP4MP_MESSAGE_AS4=4, …

### RouteViews

- The bgpkit-broker crawler builds `https://routeviews.org/bgpdata/YYYY.MM/{RIBS|UPDATES}/` (other collectors use `/<collector>/bgpdata/…`) and matches `.bz2` files. [read] ([routeviews.rs](https://github.com/bgpkit/bgpkit-broker/blob/main/src/crawler/routeviews.rs))
- The filenames `rib.YYYYMMDD.HHMM.bz2` / `updates.YYYYMMDD.HHMM.bz2` and the cadence (RIBs every 2 h, updates every 15 min) are **[unconfirmed]**. They come from a secondary source only; routeviews.org could not be opened.

### CAIDA BGPStream

- libBGPStream is "an open-source software framework for the analysis of both historical and real-time BGP measurement data". It is a C library under a BSD licence and depends on libcurl and wandio. [read] ([libbgpstream README](https://github.com/CAIDA/libbgpstream))
- PyBGPStream (`pip install pybgpstream`) wraps it and needs libBGPStream installed first. [read] ([pybgpstream README](https://github.com/CAIDA/pybgpstream))
- The broker and data-interface details live on bgpstream.caida.org, which was not reachable. **[unconfirmed]**

### Node.js MRT tooling

- **`@bgpkit/parser`** (npm, MIT): "BGP/BMP/MRT message parser compiled to WebAssembly". [read] ([npm](https://registry.npmjs.org/@bgpkit/parser))
  - Versions: 0.15.0 was first published 2026-03-22; the latest is 0.22.0 from 2026-09-10.
  - It runs in Node (CJS and ESM), browsers and Workers.
  - Exports include `parseMrtRecords`, `streamMrtFrom` ("fetch + decompress + stream-parse", gzip and bzip2), `parseBgpUpdate`, `parseRisLiveMessageJson` and `parseRisLiveMessageRaw`.
  - Caveat from its README: "MRT parsing requires the entire decompressed file in memory". That is fine for 5-minute `updates` files and risky for full `bview` RIBs. It is a young package, so pin the version.
- **No other npm MRT parser was found**: an npm search for "mrt bgp" returned nothing relevant. [read] ([npm search](https://registry.npmjs.org/-/v1/search?text=mrt%20bgp&size=20))
- **Bridge option:** `bgpdump -m` prints one pipe-delimited line per entry with Unix timestamps, e.g. `BGP4MP|<time>|A|<peer_ip>|<peer_as>|<prefix>|<as_path>|…` for announcements and `…|W|…` for withdrawals. [read] ([bgpdump.c usage](https://github.com/RIPE-NCC/bgpdump/blob/master/bgpdump.c)) The exact column set depends on version and flags (`-l`, `-u`, `-p`), so check it against the installed binary. A child process streaming `bgpdump -m` (or a pybgpstream script that writes NDJSON) into Node is the most robust option for large RIB files.

**Recommendation:**

- Evaluation replays mostly need `updates` files around incident windows. Use `@bgpkit/parser` for those, behind a small `MrtSource` interface.
- Keep a `bgpdump -m` adapter as a fallback and for RIB snapshots.

---

## 8. Ground-truth incidents

Only fields confirmed from the cited source are filled in. A "—" means not confirmed. The reliance on **[extract]** is high in this section, so re-read each linked write-up before publishing numbers.

| # | Incident | Date (UTC) | Prefix(es) | Offending AS | Victim | Type | Primary source |
|---|---|---|---|---|---|---|---|
| 1 | Pakistan Telecom / YouTube | 2008-02-24, 18:47–21:01 | 208.65.153.0/24 | AS17557 (propagated by AS3491 PCCW) | AS36561 (YouTube) | Sub-prefix origin hijack. YouTube countered with the /24 and then two /25s | RIPE NCC, [YouTube Hijacking: A RIPE NCC RIS case study](https://www.ripe.net/about-us/news/youtube-hijacking-a-ripe-ncc-ris-case-study/) [extract] |
| 2 | China Telecom IDC mass origination | 2010-04-08, 17:54–18:10 | ~37,000 prefixes (the AS normally originated ~40) | AS23724 (China Telecom data centre) | Many | Origin hijack (mass re-origination) | BGPmon, [Chinese ISP hijacks the Internet](https://www.bgpmon.net/chinese-isp-hijacked-10-of-the-internet/) [extract] |
| 3 | Amazon Route 53 / MyEtherWallet | 2018-04-24, ~11:05–13:03 | 205.251.192.0/24, .193.0/24, .195.0/24, .197.0/24, .199.0/24 (Amazon announced /23s) | AS10297 (eNet) | Amazon AS16509 (Route 53 DNS) | More-specific origin hijack used to poison DNS | Cloudflare, [BGP leaks and cryptocurrencies](https://blog.cloudflare.com/bgp-leaks-and-crypto-currencies/) [extract]; AS16509 and the /23s are from [Internet Society](https://www.internetsociety.org/blog/2018/04/amazons-route-53-bgp-hijack/) [extract] |
| 4 | Safe Host → China Telecom leak | 2019-06-06, from 09:43, >2 h | >70,000 routes, many of them more-specifics. Example path `4134 21217 … 13237 1136` | AS21217 (Safe Host) leaked to AS4134 (China Telecom), which propagated | Swisscom AS3303, KPN AS1136, Bouygues AS5410, SFR AS21502, … | Route leak | Oracle Internet Intelligence (D. Madory), republished: [APNIC blog](https://blog.apnic.net/2019/06/07/large-european-routing-leak-sends-traffic-through-china-telecom/) [extract]. Oracle's original URL is not confirmed |
| 5 | Verizon / DQE / Allegheny | 2019-06-24, from ~10:30, ~3 h | ~20,000 prefixes. Example: Cloudflare's 104.20.0.0/20 became 104.20.0.0/21 and 104.20.8.0/21 | AS396531 (Allegheny Technologies) leaked to AS701 (Verizon). More-specifics created by AS33154 (DQE)'s Noction optimizer | Cloudflare, Amazon, Facebook, others | Route leak (RFC 7908 type 1 hairpin) carrying optimizer more-specifics | Cloudflare, [How Verizon and a BGP Optimizer Knocked Large Parts of the Internet Offline Today](https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/) [extract] |
| 6 | Rostelecom | 2020-04-01, from ~19:28, ~1 h | >8,800 prefixes from >200 networks | AS12389 (Rostelecom), via AS20764 (Rascom) | Akamai, Amazon AWS, Cloudflare, Digital Ocean, Hetzner, Google, Facebook, … | Origin hijack, largely more-specifics. Cause not confirmed | MANRS, [Not just another BGP Hijack](https://manrs.org/2020/04/not-just-another-bgp-hijack/) [extract] |
| 7 | KLAYswap (Kakao SDK) | 2022-02-03, ~10:04–13:28 KST | 211.249.221.0/24, carved from Kakao's 211.249.216.0/21. S2W also mentions 121.53.104.0/23 | AS9457 (Dreamline) | Kakao (ASN not confirmed) | More-specific origin hijack used to serve malicious JS (~US$1.9 M stolen) | S2W, [Post Mortem of KlaySwap Incident through BGP Hijacking](https://medium.com/s2wblog/post-mortem-of-klayswap-incident-through-bgp-hijacking-en-3ed7e33de600) [extract]; [MANRS](https://manrs.org/2022/02/klayswap-another-bgp-hijack-targeting-crypto-wallets/) [extract] |
| 8 | Celer Bridge | 2022-08-17, from 19:39:50, ~3 h | 44.235.216.0/24 (normally covered by Amazon's 44.224.0.0/11 from AS16509) | AS209243 (QuickHostUK) as the new upstream | Amazon / Celer (cbridge-prod2.celer.network) | **Forged-origin sub-prefix hijack.** The path ended in Amazon's AS14618, so the route was RPKI-Valid. A fake AltDB IRR entry was created on 08-16 | Coinbase, [Celer Bridge incident analysis](https://www.coinbase.com/blog/celer-bridge-incident-analysis) [extract] |

Notes:

- Incidents 1–2 predate production RPKI. Evaluating them with ROV requires *synthetic* ROAs, e.g. a minimal ROA for the victim's legitimate announcements, and that assumption must be stated.
- Which Amazon ROA (and maxLength) made the Celer /24 Valid is **[unconfirmed]**. RFC 9319 §3 describes exactly this class.
- The NSDI'24 paper *A System to Detect Forged-Origin BGP Hijacks* (DFOH; Holterbach et al.) is the relevant academic baseline for detecting incident 8 without ASPA. It was found via search only, not read. ([PDF](https://www.usenix.org/system/files/nsdi24spring_prepub_holterbach.pdf)) [extract]

---

## 9. Implications for our design

### Data sources

| Mode | Routes | VRPs | Notes |
|---|---|---|---|
| **Live** | RIS Live WebSocket. One subscription per watched prefix (`prefix` + `moreSpecific: true`, `type: "UPDATE"`), plus one per watched origin AS (`path: "<asn>$"`). Send `?client=<project-id>`. | Public `vrps.json` (rpki-client console) refreshed every ~10–15 min. Alternatively, a local Routinator `/json` with `/json-delta` for cheap deltas. | Validate RIS Live and VRP JSON as `unknown` at the boundary. Reconnect on close. Treat the stream as lossy. BGPalerter adds a canary-prefix subscription to detect silent stalls ([connectorRIS.js](https://github.com/nttgin/BGPalerter/blob/main/src/connectors/connectorRIS.js)). |
| **Evaluation** | RIS `updates.*.gz` from multihop collectors (rrc00, rrc25; rrc24 for LACNIC) for each incident window, parsed with `@bgpkit/parser` or a `bgpdump -m` bridge. Optionally RouteViews. | VRPs *as of the incident date* (historical archive **unconfirmed**), or synthetic minimal ROAs for pre-RPKI incidents. | Put live and replay behind one `UpdateSource` interface (an async iterator of normalised announcements and withdrawals). The detectors then do not care which mode is running. |

### Which detectors work with which data

| Detector | ROV alone | Needs path data / ASPA | Incidents it catches |
|---|---|---|---|
| Origin hijack, Invalid by ASN (prefix covered, origin ≠ VRP ASN) | Yes | — | #1, #2, #3, #6, #7, if the victim had ROAs |
| More-specific hijack, Invalid by length (prefix length > maxLength) | Yes | — | Same as above, when ROAs are minimal |
| Loose-ROA exposure (VRP maxLength allows un-announced more-specifics, per RFC 9319) | Yes (VRPs + observed announcements) | — | Pre-warning for #8-class attacks |
| NotFound monitoring for watched prefixes (no ROA) | Yes | — | Flags that coverage is missing |
| AS_SET-terminated paths (origin NONE ⇒ Invalid if covered) | Yes | — | Edge case |
| **Forged-origin sub-prefix** (Valid origin, new upstream adjacent to the origin, new more-specific) | No: ROV says Valid | Path history: is the "origin's neighbour" new? Also MOAS / new-more-specific heuristics. ASPA helps if the victim published one | #8 |
| **Route leak** (valley in the path) | No: ROV says Valid | ASPA upstream/downstream verification, or inferred AS relationships | #4, #5 |
| Optimizer-generated more-specifics leaked | Partly: Invalid only if ROAs are minimal | Path data | #5 |

**Bottom line:** ROV alone covers the four demo cases in the existing prototype except the forged-origin case. There it can only *warn* that the ROA is loose; it cannot detect the attack. For the forged-origin case, add a path-based "new first-hop-to-origin and new more-specific" heuristic over the RIS Live `path`. Add ASPA verification on top when the VRP source includes `aspas`, expecting mostly "Unknown" outcomes today. Present route-leak detection as ASPA-dependent future work.

---

## Facts not confirmed from a primary source

- The full RIS Live manual: the firehose URL, defaults for `moreSpecific`/`lessSpecific`, the JSON type of `peer_asn`, the AS_SET representation in `path`, the `ping` message, and any rate limit. The RIS commercial-use terms were also not read.
- The step-by-step text of `draft-ietf-sidrops-aspa-verification-28` and the exact current revisions and IESG state of the ASPA and 8210bis drafts.
- Whether the public VRP endpoints (rpki-client console, NTT, RIPEstat, Cloudflare) are currently live, and what their usage terms are.
- A historical VRP archive for incident-time validation.
- RouteViews filename patterns and dump cadence; BGPStream broker details.
- From the incident table: Kakao's ASN; the exact Amazon ROA in the Celer incident; the original Oracle URL for the 2019 Safe Host leak; the root cause of the Rostelecom 2020 event.

## Sources

**IETF**

- RFC 6811, BGP Prefix Origin Validation: https://www.rfc-editor.org/rfc/rfc6811.html
- RFC 8481, Clarifications to BGP Origin Validation: https://www.rfc-editor.org/rfc/rfc8481.html
- RFC 9319, The Use of maxLength in the RPKI (BCP 185): https://www.rfc-editor.org/rfc/rfc9319.html
- RFC 8210, RPKI to Router Protocol v1: https://www.rfc-editor.org/rfc/rfc8210.html
- RFC 7908, Problem Definition and Classification of BGP Route Leaks: https://www.rfc-editor.org/rfc/rfc7908.html
- RFC 6396, MRT Routing Information Export Format: https://www.rfc-editor.org/rfc/rfc6396.html
- draft-ietf-sidrops-aspa-profile: https://datatracker.ietf.org/doc/draft-ietf-sidrops-aspa-profile/
- draft-ietf-sidrops-aspa-verification: https://datatracker.ietf.org/doc/draft-ietf-sidrops-aspa-verification/
- draft-ietf-sidrops-8210bis: https://datatracker.ietf.org/doc/draft-ietf-sidrops-8210bis/
- Verbatim RFC text copy used for reading: https://github.com/tex2e/rfc-translater (`html/rfc<N>.html`)

**RIPE NCC**

- RIS docs repository: https://github.com/RIPE-NCC/ris-docs
  - route collectors: `docs/10_routecollectors.md`
  - raw data (MRT): `docs/20_raw_data_mrt.md`
  - RIS Live: `docs/25_ris_live.md`
- RIS Live manual: https://ris-live.ripe.net/manual/
- RIS commercial use terms: https://www.ripe.net/analyse/internet-measurements/routing-information-service-ris/commercial-use/
- bgpdump: https://github.com/RIPE-NCC/bgpdump (`bgpdump.c`)
- YouTube hijacking case study: https://www.ripe.net/about-us/news/youtube-hijacking-a-ripe-ncc-ris-case-study/

**Tools**

- Routinator manual sources: https://github.com/NLnetLabs/routinator/tree/main/doc/manual/source (`output-formats.rst`, `http-service.rst`, `api-endpoints.rst`, `rtr-service.rst`, `advanced-features.rst`)
- rpki-client: https://github.com/rpki-client/rpki-client-openbsd/tree/master/src/usr.sbin/rpki-client (`output-json.c`, `rpki-client.8`)
- OpenBGPD ASPA: https://github.com/openbsd/src/blob/master/usr.sbin/bgpd/rde_aspa.c
- CAIDA libBGPStream: https://github.com/CAIDA/libbgpstream
- PyBGPStream: https://github.com/CAIDA/pybgpstream
- BGPKIT parser: https://github.com/bgpkit/bgpkit-parser
  - npm package `@bgpkit/parser`: https://registry.npmjs.org/@bgpkit/parser
- BGPKIT broker crawlers: https://github.com/bgpkit/bgpkit-broker
- BGPKIT ris-live-rs: https://github.com/bgpkit/ris-live-rs
- BGPalerter (NTT): https://github.com/nttgin/BGPalerter
- rpki-validator (VRP endpoint connectors): https://github.com/massimocandela/rpki-validator

**Incidents and papers**

- Cloudflare, BGP leaks and cryptocurrencies (2018): https://blog.cloudflare.com/bgp-leaks-and-crypto-currencies/
- Internet Society, Amazon Route 53 BGP hijack (2018): https://www.internetsociety.org/blog/2018/04/amazons-route-53-bgp-hijack/
- Cloudflare, Verizon and a BGP optimizer (2019): https://blog.cloudflare.com/how-verizon-and-a-bgp-optimizer-knocked-large-parts-of-the-internet-offline-today/
- Large European routing leak through China Telecom (2019), APNIC republication: https://blog.apnic.net/2019/06/07/large-european-routing-leak-sends-traffic-through-china-telecom/
- BGPmon, Chinese ISP hijacks the Internet (2010): https://www.bgpmon.net/chinese-isp-hijacked-10-of-the-internet/
- MANRS, Not just another BGP Hijack (Rostelecom, 2020): https://manrs.org/2020/04/not-just-another-bgp-hijack/
- S2W, KlaySwap post-mortem (2022): https://medium.com/s2wblog/post-mortem-of-klayswap-incident-through-bgp-hijacking-en-3ed7e33de600
- MANRS, KlaySwap (2022): https://manrs.org/2022/02/klayswap-another-bgp-hijack-targeting-crypto-wallets/
- Coinbase, Celer Bridge incident analysis (2022): https://www.coinbase.com/blog/celer-bridge-incident-analysis
- Holterbach et al., A System to Detect Forged-Origin BGP Hijacks (NSDI '24): https://www.usenix.org/system/files/nsdi24spring_prepub_holterbach.pdf
