# BGP Hijack Monitor

เฝ้าดู BGP announcement ของ **monitored prefix** ของคุณ และแจ้ง **alert** เมื่อมีการประกาศ prefix นั้นในแบบที่ **declared origin** ของคุณไม่รองรับ คำศัพท์ต่าง ๆ อธิบายไว้ใน [GLOSSARY.md](GLOSSARY.md) ส่วนเหตุผลที่ใช้ declared origin เป็นตัวตัดสิน alert อยู่ใน [ADR 0001](docs/adr/0001-declared-origin-primary-rpki-as-context.md)

## วิธีรัน

ต้องใช้ Node.js 22.18 ขึ้นไป (รัน TypeScript source โดยตรง)

```sh
npm install
npm start
```

service จะเชื่อมต่อกับ RIPE RIS Live และ subscribe announcement ของ monitored prefix ทุกตัวรวมถึง more-specific ของมัน หน้าเว็บแสดงสถานะของ live feed (connecting, connected หรือ reconnecting เมื่อติดต่อ RIS Live ไม่ได้) และจำนวน announcement ที่สังเกตได้ alert ที่มาจาก feed จะมีป้าย LIVE prefix ใน configuration ตัวอย่างเป็น documentation prefix ซึ่งไม่มีวันปรากฏบนอินเทอร์เน็ตจริง ถ้าอยากเห็นตัวนับขยับ ให้ใช้ prefix ที่มีการประกาศจริง

จากนั้นเปิด <http://localhost:8080/> แล้วกด **Simulate: Origin mismatch** จะมี alert แบบ SIMULATED ชนิด Origin mismatch ขึ้นมาโดยไม่ต้อง reload กดอีกครั้งแล้วจำนวน peer จะเพิ่มขึ้น

- **Simulate: more-specific** ประกาศ monitored prefix ตัวแรกที่ยาวขึ้นหนึ่ง bit จาก foreign AS
- **Simulate: forged origin + more-specific** ประกาศ prefix ที่ยาวขึ้นตัวเดียวกัน ด้วย path `[foreign AS, declared origin]` (รูปแบบเดียวกับเหตุการณ์ Celer Bridge)

ทั้งสองปุ่มทำให้เกิด alert ชนิด Unexpected more-specific

## การตั้งค่า

ระบุ monitored prefix และ declared origin ของแต่ละตัวใน `monitor.config.json` (IPv4 หรือ IPv6, host bit ต้องเป็นศูนย์, AS number ตั้งแต่ 1 ถึง 4294967295)

```json
{
  "monitoredPrefixes": [
    { "prefix": "203.0.113.0/24", "declaredOrigin": 64500 },
    { "prefix": "2001:db8::/32", "declaredOrigin": 64500 }
  ]
}
```

ปุ่ม simulation ใช้ monitored prefix ตัวแรก ถ้าไฟล์หายไปหรือรูปแบบผิด service จะไม่ยอมเริ่มทำงาน และจะบอกชื่อไฟล์กับปัญหาที่เจอ

`monitor.config.json` ที่ commit ไว้เป็นตัวอย่างที่ `npm run demo` ใช้ ให้ใส่ prefix จริงของคุณใน `live.config.json` แทน (ไฟล์นี้อยู่ใน `.gitignore`) แล้วชี้ service ไปที่ไฟล์นั้น

```sh
MONITOR_CONFIG_FILE=live.config.json npm start
```

## RPKI

ตอนเริ่มทำงาน service จะดึง VRP หนึ่งครั้งจาก `VRP_URL` (JSON ของ rpki-client, Routinator หรือ RIPEstat) แล้วบันทึก response ดิบไว้ที่ `VRP_CACHE_FILE`

- ถ้าดึงไม่สำเร็จ จะใช้ cache นั้นแทน
- ถ้าไม่มี cache ที่ใช้ได้ด้วย จะไม่ยอมเริ่มทำงาน
- VRP ไม่ถูก refresh ระหว่างที่ service ทำงานอยู่

ก่อนเดโมในที่ที่เครือข่ายไม่เสถียร ให้รันหนึ่งครั้งตอนเน็ตใช้ได้ เพื่อให้มี cache อยู่แล้ว

alert ทุกรายการแสดง validation state ตาม RFC 6811 (Valid, Invalid หรือ NotFound) เป็นข้อมูลประกอบเท่านั้น ค่านี้ไม่เคยเป็นตัวตัดสินว่าจะเกิด alert หรือไม่ ส่วน **Advisories** แสดง **Loose ROA** ทุกตัว ซึ่งหมายถึง ROA ที่ครอบคลุม monitored prefix และมี maxLength ยาวกว่าตัว prefix

Environment variable (ไม่บังคับทั้งหมด):

| Variable | ค่าเริ่มต้น | ความหมาย |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port ของหน้าเว็บ |
| `MONITOR_CONFIG_FILE` | `monitor.config.json` | path ของไฟล์ configuration |
| `VRP_URL` | `https://console.rpki-client.org/vrps.json` | VRP JSON endpoint ที่ดึงตอนเริ่มทำงาน |
| `VRP_CACHE_FILE` | `vrps.cache.json` | VRP JSON ล่าสุดที่ดึงมา ใช้เมื่อติดต่อ endpoint ไม่ได้ |
| `RIS_LIVE_URL` | `wss://ris-live.ripe.net/v1/ws/` | RIPE RIS Live WebSocket URL (`ws://` หรือ `wss://`) |
| `RIS_LIVE_CLIENT` | `bgp-hijack-monitor` | `client` identifier ที่ส่งให้ RIS Live ควรตั้งเป็นชื่อ deployment ของคุณ |

ตัวอย่าง: `PORT=3000 MONITOR_CONFIG_FILE=/etc/bgp/prefixes.json npm start`

## Offline demo

```sh
npm run demo
```

รัน service โดยไม่ต้องใช้ VRP endpoint

- `VRP_URL` ชี้ไปที่ local URL ที่ล้มเหลวเสมอ
- `VRP_CACHE_FILE` ชี้ไปที่สำเนาชั่วคราวของ `demo/vrps.demo.json` ไฟล์ที่ commit ไว้จึงไม่ถูกเขียนทับ

ไฟล์นี้คือ rpki-client fixture `src/parsers/fixtures/vrps/vrps-rpki-client-2023.json` ที่เพิ่ม ROA ของ `203.0.113.0/24` (maxLength 25, AS64500) อีกหนึ่งตัว เมื่อใช้กับ `monitor.config.json` ตัวอย่าง หน้าเว็บจะแสดง Loose ROA advisory และปุ่ม **Simulate: forged origin + more-specific** จะได้ alert ที่มี validation state เป็น Valid

ปุ่ม simulation ใช้ได้แบบออฟไลน์ ส่วน RIS Live feed ยังต้องใช้เครือข่าย ถ้าไม่มีเน็ต สถานะ feed จะขึ้น reconnecting ตัวแปรอื่นที่ตั้งไว้ใน shell (`PORT`, `RIS_LIVE_URL`, ...) ยังมีผลเหมือนเดิม

ถ้าจะรันเดโมคู่กับ service ที่ใช้ prefix จริง ให้เดโมใช้ port ของตัวเอง

```sh
# terminal 1: prefix จริง, http://localhost:8080/
MONITOR_CONFIG_FILE=live.config.json npm start

# terminal 2: เดโมกับ monitor.config.json ตัวอย่าง, http://localhost:8081/
PORT=8081 npm run demo
```

ตั้ง `MONITOR_CONFIG_FILE` ไว้ในบรรทัด `npm start` เท่านั้น อย่าใช้ `export` เพราะเดโมรับ environment ของ shell ไปด้วย ถ้า export ไว้ เดโมจะอ่าน prefix จริงของคุณ และ Loose ROA advisory กับผล Valid จะไม่ขึ้น

## แผนทดสอบจริงและเช็กลิสต์ก่อนวันนำเสนอ

ทำตามลำดับ ช่วงที่ 1 ถึง 3 ทำล่วงหน้า ช่วงที่ 4 ทำเช้าวันงาน

### ช่วงที่ 1: เตรียมเครื่อง (ล่วงหน้าหลายวัน)

ใช้โน้ตบุ๊กเครื่องที่จะใช้นำเสนอจริง

```sh
node --version          # ต้องเป็น 22.18 ขึ้นไป
git clone https://github.com/Lnwpoom/cloud_Developer.git
cd cloud_Developer
npm ci                  # ทำตอนมีเน็ต ที่งานอาจติดตั้งไม่ได้
npm run typecheck && npm run lint && npm test
```

**ผ่านเมื่อ:** ทั้งสามคำสั่งผ่าน และ test รายงาน `# fail 0`

### ช่วงที่ 2: ทดสอบกับเครือข่ายจริง ([#10](https://github.com/Lnwpoom/cloud_Developer/issues/10))

**1. สร้าง `live.config.json`** (ดู [การตั้งค่า](#การตั้งค่า)) ใส่ prefix ที่มีการประกาศจริงพร้อม origin AS ที่ถูกต้อง

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

**ข้อควรรู้:** เมื่อใช้ prefix จริงกับ VRP จริง ปุ่ม forged origin + more-specific จะได้ **Valid** ก็ต่อเมื่อ ROA จริงของ prefix นั้นเป็น Loose ROA เท่านั้น ถ้าไม่ใช่จะได้ **Invalid** และประเด็นสำคัญของเรื่องจะไม่ปรากฏ จึงแนะนำให้เปิดสองหน้าต่างตามคำสั่งใน [Offline demo](#offline-demo): หน้าต่าง 1 คือ live feed ของ prefix จริงที่ port 8080 หน้าต่าง 2 คือข้อมูลเดโมที่มี Loose ROA ที่ port 8081

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

```sh
npm run typecheck
npm run lint
npm test
```

มาตรฐานการเขียนโค้ดอยู่ใน [CODING_STANDARDS.md](CODING_STANDARDS.md)

โครงสร้าง:

- `src/monitor.ts`: Monitor ซึ่งเป็นแกนการตรวจจับ (ไม่มี I/O)
- `src/domain.ts`: domain type ที่ใช้ร่วมกันหลาย module (monitored prefix, AS path, observation, origin) และ `formatAsn`
- `src/prefix.ts`: การ parse prefix IPv4/IPv6 และการตรวจว่า prefix หนึ่งอยู่ในอีกตัวหรือไม่
- `src/rpki.ts`: validation state ตาม RFC 6811 และ Loose ROA advisory ที่ Monitor ใช้
- `src/parsers/`: boundary parser จาก input แบบ `unknown` (ไฟล์ configuration, VRP JSON, RIS Live frame) helper ที่ใช้ร่วมกันและ `ParseResult` อยู่ใน `parse.ts` fixture จริงพร้อมแหล่งที่มาอยู่ใน `src/parsers/fixtures/vrps/` และ `src/parsers/fixtures/ris-live/`
- `src/vrp-source.ts`: ดึง VRP ตอนเริ่มทำงาน พร้อม cache fallback
- `src/ris-live-feed.ts`: RIS Live WebSocket client (subscribe, นับ, ping, reconnect พร้อม backoff)
- `src/monitor-config-file.ts`: อ่านและ parse ไฟล์ configuration
- `src/config.ts`: ที่เดียวที่อ่าน `process.env`
- `src/listeners.ts`: listener set ที่อยู่เบื้องหลัง `onChange` ทุกตัว
- `src/simulation.ts`: simulation preset ใช้ synthetic peer ใหม่หนึ่งตัวต่อการกดหนึ่งครั้ง
- `scripts/demo.ts`: `npm run demo` โดยใช้ `demo/vrps.demo.json` เป็นข้อมูล VRP
- `src/server.ts`: หน้าเว็บ, server-sent events ที่ `/events` (`snapshot`, `alert`, `feed-status`, `observations`) และ `POST /simulate/:preset`
- `public/index.html`: หน้าเว็บ
