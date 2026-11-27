// ส่วน B: ข้อตรวจข้อมูลหลังทุกการกระทำในส่วนจำลอง + self-test ว่าแต่ละข้อจับข้อมูลผิดได้จริง
// B1 ไม่รวมเวลา (at) เพราะการเลื่อนวันจำลองถอยเวลาทุกแถว
import { createHash } from 'node:crypto'
import { leadDaysFor, leadDayN, LEAD_WARN_RATIO } from '../lib/lead.mjs'
import { thaiToday, workDays } from '../lib/clock.mjs'

export function createInvariantState() {
  return { eventHashes: new Map() }
}

const hashEvent = row => createHash('sha256')
  .update(JSON.stringify([row.id, row.job_id, row.type, row.by, row.payload]))
  .digest('hex')

const thaiDayOf = ts => thaiToday(new Date(ts))

export async function checkInvariants(client, state = createInvariantState(), { afterScan = false } = {}) {
  const errors = []

  // B1 events ห้ามแก้/ลบ · ทุกงานมี event รับงาน · งานที่เปลี่ยนสถานะต้องมี event ใหม่
  const events = await client.sql('select id, job_id, type, by, payload, at from public.events order by id')
  const ids = new Set(events.map(e => e.id))
  for (const id of state.eventHashes.keys()) if (!ids.has(id)) errors.push(`B1: event id=${id} หายไป`)
  for (const e of events) {
    const h = hashEvent(e)
    const prev = state.eventHashes.get(e.id)
    if (prev && prev !== h) errors.push(`B1: event id=${e.id} ถูกแก้`)
    state.eventHashes.set(e.id, h)
  }
  const noReceive = await client.sql(`
    select j.confirmation_no from public.jobs j
    where not exists (select 1 from public.events e where e.job_id = j.id)`)
  if (noReceive.length) errors.push(`B1: งานไม่มี event เลย: ${noReceive.map(r => r.confirmation_no).slice(0, 3).join(', ')}`)

  // B2 phase / สถานี / สถานะสถานีสอดคล้องกัน
  const badPhase = await client.sql(`
    select j.confirmation_no, j.phase, j.station_seq, j.station_status
    from public.jobs j
    where (j.phase = 'materials' and (j.station_seq <> 0 or j.station_status is not null))
       or (j.phase in ('done', 'cancelled') and j.station_status in ('queued', 'doing', 'hold', 'out'))
       or (j.phase in ('production', 'sample') and (j.station_status is null or j.station_status not in ('queued', 'doing', 'hold', 'out')))
       or (j.phase in ('production', 'sample') and not exists (
            select 1 from public.route_stations rs where rs.route_code = j.route_code and rs.seq = j.station_seq))
       or (j.phase = 'done' and j.finished_at is null)
       or (j.delivered_at is not null and j.phase <> 'done')`)
  if (badPhase.length) errors.push(`B2: สถานะงานขัดกัน: ${JSON.stringify(badPhase.slice(0, 3))}`)

  // B3 คิว: งานที่ยังไม่จบต้องมีลำดับคิวไม่ซ้ำ
  const dupQueue = await client.sql(`
    select queue_seq, count(*)::int c from public.jobs
    where phase not in ('done', 'cancelled') group by queue_seq having count(*) > 1 or queue_seq is null`)
  if (dupQueue.length) errors.push(`B3: queue_seq ซ้ำ/ว่าง: ${JSON.stringify(dupQueue)}`)

  // B4 จำนวน: 1–100,000 · QC ผ่านไม่เกินจำนวนงาน
  const badQty = await client.sql(`
    select j.confirmation_no, j.qty, (select sum(q.passed) from public.qc_results q where q.job_id = j.id) passed
    from public.jobs j
    where j.qty <= 0 or j.qty > 100000
       or (select coalesce(sum(q.passed), 0) from public.qc_results q where q.job_id = j.id) > j.qty`)
  if (badQty.length) errors.push(`B4: จำนวนงานผิด: ${JSON.stringify(badQty.slice(0, 3))}`)

  // B5 เวลาผลิตในฐาน (job_sla_flags) ตรงกับกฎฝั่งเว็บ (proto/leadTime.ts)
  const slaRes = await client.rpc('admin1', 'job_sla_flags')
  if (!slaRes.ok) errors.push(`B5: job_sla_flags เรียกไม่ได้: ${JSON.stringify(slaRes.body)}`)
  else {
    const today = thaiToday()
    const flags = new Map(slaRes.body.map(f => [f.job_id, f]))
    const jobs = await client.sql(`
      select j.id, j.confirmation_no, j.qty, j.phase, j.develop, j.created_at,
        (select min(e.at) from public.events e where e.job_id = j.id and e.type = 'released' and e.payload ->> 'manual' = 'true') released_at,
        (select e.payload ->> 'parent' from public.events e where e.job_id = j.id and e.type = 'job_split_from' limit 1) parent_no
      from public.jobs j`)
    const byNo = new Map(jobs.map(j => [j.confirmation_no, j]))
    const childrenOf = new Map()
    for (const j of jobs) if (j.parent_no) {
      if (!childrenOf.has(j.parent_no)) childrenOf.set(j.parent_no, [])
      childrenOf.get(j.parent_no).push(j)
    }
    const rootOf = j => { let r = j; while (r.parent_no && byNo.has(r.parent_no)) r = byNo.get(r.parent_no); return r }
    const familyQty = root => {
      let sum = 0
      const walk = j => { sum += Number(j.qty); for (const c of childrenOf.get(j.confirmation_no) ?? []) walk(c) }
      walk(root)
      return sum
    }
    for (const j of jobs) {
      if (['done', 'cancelled', 'materials'].includes(j.phase) || j.develop) {
        if (flags.has(j.id) && j.phase !== 'materials') errors.push(`B5: งาน ${j.confirmation_no} (${j.phase}) ไม่ควรมีเวลาผลิต`)
        continue
      }
      const f = flags.get(j.id)
      if (!f) { errors.push(`B5: งาน ${j.confirmation_no} ไม่มีเวลาผลิตจากฐาน`); continue }
      const root = rootOf(j)
      const start = thaiDayOf(root.released_at ?? root.created_at)
      const days = leadDaysFor(Math.max(familyQty(root), Number(j.qty)))
      const due = leadDayN(start, days)
      const warnOn = leadDayN(start, Math.ceil(days * LEAD_WARN_RATIO))
      const want = { lead_days: days, lead_due: due, warn: today >= warnOn, over: today > due }
      const got = { lead_days: Number(f.lead_days), lead_due: String(f.lead_due).slice(0, 10), warn: f.warn, over: f.over }
      if (JSON.stringify(want) !== JSON.stringify(got)) {
        errors.push(`B5: เวลาผลิต ${j.confirmation_no} ฐาน=${JSON.stringify(got)} เว็บ=${JSON.stringify(want)} (เริ่ม ${start})`)
      }
    }
  }

  // B6 งานกำลังทำไม่เกินจำนวนเครื่อง · จักร 1 ตัวไม่ถูกใช้ 2 งานพร้อมกัน
  const overCap = await client.sql(`
    select l.current_station, count(*)::int doing, s.machines
    from public.job_live l join public.stations s on s.code = l.current_station
    where l.station_status = 'doing' and s.machines is not null
    group by l.current_station, s.machines having count(*) > s.machines`)
  if (overCap.length) errors.push(`B6: กำลังทำเกินจำนวนเครื่อง: ${JSON.stringify(overCap)}`)
  const dupMachine = await client.sql(`
    select m.code, count(*)::int c from public.machine_assignments ma
    join public.sewing_machines m on m.id = ma.machine_id
    where ma.released_at is null group by m.code having count(*) > 1`)
  if (dupMachine.length) errors.push(`B6: จักรถูกใช้หลายงานพร้อมกัน: ${JSON.stringify(dupMachine)}`)
  const leftMachines = await client.sql(`
    select j.confirmation_no from public.machine_assignments ma join public.jobs j on j.id = ma.job_id
    where ma.released_at is null and j.phase in ('done', 'cancelled')`)
  if (leftMachines.length) errors.push(`B6: งานจบแล้วยังถือจักร: ${JSON.stringify(leftMachines)}`)

  // B7 ใบแก้ครั้งที่ไม่ติดลบ และไม่น้อยกว่าครั้งที่สถานีรับทราบ
  const badRev = await client.sql(`
    select j.confirmation_no, j.confirmation_rev from public.jobs j
    where j.confirmation_rev < 0
       or exists (select 1 from public.confirmation_acks a where a.job_id = j.id and a.rev > j.confirmation_rev)`)
  if (badRev.length) errors.push(`B7: ใบแก้ครั้งที่ผิด: ${JSON.stringify(badRev)}`)

  // B8 วัตถุดิบ: ชื่อไม่ซ้ำในงาน · รูปไม่ใช่รูปม็อคอัพ · งานที่ปล่อยแล้วติ๊กครบ + มีรูป
  const dupMat = await client.sql(`
    select job_id, lower(btrim(name)) n, count(*)::int c from public.job_materials
    group by job_id, lower(btrim(name)) having count(*) > 1`)
  if (dupMat.length) errors.push(`B8: ชื่อวัตถุดิบซ้ำ: ${JSON.stringify(dupMat)}`)
  const matUseMock = await client.sql(`
    select p.job_id, p.path from public.job_material_photos p join public.jobs j on j.id = p.job_id
    where p.path = j.mockup_path or coalesce(j.spec -> 'mockups', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('path', p.path))`)
  if (matUseMock.length) errors.push(`B8: รูปวัตถุดิบเป็นรูปม็อคอัพ: ${JSON.stringify(matUseMock)}`)
  const releasedUnchecked = await client.sql(`
    select j.confirmation_no from public.jobs j
    join public.events e on e.job_id = j.id and e.type = 'released' and e.payload ->> 'manual' = 'true'
    where coalesce(e.payload ->> 'outsource', '') <> 'true'
      and (exists (select 1 from public.job_materials m where m.job_id = j.id and m.checked_at is null)
           or not exists (select 1 from public.job_material_photos p where p.job_id = j.id))`)
  if (releasedUnchecked.length) errors.push(`B8: ปล่อยเข้าไลน์ทั้งที่วัตถุดิบไม่ครบ/ไม่มีรูป: ${JSON.stringify(releasedUnchecked.slice(0, 3))}`)

  // B9 ไฟล์ที่ตารางอ้างมีใน R2 · ไม่มีรูป base64 ในฐาน
  const b64 = await client.sql(`
    select 'jobs' t, confirmation_no k from public.jobs where spec::text like '%data:image/%'
    union all select 'drafts', confirmation_no from public.confirmation_drafts where data::text like '%data:image/%'`)
  if (b64.length) errors.push(`B9: พบรูป base64 ในฐาน: ${JSON.stringify(b64.slice(0, 3))}`)
  const missing = []
  for (const r of await client.sql('select path from public.job_material_photos')) {
    if (!client.stack.r2Store.has('mockups/' + r.path)) missing.push(r.path)
  }
  if (missing.length) errors.push(`B9: ไฟล์ในฐานไม่มีใน R2: ${JSON.stringify(missing.slice(0, 3))}`)

  // B10 กล่องจดหมายไม่ส่งซ้ำ
  const dupInbox = await client.sql('select dedupe_key, count(*)::int c from public.inbox_messages group by dedupe_key having count(*) > 1')
  if (dupInbox.length) errors.push(`B10: กล่องจดหมายซ้ำ: ${JSON.stringify(dupInbox)}`)

  // B11 หลังสแกนกล่องจดหมาย: เกินเวลาผลิต (ยังไม่รายงาน) และรอผลิตเกิน 2 วันทำงาน ต้องมีจดหมาย
  if (afterScan && slaRes.ok) {
    const overIds = slaRes.body.filter(f => f.over && f.need_report).map(f => f.job_id)
    if (overIds.length) {
      const got = await client.sql(`select job_id from public.inbox_messages where kind = 'sla_over' and job_id = any($1::uuid[])`, [overIds])
      const have = new Set(got.map(r => r.job_id))
      const lost = overIds.filter(id => !have.has(id))
      if (lost.length) errors.push(`B11: เกินเวลาผลิตแต่ไม่มีจดหมาย ${lost.length} งาน`)
    }
    const waiting = await client.sql(`select id, confirmation_no, stage_entered_at from public.jobs where phase = 'materials'`)
    const late = waiting.filter(w => workDays(w.stage_entered_at, new Date()) > 2)
    if (late.length) {
      const got = await client.sql(`select distinct job_id from public.inbox_messages where kind = 'materials_late' and job_id = any($1::uuid[])`, [late.map(w => w.id)])
      const have = new Set(got.map(r => r.job_id))
      const lost = late.filter(w => !have.has(w.id))
      if (lost.length) errors.push(`B11: รอผลิตเกิน 2 วันทำงานแต่ไม่มีจดหมาย: ${lost.map(w => w.confirmation_no).join(', ')}`)
    }
  }

  return errors
}

export async function runInvariantSelfTests(client) {
  const cases = []
  const verifyCatches = async (code, corruptFn, opts = {}) => {
    await client.reset(false)
    const r = await client.rpc('admin1', 'receive_job', {
      p_confirmation_no: `SELF-${code}`, p_customer_name: 'SelfTest', p_job_name: code,
      p_product_type_code: 'tshirt', p_qty: 50, p_unit: 'ตัว', p_due_date: '2099-01-20',
      p_route_code: 'cut_only', p_confirmation_pdf_path: null, p_confirmation_rev: 0,
      p_spec: {}, p_needs_sample: false,
    })
    if (!r.ok) throw new Error(`setup ${code}: ${JSON.stringify(r.body)}`)
    const jobId = r.body
    const st = createInvariantState()
    const clean = await checkInvariants(client, st, opts)
    if (clean.length) throw new Error(`${code} ข้อมูลตั้งต้นไม่ผ่าน: ${clean.join('; ')}`)
    await corruptFn(jobId)
    const caught = await checkInvariants(client, st, opts)
    const hit = caught.some(e => e.startsWith(code + ':'))
    cases.push({ code, caught: hit })
    if (!hit) throw new Error(`self-test ${code} จับข้อมูลผิดไม่ได้: ${JSON.stringify(caught)}`)
  }
  const raw = async sql => {
    await client.sql('set session_replication_role = replica')
    try { await client.sql(sql) } finally { await client.sql('set session_replication_role = origin') }
  }

  await verifyCatches('B1', id => raw(`update public.events set payload = '{"x":1}' where job_id = '${id}'`))
  await verifyCatches('B2', id => raw(`update public.jobs set station_seq = 9 where id = '${id}'`))
  await verifyCatches('B3', async id => {
    await client.sql('alter table public.jobs drop constraint if exists jobs_queue_seq_key')
    await client.sql('drop index if exists public.jobs_queue_seq_key')
    await raw(`insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date, route_code, phase, station_seq, station_status, queue_seq)
      select 'SELF-B3-DUP', 'A', 'B', 'tshirt', 10, 'ตัว', '2099-01-20', 'cut_only', 'materials', 0, null, queue_seq from public.jobs where id = '${id}'`)
    await raw(`insert into public.events (job_id, type, payload) select id, 'received', '{}' from public.jobs where confirmation_no = 'SELF-B3-DUP'`)
  })
  await verifyCatches('B4', id => raw(`insert into public.qc_results (job_id, passed) values ('${id}', 51)`))
  await verifyCatches('B5', async id => {
    await raw(`update public.jobs set qty = 1000 where id = '${id}'`)
    await client.sql(`create or replace function private.lead_days(p_qty int) returns int language sql immutable set search_path = '' as $$ select 10 $$`)
  })
  await verifyCatches('B6', async id => {
    await client.sql("update public.stations set machines = 1 where code = 'cut'")
    await raw(`update public.jobs set station_status = 'doing' where id = '${id}'`)
    const r = await client.rpc('admin1', 'receive_job', {
      p_confirmation_no: 'SELF-B6-2', p_customer_name: 'A', p_job_name: 'B', p_product_type_code: 'tshirt',
      p_qty: 10, p_unit: 'ตัว', p_due_date: '2099-01-20', p_route_code: 'cut_only',
      p_confirmation_pdf_path: null, p_confirmation_rev: 0, p_spec: {}, p_needs_sample: false,
    })
    await raw(`update public.jobs set station_status = 'doing' where id = '${r.body}'`)
  })
  await verifyCatches('B7', id => raw(`update public.jobs set confirmation_rev = -1 where id = '${id}'`))
  await verifyCatches('B8', async id => {
    const p = await client.seedMockJpg('mockups', 'SELF-B8', 'mock-b8')
    await raw(`update public.jobs set mockup_path = '${p}' where id = '${id}'`)
    await raw(`insert into public.job_material_photos (job_id, path) values ('${id}', '${p}')`)
  })
  await verifyCatches('B9', id => raw(`insert into public.job_material_photos (job_id, path) values ('${id}', 'MISSING/nofile.jpg')`))
  await verifyCatches('B10', async id => {
    await client.sql('alter table public.inbox_messages drop constraint if exists inbox_messages_dedupe_key_key')
    await raw(`insert into public.inbox_messages (kind, job_id, dedupe_key, title, body, audience) values
      ('materials_late', '${id}', 'dup-k', 't', 'b', array['admin']), ('materials_late', '${id}', 'dup-k', 't', 'b', array['admin'])`)
  })
  await verifyCatches('B11', async id => {
    await raw(`update public.jobs set created_at = now() - interval '40 day' where id = '${id}'`)
    await raw(`update public.events set at = at - interval '40 day' where job_id = '${id}'`)
    await raw(`insert into public.inbox_settings (kind, enabled) values ('sla_over', false) on conflict (kind) do update set enabled = false`)
    await client.rpc('admin1', 'inbox_scan')
  }, { afterScan: true })
  return cases
}
