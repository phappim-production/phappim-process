// ใส่บั๊กลงฐานจำลองทีละตัว (หลัง reset ทุกครั้ง) เพื่อพิสูจน์ว่าชุดทดสอบจับได้ด้วยข้อตรวจที่ตรงกับบั๊กนั้น
async function rewrite(client, name, from, to) {
  const [schema, fn] = name.split('.')
  const defs = await client.sql(`
    select pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = $1 and p.proname = $2`, [schema, fn])
  const hit = defs.filter(d => d.def.includes(from))
  if (!hit.length) throw new Error(`mutation: ไม่พบข้อความใน ${name}: ${from}`)
  for (const { def } of hit) await client.sql(def.split(from).join(to))
}

export const MUTATIONS = {
  'gate-release-staff': {
    label: 'พนักงานกดปล่อยงานเข้าไลน์ได้',
    part: 'security', expect: /E3: ด่านบทบาทของ release_job|E5: staff\w* ผ่านด่าน release_job/,
    apply: c => rewrite(c, 'public.release_job', "require_role('admin')", "require_role('admin', 'qc')"),
  },
  'station-check-off': {
    label: 'พนักงานกดงานที่สถานีที่ไม่ได้จับคู่ได้',
    part: 'security', expect: /E6: staff_(qc|empty)/,
    apply: c => rewrite(c, 'private.lock_job', "if private.my_role() = 'staff' then", 'if false then'),
  },
  'rls-open-jobs': {
    label: 'client แก้ตาราง jobs ตรงได้',
    part: 'security', expect: /E8: ตาราง jobs|E10: .* jobs/,
    apply: c => c.sql('create policy qa_open_update on public.jobs for update to authenticated using (true) with check (true)'),
  },
  'release-no-photo': {
    label: 'ปล่อยเข้าไลน์ได้โดยไม่มีรูปวัตถุดิบ',
    part: 'sim', expect: /ปล่อยก่อนมีรูป ควรถูกปฏิเสธ|B8: ปล่อยเข้าไลน์/,
    apply: c => rewrite(c, 'public.release_job', 'if not exists (select 1 from public.job_material_photos where job_id = p_job) then', 'if false then'),
  },
  'outsource-from-materials-off': {
    label: 'ส่งออกบริษัทภายนอกจากรอผลิตไม่ได้',
    part: 'sim', expect: /send_out จากรอผลิต/,
    apply: c => rewrite(c, 'public.send_out', "if j.phase = 'materials' then", 'if false then'),
  },
  'service-guard-off': {
    label: 'ใบงานบริการใช้เส้นทางอะไรก็ได้',
    part: 'sim', expect: /ใบงานบริการใช้เส้นทางผิด ควรถูกปฏิเสธ/,
    apply: c => c.sql('drop trigger jobs_guard_service on public.jobs'),
  },
  'lead-days-sql': {
    label: 'เวลาผลิตในฐานไม่ตรงกับหน้าเว็บ (500+ ยังเป็น 10 วัน)',
    part: 'sim', expect: /B5: เวลาผลิต/,
    apply: c => c.sql(`create or replace function private.lead_days(p_qty int) returns int language sql immutable set search_path = '' as $$ select case when p_qty >= 1000 then 20 else 10 end $$`),
  },
  'sla-inbox-off': {
    label: 'เกินเวลาผลิตแล้วไม่มีจดหมายเตือน',
    part: 'sim', expect: /B11: เกินเวลาผลิต/, days: 20,
    apply: c => rewrite(c, 'private.inbox_scan_all', "if private.inbox_emit('sla_over'", "if false and private.inbox_emit('sla_over'"),
  },
  'materials-inbox-off': {
    label: 'รอผลิตนานแล้วไม่มีจดหมายเตือน',
    part: 'sim', expect: /B11: รอผลิตเกิน 2 วันทำงาน/, days: 12,
    apply: c => rewrite(c, 'private.inbox_scan_all', "if private.inbox_emit('materials_late'", "if false and private.inbox_emit('materials_late'"),
  },
}

export async function applyMutation(client, id) {
  const m = MUTATIONS[id]
  if (!m) throw new Error(`ไม่รู้จัก mutation ${id} (มี ${Object.keys(MUTATIONS).join(', ')})`)
  await m.apply(client)
}
