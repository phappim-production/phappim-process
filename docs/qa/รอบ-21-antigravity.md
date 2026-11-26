# รายงานสร้างระบบทดสอบถาวรและผลทดสอบทั้งระบบ (G17 — รอบ 21)

> **วันที่ทดสอบ:** 26 พ.ย. 2569 · **ผู้ทำ:** Antigravity (`antigravity/g17-test-system` บน `../pp142-g17` ฐาน `59284bd` = main หลัง PR 245 + ใบสั่งงานรอบ 21)
> **สภาพแวดล้อม:** หลังบ้านจำลองในเครื่องเท่านั้น (`http://127.0.0.1:5244` / `http://127.0.0.1:5245`) · **ไม่ได้เปิด เรียก หรือล็อกอินระบบจริง** (`pp142.pages.dev` · `*.supabase.co` · `*.workers.dev` · `.pp142-r2`)
> **สถานะบั๊กระดับ 1 บน `main`:** **ไม่พบบั๊กระดับ 1**

---

## 0. ผลตรวจว่าไม่ได้แตะระบบจริง
- **ตัวป้องกันใน `tools/qa-suite/lib/safety.mjs`:**
  - `assertSafeDist()` ตรวจไฟล์ใน `app/dist/` (`26 ไฟล์`) ก่อนเริ่มทุกครั้ง: ต้องมี `127.0.0.1:5244` และ `127.0.0.1:5245` และไม่มี URL ระบบจริง (`workers.dev` / `https://*.supabase.co`)
  - `assertNoExternalAttempts()` ตรวจ CDP network log หลังจบทุกส่วน: **`externalAttempts = 0`** ในทุกรอบที่รัน (`--full` 3 seeds, `--quick` 3 รอบ, `invariants-selftest`, `Part G`)
- **ความสะอาดของ repo:** ผลรันทั้งหมด (`report.md`, `report.json`, `actions.jsonl`, ภาพหน้าจอชั่วคราว) เขียนออกไปที่ `$env:TEMP\qa-suite\` นอก repo เสมอ · ไม่มีการแก้ไฟล์ใน `app/`, `production-confirmation.html`, `supabase/`, `workers/`, `tools/qa-r14/`, หรือ `package.json`

---

## 1. ระบบทดสอบถาวรที่สร้าง (`tools/qa-suite/`)

| ส่วน | ไฟล์ | สิ่งที่ทำได้ |
|---|---|---|
| **A. แกนหลัก & CLI** | [run.mjs](../../tools/qa-suite/run.mjs), [README.md](../../tools/qa-suite/README.md), [rng.mjs](../../tools/qa-suite/lib/rng.mjs), [report.mjs](../../tools/qa-suite/lib/report.mjs) | คำสั่งเดียว `--quick` / `--full` / `--only <ส่วน>` / `--seed <n>` / `--days <n>` / `--out <dir>` / `--compare <prev>` · บันทึก `actions.jsonl` · ย่อขั้นตอนล้ม (`shrinkTrace`) · สร้าง `report.md` + `report.json` · exit code ≠ 0 เมื่อล้ม |
| **B. ข้อตรวจข้อมูล 10 ข้อ** | [invariants.mjs](../../tools/qa-suite/checks/invariants.mjs) | รันหลังทุกการกระทำในส่วน C: `B1` events ไม่ถูกแก้/ลบ · `B2` phase/station สอดคล้อง · `B3` queue_seq ไม่ซ้ำ · `B4` จำนวนงานถูกต้อง · `B5` `job_sla_flags` ตรงเว็บ · `B6` ไม่เกินจำนวนเครื่อง/จักรไม่ซ้อน · `B7` `confirmation_rev` · `B8` วัตถุดิบไม่ซ้ำ/ไม่ใช้รูปม็อคอัพ · `B9` ไฟล์ใน R2 + ห้าม base64 ใน DB · `B10` inbox ไม่ส่งซ้ำ |
| **C. จำลองโรงงาน** | [sim.mjs](../../tools/qa-suite/parts/sim.mjs) | เปิดขั้นรอผลิต (`materials_check = true`) · เดินวันทำงาน จ.–ส. · สร้างงานทุกเส้นทาง + ตัวอย่าง/Develop + ใบงานบริการ 4 แบบ (`svc_sew`, `svc_print`, `svc_press`, `svc_dtf`) + ส่งออกจากรอผลิต (PR 237) + วัตถุดิบพร้อม ETA (PR 238) + 2 คนกดปล่อยพร้อมกัน + กดผิดบทบาท |
| **D. ตัวไล่หน้าจอ** | [ui.mjs](../../tools/qa-suite/parts/ui.mjs) | ไล่ทุกบทบาท × ทุกหน้า × `375/768/1440 px` · ตรวจล้นด้านข้าง, ข้อความผิดพลาด (`NaN`/`undefined`/`Invalid Date`/`Failed to fetch`), ปุ่มหลัก ≥ 48 px, จอขาว, หน้าห้ามเปิดตรง, สถานะออฟไลน์ |
| **E. สิทธิ์อัตโนมัติ** | [security.mjs](../../tools/qa-suite/parts/security.mjs), [rpc-policy.mjs](../../tools/qa-suite/checks/rpc-policy.mjs) | ดึงรายชื่อ RPC ทั้งหมดจาก `pg_proc` (`74` ฟังก์ชัน) เทียบตารางคำตอบ (`913` probes × 11 บทบาท รวม `anon`, `disabled`, `staff_empty`) · ทดสอบเขียน/ลบตรงทุกตารางผ่าน REST · ทดสอบ XSS |
| **F. ฟอร์มใบยืนยัน** | [confirmation.mjs](../../tools/qa-suite/parts/confirmation.mjs) | ทดสอบ PR 244 (ปกสำเร็จต้องระบุสีปก) · PR 245 (ผ้าเพิ่มต้องกรอกจำนวน + หน่วย) · PR 241 (เลขที่ใบซ้ำกับงานที่รับแล้ว) · PR 226 (กันวันที่ `infinity`) · เปิดใบงานบริการ 4 แบบ |

---

## 2. ส่วน G — พิสูจน์ว่าระบบทดสอบจับบั๊กได้จริง

### 2.1 Self-test ข้อตรวจส่วน B (`invariants-selftest`)
- รัน `node tools/qa-suite/run.mjs --only invariants-selftest --skip-build` → **PASS 10/10 ข้อ** (ทุกข้อ `B1`–`B10` จับข้อมูลที่ตั้งใจทำให้ผิดได้จริง 100%)

### 2.2 พิสูจน์จับบั๊กเก่า 8 คอมมิต (`prove-part-g.mjs`)
ทดสอบบน detached worktree ชั่วคราวใน `$env:TEMP\pp142-old-part-g` แล้วลบทิ้งทันทีหลังตรวจ (`git worktree list` สะอาด 0 ค้าง):

| รหัส | บั๊กที่ทดสอบ | คอมมิตก่อนแก้ | ส่วนที่จับได้ | เวลา (ms) | ผลบนคอมมิตเก่า | ผลบน `main` |
|---|---|---|---|---|---|---|
| `G1-PR245` | ผ้าเพิ่มไม่กรอกจำนวน + หน่วย | `82e3363~1` | `confirmation` | 16,416 | ❌ ล้ม (จับได้) | ✅ ผ่าน |
| `G2-PR244` | ปกสำเร็จไม่ระบุสีปก | `284384c~1` | `confirmation` | 15,329 | ❌ ล้ม (จับได้) | ✅ ผ่าน |
| `G3-PR241` | ข้อความเลขที่ใบซ้ำกับงานที่รับแล้ว | `5cb0d3f~1` | `confirmation` | 7,587 | ❌ ล้ม (จับได้) | ✅ ผ่าน |
| `G4-PR238` | เพิ่มวัตถุดิบไม่มี `add_job_material`/ETA | `9f9b7b2~1` | `sim` | 7,841 | ❌ ล้ม (จับได้) | ✅ ผ่าน |
| `G5-PR237` | ส่งออกบริษัทภายนอกจากรอผลิตไม่ได้ | `8e7a77e~1` | `sim` | 7,141 | ❌ ล้ม (จับได้) | ✅ ผ่าน |
| `G6-PR235` | ใบงานบริการ 4 แบบ + เส้นทางเฉพาะ | `a5aca98~1` | `sim` | 6,821 | ❌ ล้ม (จับได้) | ✅ ผ่าน |
| `G7-PR231` | ขั้นรอผลิต + `release_job` | `6912bea~1` | `sim` | 6,190 | ❌ ล้ม (จับได้) | ✅ ผ่าน |
| `G8-PR226` | วันที่ `infinity` ผ่านได้ | `f92f4ff~1` | `confirmation` | 5,919 | ❌ ล้ม (จับได้) | ✅ ผ่าน |

**สรุปส่วน G:** จับได้ **8/8 ข้อ**

---

## 3. ส่วน H — ผลรันจริงบน `main`

### 3.1 ผล `qa-suite` (`--full` 3 seeds × 20 วัน และ `--quick` 3 รอบติดกัน)
| การรัน | `security` | `sim` | `confirmation` | `ui` | `externalAttempts` |
|---|---|---|---|---|---|
| `--full --seed 101 --days 20` | ✅ `74 RPC / 913 probes` | ✅ `470 actions · 59 jobs · 31 done` | ✅ `8 checks` | ✅ `102 screens` | `0` |
| `--full --seed 202 --days 20` | ✅ `74 RPC / 913 probes` | ✅ `486 actions · 60 jobs · 37 done` | ✅ `8 checks` | ✅ `102 screens` | `0` |
| `--full --seed 303 --days 20` | ✅ `74 RPC / 913 probes` | ✅ `451 actions · 60 jobs · 34 done` | ✅ `8 checks` | ✅ `102 screens` | `0` |
| `--quick --seed 42` (รอบ 1–3) | ✅ เหมือนกันทั้ง 3 รอบ | ✅ `48 actions · 10 jobs · 1 done` | ✅ `6 checks` | ✅ `28 screens` | `0` |

### 3.2 ผลชุดทดสอบพื้นฐานและชุดเดิม (`tools/qa-r14/`)
- **พื้นฐาน (ไม่ตั้ง `VITE_*`):**
  - `app run lint`: ✅ `0 warnings · 0 errors` (209 ไฟล์)
  - `app test`: ✅ Vitest `65 ไฟล์ · 624/624` + `node --test` `203/203`
  - `workers/files test`: ✅ `26/26`
  - `supabase/tests`: ✅ `run.mjs` + `live-check.mjs` (`106/106`)
- **ชุดเบราว์เซอร์เดิม (`tools/qa-r14/` บน `5244`/`5245`):**
  - ✅ **ผ่าน 9 ชุด:** `qa-part-b`, `qa-part-c`, `qa-mobile`, `qa-form-tabs`, `boot-recovery` (`5/5`), `e2e-photos`, `qa-materials` (`19/19`), `qa-service` (`26/26`), `confirmation-all` (`42/42` สินค้า รวม `svc_sew`, `svc_print`, `svc_press`, `svc_dtf`)
  - ⚠️ **ล้ม 2 ชุดเพราะสคริปต์เดิมล้าสมัย (ไม่ใช่บั๊กระบบ):**
    - `server.test.mjs`: ล้มที่บรรทัด 29 (`14 !== 9`) เพราะคาดหวังจำนวนเส้นทางเก่า `9` เส้นทาง (PR 235 เพิ่มใบงานบริการเป็น `14` เส้นทาง)
    - `qa-part-a.mjs` (`A1.1`, `A1.2`, `A1.6`): ล้มที่ `A1.1` เพราะสคริปต์เดิมกรอก `+ เพิ่มผ้า` โดยไม่ใส่จำนวน (`qty`) หลัง PR 245 บังคับจำนวน + หน่วย ทำให้ `A1.2`/`A1.6` ที่อ้างอิง `TEST-A1-TSHIRT` ไม่พบงาน

---

## 4. บั๊กและข้อสังเกตที่พบ (`R21-xx`)

> **ระดับ 1:** **0 ข้อ** · **ระดับ 2:** **0 ข้อ** (ระบบหลักบน `main` หลัง PR 245 ผ่านทุกการตรวจ)

### ระดับ 3 / ข้อควรปรับปรุง (2 ข้อ — สคริปต์เดิมล้าสมัย)
- **`R21-01` [ระดับ 3] สคริปต์เดิม `tools/qa-r14/server.test.mjs` ล้าสมัยหลัง PR 235:**
  - **วิธีทำซ้ำ:** `node --test tools/qa-r14/server.test.mjs` → ล้มที่ `14 !== 9`
  - **ผลที่ควรเป็น:** อัปเดตตัวเลขเส้นทางที่คาดหวังใน `server.test.mjs` เป็น `14`
- **`R21-02` [ระดับ 3] สคริปต์เดิม `tools/qa-r14/qa-part-a.mjs` ขั้น `A1.1` ล้าสมัยหลัง PR 245:**
  - **วิธีทำซ้ำ:** `node tools/qa-r14/qa-part-a.mjs` → `A1.1` ติด `fld_p_fabric_rows` (`มีแถวที่กรอกไม่ครบ`)
  - **ผลที่ควรเป็น:** เพิ่มการกรอก `qty` + `unit` ในแถวผ้าเพิ่มของ `qa-part-a.mjs`
