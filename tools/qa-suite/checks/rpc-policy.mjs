// ตารางสิทธิ์ RPC ใน schema public · gate = อาร์กิวเมนต์ของ private.require_role ตัวแรกในฟังก์ชัน (ต้องตรงกับ SQL)
// ไม่มี require_role: active = ทุกบัญชีที่เปิดอยู่ · job = ตรวจบทบาท/สถานีหลังหางาน · upload = ตรวจด้วยใบรับรองไฟล์
export const RPC_POLICY = {
  save_confirmation_draft: { gate: ['admin'] },
  cancel_confirmation_draft: { gate: ['admin'] },
  receive_job: { gate: ['admin'] },
  attach_confirmation_pdf: { gate: ['admin'] },
  set_customer_signature: { gate: ['admin'] },
  job_customer_signature: { scope: 'active' },
  revise_job_spec: { gate: ['admin'] },
  ack_confirmation_revision: { gate: ['supervisor', 'qc'], station: true },
  confirmation_revision_flags: { scope: 'active' },
  ack_mockup_sheet: { gate: ['production', 'supervisor', 'qc'] },

  set_job_materials: { gate: ['admin'] },
  add_job_material: { gate: ['admin'] },
  set_material_eta: { gate: ['admin'] },
  check_material: { gate: ['admin'] },
  add_material_photos: { gate: ['admin'] },
  remove_material_photo: { gate: ['admin'] },
  release_job: { gate: ['admin'] },

  move_job_ahead: { gate: ['supervisor', 'manager'] },
  start_in_queue: { gate: ['supervisor', 'qc'], station: true },
  note_queue_skip: { gate: ['supervisor', 'qc'], station: true },
  add_vendor: { gate: ['admin'] },
  send_out: { gate: ['admin'] },
  forward_out: { gate: ['admin'] },
  receive_back: { gate: ['admin'] },
  update_out_plan: { gate: ['admin'] },
  split_job: { gate: ['admin'] },
  cancel_job: { gate: ['manager'] },
  mark_delivered: { gate: ['admin'] },
  undo_delivery: { gate: ['admin'] },

  start_station: { gate: ['supervisor', 'qc'], station: true },
  finish_station: { gate: ['supervisor', 'qc'], station: true },
  open_issue: { gate: ['supervisor', 'qc', 'admin', 'production'], station: true },
  close_issue: { gate: ['supervisor', 'production', 'manager'] },
  job_sla_flags: { scope: 'active' },
  submit_delay_report: { gate: ['supervisor', 'qc', 'admin', 'production'], station: true },
  correct_event: { gate: ['supervisor'] },
  complete_substep: { gate: ['supervisor', 'qc'], station: true },
  record_sample_result: { gate: ['admin'] },
  order_film: { gate: ['admin'] },
  receive_film: { gate: ['admin'] },

  start_sewing: { scope: 'job' },
  finish_sewing: { scope: 'job' },
  report_sewing_issue: { scope: 'job' },
  resume_sewing: { scope: 'job' },
  book_machines: { gate: ['production'] },
  cancel_booking: { gate: ['production'] },
  assign_machines: { scope: 'job' },
  release_machines: { scope: 'job' },
  set_machine_status: { scope: 'job' },
  set_repair_eta: { gate: ['production'] },
  set_job_machines: { scope: 'job' },
  update_sew_count: { gate: ['supervisor'] },

  record_qc: { gate: ['supervisor', 'qc'], station: true },
  send_rework: { gate: ['supervisor', 'qc'], station: true },

  submit_first_piece: { scope: 'job' },
  add_finish_photos: { scope: 'job' },
  decide_first_piece: { gate: ['admin', 'manager'] },
  set_station_photos_enabled: { gate: ['owner'] },
  station_photo_flags: { scope: 'active' },

  start_mockup_sheet: { gate: ['admin'] },
  submit_mockup_sheet: { gate: ['admin'] },
  save_mockup_draft: { gate: ['admin'] },
  discard_mockup_draft: { gate: ['admin'] },
  return_mockup_sheet: { gate: ['manager', 'production'] },
  approve_mockup_sheet: { gate: ['admin', 'manager', 'production'] },
  set_job_mockup: { gate: ['admin'] },
  file_read_allowed: { scope: 'active' },
  file_upload_allowed: { scope: 'upload' },
  record_file_upload: { scope: 'upload' },
  inbox_scan: { scope: 'active' },
  inbox_mark_read: { scope: 'active' },
  inbox_mark_all_read: { scope: 'active' },
  inbox_unread_count: { scope: 'active' },
  ack_review: { gate: ['manager'] },
  staff_names: { scope: 'active' },
  owner_list_users: { gate: ['owner'] },
}

export const PROBE_ACCOUNTS = ['owner', 'manager', 'admin1', 'prod1', 'sup1', 'sup2', 'qc', 'staff_multi', 'staff_single', 'staff_qc', 'staff_empty', 'disabled', 'norole', 'anon']

// เลียนแบบ private.require_role: production ผ่านด่าน supervisor · staff ผ่านด่าน qc · owner ผ่านทุกด่าน
export function passesGate(account, gate) {
  if (!account.active || !account.role) return false
  const r = account.role
  if (r === 'owner') return true
  if (r === 'production' && gate.includes('supervisor') && !gate.includes('production')) return true
  if (r === 'staff' && gate.includes('qc')) return true
  return gate.includes(r)
}

export function firstGate(prosrc) {
  const m = /private\.require_role\(([^)]*)\)/.exec(prosrc)
  if (!m) return null
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1])
}
