import { requiredSteps, substepSql } from './steps.mjs'

import { queueSkips } from './queue-skip.mjs'

export async function historyTests({ db, ok, as }) {
  const users = {
    admin: '00000000-0000-0000-0000-000000000011',
    qc: '00000000-0000-0000-0000-000000000012',
    production: '00000000-0000-0000-0000-000000000013',
  }
  const skips = queueSkips(db, 'history')
  const call = async (sql, role = 'production') => { await skips.beforeSql(as, users[role], sql); return as(users[role], () => db.query(`select ${sql}`)) }
  const first = async (sql, args) => (await db.query(sql, args)).rows[0]

  async function receive(name, sample) {
    const result = await call(`public.receive_job('TEST-C6-${name}', 'ลูกค้าทดสอบ', 'งานทดสอบประวัติ',
      'tshirt', 10, 'ตัว', '2026-12-31', 'cut_only', 'confirmations/TEST-C6-${name}.pdf',
      p_needs_sample => ${sample}) as id`, 'admin')
    const id = result.rows[0].id
    const { rows } = await db.query('select id, dept from public.job_materials where job_id = $1 order by id', [id])
    for (const material of rows) await call(`public.check_material(${material.id})`, material.dept)
    return id
  }

  async function finish(id, station, phase) {
    for (const [key, value] of await requiredSteps(db, station, phase)) await call(substepSql(id, key, value))
    await call(`public.finish_station('${id}')`)
  }

  const start = id => call(`public.start_station('${id}')`)
  const currentVisit = async id => (await first('select visit from public.jobs where id=$1', [id])).visit
  const eventAt = async (id, type) => (await first(`
    select at::text as at from public.events where job_id=$1 and type=$2 order by id desc limit 1
  `, [id, type]))?.at
  const visit = async (id, n) => (await as(users.production, () => db.query(`
    select station_code, phase, visit, started_at::text, done_at::text, rework
    from public.station_visits where job_id=$1 and visit=$2
  `, [id, n]))).rows[0]

  const production = await receive('PRODUCTION', false)
  await start(production)
  const cut = await currentVisit(production)
  await finish(production, 'cut', 'production')
  const cutVisit = await visit(production, cut)
  ok('C6: จบรอบตัดปกติใช้เวลาจาก station_done', !!cutVisit?.done_at &&
    cutVisit.done_at === await eventAt(production, 'station_done'))

  await start(production)
  const qc = await currentVisit(production)
  await call(`public.send_rework('${production}', 1, 'ตัดคลาด', 'cut')`, 'qc')
  const qcVisit = await visit(production, qc)
  ok('C6: QC จบรอบที่เวลาส่งกลับแก้ แม้ rework ใช้รหัสสถานีปลายทาง', !!qcVisit?.done_at &&
    qcVisit.done_at === await eventAt(production, 'rework'))

  await start(production)
  const repair = await currentVisit(production)
  const repairVisit = await visit(production, repair)
  ok('C6: สถานีต้นเหตุเริ่มรอบใหม่และยังไม่จบ', repair > qc &&
    repairVisit?.station_code === 'cut' && repairVisit.rework === true && repairVisit.done_at === null)
  await call(`public.open_issue('${production}', 'รอตรวจชิ้นงาน')`)
  const held = await visit(production, repair)
  await call(`public.close_issue('${production}')`)
  const resumed = await visit(production, repair)
  ok('C6: พักแล้วทำต่อยังเป็นรอบเดิมและไม่มีเวลาจบ',
    held?.done_at === null && resumed?.done_at === null &&
    resumed.started_at === repairVisit.started_at && await currentVisit(production) === repair)

  await finish(production, 'cut', 'production')
  await start(production)
  const finalQc = await currentVisit(production)
  await call(`public.record_qc('${production}', 10)`, 'qc')
  await finish(production, 'qc_pack', 'production')
  const finalVisit = await visit(production, finalQc)
  ok('C6: รอบ QC สุดท้ายมีเวลาจบตรงกับ event งานเสร็จ',
    !!finalVisit?.done_at && finalVisit.done_at === await eventAt(production, 'done'))

  const sample = await receive('SAMPLE', true)
  await start(sample)
  await finish(sample, 'cut', 'sample')
  await start(sample)
  const sampleQc = await currentVisit(sample)
  await finish(sample, 'qc_pack', 'sample')
  const sampleVisit = await visit(sample, sampleQc)
  ok('C6: รอบ QC ของตัวอย่างจบตรงกับ event ส่งตัวอย่าง', sampleVisit?.phase === 'sample' &&
    !!sampleVisit.done_at && sampleVisit.done_at === await eventAt(sample, 'sample_sent'))

  // RPC ปัจจุบันบันทึก station_done ควบคู่กับ sample_sent/done จึงจำลองประวัติเดิมที่ไม่มี station_done เพิ่ม
  async function legacy(name, phase, transition, station, payload, minute) {
    const job = await receive(name, phase === 'sample')
    await db.query(`
      insert into public.events (job_id, type, phase, station_code, at, payload) values
        ($1, 'station_start', $2, 'cut', '2026-11-16T02:00:00Z', '{"visit": 1}'),
        ($1, 'substep_done', $2, 'cut', '2026-11-16T02:00:00Z', '{"visit": 1}'),
        ($1, $3, $2, $4, $5, $6::jsonb)
    `, [job, phase, transition, station, `2026-11-16T02:0${minute}:00Z`, JSON.stringify(payload)])
    return job
  }

  for (const [type, phase] of [['sample_sent', 'sample'], ['done', 'production']]) {
    const id = await legacy(type.toUpperCase(), phase, type, null, {}, 5)
    const row = await visit(id, 1)
    ok(`C6: ประวัติเดิมที่ไม่มี station_done ใช้ ${type}`,
      !!row?.done_at && row.done_at === await eventAt(id, type))
  }
  const next = await legacy('NEXT', 'production', 'station_start', 'qc_pack', { visit: 2 }, 0)
  const before = await visit(next, 1)
  const after = await visit(next, 2)
  ok('C6: ใช้เวลาเริ่ม visit ถัดไปแม้เวลาเท่ากัน โดยเรียง id',
    !!before?.done_at && before.done_at === after?.started_at && after.done_at === null)
  skips.report()
}
