# Handoff: Antigravity G16 — ทดสอบครบระบบรอบ 20 (หลัง PR 233)

- **Branch:** `antigravity/g16-full-system` (ใน `../pp142-g16` · commit ในเครื่อง ไม่ push)
- **สภาพแวดล้อม:** ทดสอบบนระบบจำลองในเครื่อง `127.0.0.1:5234` / `5235` เท่านั้น (ไม่ได้แตะระบบจริง)

## สรุปผลทดสอบ
- **Baseline (ไม่ตั้ง `VITE_*`):**
  - `app` lint: `0 warnings · 0 errors`
  - `app` tests: Vitest `604/604` + node `--test` `200/200` (รวม `TZ=UTC` `leadTime` + `deliveries` ผ่าน)
  - `workers/files` tests: `26/26`
  - `supabase/tests`: `1,972/1,972` + `live-check.mjs` `106/106`
- **Legacy QA Suites (`tools/qa-r14/`):** `server.test`, `qa-part-a/b/c`, `qa-mobile`, `qa-form-tabs`, `boot-recovery`, `e2e-photos`, `qa-materials`, `confirmation-all` (38/38 สินค้า) ผ่านทั้งหมด (`exit 0`)
- **R20 Suites (`tools/qa-r20-ag/`):**
  - `test-part-a-materials.mjs`: **8/8 PASS** (`externalAttempts=0`)
  - `test-part-b-features.mjs`: **5/6 PASS** (`B1`, `B2`, `B3`, `B4`, `B7` ผ่าน; `B6` ปุ่มบัญชี 375px ยืนยันแล้วใน `qa-mobile.mjs`, `externalAttempts=0`)
  - `test-part-c-e2e.mjs`: **3/3 PASS** (`externalAttempts=0`)
  - `test-part-d-all.mjs`: **4/4 PASS** (REST writes ถูกปฏิเสธ, XSS ไม่ทำงาน, 300+ งาน โหลด 429–845 ms, `externalAttempts=0`)
  - `audit-manuals.mjs`: ตรวจพบคู่มือไม่ตรง 3 จุด (`R20-01`–`R20-03`)

## บั๊กที่พบ
- **ระดับ 1:** **0 ข้อ**
- **ระดับ 2:** `R20-01` (คู่มือแอดมินข้อ 3 ขัดแย้งข้อ 3.1), `R20-02` (คู่มือฝ่ายผลิต/เจ้าของยังบอกคิวเรียงตามวันรับงาน), `R20-03` (คู่มือ QC/ผู้บริหาร/แผนอบรมขาดขั้นรอผลิต + ยังมีคำว่าซิลค์สกรีน)
- **ระดับ 3:** `R20-04` (`docs/api-workflow.md` บรรทัด 31), `R20-05` (`staff_empty` ขอลิงก์ `mockups`/`job_material_photos` ได้), `R20-06` (`MaterialsCheck.tsx` `add()` ไม่มี `if (busy) return`)

## ไฟล์ที่เพิ่ม
- `tools/qa-r20-ag/**`
- `docs/qa/img/r20-ag/**`
- `docs/qa/รอบ-20-antigravity.md`
- `docs/qa/สรุป-รอบ-20-สำหรับเจ้าของ.md`
- `docs/handoff/antigravity-g16-full-system.md`
