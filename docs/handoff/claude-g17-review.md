# Claude: ตรวจรับงาน G17 (ระบบทดสอบถาวร `tools/qa-suite`)

- **Branch:** `claude/g17-review` = main หลัง PR 249 + merge `antigravity/g17-test-system` (5da618e) + แก้ของ Claude
- **ผล:** โครงของ Antigravity ใช้ได้ แต่ข้อตรวจหลายส่วนผ่านโดยไม่ได้ตรวจจริง (CR21-01 ถึง 10 ใน [`../qa/รอบ-21-antigravity.md`](../qa/รอบ-21-antigravity.md) หัวข้อ 5) → เขียนใหม่ทุกส่วน · ไม่พบบั๊กของระบบจริง

## เปลี่ยนอะไร
- `parts/security.mjs` + `checks/rpc-policy.mjs`: เรียกทุก RPC ด้วยพารามิเตอร์ครบ × 14 บัญชี · ด่าน `require_role` อ่านจาก SQL เทียบตาราง · งานจริงที่สถานี · RLS/policy/`security_invoker` · REST เขียนตรงด้วยแถวที่ข้อมูลครบ
- `lib/clock.mjs` (ใหม่): เลื่อนวันโดยถอยทุกช่องวันที่ในฐาน (ปิด trigger ชั่วคราวด้วย `session_replication_role`)
- `lib/lead.mjs` (ใหม่): import `proto/leadTime.ts` `auth/menus.ts` `auth/access.ts` ตัวจริงด้วย Node 24 (ตัด type เอง + hook เติม `.ts`)
- `parts/sim.mjs`: ทุกคำสั่งต้องสำเร็จ · กรณีที่ต้องถูกปฏิเสธตรวจข้อความ · วัตถุดิบพร้อมวันที่/เลื่อนวัน/ค้าง · แบ่งงาน · ฟิล์ม · รายงานสาเหตุเมื่อเกินเวลาผลิต · ใบงานบริการ 5 เส้นทาง
- `checks/invariants.mjs`: B1–B11 (B5 เทียบกับ `leadTime.ts` · B11 กล่องจดหมาย) + self-test 11/11
- `parts/confirmation.mjs`: ใช้ `validate()` ของฟอร์ม · ฉบับลูกค้า vs ฉบับโรงงานทุกสินค้า · รวมทุกข้อที่ล้มแล้วรายงานครั้งเดียว
- `parts/ui.mjs`: เมนูจริงของทุกบทบาท · `measureFloorUx` · console · หน้าที่เปิดไม่ได้ทุกหน้า
- `checks/mutations.mjs` + `prove.mjs` (แทน `prove-part-g.mjs`): ใส่บั๊ก 9 แบบ + โค้ดก่อนแก้ 4 commit ต้องจับได้ด้วยข้อความที่ถูกข้อ
- `lib/client.mjs` `reset` ใช้กับฐานเก่าที่ยังไม่มี `production_settings` ได้ · `lib/rng.mjs` ลบ `shrinkTrace` ที่ไม่ได้ใช้ · คำสั่งรันซ้ำมีโหมด/`--mutate`
- R21-01 `tools/qa-r14/server.test.mjs` 14 เส้นทาง · R21-02 `tools/qa-r14/qa-part-a.mjs` กรอกจำนวน + หน่วยผ้าเพิ่ม

## ทดสอบ
ดูตัวเลขล่าสุดในคำอธิบาย PR · `app` lint 0 · Vitest 629 · node 207 · DB 2,067 + live-check 106 · `server.test.mjs` ผ่าน · `qa-part-a` 16/16

## ยังไม่ได้ทำ / ข้อจำกัด
- PGlite การเชื่อมต่อเดียว: "กดพร้อมกัน" ไม่ใช่ transaction ชนกันจริง (ใช้ `tools/load-test/race.mjs`)
- ไม่ตรวจภาพ PDF / ฟอนต์ / คำแปลพม่า
- `qa-part-b` B1 (บอร์ด 375 px เกิน 2 px · ลิ้นชัก 16–18 px): `qa-suite` วัดด้วย `measureFloorUx` แล้วไม่เจอ ทั้งบอร์ดและลิ้นชักทุกบทบาท → น่าจะเป็นจังหวะวัดของ `qa-part-b` ยังไม่ได้แก้สคริปต์นั้น
- ขั้น "เกินเวลาผลิตแล้วต้องรายงานสาเหตุก่อน QC เสร็จ" ขึ้นกับ seed (seed 1 = 4 ครั้ง · seed 101 / 202 = 0 ครั้ง) · `qa-part-a` A2.4 ครอบขั้นนี้แน่นอน
- ไม่ได้ใส่ `qa-suite` เข้า CI (Actions โควตาหมด / ต้องมี Chrome)
