# API ของ workflow (A1)

> ที่มา: `supabase/migrations/20261117000001_workflow.sql` · ทดสอบ: `supabase/tests/workflow.mjs`
> หน้าเว็บเรียกด้วย `supabase.rpc('ชื่อฟังก์ชัน', { p_...: ... })` · ข้อมูลงาน**เขียนตรงเข้าตารางไม่ได้** ต้องผ่านฟังก์ชันเหล่านี้เท่านั้น
> owner เรียกได้ทุกฟังก์ชัน · ทุกฟังก์ชันบันทึก 1 แถวใน `events` · ข้อความ error เป็นภาษาไทย แสดงให้ผู้ใช้ได้ตรงๆ
> **ผู้ควบคุมงาน 2 เฟส** (`20261118000001_supervisor_sections.sql` · ทดสอบ `supabase/tests/sections.mjs`): ผู้ควบคุมงานที่มี `profiles.section` กดได้เฉพาะงานที่อยู่สถานีซึ่ง `stations.section` ตรงกัน (เฟส 1 = พิมพ์ รีด ตัด รีด DTF ปัก สกรีน · เฟส 2 = เย็บ QC+Packing) · ตรวจใน `private.lock_job` จึงมีผลกับทุกฟังก์ชันที่กดงาน · ยกเว้น `receive_job` และ `correct_event` · section = null = ทุกเฟส · error: "งานนี้อยู่สถานี… (เฟส N) ให้ผู้ควบคุมงานเฟส N เป็นคนกด"

## ลำดับของงาน
```
receive_job → [materials] check_material / order_film ครบทุกฝ่าย → [sample] สถานีตามเส้นทาง
→ [sample_review] record_sample_result ── ไม่ผ่าน → [sample] รอบใหม่
                                       └─ ผ่าน → [production] สถานีตามเส้นทาง → [done]
แต่ละสถานี: queued → start_station → doing → complete_substep… → finish_station → สถานีถัดไป queued
พักงาน: queued/doing → open_issue → hold → close_issue → กลับสถานะเดิม
QC ส่งแก้: send_rework → กลับสถานีต้นเหตุ (is_rework) → finish_station → กลับ QC ทันที
```

## ฟังก์ชัน
| ฟังก์ชัน | พารามิเตอร์ | บทบาท | ทำอะไร / ปฏิเสธเมื่อ |
|---|---|---|---|
| `receive_job` | `p_confirmation_no, p_customer_name, p_job_name, p_product_type_code, p_qty, p_unit, p_due_date, p_route_code, p_confirmation_pdf_path` · ไม่บังคับ `p_spare_qty, p_confirmation_rev, p_spec` | supervisor | สร้างงาน + รายการวัตถุดิบจากแม่แบบ · คืน `uuid` · ปฏิเสธ: ไม่มี PDF / ไม่ใช่ .pdf, เลขที่ซ้ำ, จำนวน ≤ 0 |
| `check_material` | `p_material_id, p_checked = true` | admin / qc / production (เฉพาะรายการของฝ่ายตัวเอง) | ติ๊ก/ยกเลิก · ครบทุกฝ่าย → ปล่อยไปขึ้นตัวอย่างอัตโนมัติ · ปฏิเสธ: ฝ่ายอื่น, ปล่อยงานแล้ว, รายการฟิล์ม (ติ๊กอัตโนมัติ) |
| `order_film` | `p_job, p_eta` | admin | บันทึกสั่งฟิล์ม DTF + ETA · ติ๊กรายการฟิล์มให้ |
| `receive_film` | `p_job` | admin | บันทึกได้รับฟิล์ม · ปฏิเสธ: ยังไม่สั่ง |
| `start_station` | `p_job` | supervisor · qc (เฉพาะ QC+Packing) | queued → doing · ปฏิเสธ: เริ่มไปแล้ว, พักอยู่, รีด DTF ยังไม่ได้ฟิล์ม |
| `complete_substep` | `p_job, p_key, p_value = null` | supervisor · qc (เฉพาะ QC+Packing) | ติ๊กขั้นย่อย · `kind=num` ต้องส่งตัวเลข · `kind=appr` เฉพาะ supervisor · ปฏิเสธ: ยังไม่เริ่ม, ขั้น lock, `sew_count`/`inspect` (มีฟังก์ชันเฉพาะ), ตัวแรกตอนขึ้นตัวอย่าง |
| `update_sew_count` | `p_job, p_count` | supervisor | ยอดเย็บสะสม · ปฏิเสธ: ตัวแรกยังไม่ผ่าน, เกิน qty + เผื่อเสีย |
| `record_qc` | `p_job, p_passed` | supervisor / qc | เพิ่มยอดผ่าน QC (สะสม) |
| `send_rework` | `p_job, p_qty, p_reason, p_source_station` | supervisor / qc | ส่งกลับแก้ · ต้องมีจำนวน + สาเหตุ + สถานีต้นเหตุที่อยู่ก่อน QC ในเส้นทาง |
| `finish_station` | `p_job` | supervisor · qc (เฉพาะ QC+Packing) | ตรวจขั้นย่อยครบ + เวลามาตรฐาน แล้วส่งต่อ · ปฏิเสธ: "ยังทำขั้นย่อยไม่ครบ: …", เกินเวลาแต่ยังไม่รายงาน |
| `record_sample_result` | `p_job, p_pass, p_note = null, p_customer_confirmed_at = null` | admin | ผ่าน → ผลิตจริง · ไม่ผ่าน (ต้องมี note) → ตัวอย่างรอบใหม่ |
| `open_issue` | `p_job, p_reason` | supervisor / qc / admin / production | พักงาน · ต้องมีสาเหตุ · คืน id |
| `close_issue` | `p_job, p_note = null` | supervisor / qc / admin / production | แก้แล้ว · กลับสถานะก่อนพัก |
| `submit_delay_report` | `p_job, p_reasons text[], p_detail, p_new_eta, p_need_help = null` | supervisor / qc / admin / production | รายงานปัญหา (ส่งล่วงหน้าได้) · รหัสสาเหตุต้องมีใน `reason_codes` · วันเสร็จใหม่ต้องอยู่ในอนาคต |
| `correct_event` | `p_job, p_event_id, p_reason` | supervisor | บันทึกการแก้ไขย้อนหลัง (event `correction`) |

### ขั้นย่อยที่บังคับก่อน `finish_station`
- **ผลิตจริง:** ทุกขั้น `req`, `num`, `appr`, `lock` · `sew_count` = ยอดเย็บ ≥ qty · `first_piece` = อนุมัติตัวแรกแล้ว · `inspect` (QC) = ยอดผ่านสะสม ≥ qty · `lock` = ได้รับฟิล์มแล้ว
- **ขึ้นตัวอย่าง:** เฉพาะ `req` · ไม่บังคับขั้นของ QC + Packing
- **งานแก้ (rework):** สถานีต้นเหตุไม่บังคับขั้นย่อย · QC บังคับครบเหมือนเดิม

### เวลามาตรฐาน (กฎข้อ 10)
- นับเฉพาะ **ผลิตจริง** · วันทำงานจันทร์–เสาร์ (เวลาไทย) · หักเวลาพักงานที่มีสาเหตุ · งานแก้ไม่จับเวลา
- สถานี: `stations.sla_days` (null = ไม่จับ) · ช่วง: `sla_segments` (เริ่มนับจากครั้งแรกที่เริ่มสถานีต้นช่วงในการผลิตจริง)
- ใช้ถึง `warn_pct` % = เตือน (ส้ม) · เกิน = ต้องมี `delay_reports` ก่อนกดเสร็จ (สถานี: รายงานในรอบนี้ · ช่วง: รายงานหลังเริ่มช่วง)

## อ่านข้อมูล
| ที่ | ใช้ทำ |
|---|---|
| `job_live` (view) | ทุกคอลัมน์ของ `jobs` + `current_station`, `current_station_name`, `last_seq`, `materials_pending`, `materials_waiting_depts`, `hold_reason`, `qc_passed`, `sla` (jsonb: `station_days`, `station_sla_days`, `station_warn`, `station_over`, `station_reported`, `segment_*`) |
| `station_visits` (view) | งาน × สถานี × รอบ: `started_at`, `done_at`, `rework` (สำหรับรายงานเวลา) |
| `job_materials`, `job_substeps`, `qc_results`, `sample_results`, `issues`, `delay_reports`, `events` | รายละเอียดและไทม์ไลน์ |
| `stations` (`substeps`, `sla_days`, `warn_pct`), `routes`, `route_stations`, `sla_segments`, `reason_codes`, `material_templates` | ข้อมูลตั้งค่า (owner แก้ได้ตรงตาม RLS) |

Realtime: `jobs`, `job_materials`, `issues`, `job_substeps`, `sample_results`, `qc_results`, `events`, `delay_reports`

## ค่าร่าง (รอ PP-SOP-01)
`stations.sla_days` พิมพ์/รีด/ตัด = 1 วัน (สถานีอื่นยังไม่จับเวลา) · `sla_segments.subli_ppc` = 3 วัน · `reason_codes` M1–O9 · แก้ผ่านหน้าตั้งค่า (C2) ได้โดยไม่ต้องแก้โค้ด
