# API ของ workflow (ฟังก์ชันในฐานข้อมูล)

> อัปเดต **25 พ.ย. 2569** · migration ล่าสุด `20261203000000_lead_split_cancel` · ผังภาพทั้งระบบ: https://claude.ai/artifact/8BX5yhE37UUUWH6GzQgrym
> หน้าเว็บเรียกด้วย `rpc('ชื่อฟังก์ชัน', { p_...: ... })` (`app/src/data/useFactoryData.ts`) · ข้อมูลงาน**เขียนตรงเข้าตารางไม่ได้** (RLS) ต้องผ่านฟังก์ชันเหล่านี้เท่านั้น
> ทุกฟังก์ชันตรวจบทบาทด้วย `private.require_role(...)` (owner ผ่านเสมอ · **production ผ่านทุกที่ที่เขียน supervisor**) · ทุกการเปลี่ยนสถานะบันทึก 1 แถวใน `events` (แก้/ลบไม่ได้) · ข้อความ error เป็นภาษาไทย แสดงผู้ใช้ได้ตรงๆ
> บทบาทที่ใช้จริง: **owner · admin · production · qc · manager · staff** (supervisor เลิกใช้แล้ว · ระบบยังรองรับ)
> **staff** = พนักงานสถานี (`20261120140000`): ผ่านทุกที่ที่เขียน qc · แต่กดได้เฉพาะงานที่อยู่สถานีที่จับคู่ไว้ใน `staff_stations` (ตรวจใน `private.lock_job`) · ข้อจำกัด "QC เฉพาะสถานี QC + Packing" ไม่ใช้กับ staff

## ลำดับของงาน
```
[ฟอร์ม] save_confirmation_draft (ไม่บังคับ) ─┐
receive_job ──────────────────────────────────┴→ needs_sample?
   ├─ ขึ้นตัวอย่าง → [sample] สถานีตามเส้นทาง → [sample_review] record_sample_result
   │                    ไม่ผ่าน → [sample] รอบ +1        ผ่าน → [production] สถานีแรก
   └─ ไม่ขึ้น      → [production] สถานีแรกทันที (ไม่มีขั้นวัตถุดิบตั้งแต่ 20261119190000)
แต่ละสถานี: queued → start_in_queue (คิวแรก หรือมีเหตุผลข้ามคิว) → doing → finish_station → สถานีถัดไป queued … → [done]
เย็บ:       queued → start_in_queue / start_sewing (จ่ายจักรประจำไลน์) → doing → finish_sewing → QC
พักงาน:     open_issue → hold → close_issue (เย็บ: report_sewing_issue p_pause → resume_sewing)
QC ส่งแก้:  send_rework → สถานีต้นเหตุ (is_rework) → finish_station → กลับ QC ทันที
ใบแก้:      revise_job_spec → ทุกสถานีที่งานไปถึงหลังแก้ ack_confirmation_revision → finish_station ได้
รูปสถานี:   (เมื่อเจ้าของเปิดระบบรูป) doing → [สถานีตรวจชิ้นแรก] submit_first_piece → decide_first_piece ผ่าน → add_finish_photos → finish_station
PDF:        แนบตอน receive_job หรือ attach_confirmation_pdf ทีหลัง
```

## รับงาน + ใบยืนยัน
| ฟังก์ชัน | อาร์กิวเมนต์ | ใครเรียก | ทำอะไร / ปฏิเสธเมื่อ |
|---|---|---|---|
| `save_confirmation_draft` | `p_data jsonb` (state ทั้งฟอร์ม · ต้องมี `h.doc_no`) → `uuid` | admin · owner | บันทึก/แก้ใบยืนยันร่างตามเลขที่ใบ (`confirmation_drafts`) · ตัด `imgs` ทิ้ง (ห้ามเก็บรูปในตาราง) · ปฏิเสธ: ไม่มีเลขที่ใบ, ข้อมูลไม่ใช่ใบยืนยัน, เลขนี้ส่งงานเข้าแล้ว, **เลขนี้มีใบร่างเป็นสินค้าอื่นอยู่แล้ว** (`20261129000001` · "เลขที่ใบ … บันทึกไว้แล้วเป็นสินค้าอื่น · ถ้าเป็นสินค้าคนละชิ้นในออเดอร์เดียวกัน ให้ต่อท้ายเลข เช่น …-0002") · ใบที่ยกเลิกแล้วบันทึกใหม่ = กลับเป็นร่าง (เปลี่ยนสินค้าได้) |
| `cancel_confirmation_draft` | `p_id` | admin · owner | ยกเลิกใบร่าง · ปฏิเสธ: ส่งงานเข้าแล้ว / ยกเลิกแล้ว |
| `receive_job` | `p_confirmation_no, p_customer_name, p_job_name, p_product_type_code, p_qty, p_unit, p_due_date, p_route_code, p_confirmation_pdf_path` (**ว่างได้**) · ไม่บังคับ `p_spare_qty, p_confirmation_rev, p_spec, p_needs_sample, p_develop` → `uuid` | **admin · owner** (production/supervisor = "แอดมินเป็นคนส่งงานเข้าโรงงาน") | สร้างงาน → ปล่อยเข้าสถานีแรก/ขึ้นตัวอย่างทันที · ใบร่างเลขเดียวกัน → `received` + `job_id` · ปฏิเสธ: เลขซ้ำ, ไม่เลือกขึ้นตัวอย่าง, จำนวน ≤ 0 / เกิน 100,000 (trigger `jobs_qty_cap` · `20261130000001`), ไม่มีกำหนดส่ง / ปีนอก ค.ศ. 2000–2399 (ดูหัวข้อกันพิมพ์ผิด), PDF ที่แนบไม่ใช่ .pdf / ยังไม่อัปโหลดจริง |
| `attach_confirmation_pdf` | `p_job, p_path` | admin · owner | แนบ/เปลี่ยน PDF ที่ลูกค้าเซ็น · event `confirmation_pdf` (`replaced`) · ปฏิเสธ: งานยกเลิก, ไม่ใช่ PDF / ยังไม่อัปโหลด |
| `revise_job_spec` | `p_job, p_spec, p_rev, p_customer_name, p_job_name, p_qty, p_spare_qty, p_due_date, p_needs_sample` · ไม่บังคับ `p_changes` (ชื่อช่องที่แก้จากฟอร์ม) → `jsonb` (`changed`, `rev`, `mockup_rev`, `mockup_stale`) | admin · owner | ลูกค้าขอแก้ใบหลังรับงาน: ฟอร์มที่เปิดจากงานกด "บันทึกการแก้เข้างาน" → แทน `spec` + ครั้งที่แก้ ชื่อลูกค้า ชื่องาน จำนวน เผื่อเสีย กำหนดส่ง · ไม่เปลี่ยนสถานี/สถานะ · ไม่มีอะไรเปลี่ยน = `changed: false` ไม่ลง event · **งานที่แบ่งแล้ว** (`20261123020000`): สเปก/ลูกค้า/ชื่องาน/กำหนดส่ง/ครั้งที่แก้ เปลี่ยนทุกส่วน (`parts`) จำนวนแต่ละส่วนคงเดิม · จำนวนในใบต้องเท่ายอดรวมทุกส่วน · เรียกด้วยส่วนที่แบ่ง (`-2`) = แก้ทั้งครอบครัวจากงานแม่ เลขที่ใบต้องเป็นของงานแม่ · งานแม่ถูกยกเลิก = แก้ไม่ได้ (`20261124000000`) · event `spec_revised` (`summary`, `fields`, `mockup_stale`) · กล่องจดหมาย `spec_revised` ทุกฝ่าย (บอกจุดในม็อคอัพฉบับอนุมัติที่ยังเป็นค่าเก่า) · **งานกำลังแก้ที่สถานีต้นเหตุ** (`20261128000000`): ลดจำนวนแล้ว `rework_qty` ลดเหลือชิ้นที่ยังไม่ผ่าน QC (สรุป "จำนวนส่งแก้ 4 → 2") · ลดจนไม่เหลือชิ้นที่กำลังแก้ = ปฏิเสธ (งานที่กลับถึง QC แล้วไม่ตรวจ) · ล็อกคิวตัวเดียวกับ `split_job` ก่อนหาครอบครัวงาน · **ฟอร์มที่เปิดไว้ก่อนมีใบแก้ใหม่กว่า** (`20261202000000`): ฟอร์มส่ง `spec.base_rev` (ครั้งที่แก้ตอนเปิดใบ) ไม่ตรง `jobs.confirmation_rev` = ปฏิเสธ "มีการบันทึกใบแก้ไขครั้งที่ N ของงาน … หลังจากเปิดใบนี้ · ปิดฟอร์มนี้ แล้วกด "แก้ใบยืนยัน" ที่งานเพื่อเปิดใบล่าสุดแล้วแก้ใหม่" (ไม่ส่ง `base_rev` = ไม่ตรวจ · `base_rev`, `sent_sig`, `sys` ไม่เก็บใน `spec`) · ปฏิเสธ: งานยกเลิก, เลขที่ใบไม่ตรง, เปลี่ยนสินค้า, เปลี่ยนการขึ้นตัวอย่าง, สลับงาน Develop ↔ ผลิตจริง (`20261127000000` · งานที่แบ่งแล้วดูที่งานแม่), ครั้งที่แก้ < 1 หรือถอยหลัง, จำนวน ≤ 0 / เกิน 100,000 / ต่ำกว่า QC ผ่านแล้ว / เปลี่ยนจำนวนงานที่เสร็จแล้ว, ไม่มีกำหนดส่ง · `20261204000000`: ฟอร์มส่ง `base_token` (= `spec.rev_token` ตอนเปิดใบ) · บันทึกใบแก้แล้วสเปกได้ `rev_token` ใหม่ · รหัสไม่ตรง (อีกแท็บบันทึกไปก่อน แม้เลขครั้งเดียวกัน) → "มีคนบันทึกใบแก้ของงาน … หลังจากเปิดใบนี้ · ปิดฟอร์มนี้ แล้วกด "แก้ใบยืนยัน" ที่งานเพื่อเปิดใบล่าสุดแล้วแก้ใหม่" · ไม่ส่งรหัส (ไฟล์เก่า) = ตรวจแค่เลขครั้ง |
| `ack_confirmation_revision` | `p_job, p_station` → void | supervisor · production · staff (สถานีที่จับคู่) · qc (QC + Packing) · owner | สถานีที่งานอยู่รับทราบใบยืนยันฉบับแก้ล่าสุด · สถานีถัดไปต้องรับทราบใบเดิมอีกครั้ง (`20261130000000` · ยึด event `spec_revised` ล่าสุด รวมงานต้นทางของงานที่แบ่ง) · บันทึก `confirmation_acks` + event `confirmation_ack` · กดซ้ำไม่บันทึกซ้ำ · **กดเสร็จสถานีไม่ได้จนกว่าจะรับทราบ** (`private.revision_ack_missing` ใน `missing_substeps` · "กด "รับทราบใบแก้" ก่อน · แอดมินแก้ใบยืนยันครั้งที่ N เมื่อ วัน เวลา น.") · ปฏิเสธ: ยังไม่มีใบแก้, งานอยู่สถานีอื่น, QC ที่ไม่ใช่สถานี QC, แอดมิน, ผู้บริหาร |
| `confirmation_revision_flags` | ไม่มี → `job_id, rev, revised_at, revised_by, fields, summary, event_id, acked_stations` | ทุกบทบาทที่ใช้งานอยู่ | ใบแก้ล่าสุดของงานที่ยังไม่เสร็จ/ยกเลิก ให้บอร์ดแสดงป้าย "ใบแก้ครั้งที่ N · วัน เวลา" และรายละเอียดงานแสดงผู้แก้ ช่องที่แก้ สถานีที่รับทราบแล้ว |
| `ack_mockup_sheet` | `p_sheet, p_station` → void | production · supervisor (เฟสตัวเอง) · staff (สถานีที่จับคู่) · qc (QC + Packing) · owner | รับทราบม็อคอัพฉบับที่อนุมัติ (`mockup_acks` · กดซ้ำไม่บันทึกซ้ำ) · ปฏิเสธ: ไม่พบฉบับนี้, ฉบับไม่ใช่ที่อนุมัติ, เส้นทางไม่ผ่านสถานีนี้, staff สถานีที่ไม่ได้จับคู่, QC สถานีอื่น · `20261202000000`: **งานยกเลิกแล้ว** "งานนี้ถูกยกเลิกแล้ว ไม่ต้องรับทราบม็อคอัพ" · **supervisor สถานีนอกเฟสตัวเอง** "สถานี… อยู่เฟส N ให้ผู้ควบคุมงานเฟส N เป็นคนกดรับทราบ" |

ฟอร์ม `/confirmation` (ไฟล์ `production-confirmation.html` · build คัดลอกขึ้นเว็บ) ไม่มี key: กด "บันทึกเข้าระบบ" → `localStorage['pp142.confirmation.outbox']` → เปิด `#/board?confirmation=save` → `ConfirmationOutbox` เรียก `save_confirmation_draft` · หน้ารับงานกด "แก้ใบนี้ในฟอร์ม" → `localStorage['pp142.confirmation.inbox']` → ฟอร์มโหลดใบ (`app/src/data/confirmationDrafts.ts`)
ค่าที่จุดกำกับม็อคอัพอ้างจากสเปก (`private.mockup_ref_value` · ใช้นับ `mockup_stale` ใน `revise_job_spec`): ตัวเลือก "อื่นๆ" แสดงเป็น "อื่นๆ: ข้อความที่พิมพ์" จากช่อง `…__other` ตรงกับ PDF (`20261129000001`)

## คิวงาน (`20261120000000` · `20261120010000` · `20261128000000`)
คิว = `jobs.queue_seq` จำนวนเต็มห่างกัน 1024 ตามลำดับรับเข้า (ห้ามซ้ำ · unique) · หน้าเว็บเรียงทุกรายการตามนี้ ไม่เรียงตามกำหนดส่ง
**กฎคิวบังคับทุกทางเริ่ม** (`20261128000000`): `start_station` / `start_sewing` ปฏิเสธงานที่ไม่ใช่คิวแรกของสถานี (นิยามเดียวกับ `private.queue_ahead`) "งานนี้ไม่ใช่คิวแรกแล้ว (คิวก่อนหน้า: …) กด "เริ่มก่อนคิว" แล้วใส่เหตุผล" · ผ่านเมื่อมี event `queue_skip` ของงานนั้นในรอบสถานีปัจจุบัน (`payload.visit` = `jobs.visit` · บันทึกโดย `start_in_queue` หรือ `note_queue_skip`)
| ฟังก์ชัน | อาร์กิวเมนต์ | ใครเรียก | ทำอะไร / ปฏิเสธเมื่อ |
|---|---|---|---|
| `move_job_ahead` | `p_job, p_before, p_reason` | production · manager · owner | แทรกงานด่วนก่อน `p_before` · ทีละคำขอ (advisory lock) · ช่องว่างหมด = จัดเลขใหม่ (`private.queue_renumber` · เฉพาะงานที่ยังไม่เสร็จ/ยกเลิก รอบเดียว ลำดับเดิม เลขใหม่อยู่เหนือทุกเลขเดิม · งานที่จบแล้วคงเลขเดิม) · event `queue_insert` · ปฏิเสธ: ไม่มีเหตุผล, งานเดียวกัน, อยู่ก่อนแล้ว, เสร็จ/ยกเลิก |
| `start_in_queue` | `p_job, p_reason` → `text[]` | production · qc (เฉพาะ QC+Packing) · owner | **ปุ่มเริ่มในหน้าคิวสถานีใช้ตัวนี้** · ไม่ใช่คิวแรกต้องมีเหตุผล (event `queue_skip` · `ahead`, `visit`) · แล้วเรียก `start_station` / `start_sewing` ในธุรกรรมเดียว (เริ่มไม่ได้ = ไม่บันทึกอะไร) · เย็บคืนรหัสจักร |
| `note_queue_skip` | `p_job, p_reason` → `boolean` | production · qc (เฉพาะ QC+Packing) · owner | ตรวจ/บันทึกข้ามคิวอย่างเดียว (event `queue_skip` · `visit`) · ใช้ก่อน `start_sewing` แบบเลือกจักรเอง: บันทึกเหตุผลก่อน แล้วเรียก `start_sewing(p_codes)` |

## ส่งงานออกบริษัทภายนอก + แบ่งงาน (`20261120020000`)
สถานีที่ส่งออกได้: พิมพ์ · รีด · ตัด · เย็บ · ปัก · สั่งผลิตข้างนอก (ติดกันหลายสถานีในรอบเดียว) · เส้นทาง `outside` (ผลิตข้างนอกทั้งหมด) = `outside` → `qc_pack` · สถานี `outside` กดเริ่มที่โรงงานไม่ได้ ต้องส่งออก (trigger `jobs_guard_outside_start`) · งานข้างนอก `station_status = 'out'` · trigger `jobs_guard_outsourced` ห้ามปุ่มของโรงงานเปลี่ยนงานจนกว่าจะรับกลับ · ตาราง `vendors`, `outsource_runs` (อ่านได้ทุกบัญชีที่เปิดอยู่ · เขียนผ่านฟังก์ชันเท่านั้น)
| ฟังก์ชัน | อาร์กิวเมนต์ | ใครเรียก | ทำอะไร / ปฏิเสธเมื่อ |
|---|---|---|---|
| `add_vendor` | `p_name, p_stations text[], p_contact` → `bigint` | admin · owner | เพิ่ม/เปิดใช้บริษัท · ปฏิเสธ: ชื่อว่าง, งานที่รับไม่ใช่ 6 สถานีที่ส่งออกได้ |
| `send_out` | `p_job, p_vendor, p_last_station, p_arrive_at, p_lead_days, p_back_at, p_note` → run id | admin · owner | งานรอเริ่ม (queued) ที่สถานีส่งออกได้ → บริษัททำถึง `p_last_station` · event `outsource_sent` · ปฏิเสธ: เริ่ม/พักแล้ว, อยู่ข้างนอกแล้ว, ข้ามสถานีที่ต้องทำในโรงงาน, ไม่อยู่ในเส้นทาง, กรอกกำหนดไม่ครบ / กลับก่อนถึง, งานแก้ส่งเกินสถานีต้นเหตุ · ช่วงที่ส่งออกรวมสถานีเย็บ = คืนจักร + จบ/ยกเลิกการจองจักรของงาน เหมือนตอนออกจากสถานีเย็บ (`20261128000000` · ตัวอย่างเก็บการจองล่วงหน้าไว้ให้ผลิตจริง ยกเว้นงาน Develop) |
| `forward_out` | `p_run, p_vendor, p_last_station, …` → run id | admin · owner | บ.A เสร็จ → บ.B ทำสถานีถัดไปโดยไม่ผ่านโรงงาน · event `outsource_forwarded` · ช่วงใหม่รวมเย็บ = ยกเลิกการจองจักรเหมือน `send_out` · ปฏิเสธ: บริษัทเดิม, งานแก้, ถัดไปทำในโรงงาน |
| `receive_back` | `p_run, p_note` | admin · owner | ของถึงโรงงาน → งานเข้าสถานีถัดไป (งานแก้ → QC) รอคิว · event `outsource_received` (`late`) |
| `update_out_plan` | `p_run, p_arrive_at, p_lead_days, p_back_at` | admin · owner | แก้กำหนด · event `outsource_plan` |
| `split_job` | `p_job, p_qty, p_request = null` → uuid งานใหม่ |  admin · owner | งานผลิตจริงที่รอเริ่ม (ไม่ใช่งานแก้/QC) แยก `p_qty` เป็นงาน `เลขเดิม-2` สถานีเดียวกัน คิวถัดไป · event `job_split` / `job_split_from` · ส่วนที่แบ่งใช้เวลาผลิตชุดเดียวกับงานแม่ (`20261201000000` · วันรับงานของงานแม่ + จำนวนรวมทั้งครอบครัว · ดูหัวข้อเวลาผลิต) |
| `cancel_job` | `p_job, p_reason` | **manager** · owner | ยกเลิกงาน (ลูกค้ายกเลิกออเดอร์) → phase `cancelled` ล้างสถานี · คืนจักร · การจองที่กำลังใช้จบทันที / ในอนาคตยกเลิก · ปิดปัญหาที่ค้าง · event `job_cancelled` (เหตุผล สถานี สถานะเดิม) · กล่องจดหมาย `job_cancelled` ทุกฝ่าย · ย้อนกลับไม่ได้ · ยกเลิกบางส่วนของงานที่แบ่งแล้ว เวลาผลิตของส่วนที่เหลือไม่เปลี่ยน (จำนวนส่วนที่ยกเลิกยังนับ · `20261203000000`) · ปฏิเสธ: บทบาทอื่น, ไม่มีเหตุผล, เสร็จแล้ว, ยกเลิกแล้ว, อยู่บริษัทภายนอก (รับของกลับก่อน) |

## จัดส่ง (`20261120240000`)
| ฟังก์ชัน | พารามิเตอร์ | ใครเรียกได้ | ทำอะไร / ปฏิเสธเมื่อ |
|---|---|---|---|
| `mark_delivered` | `p_job, p_note = null` | admin · owner | งาน `done` → `delivered_at / delivered_by / delivery_note` · event `delivered` · ปฏิเสธ: ยังไม่เสร็จ, บันทึกแล้ว |
| `undo_delivery` | `p_job, p_reason` | admin · owner | ล้างข้อมูลจัดส่ง · event `delivery_undone` (เหตุผล + ข้อมูลเดิม) · ปฏิเสธ: ยังไม่ได้ส่ง, ไม่มีเหตุผล |

## สถานีทั่วไป
| ฟังก์ชัน | อาร์กิวเมนต์ | ใครเรียก | ทำอะไร / ปฏิเสธเมื่อ |
|---|---|---|---|
| `start_station` | `p_job` | production · qc (เฉพาะ QC+Packing) · owner | queued → doing · ปฏิเสธ: เริ่มแล้ว, พักอยู่, **รีดฟิล์มยังไม่ได้รับฟิล์ม/งาน DTG/ของสกรีน**, เครื่องเต็ม, **ไม่ใช่คิวแรกและยังไม่มี `queue_skip` ของรอบนี้** (`20261128000000` · หน้าเว็บใช้ `start_in_queue`) · สถานีเย็บต้องใช้ `start_sewing` (trigger บังคับจักรครบ) · งานที่พักแล้วกลับเข้าคิวเพราะเครื่องเต็ม เริ่มต่อ = `station_started_at` เดิมไม่ถูกล้าง |
| `finish_station` | `p_job, p_station = null` (`20261120070000`: สถานีที่หน้าจอเห็น · ไม่ตรงสถานีปัจจุบัน = ปฏิเสธ "งานนี้ไปอยู่สถานีอื่นแล้ว" · หน้าเว็บส่งเสมอ) | production · qc (เฉพาะ QC+Packing) · owner | ไม่บังคับขั้นย่อย (`20261119180000`) · ตรวจ: พักอยู่ → "กด แก้แล้ว ก่อน" · QC กดได้เฉพาะสถานี QC + Packing · `missing_substeps` = ขั้น lock + QC ผ่านครบจำนวน → "ยังกดเสร็จไม่ได้: QC ตรวจผ่าน 10/25 ชิ้น ยังไม่ครบ …" (`20261119200000`) + ยังไม่รับทราบใบแก้ (`20261130000000`) + รูปชิ้นแรก/รูปงานเสร็จ (`20261129000000` · สองข้อหลังใช้กับเย็บและงานแก้ด้วย) · **เวลาผลิตทั้งงาน** (`20261201000000`): เฉพาะผลิตจริงที่สถานีสุดท้าย (QC + Packing → `done`) ถ้าเกินกำหนดและยังไม่มีรายงานที่ส่งตั้งแต่วันเตือน → "งานนี้เกินเวลาผลิต N วันทำงาน (ครบ วันที่) · ส่งรายงานสาเหตุที่ช้าก่อนกด QC + Packing เสร็จ" · สถานีอื่นไม่ตรวจเวลาแล้ว · event `station_done` เก็บ `lead` · งานแก้เสร็จ → กลับ QC ทันที · สถานีสุดท้าย → `done` (ตัวอย่าง → `sample_review`) |
| `open_issue` | `p_job, p_reason` | production · qc · admin · owner | พักงาน (ต้องมีสาเหตุ) · event `hold` |
| `close_issue` | `p_job, p_note = null` | production · **manager** · owner (`20261120050000`) | แก้แล้ว กลับสถานะก่อนพัก (เครื่องเต็ม = กลับเข้าคิว) · event `resume` (`requeued` · `waiting` = รอคิวต่อในรอบสถานีที่เริ่มไปแล้ว) · **แอดมิน / QC ถูกปฏิเสธ** "แจ้งผู้บริหารหรือฝ่ายผลิตให้กด …" (เจ้าของ 18 พ.ย.: แอดมินไม่มีหน้าที่แก้ปัญหาของสถานี) · งานเย็บใช้ `resume_sewing` (ฝ่ายผลิต) |
| `job_sla_flags` | — → `job_id, warn, over, need_report, lead_days, lead_due` | ทุกบทบาทที่ใช้งานอยู่ | อ่านอย่างเดียว · `20261201000000`: เวลาผลิตทั้งงาน (`private.lead_state` ตัวเดียวกับ `finish_station`) ของทุกงานที่ยังไม่เสร็จ/ยกเลิก ไม่รวมงาน Develop · `warn` = ถึงวันเตือน · `over` = เลยวันครบ · `need_report` = เลยแล้วยังไม่มีรายงาน |
| `submit_delay_report` | `p_job, p_reasons text[], p_detail, p_new_eta, p_need_help = null, p_request = null` | production · qc · admin · owner | รายงานปัญหา/ล่าช้า (ส่งล่วงหน้าได้ แต่นับเป็นรายงานเวลาผลิตเฉพาะที่ส่งตั้งแต่วันเตือน) · รหัสต้องอยู่ใน `reason_codes` · วันเสร็จใหม่ต้องเป็นอนาคต · `20261201000000`: ไม่ผูกช่วงแล้ว (`segment_code` = null) · ปฏิเสธ: งานปิดแล้ว, **งาน Develop** "งาน Develop ไม่มีเวลาผลิต ไม่ต้องรายงานล่าช้า" · `20261204000000`: **QC รายงานได้เฉพาะงานที่อยู่ QC + Packing** "ฝ่าย QC รายงานสาเหตุได้เฉพาะงานที่อยู่สถานี QC + Packing · งานนี้อยู่สถานีอื่น ให้คนที่สถานีนั้นรายงาน" |
| `correct_event` | `p_job, p_event_id, p_reason` | production · owner | "แจ้งว่ากดผิด" บันทึก event `correction` · **ไม่ย้อนสถานะงาน** |
| `complete_substep` | `p_job, p_key, p_value` | production · qc | ยังมีอยู่แต่หน้าเว็บไม่ใช้แล้ว |

## ตัวอย่าง + ฟิล์ม
| ฟังก์ชัน | อาร์กิวเมนต์ | ใครเรียก | ทำอะไร / ปฏิเสธเมื่อ |
|---|---|---|---|
| `record_sample_result` | `p_job, p_pass, p_note, p_customer_confirmed_at` | admin · owner | ผ่าน → ผลิตจริงสถานีแรก (**งาน Develop** `jobs.develop` → `done` ทันที ไม่ผลิตจริง · คืนจักร + ยกเลิกการจองจักรล่วงหน้า · `20261127000000`) · ไม่ผ่าน (ต้องมี note) → ตัวอย่างรอบใหม่ + แจ้งเตือน |
| `order_film` | `p_job, p_eta` | admin · owner | บันทึกสั่ง + วันคาดว่าได้รับ · เส้นทางที่ไม่ใช้ฟิล์ม → "ไม่ต้องสั่งฟิล์ม" |
| `receive_film` | `p_job` | admin · owner | บันทึกได้รับ → ปลดล็อกสถานีรีดฟิล์ม · ทำได้ทุกช่วงของงาน |

**รหัสคำขอ `p_request`** (`20261120070000` · `private.rpc_requests`): หน้าเว็บสร้าง 1 รหัสต่อการกรอก 1 ครั้ง (`app/src/data/requestId.ts`) · ส่งรหัสเดิมซ้ำ = ไม่บันทึกซ้ำ คืนผลเดิม (`record_qc` · `split_job` คืนใบลูกเดิม · `submit_delay_report` คืนรายงานเดิม) · ไม่ส่ง = ทำงานแบบเดิม

## เย็บ + จักร
**จักรใช้ร่วม** (`machine_types.shared` · `20261119210000`/`220000`): ตอนนี้ = จักรลา · โพ้ง 4 เส้น · ติดกระดุม · เจาะรังดุม · ไม่จ่าย/ไม่จองให้งาน · เริ่มเย็บได้เมื่อตัวที่ใช้ได้ (`status='ready'`) ≥ จำนวนที่สินค้าต้องใช้ · owner สลับได้ที่ ตั้งค่า → จักรเย็บ → ชนิดจักร (trigger `machine_types_release_on_shared` ปล่อยจักรที่ผูก + ยกเลิกการจองที่ยังไม่เริ่ม)

| ฟังก์ชัน | อาร์กิวเมนต์ | ใครเรียก | ทำอะไร / ปฏิเสธเมื่อ |
|---|---|---|---|
| `start_sewing` | `p_job` → `text[]` รหัสจักรที่จ่าย | production · owner | จ่ายจักร**ประจำไลน์**ว่างครบตามสูตรสินค้า (จักรที่งานนี้จองไว้ก่อน · จักรที่งานถืออยู่แล้วนับรวม ไม่จ่ายซ้ำ · คืนรหัสจักรทั้งชุดของงาน) แล้วเริ่มสถานี · ปฏิเสธ: ยังไม่ถึงเย็บ, พักอยู่, ไม่ใช่คิวแรกและยังไม่มี `queue_skip`, สินค้าไม่มีสูตร (ข้อความกลาง ดูใต้ตาราง), "จักรไม่ว่าง เริ่มเย็บไม่ได้: เข็มเดี่ยว ขาด 1 ตัว (SN-001 ใช้กับ SC…)", "โพ้ง 4 เส้น ใช้ได้ 1 ตัว ต้องใช้ 2 ตัว" · ไม่จำกัดจำนวนไลน์ (หัวหน้าหน้างานคุมเอง) |
| `finish_sewing` | `p_job` | production · owner | ยืนยันเย็บเสร็จครั้งเดียว → QC · คืนจักร + ช่วงจองที่เหลืออัตโนมัติ · เรียก `finish_station` ภายใน (ตรวจรับทราบใบแก้ + รูปสถานี) |
| `report_sewing_issue` | `p_job, p_reason, p_pause = false` | production · owner | บันทึกปัญหาระหว่างเย็บ · `p_pause` = พักงาน (`open_issue`) |
| `resume_sewing` | `p_job` | production · owner | เย็บต่อ · จ่ายเฉพาะจักรประจำไลน์ที่ขาด (`machines_short` ไม่นับจักรใช้ร่วม) · **ไม่ตรวจจักรใช้ร่วม** (ตั้งใจ: ช่างเย็บตะเข็บอื่นต่อได้) · งานที่พักตอน**ยังรอคิว** กลับไปรอคิว ไม่ได้จักร (`start_sewing` จ่ายตอนเริ่ม) · จบที่รอคิว = คืนจักรทั้งหมด (`20261128000000`) |
| `book_machines` | `p_job, p_starts, p_ends` → `text[]` | **production เท่านั้น** · owner | จองเฉพาะจักรประจำไลน์ · กันทับด้วย exclusion constraint · ปฏิเสธ: ผ่านไปแล้ว, วันอาทิตย์, เกิน 14 วัน, จองไว้แล้ว, จักรไม่พอ (บอกตัวและงานที่จอง) · `20261128000000`: เส้นทางไม่มีสถานีเย็บ, ผ่านเย็บไปแล้ว (ตัวอย่างที่ผ่านเย็บยังจองให้ผลิตจริงได้ ยกเว้นงาน Develop), งานแก้ที่สถานีก่อนเย็บ (กลับ QC เลย), ส่งเย็บที่บริษัทภายนอกอยู่, เสร็จ/ยกเลิก, สินค้าไม่มีสูตร |
| `cancel_booking` | `p_job` | production · owner | ยกเลิกช่วงที่ยังไม่เริ่ม · ช่วงที่กำลังใช้ตัดจบตอนนี้ |
| `assign_machines` / `release_machines` | `p_job, p_machine_codes` | production · owner | จ่าย/คืนจักรเอง (หน้าเว็บใช้ `start_sewing` แทน) · งานยังไม่เริ่มเย็บ: สินค้าไม่มีสูตร = ข้อความกลาง · มีสูตร = "กดเริ่มเย็บก่อน" |
| `set_machine_status` | `p_machine_code, p_status (ready/broken/off), p_note, p_repair_eta` | production · owner | แจ้งเสีย (ต้องมีอาการ + เวลาคาดซ่อมเสร็จ) / ซ่อมเสร็จ / ปิด · จักรประจำไลน์เสียระหว่างใช้ = คืนจากงาน + พักงานอัตโนมัติ · จักรใช้ร่วมเสียไม่พักงาน · แก้ `status` ตรงไม่ได้ (trigger) · ล็อกงานที่ใช้จักรก่อนล็อกจักร (ลำดับเดียวกับ `start_sewing`) |
| `set_repair_eta` | `p_machine_code, p_repair_eta, p_note` | production · owner | เลื่อนเวลาคาดซ่อมเสร็จ (≤ 30 วัน) |

**สินค้าไม่มีสูตรจักร** (`private.no_machine_recipe` · `20261128000000`): `start_sewing` · `start_station` ที่สถานีเย็บ · `assign_machines` / `set_job_machines` ก่อนเริ่มเย็บ · `book_machines` ตอบข้อความเดียวกัน "สินค้า "…" ยังไม่มีสูตรจักรเย็บ เย็บในโรงงานไม่ได้ · ให้เจ้าของระบบเพิ่มสูตรที่ ตั้งค่า → จักรเย็บ หรือให้แอดมินส่งงานเย็บออกบริษัทภายนอก"
**ล็อกการเลือกจักรว่าง** `pp142.sewing_machines` (advisory): `start_sewing` · `resume_sewing` · `set_job_machines` (ปุ่ม + / − จำนวนจักรของงาน)
**ออกจากเย็บโดยไม่เคยอยู่ที่เย็บ** (trigger `jobs_release_machines` · `private.leave_sewing`): รับกลับจากข้างนอกข้ามเย็บ · งานแก้กลับ QC · งานเสร็จ/ยกเลิก = คืนจักร + จบ/ยกเลิกการจองเหมือนเย็บเสร็จ

## QC
| ฟังก์ชัน | อาร์กิวเมนต์ | ใครเรียก | ทำอะไร / ปฏิเสธเมื่อ |
|---|---|---|---|
| `record_qc` | `p_job, p_passed, p_request = null` | qc · production · owner | เพิ่มยอดผ่าน (สะสม) · ยอดสะสมเกินจำนวนงานไม่ได้ (บอกว่ายังบันทึกได้อีกกี่ชิ้น) |
| `send_rework` | `p_job, p_qty, p_reason, p_source_station` | qc · production · owner | ส่งกลับแก้ (จำนวน + สาเหตุ + สถานีต้นเหตุก่อน QC) · จำนวนไม่เกินชิ้นที่ยังไม่ผ่าน (จำนวนงาน − ยอดผ่านสะสม) · งานแก้ที่เย็บต้องได้จักรใหม่ผ่าน `start_sewing` |

## รูปจากสถานี (`20261129000000` · `20261130000001`)
เปิด/ปิดทั้งโรงงานด้วย `station_photo_settings.enabled_at` (`set_station_photos_enabled` · owner) · **ใช้เฉพาะรอบสถานีที่กดเริ่มหลังเปิดใช้** (`private.photo_gate_on`: ตัวอย่าง/ผลิตจริง · กดเริ่มแล้ว · ไม่ใช่สถานี `outside`) · สถานีที่ต้องตรวจชิ้นแรก = `stations.first_piece_check` (ตั้งต้น: print · press · dtf_press · cut · emb · screen) · `finish_station` ปฏิเสธผ่าน `missing_substeps` (ทุกสถานี รวมเย็บและงานแก้): "ถ่ายรูปชิ้นแรกส่งให้แอดมินอนุมัติก่อน" / "รูปชิ้นแรกรอแอดมินอนุมัติ" / "ชิ้นแรกไม่ผ่าน (เหตุผล) แก้แล้วถ่ายรูปชิ้นแรกส่งใหม่" / "ถ่ายรูปงานเสร็จอย่างน้อย 1 รูป" · งานที่แบ่งนับรูปของงานต้นทางก่อนแบ่ง (`private.visit_checks`) · ตาราง `station_checks` (`kind` first_piece / finish · `status` pending / approved / rejected / recorded) เขียนผ่านฟังก์ชันเท่านั้น
**ตรวจกลางก่อนส่งรูป** (`private.station_photo_job`): งานต้องอยู่สถานี `p_station` (ไม่ตรง = "งานนี้ไปอยู่สถานีอื่นแล้ว") · QC "ฝ่าย QC ส่งรูปได้เฉพาะสถานี QC + Packing" · พักอยู่ "งานนี้พักอยู่ กด "แก้แล้ว" ก่อน" · ยังไม่เริ่ม "กด "เริ่ม" ก่อนถ่ายรูป" · รอบนี้ไม่ใช้รูป "รอบนี้ไม่ต้องส่งรูป กด "เสร็จ" ได้เลย" · รูป 1–6 รูปต่อครั้ง ต้องอยู่โฟลเดอร์ `โฟลเดอร์งาน/สถานี/รอบ/` และอัปโหลดเสร็จจริง · รูปที่เคยส่งในรายการใดแล้วใช้ซ้ำไม่ได้ "มีรูปที่เคยส่งไปแล้ว ให้ถ่ายรูปใหม่" (`20261130000001`)
| ฟังก์ชัน | อาร์กิวเมนต์ | ใครเรียก | ทำอะไร / ปฏิเสธเมื่อ |
|---|---|---|---|
| `submit_first_piece` | `p_job, p_station, p_photos text[], p_note = null` → `bigint` | production · supervisor · staff (สถานีที่จับคู่) · qc (QC + Packing) · owner | ส่งรูปชิ้นแรกรออนุมัติ (`pending`) · event `first_piece_sent` (`resend`) · กล่องจดหมาย `first_piece_pending` → admin · manager · ส่งใหม่ได้หลังไม่ผ่าน · ปฏิเสธ: ตรวจกลาง, "สถานีนี้ไม่ต้องส่งรูปชิ้นแรก ถ่ายรูปงานเสร็จได้เลย", "ส่งรูปชิ้นแรกไปแล้ว รอแอดมินอนุมัติ", ชิ้นแรกผ่านแล้ว |
| `decide_first_piece` | `p_check bigint, p_approve boolean, p_reason = null` | admin · manager · owner | ผ่าน / ไม่ผ่าน (ต้องมีเหตุผล "ใส่เหตุผลที่ไม่ผ่าน ให้หน้างานรู้ว่าต้องแก้อะไร") · event `first_piece_ok` / `first_piece_rejected` · ไม่ผ่าน → กล่องจดหมาย `first_piece_rejected` → supervisor · staff · production · ตัดสินได้เมื่อยังมีงานในครอบครัว (รวมส่วนที่แบ่ง) อยู่ที่สถานีและรอบนั้น · ปฏิเสธ: ไม่พบรายการ, ตัดสินไปแล้ว, งานยกเลิก, งานออกจากสถานีแล้ว · `20261130000001`: งานต้องรอ/ทำ/พักอยู่และรอบนั้นยังต้องส่งรูป · ระบบรูปปิดแล้ว "เจ้าของปิดระบบรูปยืนยันงานแล้ว ไม่ต้องตัดสินรูปนี้" · ส่งออกข้างนอกแล้ว "งานนี้ส่งออกข้างนอกแล้ว ไม่ต้องตัดสินรูปนี้" · `20261204000000`: ล็อกงานต้นทางก่อน แล้วทุกส่วนที่แบ่ง (ลำดับเดียวกับ `revise_job_spec`) |
| `add_finish_photos` | `p_job, p_station, p_photos text[]` → `bigint` | เหมือน `submit_first_piece` | บันทึกรูปงานเสร็จ (`recorded` · ส่งได้หลายครั้ง) · event `finish_photo` · ปฏิเสธ: ตรวจกลาง, ชิ้นแรกยังไม่ผ่าน (ข้อความเดียวกับ `missing_substeps`) · `20261130000001`: ผู้ส่งเดิมส่งรูปชุดเดิมซ้ำ (เน็ตหลุด) = คืนรายการเดิม ไม่ error |
| `set_station_photos_enabled` | `p_on, p_remind_minutes = null` | owner | เปิด = `enabled_at` เป็นตอนนี้ (เปิดอยู่แล้วคงเวลาเดิม) · ปิด = null · `remind_minutes` 5–240 (ค่าเริ่ม 15) |
| `station_photo_flags` | — → `job_id, station_code, needs_first_piece, first_piece, first_piece_id, reject_reason, first_piece_at, finish_photos, visit, folder, remind_minutes` | ทุกบทบาทที่ใช้งานอยู่ | งานที่อยู่สถานี (รอ/ทำ/พัก) ที่รอบนี้ต้องส่งรูป · `first_piece` = สถานะรูปชิ้นแรกล่าสุด · `finish_photos` = จำนวนรูปงานเสร็จ · `folder` = โฟลเดอร์งานสำหรับอัปโหลด |

**อัปโหลด/เปิดรูป**: `private.check_file_upload` ชนิด `station_photos` (R2 · ปิด R2 = bucket `station_photos` ใน Supabase Storage ใช้ policy เดียวกัน): production · supervisor · staff · qc · owner · JPG ≤ 20 MB · `20261130000001` (`private.station_photo_upload_error`): path ต้องเป็นของงานที่**กำลังทำ**ที่สถานีและรอบนั้น และรอบนั้นต้องส่งรูป "รูปนี้ไม่ใช่ของงานที่กำลังทำที่สถานีนี้ ให้กด "เริ่ม" แล้วถ่ายรูปจากหน้างานนี้" · QC เฉพาะ QC + Packing · staff เฉพาะสถานีที่จับคู่ · supervisor เฉพาะเฟสตัวเอง · `file_read_allowed('station_photos', …)`: รูปที่อยู่ใน `station_checks` หรือที่ตัวเองอัปโหลด · staff ที่ยังไม่จับคู่สถานีเปิดไม่ได้
**เตือนรออนุมัติ**: `first_piece_late` → manager · production เมื่อรูปชิ้นแรกรอเกิน `remind_minutes` (`private.first_piece_scan` ใน `inbox_scan` และ cron)

## เวลาผลิตทั้งงาน (กฎข้อ 10 · `20261201000000` · `20261203000000`)
แทนเวลามาตรฐานรายสถานี/ช่วงเดิม (ลบ `private.sla_state`, `sla_for_qty`, `segment_of`, `hold_days`, `requeue_wait_days`, `first_piece_wait_days`)
- `private.lead_days(จำนวน)`: ต่ำกว่า 500 = **10** · 500–999 = **15** · 1,000 ขึ้นไป = **20** วันทำงาน
- นับจันทร์–เสาร์ (ข้ามเฉพาะวันอาทิตย์) เวลาไทย · วันรับงาน (`created_at`) = วันที่ 1 · รับวันอาทิตย์ = วันที่ 1 เป็นวันจันทร์ · ไม่หักเวลาพัก/รอคิว/งานแก้ · นับรวมช่วงขึ้นตัวอย่าง
- `private.lead_state` (= `job_live.sla`): `lead_due` = วันทำงานที่ N · `lead_warn_on` = วันทำงานที่ ⌈N × 0.8⌉ (8 / 12 / 16) · `lead_warn` = วันนี้ ≥ วันเตือน (ส้ม) · `lead_over` = วันนี้ > วันครบ (แดง) · `lead_used` = วันที่ใช้ไป (งานเสร็จนับถึงวันที่เสร็จ) · `lead_reported` = มี `delay_reports` (รวมงานต้นทางก่อนแบ่ง) ที่ส่งตั้งแต่วันเตือน
- เลยวันครบแล้วยังไม่รายงาน → กล่องจดหมาย `sla_over` "เกินเวลาผลิต …" (ครั้งเดียวต่องาน · production · admin · manager) + `finish_station` ที่สถานีสุดท้ายของผลิตจริงปฏิเสธ
- งาน Develop / งานยกเลิก = ไม่มีเวลาผลิต (`{}`)
- **งานที่แบ่ง**: ใช้วันรับงานของงานแม่ต้นทาง · จำนวน = ยอดรวมทั้งครอบครัว (ถ้ามากกว่าจำนวนงานนี้) → แบ่งแล้วกำหนดไม่เปลี่ยน · `20261203000000`: ยอดรวมนับส่วนที่ยกเลิกด้วย → ยกเลิกบางส่วนแล้วกำหนดของส่วนที่เหลือไม่หด

## กันพิมพ์ผิด (trigger)
- `jobs.qty` เกิน 100,000 → "จำนวน … มากเกินไป ตรวจว่าพิมพ์ตัวเลขถูกไหม (ไม่เกิน 100,000)" (`jobs_qty_cap` · `20261130000001`)
- ปีนอก ค.ศ. 2000–2399 (พิมพ์ปี พ.ศ. ลงช่องวันที่) → "ปี … ไม่ถูกต้อง · ระบบใช้ปี ค.ศ. (พ.ศ. 2569 = ค.ศ. 2026) เลือกวันจากปฏิทินใหม่" (`private.guard_ce_year` · `20261201000001`) · ช่อง: `jobs.due_date`, `jobs.dtf_film_eta`, `sample_results.customer_confirmed_at`, `delay_reports.new_eta`, `sewing_machines.repair_eta`, `machine_status_log.repair_eta`, `machine_bookings.starts_at` / `ends_at`, `outsource_runs.arrive_at` / `back_at` · `20261202000000`: ตอนแก้แถว ตรวจเฉพาะช่องที่เปลี่ยนจริง · `20261204000000`: `infinity` / `-infinity` / ปี BC → "วันที่ไม่ถูกต้อง (…) · เลือกวันจากปฏิทินใหม่"
- กล่องจดหมาย `film_late` / `due_soon` แสดงวันที่เป็น พ.ศ. (`private.thai_date` · `20261201000001`)

## อ่านข้อมูล (RLS: ทุกคนที่ล็อกอินอ่านงานได้)
| ที่ | ใช้ทำ |
|---|---|
| `job_live` (view) | `jobs` + `current_station`, `hold_reason`, `qc_passed`, `sla` (jsonb · ตั้งแต่ `20261201000000` = เวลาผลิตทั้งงาน: `lead_qty, lead_days, lead_start, lead_due, lead_warn_on, lead_used, lead_warn, lead_over, lead_reported`) |
| `station_visits` (view) | งาน × สถานี × รอบ: `started_at`, `done_at`, `rework` · หน้าเว็บหักช่วงพักเองจาก events (`app/src/data/history.ts`) |
| `events`, `qc_results`, `sample_results`, `issues`, `delay_reports` | ไทม์ไลน์และรายละเอียด |
| `confirmation_drafts` | ใบยืนยันร่าง · **อ่านได้เฉพาะ admin / manager / owner** |
| `confirmation_acks` | สถานีที่รับทราบใบแก้ (`event_id` ของ `spec_revised` × สถานี · `20261130000000`) |
| `station_checks`, `station_photo_settings` | รูปชิ้นแรก/รูปงานเสร็จ และการตั้งค่าระบบรูป (`20261129000000`) · เขียนผ่านฟังก์ชันเท่านั้น |
| `stations` (`first_piece_check`), `routes`, `route_stations`, `reason_codes`, `machine_types` (`shared`), `sewing_machines`, `product_machine_needs`, `inbox_settings` | ตั้งค่า · owner แก้ตรงได้ตาม RLS (หน้าตั้งค่า) |
| `machine_assignments` (`released_at` null = ใช้อยู่), `machine_bookings`, `machine_status_log` | จักรเย็บ |
| `inbox_messages`, `inbox_reads` | กล่องจดหมาย · pg_cron ทุก 5 นาทีเรียก `private.inbox_scan_cron` (= `inbox_scan_all` + `first_piece_scan` · `20261129000000`) · หน้าเว็บเรียก `inbox_scan` ได้ผลเดียวกัน · ชนิดใหม่ `first_piece_pending` / `first_piece_late` / `first_piece_rejected` |

Index เพิ่มใน `20261128000000`: `jobs (mockup_path)` · `jobs (confirmation_pdf_path)` · GIN `jobs (spec -> 'mockups')` · `mockup_views (image_path)` (ให้ `file_read_allowed` ไม่ไล่อ่านทั้งตาราง) · `events (at desc)` · `events (payload->>'parent')` เฉพาะ `job_split_from`

Realtime ที่หน้าเว็บฟัง: `jobs`, `events`, `job_materials`, `issues`, `sewing_machines`, `machine_assignments`, `machine_bookings` (`app/src/data/useFactoryData.ts` · รวมการโหลดใน 250 ms)

## ไม่ใช้แล้ว (ยังอยู่ในฐานข้อมูล)
`check_material` / `job_materials` / `material_templates` (ไม่มีขั้นวัตถุดิบ) · `stations.substeps` (เหลือแค่ขั้น lock และ `inspect` ที่ระบบใช้) · บทบาท supervisor + `profiles.section` · เวลามาตรฐานรายสถานี/ช่วง `stations.sla_days` / `big_qty` / `big_sla_days` / `warn_pct`, `sla_segments`, `delay_reports.segment_code` (ใช้เวลาผลิตทั้งงานแทน · `20261201000000`)
