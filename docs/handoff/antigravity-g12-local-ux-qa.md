# ส่งต่องาน antigravity/g12-local-ux-qa (G12 — QA รอบ 14 ในเครื่อง)

- **Branch:** `antigravity/g12-local-ux-qa` (แตกจาก `main` หลัง PR #151 ใน worktree `../pp142-g12`)
- **สถานะ:** เสร็จครบส่วน 0 และส่วน A · B · C บนสภาพแวดล้อมจำลองในเครื่องเท่านั้น (`127.0.0.1:5214` / `5215`) · ยังไม่ได้ `git push` และไม่ได้เปิด PR

---

## 1. เปลี่ยนอะไร (ไฟล์ใหม่ทั้งหมดในขอบเขตใบสั่งงาน)

- **ชุดจำลองหลังบ้านและทดสอบในเครื่อง (`tools/qa-r14/`):**
  - `tools/qa-r14/db.mjs`: รัน migration จริงใน `supabase/migrations/*.sql` บน PGlite + seed จักร 22 ตัว · 9 เส้นทาง · 6 บริษัท · เครื่องต่อสถานีตามจริง · 0 งาน · 15 บัญชีทดสอบ `.invalid`
  - `tools/qa-r14/postgrest.mjs`: PostgREST-compatible REST/RPC router + บังคับ `request.jwt.claim.sub` และ RLS
  - `tools/qa-r14/server.mjs`: HTTP server เสิร์ฟ `app/dist/` + Auth/REST จำลอง (`5214`), R2 Worker จริงในหน่วยความจำ (`5215`), `/__qa/switch`, `/__qa/reset`, `/__qa/config`
  - `tools/qa-r14/server.test.mjs`: ทดสอบ Part 0 (seed, Auth/password, disabled/anon RLS, `.single`/`.maybeSingle`, RPC workflow, R2 Worker upload/sign, embedded select, audit_log, reset)
  - `tools/qa-r14/chrome.mjs` และ `tools/qa-r14/fixtures.mjs`: CDP driver แบบปิดเครือข่ายภายนอก (`--host-resolver-rules` + `Network.setBlockedURLs`) พร้อม `newTab({ isolated: true })` และไฟล์ทดสอบชั่วคราว (JPG/PNG/WEBP/PDF/ปลอม/0B/>20MB)
  - `tools/qa-r14/qa-part-a.mjs`, `qa-part-b.mjs`, `qa-part-c.mjs`: ชุดทดสอบ E2E ส่วน A (`A1.1–A8.1`), ส่วน B (`B1–B5`), ส่วน C (`C1–C5`)
  - `tools/qa-r14/README.md`: คู่มือเตรียมเครื่อง รันทดสอบ และข้อจำกัดของสภาพแวดล้อมจำลอง
- **รายงานและหลักฐาน:**
  - `docs/qa/รอบ-14-antigravity.md`: รายงานฉบับเต็มพร้อมผลตรวจไม่แตะระบบจริง, ตารางผล A/B/C, รายการบั๊กเรียงตามระดับ และตารางเทียบคู่มือ/ภาพประกอบเก่า
  - `docs/qa/สรุป-รอบ-14-สำหรับเจ้าของ.md`: สรุปภาษาคนทั่วไปสำหรับเจ้าของระบบ
  - `docs/qa/img/r14-ag-*.png` (17 ภาพ) และ `docs/qa/img/r14-ag-pdf-*.pdf` (8 ไฟล์)
  - `docs/handoff/antigravity-g12-local-ux-qa.md`: เอกสารส่งต่องานฉบับนี้

*(ไม่ได้แก้ไขไฟล์ใน `app/`, `production-confirmation.html`, `supabase/`, `workers/`, ชุดทดสอบเดิม หรือเอกสารเดิม)*

---

## 2. ทดสอบอะไร (ผลจริง)

- `node --test tools/qa-r14/server.test.mjs`: ผ่าน **1/1** (`3785.92 ms` / รวม `3988.94 ms`)
- `node tools/qa-r14/qa-part-a.mjs`: ผ่าน **16/16** (`A1.1–A8.1`, `externalAttempts = []`, `blockedFontRequests = 164`)
- `node tools/qa-r14/qa-part-b.mjs`: ผ่าน **5/5** (`B1–B5`, ตรวจ **183** จอที่ 375/768/1440px, PDF 8 ไฟล์ `%PDF-` ครบ, `externalAttempts = []`, `blockedFontRequests = 241`)
- `node tools/qa-r14/qa-part-c.mjs`: ผ่าน **5/5** (`C1–C5`, `externalAttempts = []`, `blockedFontRequests = 28`)
- `npm.cmd --prefix app run lint` (`oxlint`): **0 warnings, 0 errors** (139 ไฟล์ · 116 กฎ)
- `npm.cmd --prefix app test`:
  - `vitest run`: **42 ไฟล์ · 457 tests ผ่านทั้งหมด**
  - `node --experimental-strip-types --test tests/*.test.mjs`: **119 tests ผ่าน · 0 ไม่ผ่าน · 0 ข้าม**
- Loopback `npm.cmd --prefix app run build` (`VITE_SUPABASE_URL=http://127.0.0.1:5214`, `VITE_FILES_URL=http://127.0.0.1:5215`): สำเร็จ (`150 modules transformed`) + สแกน `app/dist/` (`workers.dev`: `0`, `127.0.0.1:5214`: `1`, `127.0.0.1:5215`: `1`, `supabase.co`: `1` ใน helper ภายใน `@supabase/supabase-js` ไม่ใช่ endpoint, `pp142.pages.dev`: `2` เป็นสตริงใน `confirmation.html` และ SVG QR ใน `LabelPage` ไม่ใช่การเรียกเครือข่าย)
- `npm.cmd --prefix supabase\tests test`: `run.mjs` **ผ่าน 1,498 · ไม่ผ่าน 0** และ `live-check.mjs` **ผ่าน 106 · ไม่ผ่าน 0 · งานค้าง 0 · บัญชีทดสอบเปิดค้าง 0**

---

## 3. ยังไม่ได้ทำ / ข้อจำกัดของชุดจำลองในเครื่อง

- **Supabase Realtime WebSocket push:** `chrome.mjs` ใช้ stub socket ตอบ `phx_reply ok` แทน WebSocket จริง (การซิงก์ระหว่างแท็บทดสอบผ่านการเรียก `refresh()` หลัง RPC และรีโหลดหน้า)
- **Physical multi-connection contention:** PGlite ประมวลผลตามคิวใน process เดียว (ชดเชยด้วยการจำลอง latency 3,000 ms ใน B3 เพื่อตรวจปุ่มค้างและ optimistic lock)
- **ไม่มี `pg_cron` 5 นาที:** การแจ้งเตือนเกิดจาก `inbox_scan` ตอนหน้าเว็บโหลด/เปิดกล่องจดหมาย

---

## 4. บั๊กที่เจอนอกขอบเขต (ให้ Claude / Codex พิจารณาแก้ไข)

> **ไม่พบบั๊กระดับ 1** · พบ **ระดับ 2 จำนวน 2 รายการ** และ **ระดับ 3 จำนวน 9 รายการ** (รายละเอียดวิธีทำซ้ำครบอยู่ใน `docs/qa/รอบ-14-antigravity.md`):

### ระดับ 2 (นอกขอบเขต — ต้องแก้ใน `app/` หรือ `docs/คู่มือ/`)
1. **B2-01 — คู่มือ (`docs/คู่มือ/*.md`) และภาพใน `docs/คู่มือ/img/` ขัดกับระบบจริงหลายจุด:**
   - `docs/คู่มือ/QC.md:91` ระบุ *"พิมพ์ไม่ได้ (ดูบนจอ)"* แต่ `app/src/auth/access.ts` + `app/src/pages/mockup/MockupPage.tsx:575` อนุญาตให้ `qc` เปิด `#/artwork?id=...` และกด `พิมพ์ / PDF` ได้จริง (`canOpenPage('qc', 'artwork') === true`)
   - `docs/คู่มือ/QC.md:42` บอกหัวสถานีขึ้น *"ไม่จำกัดเครื่อง"* (ความจริงซ่อนป้ายเมื่อ `machines === null`) และ `QC.md:67-68` พูดถึงเฉพาะส่งแก้กลับ `เย็บงาน` (ความจริงส่งกลับได้ทุกสถานีก่อน QC รวมถึง `สั่งผลิตข้างนอก`)
   - `docs/คู่มือ/แผนอบรม.md:89` ยังสอนว่า *"QC มีเครื่อง 1 ชุด: ป้าย เครื่อง 1/1 · เต็ม"*
   - `docs/คู่มือ/เจ้าของระบบ.md:55-84` และ `docs/คู่มือ/แผนอบรม.md:35,116` ยังระบุตั้งค่า **7 แท็บ** โดยมีแท็บ 1 เป็น `ผู้ใช้และบทบาท` (จริงมี **6 แท็บ**) และ `เจ้าของระบบ.md:78` บอกให้แจ้ง Claude เปลี่ยนชนิดจักรใช้ร่วม (จริงแก้ได้บนเว็บแล้ว)
   - `docs/คู่มือ/ผู้บริหาร.md:4,85` และ `แผนอบรม.md:102` ยังไม่ระบุสิทธิ์ `ยกเลิกงาน` ของผู้บริหาร
   - ภาพล้าสมัยที่ยืนยันแล้ว: `qc-board-768.png`, `qc-now-768.png`, `prod-board-768.png`, `prod-now-768.png`, `admin-overview-768.png`, `r2-admin-intake-768.png`, `owner-settings-users.jpg`, `owner-settings-machines.jpg` (นอกจาก `r2-station-panel` และ `r5-queue-*` ที่ทราบอยู่แล้วใน `docs/ส่งต่องาน-Claude.md:222`)
2. **B2-02 — `QueueAllView` (`app/src/pages/RolePages.tsx:162-186`) บน 375 px:** `<li>` ใน `<ol className="grid ...">` ขาด `min-w-0` ทำให้ใน `#/production-queue` ป้าย `ส่งออกข้างนอก` / `ติดปัญหา` ถูก `<Card>` ตัดหายครึ่งป้ายฝั่งขวา (`img/r14-ag-b1-admin-queue-375.png`)

### ระดับ 3 (นอกขอบเขต — ใน `app/src/`)
3. **B3-01 — `TodoPanel` (`app/src/pages/WorkPanels.tsx:15-53`) บน 375 px:** แผง `ต้องทำตอนนี้` (`#/queue`, `#/board`, `#/mine`) ล้นขวา `17 px` (`mainOverflow = 17`, `right = 391–392 px`, `img/r14-ag-b1-prod-queue-375.png`)
4. **B3-02 — คำซ้ำ `"ภาพภาพหลัก"` (`app/src/pages/mockup/MockupPage.tsx:332,477,480`):** นำ `"ภาพ"` ต่อหน้า `VIEW_NAME.front = 'ภาพหลัก'` (`img/r14-ag-a1-mockup-from-confirmation.png`)
5. **B3-03 — กรอบข้อความ Callout ชิดขอบซ้ายถูกขอบแคนวาสบัง (`app/src/pages/mockup/AnnotationCanvas.tsx`):** พบจุด 1 ถูกขอบซ้ายตัดข้อความบางส่วนบนหน้าจอ (`img/r14-ag-a1-mockup-rev2-approved.png`)
6. **B3-04 — `StationQueue` (`app/src/pages/StationQueue.tsx:25-37,261-262`) ขาด `useRef` lock:** กดรัวใน microtask/เฟรมเดียว (<16 ms) ส่ง RPC ซ้ำ ทำให้คำขอที่ 2–3 ที่ฐานข้อมูลปฏิเสธอาจเขียนแถบแดง `[role="alert"]` ทับข้อความสำเร็จหลังงานเริ่มแล้ว (การแตะห่าง ≥100 ms ถูกล็อกด้วย `disabled={busy}` ปกติ)
7. **B3-05 — `MockupPage` (`app/src/pages/mockup/MockupPage.tsx:339,344`):** `save()` ล้าง `setBusy('')` ก่อน `saveAndReload()` รอ `reload()` จบ
8. **B3-06 — `ReceiveJob` (`app/src/pages/ReceiveJob.tsx:183`):** รับวันกำหนดส่งย้อนหลัง (`2020-01-01`) โดยไม่มีคำเตือน/ยืนยัน
9. **B3-07 — `SplitForm` (`app/src/pages/OutsourcePanel.tsx:248-259`) และ `QcPanel` (`app/src/pages/JobActions.tsx:552-554`):** ปัดทศนิยม (`1.5` → `1`) ด้วย `Math.floor` เงียบๆ แทนการเตือนจำนวนเต็ม
10. **B3-08 — `CancelJob` (`app/src/pages/JobActions.tsx:78-80,368`):** `await refresh()` ปิด `JobDrawer` ทันทีทำให้ข้อความ toast ยกเลิกงานไม่ทันแสดง
11. **B3-09 — `Audit Log` (`app/src/proto/admin.ts:20,36`):** `auditTitle` ไม่อ่าน `subject.code` และ `auditChanges` คืน `[]` เมื่อ `insert` ทำให้เพิ่มจักร `SN-099` แสดงเป็นเลข ID แทนรหัสจักร
