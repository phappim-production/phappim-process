# ใบสั่งงาน C9 (รอบ 5) — ทดสอบ Flow งานจริงครบทุกสถานะ (ตารางสถานะ × คำสั่ง)

**ผู้ทำ:** Codex (โมเดล GPT 6.2 sol) · **branch:** `codex/c9-flow-matrix` ในโฟลเดอร์ `../pp142-c9` (Claude สร้างให้แล้ว) · **ส่งภายใน:** ศ. 20 พ.ย. 18:00
**แก้ได้เฉพาะ:** `supabase/tests/flow-r5.mjs` (ไฟล์ใหม่) · `supabase/tests/run.mjs` (เพิ่มบรรทัดเรียก flow-r5 ท้ายไฟล์เท่านั้น) · `app/src/proto/flow-r5.test.ts` (ไฟล์ใหม่) · `docs/qa/รอบ-5-codex.md` · `docs/handoff/codex-c9-flow-matrix.md`
**ห้าม:** แก้โค้ดหน้าเว็บ / migration / ฟังก์ชัน SQL (เจอบั๊ก = เขียนทดสอบที่ล้มให้เห็น ชื่อขึ้นต้น `BUG:` + รายงาน · Claude แก้) · push · เปิด PR · แตะฐานข้อมูลจริง · ใช้บัญชีจริง
**ทดสอบบน:** PGlite ในเครื่อง (`cd supabase/tests && npm ci && npm test`) + Vitest (`cd app && npm ci && npm test`) · ไม่ต่อฐานข้อมูลจริง

## ทำไม
ระบบเพิ่ม คิวงาน · แทรกงานด่วน · ส่งออกบริษัทภายนอก (ส่งออก / ส่งต่อ / รับกลับ) · แบ่งงาน ภายใน 1 วัน (PR 52–61) · ก่อนทดลองจริง ส. 21 ต้องพิสูจน์ว่า **ทุกสถานะของงาน กดได้เฉพาะปุ่มที่ควรกดได้** และงานเดินจนจบได้ทุกเส้นทาง

## อ่านก่อน
- `docs/api-workflow.md` (ทุกฟังก์ชัน + ใครเรียก + ปฏิเสธเมื่อ) · `AGENTS.md`
- migration ล่าสุด: `20261120000000_job_queue.sql` · `20261120010000_queue_integrity.sql` · `20261120020000_outsourcing.sql` · `20261120030000_vendor_details.sql`
- ทดสอบเดิมที่ใช้เป็นแบบได้: `supabase/tests/e2e.mjs` · `queue.mjs` · `outsourcing.mjs` · `sewing.mjs`

## งานที่ 1 · เดินงานจนจบทุกเส้นทาง (flow-r5.mjs)
ทั้ง 8 เส้นทาง (`normal` `plain` `dtf` `dtg` `screen` `emb` `print_emb` `cut_only`) × (ขึ้นตัวอย่าง / ไม่ขึ้นตัวอย่าง) = 16 งาน · ผ่านทุกสถานีด้วยบทบาทที่ถูกต้อง (`start_in_queue` → `finish_station` · เย็บใช้ `start_sewing` / `finish_sewing` · QC บันทึกผ่านครบ) จนเป็น `done` · ตัวอย่างไม่ผ่าน 1 รอบในงานที่ขึ้นตัวอย่างอย่างน้อย 2 งาน · เส้นทางที่ใช้ฟิล์มต้องสั่ง + รับฟิล์มก่อนรีดฟิล์ม
- ตรวจว่า `events` มีครบทุกขั้น (เริ่ม · เสร็จ · ส่งต่อ) และ `station_visits` ตรงกับลำดับเส้นทาง

## งานที่ 2 · ตารางสถานะ × คำสั่ง (หัวใจของรอบนี้)
สร้างงานให้อยู่ในแต่ละสถานะ แล้วเรียก**ทุกคำสั่ง**ด้วย**ทุกบทบาท** (owner · admin · production · qc · manager) · บันทึกผลเป็นตาราง ✅ ผ่าน / ⛔ ปฏิเสธ (ข้อความไทย) · **เทียบกับที่ควรเป็นตาม `api-workflow.md`** · ไม่ตรง = บั๊ก

| สถานะ | สร้างอย่างไร |
|---|---|
| A รอคิว (คิวแรก) · B รอคิว (คิวที่ 2) | รับงาน 2 งานสถานีแรกเดียวกัน |
| C กำลังทำ · D พักงาน | เริ่ม / เปิดปัญหา |
| E ตัวอย่างรอผล (`sample_review`) | งานขึ้นตัวอย่างผ่านทุกสถานี |
| F อยู่ข้างนอก (`out`) · G อยู่ข้างนอกแบบส่งต่อ (รอบที่ 2) | `send_out` · `forward_out` |
| H งานแก้รอที่สถานีต้นเหตุ · I งานแก้อยู่ข้างนอก | QC `send_rework` · `send_out` งานแก้ |
| J รอรีดฟิล์มยังไม่ได้รับฟิล์ม | เส้นทาง dtf |
| K เย็บอยู่ (มีจักร) · L เย็บพักเพราะจักรเสีย | `start_sewing` · `set_machine_status` broken |
| M เกินเวลามาตรฐานยังไม่รายงาน | ปรับ `stations.sla_days` ในฐานจำลอง / เลื่อน `station_started_at` |
| N เสร็จ (`done`) · O ยกเลิก | เดินจนจบ / ตั้ง phase |
| P งานที่แบ่งมา (`-2`) | `split_job` |

คำสั่งที่ต้องเรียกทุกสถานะ: `start_station` `start_in_queue` `note_queue_skip` `finish_station` `open_issue` `close_issue` `submit_delay_report` `start_sewing` `finish_sewing` `report_sewing_issue` `resume_sewing` `record_qc` `send_rework` `record_sample_result` `order_film` `receive_film` `move_job_ahead` `send_out` `forward_out` `receive_back` `update_out_plan` `split_job` `attach_confirmation_pdf` `correct_event`
- เน้นจุดเสี่ยง: งาน `out` ต้องไม่มีคำสั่งไหนเดินงานได้นอกจาก `forward_out` / `receive_back` / `update_out_plan` · งาน `done` / ยกเลิก ต้องไม่ถูกเปิดใหม่ · แบ่งงานแล้วจำนวนรวมเท่าเดิม · งานแก้ข้างนอกกลับ QC เสมอ · ทุกการเปลี่ยนสถานะมี 1 แถวใน `events`
- ไม่ต้องเขียนทดสอบทุกช่องเป็น `ok()` แยก ถ้ายาวเกิน: ใช้ลูปสร้างตาราง แล้ว `ok()` ต่อสถานะ (เช่น "สถานะ F: คำสั่งที่ผ่านตรงกับที่ควรเป็น") · แนบตารางเต็มในรายงาน

## งานที่ 3 · หน้าเว็บเห็นสถานะตรงกับฐานข้อมูล (flow-r5.test.ts)
ทุกสถานะ A–P (สร้าง `Job` ตามรูปแบบใน `app/src/data/live.ts`): `columnOf` · `stationCounts` · `waitingAt` / `queueNo` · `todoList` · `simulate` (ต้องได้วันเสร็จทุกงานที่ยังไม่จบ ไม่ติดลบ ไม่ undefined) · `StationQueue` แสดงงานไว้ส่วนที่ถูก (กำลังทำ / คิว / ข้างนอก) และปุ่มตามบทบาท · `OutsourcePanel` แสดงปุ่มตามสถานะ

## ส่งงาน
- `docs/qa/รอบ-5-codex.md`: ผลงานที่ 1–3 · **ตารางสถานะ × คำสั่ง × บทบาทฉบับเต็ม** · 1 บั๊ก = 1 หัวข้อ (ระดับ 1/2/3 · ทดสอบที่จับได้ · ผลที่ได้ · ผลที่ควรเป็น · แนวทางแก้)
- **บั๊กระดับ 1 (งานเดินผิดสถานะ / ข้ามสิทธิ์ / ข้อมูลหาย) แจ้งเจ้าของโปรเจกต์ทันที**
- ตรวจก่อนส่งตาม `AGENTS.md` · `git diff --stat main` มีแต่ไฟล์ในขอบเขต · ไฟล์ส่งงาน `docs/handoff/codex-c9-flow-matrix.md` · commit ในเครื่อง (ไม่ push) · บอกเจ้าของว่า "ส่งงาน codex/c9-flow-matrix แล้ว"
