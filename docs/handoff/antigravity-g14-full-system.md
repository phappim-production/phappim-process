# Handoff: `antigravity/g14-full-system` (QA รอบ 18 — ทดสอบครบระบบในเครื่อง)

## ทำอะไรไปบ้าง
- ดำเนินการทดสอบ QA รอบ 18 (G14) บนระบบจำลอง `127.0.0.1:5234` / `5235` (ไม่ได้แตะระบบจริงแต่อย่างใด · ตรวจ `app/dist` และ CDP `externalAttempts = []`)
- รันชุดทดสอบเดิม:
  - `node --test tools/qa-r14/server.test.mjs`: ผ่าน `1/1`
  - `qa-part-a.mjs`: ผ่าน `16/16`
  - `qa-part-b.mjs`: ผ่าน `4/5` (`B3` ล้มเฉพาะ console error `net::ERR_INTERNET_DISCONNECTED` จากการจำลองออฟไลน์ในสคริปต์ ไม่ใช่บั๊กระบบ)
  - `qa-part-c.mjs`: ผ่าน `5/5`
  - `confirmation-all.mjs`: ผ่าน `38/38` สินค้า
- เขียนและรันชุดทดสอบส่วน A, B9/B10, C1 เพิ่มเติมใน `tools/qa-r18-ag/`:
  - `tools/qa-r18-ag/test-part-a.mjs` และ `tools/qa-r18-ag/test-part-a-1-6.mjs` (แก้ใบหลังรับงาน PR 185, เปิดฟอร์มไม่ต้องรีเฟรช PR 184, ปุ่มไม่ใช้กับงานนี้, แบ่งงาน+แก้ใบ PR 187, ป้ายล่าช้า X วัน PR 189, เลขติดลบ/ช่วง `28-34`/กุ๊น, ม็อคอัพขอบภาพ PR 181, SW `/confirmation`)
  - `tools/qa-r18-ag/test-part-bc-extra.mjs` (ตรวจสิทธิ์เปิด URL `#/...` ตรงๆ ทุกบทบาท, เทียบเมนูกับคู่มือ, ตรวจ overflow 375px)
- เขียนรายงาน [`docs/qa/รอบ-18-antigravity.md`](../qa/รอบ-18-antigravity.md), [`docs/qa/สรุป-รอบ-18-สำหรับเจ้าของ.md`](../qa/สรุป-รอบ-18-สำหรับเจ้าของ.md) และแนบหลักฐานใน `docs/qa/img/r18-ag-*`

## บั๊กที่พบ
- **`R18-01` (ระดับ 1 — แจ้งกลางรอบและแก้ไขแล้วบน `main` PR #192):** `revise_job_spec` ปฏิเสธการแก้ใบจากงานลูก `-2` (`เลขที่ใบไม่ตรง`) และ `private.split_family` ไล่ลงล่างอย่างเดียวไม่รวมงานแม่
- **`R18-02` (ระดับ 2):** `DueLabel` นับวันล่าช้าตามปฏิทินรวมวันอาทิตย์ (`thaiDayDiff`) และหน้า `Overview.tsx` ยังใช้ป้าย `"เลยกำหนดส่ง"`
- **`R18-03` (ระดับ 3):** `canOpenPage(role, 'queueAll')` เปิดให้ `staff`/`qc` เข้า `#/production-queue` ผ่าน URL ตรงได้ (ดูอย่างเดียว)
- **`R18-04` (ระดับ 3):** ฟอร์มแก้ใบหลังรับงาน (`revising()`) ยังไม่ปิดปุ่มเปลี่ยนสินค้าและ radio ขึ้นตัวอย่างใน UI
- **`R18-05` (ระดับ 3):** `ASIDE` ในลิ้นชักรายละเอียดงานที่มีม็อคอัพวัด `asideRight=393` ที่ `375 px` (ไม่เกิดแถบเลื่อนแนวนอน `docScroll=375`)

## ไฟล์ที่เพิ่ม/แก้ไข
- `tools/qa-r18-ag/**`
- `docs/qa/รอบ-18-antigravity.md`
- `docs/qa/สรุป-รอบ-18-สำหรับเจ้าของ.md`
- `docs/qa/img/r18-ag-*`
- `docs/handoff/antigravity-g14-full-system.md`
