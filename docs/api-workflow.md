# API ของ workflow (A1)

> ที่มา: `supabase/migrations/20261117000001_workflow.sql` · ทดสอบ: `supabase/tests/workflow.mjs`
> **ระหว่างเย็บ → เย็บเสร็จ:** `start_sewing` → `finish_sewing` ยืนยันครั้งเดียวแล้วไป QC + Packing คืนจักรและช่วงจองที่เหลือ ใช้ `report_sewing_issue` ระหว่างเย็บและ `resume_sewing` เมื่องานพักแล้วแก้ปัญหาเสร็จ
> หน้าเว็บเรียกด้วย `supabase.rpc('ชื่อฟังก์ชัน', { p_...: ... })` · ข้อมูลงาน**เขียนตรงเข้าตารางไม่ได้** ต้องผ่านฟังก์ชันเหล่านี้เท่านั้น
> owner เรียกได้ทุกฟังก์ชัน · ทุกฟังก์ชันบันทึก 1 แถวใน `events` · ข้อความ error เป็นภาษาไทย แสดงให้ผู้ใช้ได้ตรงๆ
> **ฝ่ายผลิตคุมทุกสถานี** (`20261118000004_production_runs_floor.sql` · ทดสอบ `supabase/tests/production.mjs`): ทุกฟังก์ชันที่ตารางด้านล่างเขียนว่า supervisor ฝ่ายผลิต (production) เรียกได้ด้วย ในฐานะผู้ควบคุมงานที่ไม่จำกัดเฟส (ตรวจใน `private.require_role` จุดเดียว) · บัญชี supervisor เดิมย้ายเป็น production แล้ว · ฟังก์ชันที่ระบุ production ไว้เอง (เช่น กรอบเวลาซ่อม) ยังใช้กฎของฝ่ายผลิตตามเดิม
> **ผู้ควบคุมงาน 2 เฟส (เลิกใช้แล้ว)** (`20261118000001_supervisor_sections.sql` · ทดสอบ `supabase/tests/sections.mjs`): ผู้ควบคุมงานที่มี `profiles.section` กดได้เฉพาะงานที่อยู่สถานีซึ่ง `stations.section` ตรงกัน (เฟส 1 = พิมพ์ รีด ตัด รีด DTF ปัก สกรีน · เฟส 2 = เย็บ QC+Packing) · ตรวจใน `private.lock_job` จึงมีผลกับทุกฟังก์ชันที่กดงาน · ยกเว้น `receive_job` และ `correct_event` · section = null = ทุกเฟส · error: "งานนี้อยู่สถานี… (เฟส N) ให้ผู้ควบคุมงานเฟส N เป็นคนกด"

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
| `receive_job` | `p_confirmation_no, p_customer_name, p_job_name, p_product_type_code, p_qty, p_unit, p_due_date, p_route_code, p_confirmation_pdf_path` · ไม่บังคับ `p_spare_qty, p_confirmation_rev, p_spec` | **admin เท่านั้น** · owner (ฝ่ายผลิต/ผู้ควบคุมงาน = "แอดมินเป็นคนส่งงานเข้าโรงงาน" · `20261119170000`) | สร้างงาน + รายการวัตถุดิบจากแม่แบบ · คืน `uuid` · ปฏิเสธ: ไม่มี PDF / ไม่ใช่ .pdf, เลขที่ซ้ำ, จำนวน ≤ 0 |
| `check_material` | `p_material_id, p_checked = true` | admin / qc / production (เฉพาะรายการของฝ่ายตัวเอง) | ติ๊ก/ยกเลิก · ครบทุกฝ่าย → ปล่อยไปขึ้นตัวอย่างอัตโนมัติ · ปฏิเสธ: ฝ่ายอื่น, ปล่อยงานแล้ว, รายการฟิล์ม (ติ๊กอัตโนมัติ) |
| `order_film` | `p_job, p_eta` | admin | บันทึกสั่งฟิล์ม DTF + ETA · ติ๊กรายการฟิล์มให้ |
| `receive_film` | `p_job` | admin | บันทึกได้รับฟิล์ม · ปฏิเสธ: ยังไม่สั่ง |
| `start_station` | `p_job` | supervisor · qc (เฉพาะ QC+Packing) | queued → doing · ปฏิเสธ: เริ่มไปแล้ว, พักอยู่, รีด DTF ยังไม่ได้ฟิล์ม |
| `complete_substep` | `p_job, p_key, p_value = null` | supervisor · qc (เฉพาะ QC+Packing) | ติ๊กขั้นย่อย · `kind=num` ต้องส่งตัวเลข · `kind=appr` เฉพาะ supervisor · ปฏิเสธ: ยังไม่เริ่ม, ขั้น lock, `sew_count`/`inspect` (มีฟังก์ชันเฉพาะ), ตัวแรกตอนขึ้นตัวอย่าง |
| `update_sew_count` | `p_job, p_count` | supervisor | ยอดเย็บสะสม · ปฏิเสธ: ตัวแรกยังไม่ผ่าน, เกิน qty + เผื่อเสีย |
| `record_qc` | `p_job, p_passed` | supervisor / qc | เพิ่มยอดผ่าน QC (สะสม) |
| `send_rework` | `p_job, p_qty, p_reason, p_source_station` | supervisor / qc | ส่งกลับแก้ · ต้องมีจำนวน + สาเหตุ + สถานีต้นเหตุที่อยู่ก่อน QC ในเส้นทาง |
| `finish_sewing` | `p_job` | supervisor เฟส 2 / ทุกเฟส · owner | ยืนยันเย็บเสร็จครั้งเดียวจากสถานะกำลังเย็บ · ส่งต่อ QC + Packing · คืนจักร/ช่วงจอง · ตรวจเวลามาตรฐานตามเดิม |
| `report_sewing_issue` | `p_job, p_reason, p_pause = false` | supervisor เฟส 2 / ทุกเฟส · owner | บันทึกปัญหาในไทม์ไลน์ของงานที่กำลังเย็บ · เลือกพักงานได้ · รายงานเกินเวลามาตรฐานใช้ `submit_delay_report` |
| `resume_sewing` | `p_job` | supervisor เฟส 2 / ทุกเฟส · owner | เย็บต่อเมื่องานพัก · จ่ายเฉพาะจักรที่ขาด · ถ้าจักรยังไม่ครบคงสถานะพัก |
| `finish_station` | `p_job` | supervisor · qc (เฉพาะ QC+Packing) | **ไม่บังคับเช็คลิสต์ขั้นย่อย** (`20261119180000` · เหลือ รอฟิล์ม + QC ผ่านครบจำนวน) + เวลามาตรฐาน แล้วส่งต่อ · ปฏิเสธ: "ยังทำขั้นย่อยไม่ครบ: …", เกินเวลาแต่ยังไม่รายงาน |
| `record_sample_result` | `p_job, p_pass, p_note = null, p_customer_confirmed_at = null` | admin | ผ่าน → ผลิตจริง · ไม่ผ่าน (ต้องมี note) → ตัวอย่างรอบใหม่ |
| `open_issue` | `p_job, p_reason` | supervisor / qc / admin / production | พักงาน · ต้องมีสาเหตุ · คืน id |
| `close_issue` | `p_job, p_note = null` | supervisor / qc / admin / production | แก้แล้ว · กลับสถานะก่อนพัก |
| `submit_delay_report` | `p_job, p_reasons text[], p_detail, p_new_eta, p_need_help = null` | supervisor / qc / admin / production | รายงานปัญหา (ส่งล่วงหน้าได้) · รหัสสาเหตุต้องมีใน `reason_codes` · วันเสร็จใหม่ต้องอยู่ในอนาคต |
| `correct_event` | `p_job, p_event_id, p_reason` | supervisor | บันทึกการแก้ไขย้อนหลัง (event `correction`) |
| `book_machines` | `p_job, p_starts, p_ends` → `text[]` รหัสจักรที่จอง | **production เท่านั้น** · owner | **จองจักรเป็นวัน-เวลา** ครบทุกชนิดตาม `product_machine_needs` · งานยังอยู่เฟส 1 ก็จองได้ · ปฏิเสธ: เวลาจบไม่หลังเวลาเริ่ม, ผ่านไปแล้ว, เริ่มวันอาทิตย์, เกิน 14 วัน, งานจองไว้แล้ว, ผลิตจริงที่ผ่านเย็บแล้ว, "ช่วงเวลานี้จักรไม่พอ: โพ้ง 4 เส้น ขาด 1 ตัว (OL4-001 จองให้ SC… 17/11 08:00–17:00)" · ข้อบังคับฐานข้อมูลกันการจองจักรทับแบบ `[เริ่ม, จบ)` แม้กดพร้อมกัน หากถูกจองตัดหน้าให้เลือกช่วงเวลาใหม่ |
| `cancel_booking` | `p_job` | **production เท่านั้น** · owner | ยกเลิกช่วงที่ยังไม่เริ่มหรือเริ่มตรงเวลาที่กด · ช่วงที่เริ่มไปแล้วตัดจบที่เวลาปัจจุบัน · งานออกจากเย็บ = คืนช่วงที่เหลืออัตโนมัติ |
| `start_sewing` | `p_job` → คืน `text[]` รหัสจักรที่ได้ | supervisor เฟส 2 / ทุกเฟส | **ปุ่มเริ่มเย็บ** · เลือกจักรว่างตามรหัสให้ครบทุกชนิดตาม `product_machine_needs` แล้วเริ่มสถานีเย็บในคำสั่งเดียว · ปฏิเสธ: ยังไม่ถึงเย็บ, พักอยู่, สินค้าไม่มีสูตรจักร, "จักรไม่ว่าง เริ่มเย็บไม่ได้: โพ้ง 4 เส้น ขาด 1 ตัว (OL4-001 ใช้กับ SC…, OL4-006 เสีย)" · **trigger บน jobs**: สถานีเย็บเป็น "กำลังทำ" ได้เมื่อจักรครบเท่านั้น (รวม `start_station` และ `close_issue`) · ยังไม่มีจักรในระบบเลย = ไม่บังคับ |
| `assign_machines` | `p_job, p_machine_codes text[]` | supervisor เฟส 2 / ทุกเฟส | จ่ายจักรเย็บ (S14) · event `machines_assigned` · ปฏิเสธ: งานไม่อยู่สถานีเย็บ, จักรเสีย/ปิด, จักรใช้กับงานอื่นอยู่ (บอกเลขที่ใบ), **จักรที่งานอื่นจองช่วงนี้** · ปฏิเสธทั้งชุดถ้ามีตัวใดไม่ผ่าน |
| `release_machines` | `p_job, p_machine_codes text[] = null` | supervisor เฟส 2 / ทุกเฟส | คืนจักร (null = ทุกตัว) · event `machines_released` · งานออกจากสถานีเย็บ/เสร็จ = คืนอัตโนมัติ · พักงานไม่คืน |
| `set_machine_status` | `p_machine_code, p_status (ready/broken/off), p_note, p_repair_eta = null` | production · supervisor เฟส 2 / ทุกเฟส · owner (เฟส 1 / แอดมิน / QC / ผู้บริหาร = ปฏิเสธ) | ปุ่ม **แจ้งเสีย / ปิดใช้งาน / ซ่อมเสร็จ** · เสียต้องมีอาการ · **กรอบเวลาซ่อม (`p_repair_eta`)**: ฝ่ายผลิตแจ้งเสียต้องใส่ · ผู้ควบคุมงานใส่ไม่ได้ (ฝ่ายผลิตกำหนดภายหลัง) · ต้องเป็นเวลาข้างหน้าไม่เกิน 30 วัน · ซ่อมเสร็จ = ล้างเวลา · สาเหตุพักงานต่อท้าย "คาดว่าซ่อมเสร็จ DD/MM HH:MI" · กดซ้ำสถานะเดิม = "สถานะเปลี่ยนแล้ว" · เสียระหว่างใช้ = คืนจักรจากงาน + **พักงานอัตโนมัติ** (สาเหตุ "จักร OL4-001 เสีย: อาการ") · บันทึก `machine_status_log` ทุกครั้ง · **แก้ `sewing_machines.status` ตรงไม่ได้แม้ owner** (trigger) |
| `set_repair_eta` | `p_machine_code, p_repair_eta, p_note = null` | production · owner | กำหนด / เลื่อนกรอบเวลาซ่อมของจักรที่เสียอยู่ (เช่น รออะไหล่) · บันทึกประวัติทุกครั้ง · ปฏิเสธ: จักรไม่ได้เสีย, เวลาผ่านไปแล้ว, เกิน 30 วัน |

### ขั้นย่อยที่บังคับก่อน `finish_station`
- **ผลิตจริงนอกสถานีเย็บ:** ทุกขั้น `req`, `num`, `appr`, `lock` · `inspect` (QC) = ยอดผ่านสะสม ≥ qty · `lock` = ได้รับฟิล์มแล้ว
- **ขึ้นตัวอย่าง:** เฉพาะ `req` ในสถานีอื่น ส่วนเย็บและ QC + Packing ใช้การยืนยันเสร็จ
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
| `machine_types`, `sewing_machines` (รหัส = prefix ประเภท-เลข 3 หลัก เช่น OL4-001 บังคับด้วย trigger · `20261119160000` · ชนิด · `status`), `product_machine_needs` (สินค้า → ชนิดจักร × จำนวน), `machine_assignments` (`released_at` null = ใช้อยู่), `machine_status_log` (ประวัติแจ้งเสีย/ซ่อม: ใคร · เมื่อไร · อาการ · งานที่ใช้อยู่), `machine_bookings` (`starts_at`–`ends_at` · `cancelled_at` null = ยังจองอยู่) | จักรเย็บ S14 · `20261118000002_sewing_machines.sql` · ทดสอบ `supabase/tests/sewing.mjs` · หน้าเว็บคำนวณงานที่ขึ้นเย็บได้ด้วย `app/src/proto/sewing.ts` (`planSewing`) |

Realtime: `jobs`, `job_materials`, `issues`, `job_substeps`, `sample_results`, `qc_results`, `events`, `delay_reports`, `sewing_machines`, `machine_assignments`, `machine_status_log`, `machine_bookings`

## ค่าร่าง (รอ PP-SOP-01)
`stations.sla_days` พิมพ์/รีด/ตัด = 1 วัน (สถานีอื่นยังไม่จับเวลา) · `sla_segments.subli_ppc` = 3 วัน · `reason_codes` M1–O9 · แก้ผ่านหน้าตั้งค่า (C2) ได้โดยไม่ต้องแก้โค้ด
