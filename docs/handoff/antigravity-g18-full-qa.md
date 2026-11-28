# ส่งงาน Antigravity G18: QA รอบ 22 (`antigravity/g18-full-qa`)

## เปลี่ยนอะไร
- เพิ่มรายงานผลทดสอบเต็ม: `docs/qa/รอบ-22-antigravity.md`
- เพิ่มสรุปสำหรับเจ้าของระบบ: `docs/qa/สรุป-รอบ-22-สำหรับเจ้าของ.md`
- เพิ่มภาพหลักฐานหน้าตั้งค่า/สถานะผิดพลาด: `docs/qa/img/r22-ag/settings-tabs-1440.png`, `docs/qa/img/r22-ag/server-down-state.png`
- เพิ่มข้อตรวจ `R22-01-case-duplicate-doc-no` ใน `tools/qa-suite/parts/confirmation.mjs` และอัปเดต `tools/qa-suite/README.md` เพื่อจับบั๊กเลขที่ใบยืนยันซ้ำต่างตัวพิมพ์เล็ก-ใหญ่ (ล้มบน `main` ปัจจุบันตามใบสั่งงาน)

## ทดสอบอะไร (ผลจริง)
- **พื้นฐาน (ไม่ตั้ง `VITE_*`):**
  - `app run lint`: 0 warnings · 0 errors (215 ไฟล์)
  - `app test`: Vitest 67 ไฟล์ 656/656 + `node:test` ผ่าน
  - `workers/files test`: 28/28 ผ่าน
  - `supabase/tests`: `run.mjs` + `live-check.mjs` ผ่าน 106/106
- **`tools/qa-suite` บน `127.0.0.1:5254/5255`:**
  - `--quick` 3 รอบติดกัน: ผ่าน 4/4 เหมือนกันทุกรอบ (`externalAttempts = 0`)
  - `--full --days 20`: seed `101` ผ่าน 5/5 · seed `303` ผ่าน 5/5 · seed `202` 4/5 (`sim.mjs:228` สคริปต์ล้าสมัยเรื่องกรองงานก่อน `split_job`)
  - `prove.mjs`: จับได้ 13/13
  - หลังเพิ่ม `R22-01-case-duplicate-doc-no`: รัน `--only confirmation --skip-build` ล้มที่ `R22-01` ตามคาด (`exit code 1`)
- **ชุด `tools/qa-r14/` บน `5254/5255`:** `server.test.mjs`, `qa-part-a/b/c`, `qa-mobile`, `e2e-photos`, `qa-materials` (19/19), `qa-service` (28/28), `qa-signature` (13/13) ผ่านทั้งหมด
- **ส่วน B/C/D:** ตรวจ PR 247–266, ทุกบทบาท, คู่มือทุกไฟล์, ค่าขอบ, XSS, เขตเวลา `America/New_York`, สเกล 200 งาน (`686 ms`)

## บั๊กที่เจอ
- **ระดับ 1:** 0 ข้อ
- **ระดับ 2:** 4 ข้อ (`R22-01` เลขที่ใบตัวพิมพ์เล็ก-ใหญ่ซ้ำได้, `R22-02` คู่มือเจ้าของระบบ, `R22-03` คู่มือแอดมิน, `R22-04` การ์ดติดตั้งแอปใน `#/account` เมื่อมี `beforeinstallprompt` ใน LINE UA)

## สิ่งที่ยังไม่ได้ทำ
- ทดสอบบนมือถือจริงในแอป LINE / iOS Safari จริง และทดสอบ race condition บน Postgres จริง
