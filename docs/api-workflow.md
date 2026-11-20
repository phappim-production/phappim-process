# API ของ workflow (ฟังก์ชันในฐานข้อมูล)

> อัปเดต **17 พ.ย. 2569 ค่ำ** · migration ล่าสุด `20261119230000_confirmation_drafts` · ผังภาพทั้งระบบ: https://claude.ai/artifact/8BX5yhE37UUUWH6GzQgrym
> หน้าเว็บเรียกด้วย `rpc('ชื่อฟังก์ชัน', { p_...: ... })` (`app/src/data/useFactoryData.ts`) · ข้อมูลงาน**เขียนตรงเข้าตารางไม่ได้** (RLS) ต้องผ่านฟังก์ชันเหล่านี้เท่านั้น
> ทุกฟังก์ชันตรวจบทบาทด้วย `private.require_role(...)` (owner ผ่านเสมอ · **production ผ่านทุกที่ที่เขียน supervisor**) · ทุกการเปลี่ยนสถานะบันทึก 1 แถวใน `events` (แก้/ลบไม่ได้) · ข้อความ error เป็นภาษาไทย แสดงผู้ใช้ได้ตรงๆ
> บทบาทที่ใช้จริง: **owner · admin · production · qc · manager** (supervisor เลิกใช้แล้ว · ระบบยังรองรับ)

## ลำดับของงาน
```
[ฟอร์ม] save_confirmation_draft (ไม่บังคับ) ─┐
receive_job ──────────────────────────────────┴→ needs_sample?
   ├─ ขึ้นตัวอย่าง → [sample] สถานีตามเส้นทาง → [sample_review] record_sample_result
   │                    ไม่ผ่าน → [sample] รอบ +1        ผ่าน → [production] สถานีแรก
   └─ ไม่ขึ้น      → [production] สถานีแรกทันที (ไม่มีขั้นวัตถุดิบตั้งแต่ 20261119190000)
แต่ละสถานี: queued → start_station → doing → finish_station → สถานีถัดไป queued … → [done]
เย็บ:       queued → start_sewing (จ่ายจักรประจำไลน์) → doing → finish_sewing → QC
พักงาน:     open_issue → hold → close_issue (เย็บ: report_sewing_issue p_pause → resume_sewing)
QC ส่งแก้:  send_rework → สถานีต้นเหตุ (is_rework) → finish_station → กลับ QC ทันที
PDF:        แนบตอน receive_job หรือ attach_confirmation_pdf ทีหลัง
```

## รับงาน + ใบยืนยัน
| ฟังก์ชัน | อาร์กิวเมนต์ | ใครเรียก | ทำอะไร / ปฏิเสธเมื่อ |
|---|---|---|---|
| `save_confirmation_draft` | `p_data jsonb` (state ทั้งฟอร์ม · ต้องมี `h.doc_no`) → `uuid` | admin · owner | บันทึก/แก้ใบยืนยันร่างตามเลขที่ใบ (`confirmation_drafts`) · ตัด `imgs` ทิ้ง (ห้ามเก็บรูปในตาราง) · ปฏิเสธ: ไม่มีเลขที่ใบ, ข้อมูลไม่ใช่ใบยืนยัน, เลขนี้ส่งงานเข้าแล้ว · ใบที่ยกเลิกแล้วบันทึกใหม่ = กลับเป็นร่าง |
| `cancel_confirmation_draft` | `p_id` | admin · owner | ยกเลิกใบร่าง · ปฏิเสธ: ส่งงานเข้าแล้ว / ยกเลิกแล้ว |
| `receive_job` | `p_confirmation_no, p_customer_name, p_job_name, p_product_type_code, p_qty, p_unit, p_due_date, p_route_code, p_confirmation_pdf_path` (**ว่างได้**) · ไม่บังคับ `p_spare_qty, p_confirmation_rev, p_spec, p_needs_sample` → `uuid` | **admin · owner** (production/supervisor = "แอดมินเป็นคนส่งงานเข้าโรงงาน") | สร้างงาน → ปล่อยเข้าสถานีแรก/ขึ้นตัวอย่างทันที · ใบร่างเลขเดียวกัน → `received` + `job_id` · ปฏิเสธ: เลขซ้ำ, ไม่เลือกขึ้นตัวอย่าง, จำนวน ≤ 0, ไม่มีกำหนดส่ง, PDF ที่แนบไม่ใช่ .pdf / ยังไม่อัปโหลดจริง |
| `attach_confirmation_pdf` | `p_job, p_path` | admin · owner | แนบ/เปลี่ยน PDF ที่ลูกค้าเซ็น · event `confirmation_pdf` (`replaced`) · ปฏิเสธ: งานยกเลิก, ไม่ใช่ PDF / ยังไม่อัปโหลด |

ฟอร์ม `/confirmation` (ไฟล์ `production-confirmation.html` · build คัดลอกขึ้นเว็บ) ไม่มี key: กด "บันทึกเข้าระบบ" → `localStorage['pp142.confirmation.outbox']` → เปิด `#/board?confirmation=save` → `ConfirmationOutbox` เรียก `save_confirmation_draft` · หน้ารับงานกด "แก้ใบนี้ในฟอร์ม" → `localStorage['pp142.confirmation.inbox']` → ฟอร์มโหลดใบ (`app/src/data/confirmationDrafts.ts`)

## คิวงาน (`20261120000000` · `20261120010000`)
คิว = `jobs.queue_seq` จำนวนเต็มห่างกัน 1024 ตามลำดับรับเข้า (ห้ามซ้ำ · unique) · หน้าเว็บเรียงทุกรายการตามนี้ ไม่เรียงตามกำหนดส่ง
| ฟังก์ชัน | อาร์กิวเมนต์ | ใครเรียก | ทำอะไร / ปฏิเสธเมื่อ |
|---|---|---|---|
| `move_job_ahead` | `p_job, p_before, p_reason` | production · manager · owner | แทรกงานด่วนก่อน `p_before` · ทีละคำขอ (advisory lock) · ช่องว่างหมด = จัดเลขใหม่ทั้งคิว (`private.queue_renumber`) · event `queue_insert` · ปฏิเสธ: ไม่มีเหตุผล, งานเดียวกัน, อยู่ก่อนแล้ว, เสร็จ/ยกเลิก |
| `start_in_queue` | `p_job, p_reason` → `text[]` | production · qc (เฉพาะ QC+Packing) · owner | **ปุ่มเริ่มในหน้าคิวสถานีใช้ตัวนี้** · ไม่ใช่คิวแรกต้องมีเหตุผล (event `queue_skip`) · แล้วเรียก `start_station` / `start_sewing` ในธุรกรรมเดียว (เริ่มไม่ได้ = ไม่บันทึกอะไร) · เย็บคืนรหัสจักร |
| `note_queue_skip` | `p_job, p_reason` → `boolean` | production · qc (เฉพาะ QC+Packing) · owner | ตรวจ/บันทึกข้ามคิวอย่างเดียว (หน้าเว็บไม่ใช้แล้ว) |

## ส่งงานออกบริษัทภายนอก + แบ่งงาน (`20261120020000`)
สถานีที่ส่งออกได้: พิมพ์ · รีด · ตัด · เย็บ · ปัก (ติดกันหลายสถานีในรอบเดียว) · งานข้างนอก `station_status = 'out'` · trigger `jobs_guard_outsourced` ห้ามปุ่มของโรงงานเปลี่ยนงานจนกว่าจะรับกลับ · ตาราง `vendors`, `outsource_runs` (อ่านได้ทุกคน · เขียนผ่านฟังก์ชันเท่านั้น)
| ฟังก์ชัน | อาร์กิวเมนต์ | ใครเรียก | ทำอะไร / ปฏิเสธเมื่อ |
|---|---|---|---|
| `add_vendor` | `p_name, p_stations text[], p_contact` → `bigint` | admin · owner | เพิ่ม/เปิดใช้บริษัท · ปฏิเสธ: ชื่อว่าง, งานที่รับไม่ใช่ 5 สถานี |
| `send_out` | `p_job, p_vendor, p_last_station, p_arrive_at, p_lead_days, p_back_at, p_note` → run id | admin · owner | งานรอเริ่ม (queued) ที่สถานีส่งออกได้ → บริษัททำถึง `p_last_station` · event `outsource_sent` · ปฏิเสธ: เริ่ม/พักแล้ว, อยู่ข้างนอกแล้ว, ข้ามสถานีที่ต้องทำในโรงงาน, ไม่อยู่ในเส้นทาง, กรอกกำหนดไม่ครบ / กลับก่อนถึง, งานแก้ส่งเกินสถานีต้นเหตุ |
| `forward_out` | `p_run, p_vendor, p_last_station, …` → run id | admin · owner | บ.A เสร็จ → บ.B ทำสถานีถัดไปโดยไม่ผ่านโรงงาน · event `outsource_forwarded` · ปฏิเสธ: บริษัทเดิม, งานแก้, ถัดไปทำในโรงงาน |
| `receive_back` | `p_run, p_note` | admin · owner | ของถึงโรงงาน → งานเข้าสถานีถัดไป (งานแก้ → QC) รอคิว · event `outsource_received` (`late`) |
| `update_out_plan` | `p_run, p_arrive_at, p_lead_days, p_back_at` | admin · owner | แก้กำหนด · event `outsource_plan` |
| `split_job` | `p_job, p_qty, p_request = null` → uuid งานใหม่ |  admin · owner | งานผลิตจริงที่รอเริ่ม (ไม่ใช่งานแก้/QC) แยก `p_qty` เป็นงาน `เลขเดิม-2` สถานีเดียวกัน คิวถัดไป · event `job_split` / `job_split_from` |
| `cancel_job` | `p_job, p_reason` | **manager** · owner | ยกเลิกงาน (ลูกค้ายกเลิกออเดอร์) → phase `cancelled` ล้างสถานี · คืนจักร · การจองที่กำลังใช้จบทันที / ในอนาคตยกเลิก · ปิดปัญหาที่ค้าง · event `job_cancelled` (เหตุผล สถานี สถานะเดิม) · กล่องจดหมาย `job_cancelled` ทุกฝ่าย · ย้อนกลับไม่ได้ · ปฏิเสธ: บทบาทอื่น, ไม่มีเหตุผล, เสร็จแล้ว, ยกเลิกแล้ว, อยู่บริษัทภายนอก (รับของกลับก่อน) |

## จัดส่ง (`20261120240000`)
| ฟังก์ชัน | พารามิเตอร์ | ใครเรียกได้ | ทำอะไร / ปฏิเสธเมื่อ |
|---|---|---|---|
| `mark_delivered` | `p_job, p_note = null` | admin · owner | งาน `done` → `delivered_at / delivered_by / delivery_note` · event `delivered` · ปฏิเสธ: ยังไม่เสร็จ, บันทึกแล้ว |
| `undo_delivery` | `p_job, p_reason` | admin · owner | ล้างข้อมูลจัดส่ง · event `delivery_undone` (เหตุผล + ข้อมูลเดิม) · ปฏิเสธ: ยังไม่ได้ส่ง, ไม่มีเหตุผล |

## สถานีทั่วไป
| ฟังก์ชัน | อาร์กิวเมนต์ | ใครเรียก | ทำอะไร / ปฏิเสธเมื่อ |
|---|---|---|---|
| `start_station` | `p_job` | production · qc (เฉพาะ QC+Packing) · owner | queued → doing · ปฏิเสธ: เริ่มแล้ว, พักอยู่, **รีดฟิล์มยังไม่ได้รับฟิล์ม/งาน DTG/ของสกรีน** · สถานีเย็บต้องใช้ `start_sewing` (trigger บังคับจักรครบ) |
| `finish_station` | `p_job, p_station = null` (`20261120070000`: สถานีที่หน้าจอเห็น · ไม่ตรงสถานีปัจจุบัน = ปฏิเสธ "งานนี้ไปอยู่สถานีอื่นแล้ว" · หน้าเว็บส่งเสมอ) | production · qc (เฉพาะ QC+Packing) · owner | ไม่บังคับขั้นย่อย (`20261119180000`) · ตรวจ: พักอยู่ → "กด แก้แล้ว ก่อน" · `missing_substeps` = เฉพาะขั้น lock + QC ผ่านครบจำนวน → "ยังกดเสร็จไม่ได้: QC ตรวจผ่าน 10/25 ชิ้น ยังไม่ครบ …" (`20261119200000`) · เกินเวลามาตรฐานยังไม่รายงาน → ปฏิเสธ · งานแก้เสร็จ → กลับ QC ทันที · สถานีสุดท้าย → `done` (ตัวอย่าง → `sample_review`) |
| `open_issue` | `p_job, p_reason` | production · qc · admin · owner | พักงาน (ต้องมีสาเหตุ) · event `hold` |
| `close_issue` | `p_job, p_note = null` | production · **manager** · owner (`20261120050000`) | แก้แล้ว กลับสถานะก่อนพัก · event `resume` · **แอดมิน / QC ถูกปฏิเสธ** "แจ้งผู้บริหารหรือฝ่ายผลิตให้กด …" (เจ้าของ 18 พ.ย.: แอดมินไม่มีหน้าที่แก้ปัญหาของสถานี) · งานเย็บใช้ `resume_sewing` (ฝ่ายผลิต) |
| `job_sla_flags` | — → `job_id, warn, over, need_report` | ทุกบทบาทที่ล็อกอิน (`20261120060000`) | อ่านอย่างเดียว · สถานะเวลามาตรฐานของงานผลิตที่กำลังทำ/พัก ให้การ์ดเป็นสีส้ม-แดง · ใช้ `private.sla_state` ตัวเดียวกับ `finish_station` |
| `submit_delay_report` | `p_job, p_reasons text[], p_detail, p_new_eta, p_need_help = null, p_request = null` | production · qc · admin · owner | รายงานปัญหา/ล่าช้า (ส่งล่วงหน้าได้) · รหัสต้องอยู่ใน `reason_codes` · วันเสร็จใหม่ต้องเป็นอนาคต |
| `correct_event` | `p_job, p_event_id, p_reason` | production · owner | "แจ้งว่ากดผิด" บันทึก event `correction` · **ไม่ย้อนสถานะงาน** |
| `complete_substep` | `p_job, p_key, p_value` | production · qc | ยังมีอยู่แต่หน้าเว็บไม่ใช้แล้ว |

## ตัวอย่าง + ฟิล์ม
| ฟังก์ชัน | อาร์กิวเมนต์ | ใครเรียก | ทำอะไร / ปฏิเสธเมื่อ |
|---|---|---|---|
| `record_sample_result` | `p_job, p_pass, p_note, p_customer_confirmed_at` | admin · owner | ผ่าน → ผลิตจริงสถานีแรก · ไม่ผ่าน (ต้องมี note) → ตัวอย่างรอบใหม่ + แจ้งเตือน |
| `order_film` | `p_job, p_eta` | admin · owner | บันทึกสั่ง + วันคาดว่าได้รับ · เส้นทางที่ไม่ใช้ฟิล์ม → "ไม่ต้องสั่งฟิล์ม" |
| `receive_film` | `p_job` | admin · owner | บันทึกได้รับ → ปลดล็อกสถานีรีดฟิล์ม · ทำได้ทุกช่วงของงาน |

**รหัสคำขอ `p_request`** (`20261120070000` · `private.rpc_requests`): หน้าเว็บสร้าง 1 รหัสต่อการกรอก 1 ครั้ง (`app/src/data/requestId.ts`) · ส่งรหัสเดิมซ้ำ = ไม่บันทึกซ้ำ คืนผลเดิม (`record_qc` · `split_job` คืนใบลูกเดิม · `submit_delay_report` คืนรายงานเดิม) · ไม่ส่ง = ทำงานแบบเดิม

## เย็บ + จักร
**จักรใช้ร่วม** (`machine_types.shared` · `20261119210000`/`220000`): ตอนนี้ = จักรลา · โพ้ง 4 เส้น · ติดกระดุม · เจาะรังดุม · ไม่จ่าย/ไม่จองให้งาน · เริ่มเย็บได้เมื่อตัวที่ใช้ได้ (`status='ready'`) ≥ จำนวนที่สินค้าต้องใช้ · owner สลับได้ที่ ตั้งค่า → จักรเย็บ → ชนิดจักร (trigger `machine_types_release_on_shared` ปล่อยจักรที่ผูก + ยกเลิกการจองที่ยังไม่เริ่ม)

| ฟังก์ชัน | อาร์กิวเมนต์ | ใครเรียก | ทำอะไร / ปฏิเสธเมื่อ |
|---|---|---|---|
| `start_sewing` | `p_job` → `text[]` รหัสจักรที่จ่าย | production · owner | จ่ายจักร**ประจำไลน์**ว่างครบตามสูตรสินค้า (จักรที่งานนี้จองไว้ก่อน) แล้วเริ่มสถานี · ปฏิเสธ: ยังไม่ถึงเย็บ, พักอยู่, สินค้าไม่มีสูตร, "จักรไม่ว่าง เริ่มเย็บไม่ได้: เข็มเดี่ยว ขาด 1 ตัว (SN-001 ใช้กับ SC…)", "โพ้ง 4 เส้น ใช้ได้ 1 ตัว ต้องใช้ 2 ตัว" · ไม่จำกัดจำนวนไลน์ (หัวหน้าหน้างานคุมเอง) |
| `finish_sewing` | `p_job` | production · owner | ยืนยันเย็บเสร็จครั้งเดียว → QC · คืนจักร + ช่วงจองที่เหลืออัตโนมัติ · ตรวจเวลามาตรฐาน |
| `report_sewing_issue` | `p_job, p_reason, p_pause = false` | production · owner | บันทึกปัญหาระหว่างเย็บ · `p_pause` = พักงาน (`open_issue`) |
| `resume_sewing` | `p_job` | production · owner | เย็บต่อ · จ่ายเฉพาะจักรประจำไลน์ที่ขาด (`machines_short` ไม่นับจักรใช้ร่วม) · **ไม่ตรวจจักรใช้ร่วม** (ตั้งใจ: ช่างเย็บตะเข็บอื่นต่อได้) |
| `book_machines` | `p_job, p_starts, p_ends` → `text[]` | **production เท่านั้น** · owner | จองเฉพาะจักรประจำไลน์ · กันทับด้วย exclusion constraint · ปฏิเสธ: ผ่านไปแล้ว, วันอาทิตย์, เกิน 14 วัน, จองไว้แล้ว, จักรไม่พอ (บอกตัวและงานที่จอง) |
| `cancel_booking` | `p_job` | production · owner | ยกเลิกช่วงที่ยังไม่เริ่ม · ช่วงที่กำลังใช้ตัดจบตอนนี้ |
| `assign_machines` / `release_machines` | `p_job, p_machine_codes` | production · owner | จ่าย/คืนจักรเอง (หน้าเว็บใช้ `start_sewing` แทน) |
| `set_machine_status` | `p_machine_code, p_status (ready/broken/off), p_note, p_repair_eta` | production · owner | แจ้งเสีย (ต้องมีอาการ + เวลาคาดซ่อมเสร็จ) / ซ่อมเสร็จ / ปิด · จักรประจำไลน์เสียระหว่างใช้ = คืนจากงาน + พักงานอัตโนมัติ · จักรใช้ร่วมเสียไม่พักงาน · แก้ `status` ตรงไม่ได้ (trigger) |
| `set_repair_eta` | `p_machine_code, p_repair_eta, p_note` | production · owner | เลื่อนเวลาคาดซ่อมเสร็จ (≤ 30 วัน) |

## QC
| ฟังก์ชัน | อาร์กิวเมนต์ | ใครเรียก | ทำอะไร / ปฏิเสธเมื่อ |
|---|---|---|---|
| `record_qc` | `p_job, p_passed, p_request = null` | qc · production · owner | เพิ่มยอดผ่าน (สะสม) · ยอดสะสมเกินจำนวนงานไม่ได้ (บอกว่ายังบันทึกได้อีกกี่ชิ้น) |
| `send_rework` | `p_job, p_qty, p_reason, p_source_station` | qc · production · owner | ส่งกลับแก้ (จำนวน + สาเหตุ + สถานีต้นเหตุก่อน QC) · จำนวนไม่เกินชิ้นที่ยังไม่ผ่าน (จำนวนงาน − ยอดผ่านสะสม) · งานแก้ที่เย็บต้องได้จักรใหม่ผ่าน `start_sewing` |

## เวลามาตรฐาน (กฎข้อ 10)
- วันทำงานจันทร์–เสาร์ (เวลาไทย) · หักเวลาพักงาน · งานแก้ไม่จับเวลา · นับเฉพาะผลิตจริง
- สถานี: `stations.sla_days` (+ `big_qty`/`big_sla_days` · null = ไม่จับ) — ตอนนี้ เย็บ 2 วัน (≤100 ตัว) · QC 1 วัน (≤100) · ช่วง: `sla_segments` พิมพ์→ตัด 3 วัน (700 ชิ้นขึ้นไป 5 วัน)
- ถึง `warn_pct` (80%) = ส้ม · เกิน = ต้องมี `delay_reports` ก่อนกดเสร็จ

## อ่านข้อมูล (RLS: ทุกคนที่ล็อกอินอ่านงานได้)
| ที่ | ใช้ทำ |
|---|---|
| `job_live` (view) | `jobs` + `current_station`, `hold_reason`, `qc_passed`, `sla` (jsonb) |
| `station_visits` (view) | งาน × สถานี × รอบ: `started_at`, `done_at`, `rework` · หน้าเว็บหักช่วงพักเองจาก events (`app/src/data/history.ts`) |
| `events`, `qc_results`, `sample_results`, `issues`, `delay_reports` | ไทม์ไลน์และรายละเอียด |
| `confirmation_drafts` | ใบยืนยันร่าง · **อ่านได้เฉพาะ admin / manager / owner** |
| `stations`, `routes`, `route_stations`, `sla_segments`, `reason_codes`, `machine_types` (`shared`), `sewing_machines`, `product_machine_needs`, `inbox_settings` | ตั้งค่า · owner แก้ตรงได้ตาม RLS (หน้าตั้งค่า) |
| `machine_assignments` (`released_at` null = ใช้อยู่), `machine_bookings`, `machine_status_log` | จักรเย็บ |
| `inbox_messages`, `inbox_reads` | กล่องจดหมาย · `inbox_scan` ทุก 5 นาที (pg_cron) |

Realtime ที่หน้าเว็บฟัง: `jobs`, `events`, `job_materials`, `issues`, `sewing_machines`, `machine_assignments`, `machine_bookings` (`app/src/data/useFactoryData.ts` · รวมการโหลดใน 250 ms)

## ไม่ใช้แล้ว (ยังอยู่ในฐานข้อมูล)
`check_material` / `job_materials` / `material_templates` (ไม่มีขั้นวัตถุดิบ) · `stations.substeps` (เหลือแค่ขั้น lock และ `inspect` ที่ระบบใช้) · บทบาท supervisor + `profiles.section`
