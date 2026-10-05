# BGP Hijack Monitor

Watches BGP announcements of your **monitored prefixes** and raises an **alert** when one is announced in a way your **declared origin** does not support. Terms are defined in [GLOSSARY.md](GLOSSARY.md); why the declared origin drives alerts is in [ADR 0001](docs/adr/0001-declared-origin-primary-rpki-as-context.md).

## Run it

Needs Node.js 22.18 or later (it runs the TypeScript sources directly).

```sh
npm install
npm start
```

The service connects to RIPE RIS Live and subscribes to announcements of every monitored prefix and its more-specifics. The page shows the live feed status (connecting, connected, or reconnecting whenever RIS Live cannot be reached) and how many announcements it has observed; alerts from the feed are marked LIVE. The documentation prefixes in the sample configuration never appear on the real Internet, so use a prefix that is actually announced to see the counter move.

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

The committed `monitor.config.json` is the example that `npm run demo` relies on. Put your real prefixes in `live.config.json` instead (it is git-ignored) and point the service at it:

```sh
MONITOR_CONFIG_FILE=live.config.json npm start
```

The committed `monitor.config.json` is the example that `npm run demo` relies on. Put your real prefixes in `live.config.json` instead (it is git-ignored) and point the service at it:

```sh
MONITOR_CONFIG_FILE=live.config.json npm start
```

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

## Offline demo

```sh
npm run demo
```

Starts the service without the VRP endpoint: `VRP_URL` points at a local URL that always fails, and `VRP_CACHE_FILE` points at a temp copy of `demo/vrps.demo.json`, so the committed file is never overwritten. That file is the rpki-client fixture `src/parsers/fixtures/vrps/vrps-rpki-client-2023.json` plus one ROA for `203.0.113.0/24`, maxLength 25, AS64500. With the example `monitor.config.json` the page shows a Loose ROA advisory, and **Simulate: forged origin + more-specific** raises an alert whose validation state is Valid.

The simulation buttons work offline. The live RIS Live feed still needs the network; without it the feed status shows reconnecting. Other variables (`PORT`, `RIS_LIVE_URL`, ...) set in your shell still apply.

<<<<<<< HEAD
To run the demo next to the live service, give the demo its own port:
=======
<<<<<<< HEAD
ไฟล์นี้คือ rpki-client fixture `src/parsers/fixtures/vrps/vrps-rpki-client-2023.json` ที่เพิ่ม ROA ของ `203.0.113.0/24` (maxLength 25, AS64500) อีกหนึ่งตัว เมื่อใช้กับ `monitor.config.json` ตัวอย่าง หน้าเว็บจะแสดง Loose ROA advisory และปุ่ม **Simulate: forged origin + more-specific** จะได้ alert ที่มี validation state เป็น Valid

ปุ่ม simulation ใช้ได้แบบออฟไลน์ ส่วน RIS Live feed ยังต้องใช้เครือข่าย ถ้าไม่มีเน็ต สถานะ feed จะขึ้น reconnecting ตัวแปรอื่นที่ตั้งไว้ใน shell (`PORT`, `RIS_LIVE_URL`, ...) ยังมีผลเหมือนเดิม

## แผนทดสอบจริงและเช็กลิสต์ก่อนวันนำเสนอ

ทำตามลำดับ ช่วงที่ 1 ถึง 3 ทำล่วงหน้า ช่วงที่ 4 ทำเช้าวันงาน

### ช่วงที่ 1: เตรียมเครื่อง (ล่วงหน้าหลายวัน)

ใช้โน้ตบุ๊กเครื่องที่จะใช้นำเสนอจริง
>>>>>>> 9df6660 (แยกสำหรับ prefix live กับ demo)

```sh
# terminal 1: real prefixes, http://localhost:8080/
MONITOR_CONFIG_FILE=live.config.json npm start

# terminal 2: demo with the example monitor.config.json, http://localhost:8081/
PORT=8081 npm run demo
```

Set `MONITOR_CONFIG_FILE` on the `npm start` line only, not with `export`: the demo inherits your shell's environment, so an exported value would make it read your real prefixes and the Loose ROA advisory and Valid state would not appear.

<<<<<<< HEAD
## Develop
=======
### ช่วงที่ 2: ทดสอบกับเครือข่ายจริง ([#10](https://github.com/Lnwpoom/cloud_Developer/issues/10))

**1. ทำไฟล์ config แยกสำหรับ prefix จริง** เช่น `live.config.json` และเก็บ `monitor.config.json` ไว้เป็นตัวอย่างเดิม เพราะ `npm run demo` ใช้ไฟล์นั้น ใส่ prefix ที่มีการประกาศจริงพร้อม origin AS ที่ถูกต้อง

```json
{
  "monitoredPrefixes": [
    { "prefix": "193.0.0.0/21", "declaredOrigin": 3333 },
    { "prefix": "1.1.1.0/24", "declaredOrigin": 13335 }
  ]
}
```

prefix ในตัวอย่างยังไม่ได้ตรวจสอบ ให้ยืนยัน origin AS ที่ bgp.tools หรือ RIPEstat ก่อนใช้

**2. รัน `MONITOR_CONFIG_FILE=live.config.json npm start` แล้วตรวจ**

| ตรวจอะไร | ผลที่ต้องเห็น |
| --- | --- |
| log ตอนเริ่ม | `Loaded <n> VRPs from https://console.rpki-client.org/vrps.json` |
| ไฟล์ cache | มี `vrps.cache.json` เกิดขึ้นในโฟลเดอร์โปรเจกต์ |
| สถานะ feed บนหน้าเว็บ <http://localhost:8080/> | **connected** |
| ตัวนับ observation | ค่อย ๆ เพิ่มขึ้น |
| LIVE alert | ไม่มี Origin mismatch สำหรับ prefix ที่ประกาศโดย origin AS ที่ถูกต้อง |

- **ตัวนับ:** prefix ที่เสถียรมีการประกาศใหม่ไม่บ่อย ตัวนับจึงอาจขยับช้า ให้รอหลายนาที และใส่หลาย prefix
- **ถ้ามี Unexpected more-specific:** ระบบตั้งใจ alert กับ more-specific ทุกตัวไม่ว่า origin จะเป็นใคร ถ้าเจ้าของ prefix ประกาศ more-specific เองจริงก็ถือว่าทำงานถูก แต่ต้องอธิบายผู้ชมได้ หรือเลือก prefix อื่น

**3. ทดสอบตอนเน็ตหลุด** ปิด Wi-Fi แล้วรันคำสั่งเดิมอีกครั้ง

- log บอกว่า VRP endpoint ใช้ไม่ได้ และโหลด VRP จาก cache แทน
- สถานะ feed ขึ้น **reconnecting**
- ปุ่ม simulation ทั้งสามยังสร้าง alert ได้

**4. บันทึกผล** เป็น comment ใน #10 แล้วปิด issue ถ้ามีข้อไหนไม่ผ่าน ให้เปิด issue ใหม่แยกพร้อมแนบ log

### ช่วงที่ 3: ซ้อมนำเสนอ (อย่างน้อยหนึ่งครั้งบนเครื่องจริง)

**ข้อควรรู้:** เมื่อใช้ prefix จริงกับ VRP จริง ปุ่ม forged origin + more-specific จะได้ **Valid** ก็ต่อเมื่อ ROA จริงของ prefix นั้นเป็น Loose ROA เท่านั้น ถ้าไม่ใช่จะได้ **Invalid** และประเด็นสำคัญของเรื่องจะไม่ปรากฏ จึงแนะนำให้เปิดสองหน้าต่าง

```sh
MONITOR_CONFIG_FILE=live.config.json npm start   # หน้าต่าง 1: port 8080, live feed ของ prefix จริง
PORT=8081 npm run demo                           # หน้าต่าง 2: port 8081, ข้อมูลเดโมที่มี Loose ROA
```

ลำดับเล่าเรื่องที่แนะนำ (หน้าต่าง 2):

1. ชี้ Loose ROA advisory บนหน้าเว็บ
2. กด **Origin mismatch** ได้ alert สถานะ Invalid กดซ้ำแล้วจำนวน peer เพิ่มเป็น 2
3. กด **more-specific** ได้ alert สถานะ Invalid
4. กด **forged origin + more-specific** ได้ **Valid** แต่ระบบยัง alert อยู่ นี่คือประเด็นหลัก: RPKI อย่างเดียวจับการโจมตีแบบ Celer Bridge ไม่ได้ แต่ declared origin จับได้
5. สลับไปหน้าต่าง 1 เพื่อโชว์ live feed ที่ connected และตัวนับที่ขยับ

แผนสำรอง (จับเวลาระหว่างซ้อมด้วย):

- **แผน A:** สองหน้าต่างตามข้างบน
- **แผน B (เน็ตที่งานล่ม):** ใช้หน้าต่าง 2 อย่างเดียว `npm run demo` ไม่ต้องใช้เน็ต
- **แผน C (เครื่องมีปัญหา):** อัดวิดีโอการซ้อมแผน A เก็บไว้ในเครื่อง

### ช่วงที่ 4: เช้าวันงาน

- [ ] ตั้งค่าไม่ให้เครื่องหลับหรือปิดจอ และเสียบสายชาร์จ
- [ ] `git pull` และ `npm ci` ถ้ามีเน็ตและมีการแก้โค้ดหลังวันซ้อม
- [ ] รัน `npm start` หนึ่งครั้งตอนมีเน็ต ให้ `vrps.cache.json` เป็นข้อมูลล่าสุด
- [ ] เช็กว่า port 8080 และ 8081 ว่าง ถ้าไม่ว่างให้ตั้ง `PORT=...`
- [ ] เปิดเบราว์เซอร์สองแท็บ และขยายตัวอักษรให้ผู้ชมอ่านได้
- [ ] รีสตาร์ตทั้งสองหน้าต่างก่อนขึ้นเวที เพื่อล้าง alert จากการทดสอบ (alert เก็บในหน่วยความจำเท่านั้น)
- [ ] มีไฟล์วิดีโอสำรองอยู่ในเครื่อง

### เกณฑ์ว่าพร้อมนำเสนอ

- [ ] typecheck, lint และ test ผ่านบนเครื่องที่จะใช้จริง
- [ ] CI บน `main` เขียว
- [ ] ผ่านทุกข้อใน [#10](https://github.com/Lnwpoom/cloud_Developer/issues/10)
- [ ] ซ้อมครบทั้งเรื่องอย่างน้อยหนึ่งรอบ และแผน B ใช้ได้ตอนปิด Wi-Fi
- [ ] มีวิดีโอสำรอง

[#11](https://github.com/Lnwpoom/cloud_Developer/issues/11) (RIPEstat VRP parser) ไม่จำเป็นต่อการนำเสนอ เพราะค่าเริ่มต้นใช้ endpoint ของ rpki-client

## การพัฒนา
=======
To run the demo next to the live service, give the demo its own port:

```sh
# terminal 1: real prefixes, http://localhost:8080/
MONITOR_CONFIG_FILE=live.config.json npm start

# terminal 2: demo with the example monitor.config.json, http://localhost:8081/
PORT=8081 npm run demo
```

Set `MONITOR_CONFIG_FILE` on the `npm start` line only, not with `export`: the demo inherits your shell's environment, so an exported value would make it read your real prefixes and the Loose ROA advisory and Valid state would not appear.

## Develop
>>>>>>> bd56326 (แยกสำหรับ prefix live กับ demo)
>>>>>>> 9df6660 (แยกสำหรับ prefix live กับ demo)

```sh
npm run typecheck
npm run lint
npm test
```

Layout:

- `src/monitor.ts`: the Monitor, the detection core (no I/O).
- `src/domain.ts`: domain types shared across modules (monitored prefix, AS path, observation, origin) and `formatAsn`.
- `src/prefix.ts`: IPv4/IPv6 prefix parsing and containment.
- `src/rpki.ts`: RFC 6811 validation state and Loose ROA advisories, used by the Monitor.
- `src/parsers/`: boundary parsers from `unknown` input (configuration file, VRP JSON, RIS Live frames), with shared helpers and `ParseResult` in `parse.ts`. Real fixtures and their sources are in `src/parsers/fixtures/vrps/` and `src/parsers/fixtures/ris-live/`.
- `src/vrp-source.ts`: fetches the VRPs at startup, with the cache fallback.
- `src/ris-live-feed.ts`: the RIS Live WebSocket client (subscribe, count, ping, reconnect with backoff).
- `src/monitor-config-file.ts`: reads and parses the configuration file.
- `src/config.ts`: the only reader of `process.env`.
- `src/listeners.ts`: the listener set behind every `onChange`.
- `src/simulation.ts`: simulation presets, one synthetic peer per press.
- `scripts/demo.ts`: `npm run demo`; `demo/vrps.demo.json` is its VRP data.
- `src/server.ts`: the page, server-sent events at `/events` (`snapshot`, `alert`, `feed-status`, `observations`) and `POST /simulate/:preset`.
- `public/index.html`: the web page.
