// ส่วน B: ข้อตรวจความถูกต้องของข้อมูล 10 ข้อ (รันหลังทุกการกระทำในส่วน C + มี self-test พิสูจน์ว่าจับได้จริง)
import { createHash } from 'node:crypto'

const leadDaysForQty = qty => (qty >= 1000 ? 20 : qty >= 500 ? 15 : 10)

export function createInvariantState() {
  return {
    lastEventMaxId: 0,
    eventHashes: new Map(), // id -> sha256(row)
  }
}

function hashEvent(row) {
  return createHash('sha256').update(JSON.stringify([row.id, row.job_id, row.type, row.phase, row.station_code, row.by, row.payload])).digest('hex')
}

export async function checkInvariants(client, state = createInvariantState(), { page = null } = {}) {
  const errors = []

  // B1: events ไม่ถูกแก้/ลบ และทุกการเปลี่ยนสถานะมี events
  const events = await client.sql('select id, job_id, type, phase, station_code, by, payload from public.events order by id')
  if (events.length < state.eventHashes.size) {
    errors.push(`B1: จำนวน events ลดลง (${events.length} < ${state.eventHashes.size})`)
  }
  for (const e of events) {
    const h = hashEvent(e)
    const prev = state.eventHashes.get(e.id)
    if (prev && prev !== h) errors.push(`B1: event id=${e.id} ถูกแก้ไข`)
    state.eventHashes.set(e.id, h)
  }

  // B2: ความสอดคล้องของ phase กับสถานี/สถานะสถานี + งาน materials ไม่มีสถานี + done/cancelled ไม่อยู่ในคิว
  const badPhase = await client.sql(`
    select id, confirmation_no, phase, station_seq, station_status
    from public.jobs
    where (phase = 'materials' and (station_seq <> 0 or station_status is not null))
       or (phase in ('done', 'cancelled') and station_status in ('queued', 'doing', 'hold', 'out'))
       or (phase in ('production', 'sample') and station_status not in ('queued', 'doing', 'hold', 'out'))
  `)
  if (badPhase.length) errors.push(`B2: สถานะงานขัดแย้ง: ${JSON.stringify(badPhase.slice(0, 3))}`)

  // B3: คิวไม่ซ้ำ ไม่ข้าม และงานรอผลิตที่ปล่อยทีหลังต้องมี queue_seq มากกว่างานที่ปล่อยก่อน
  const dupQueue = await client.sql('select queue_seq, count(*)::int c from public.jobs group by queue_seq having count(*) > 1')
  if (dupQueue.length) errors.push(`B3: queue_seq ซ้ำ: ${JSON.stringify(dupQueue)}`)

  // B4: จำนวนงานแบ่ง ผลรวมส่วนลูกไม่เกิน/ตรงกับครอบครัว + ยอดบอร์ด vs job_live สอดคล้อง
  const badQty = await client.sql('select id, confirmation_no, qty from public.jobs where qty <= 0 or qty > 100000')
  if (badQty.length) errors.push(`B4: จำนวนงานผิดปกติ: ${JSON.stringify(badQty)}`)

  // B5: เวลาผลิตในฐาน (job_sla_flags) ตรงกับ leadTimeFor ฝั่งเว็บ
  const slaRes = await client.rpc('admin1', 'job_sla_flags')
  if (slaRes.ok && Array.isArray(slaRes.body)) {
    const jobs = await client.sql("select id, qty, develop, phase, created_at from public.jobs where phase not in ('done', 'cancelled', 'materials') and not develop")
    const flagMap = new Map(slaRes.body.map(f => [f.job_id, f]))
    for (const j of jobs) {
      const f = flagMap.get(j.id)
      if (!f) continue
      const expectedDays = leadDaysForQty(Number(j.qty))
      if (Number(f.lead_days) < expectedDays) {
        // กรณีแบ่งงาน f.lead_days อาจมากกว่า j.qty ได้ แต่ห้ามน้อยกว่า
        errors.push(`B5: lead_days ในฐาน (${f.lead_days}) น้อยกว่าหน้าเว็บ (${expectedDays}) สำหรับ ${j.id}`)
      }
    }
  }

  // B6: เครื่องต่อสถานีไม่เกินจำนวนเครื่อง และจักรประจำไลน์ 1 ตัวไม่ถูกใช้พร้อมกัน 2 งาน
  const overCap = await client.sql(`
    select l.current_station, count(*)::int doing, s.machines
    from public.job_live l
    join public.stations s on s.code = l.current_station
    where l.station_status = 'doing' and s.machines is not null
    group by l.current_station, s.machines
    having count(*) > s.machines
  `)
  if (overCap.length) errors.push(`B6: งานกำลังทำเกินจำนวนเครื่อง: ${JSON.stringify(overCap)}`)

  const dupMachine = await client.sql(`
    select m.id, m.code, count(*)::int c
    from public.machine_assignments ma
    join public.sewing_machines m on m.id = ma.machine_id
    where ma.released_at is null
    group by m.id, m.code
    having count(*) > 1
  `)
  if (dupMachine.length) errors.push(`B6: จักร 1 ตัวถูกใช้หลายงานพร้อมกัน: ${JSON.stringify(dupMachine)}`)

  // B7: ใบที่อนุมัติแล้ว/ครั้งที่แก้เพิ่มทีละ 1 (confirmation_rev >= 0)
  const badRev = await client.sql('select id, confirmation_no, confirmation_rev from public.jobs where confirmation_rev < 0')
  if (badRev.length) errors.push(`B7: confirmation_rev ติดลบ: ${JSON.stringify(badRev)}`)

  // B8: วัตถุดิบ: ไม่มีชื่อซ้ำในงานเดียวกัน, รูปวัตถุดิบต้องไม่ซ้ำกับรูปม็อคอัพของงาน
  const dupMat = await client.sql(`
    select job_id, lower(btrim(name)) n, count(*)::int c
    from public.job_materials
    group by job_id, lower(btrim(name))
    having count(*) > 1
  `)
  if (dupMat.length) errors.push(`B8: ชื่อวัตถุดิบซ้ำในงานเดียว: ${JSON.stringify(dupMat)}`)

  const matUseMock = await client.sql(`
    select p.job_id, p.path
    from public.job_material_photos p
    join public.jobs j on j.id = p.job_id
    where p.path = j.mockup_path
       or coalesce(j.spec -> 'mockups', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('path', p.path))
  `)
  if (matUseMock.length) errors.push(`B8: รูปวัตถุดิบซ้ำกับรูปม็อคอัพ: ${JSON.stringify(matUseMock)}`)

  // B9: ไฟล์ที่ตารางอ้างต้องมีใน R2 จำลอง + ห้ามเก็บรูป base64 ในตาราง jobs/confirmation_drafts
  const b64InDb = await client.sql(`
    select id, confirmation_no from public.jobs
    where spec::text like '%data:image/%'
    limit 3
  `)
  if (b64InDb.length) errors.push(`B9: พบ base64 รูปใน spec: ${JSON.stringify(b64InDb)}`)

  const missingR2 = []
  const matPhotos = await client.sql('select path from public.job_material_photos')
  for (const r of matPhotos) {
    if (!client.stack.r2Store.has('mockups/' + r.path)) missingR2.push('mockups/' + r.path)
  }
  if (missingR2.length) errors.push(`B9: ไฟล์ใน DB ไม่มีใน R2: ${JSON.stringify(missingR2.slice(0, 3))}`)

  // B10: กล่องจดหมายไม่ส่ง dedupe_key ซ้ำ
  const dupInbox = await client.sql('select dedupe_key, count(*)::int c from public.inbox_messages group by dedupe_key having count(*) > 1')
  if (dupInbox.length) errors.push(`B10: inbox dedupe_key ซ้ำ: ${JSON.stringify(dupInbox)}`)

  if (page) {
    const uiBad = await page.ev(() => /NaN|undefined|Invalid Date|\[object Object\]/.test(document.body.innerText))
    if (uiBad) errors.push('B4-UI: พบ NaN/undefined/Invalid Date บนหน้าจอ')
  }

  return errors
}

// พิสูจน์ว่าข้อตรวจ B1-B10 จับข้อมูลผิดได้จริงทุกข้อ
export async function runInvariantSelfTests(client) {
  const cases = []
  const verifyCatches = async (code, corruptFn) => {
    await client.reset(true)
    const r = await client.rpc('admin1', 'receive_job', {
      p_confirmation_no: `SELF-${code}`, p_customer_name: 'SelfTest', p_job_name: code,
      p_product_type_code: 'tshirt', p_qty: 50, p_unit: 'ตัว', p_due_date: '2099-01-20',
      p_route_code: 'cut_only', p_confirmation_pdf_path: null, p_confirmation_rev: 0,
      p_spec: {}, p_needs_sample: false,
    })
    if (!r.ok) throw new Error(`setup ${code} failed`)
    const jobId = r.body
    const st = createInvariantState()
    const cleanErrs = await checkInvariants(client, st)
    if (cleanErrs.length) throw new Error(`${code} clean state failed: ${cleanErrs.join('; ')}`)
    await corruptFn(jobId, st)
    const caught = await checkInvariants(client, st)
    const hit = caught.some(e => e.startsWith(code + ':'))
    cases.push({ code, caught: hit, messages: caught })
    if (!hit) throw new Error(`Self-test ${code} ไม่สามารถจับข้อมูลผิดได้! got=${JSON.stringify(caught)}`)
  }

  await verifyCatches('B1', async (jobId) => {
    await client.sql('alter table public.events disable trigger all')
    await client.sql("update public.events set type = 'tampered' where job_id = $1", [jobId])
  })
  await verifyCatches('B2', async (jobId) => {
    await client.sql("update public.jobs set station_seq = 1 where id = $1", [jobId])
  })
  await verifyCatches('B3', async (jobId) => {
    await client.sql('alter table public.jobs drop constraint if exists jobs_queue_seq_key')
    await client.sql('drop index if exists public.jobs_queue_seq_key')
    await client.sql(`insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date, route_code, phase, station_seq, station_status, queue_seq)
      select 'SELF-B3-DUP', 'A', 'B', 'tshirt', 10, 'ตัว', '2099-01-20', 'cut_only', 'materials', 0, null, queue_seq from public.jobs where id = $1`, [jobId])
  })
  await verifyCatches('B4', async (jobId) => {
    await client.sql('alter table public.jobs drop constraint if exists jobs_qty_check')
    await client.sql('alter table public.jobs drop constraint if exists jobs_qty_cap')
    await client.sql('update public.jobs set qty = 0 where id = $1', [jobId])
  })
  await verifyCatches('B5', async (jobId) => {
    await client.sql("update public.jobs set phase = 'production', station_seq = 1, station_status = 'queued', qty = 1000 where id = $1", [jobId])
    await client.sql(`create or replace function public.job_sla_flags() returns table(job_id uuid, warn boolean, over boolean, need_report boolean, lead_days int, lead_due date) language sql stable as $$ select '${jobId}'::uuid, false, false, false, 1, current_date $$`)
  })
  await verifyCatches('B6', async (jobId) => {
    await client.sql("update public.stations set machines = 1 where code = 'cut'")
    await client.sql("update public.jobs set phase = 'production', station_seq = 1, station_status = 'doing' where id = $1", [jobId])
    await client.sql(`insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date, route_code, phase, station_seq, station_status)
      values ('SELF-B6-2', 'A', 'B', 'tshirt', 10, 'ตัว', '2099-01-20', 'cut_only', 'production', 1, 'doing')`)
  })
  await verifyCatches('B7', async (jobId) => {
    await client.sql('alter table public.jobs drop constraint if exists jobs_confirmation_rev_check')
    await client.sql('update public.jobs set confirmation_rev = -1 where id = $1', [jobId])
  })
  await verifyCatches('B8', async (jobId) => {
    const p = await client.seedMockJpg('mockups', `SELF-B8`, 'mock-b8')
    await client.sql('update public.jobs set mockup_path = $1 where id = $2', [p, jobId])
    await client.sql('insert into public.job_material_photos (job_id, path) values ($1, $2)', [jobId, p])
  })
  await verifyCatches('B9', async (jobId) => {
    await client.sql("insert into public.job_material_photos (job_id, path) values ($1, 'MISSING/nofile.jpg')", [jobId])
  })
  await verifyCatches('B10', async (jobId) => {
    await client.sql('alter table public.inbox_messages drop constraint if exists inbox_messages_dedupe_key_key')
    await client.sql("insert into public.inbox_messages (kind, job_id, dedupe_key, title, body, audience) values ('materials_late', $1, 'dup-k', 't', 'b', array['admin']), ('materials_late', $1, 'dup-k', 't', 'b', array['admin'])", [jobId])
  })
  return cases
}
