import { queueSkips } from './queue-skip.mjs'

export async function confirmationAckTests({ db, ok, as }) {
  const U = {
    sup: '00000000-0000-0000-0000-0000000006a1', qc: '00000000-0000-0000-0000-0000000006a2',
    staff: '00000000-0000-0000-0000-0000000006a3', admin: '00000000-0000-0000-0000-0000000006a4',
    prod: '00000000-0000-0000-0000-0000000006a5', owner: '00000000-0000-0000-0000-000000000001',
  }
  await db.exec(`
    insert into auth.users values ('${U.sup}','ca1@test'),('${U.qc}','ca2@test'),('${U.staff}','ca3@test'),('${U.admin}','ca4@test'),('${U.prod}','ca5@test');
    insert into public.profiles (user_id, name, role, active) values
      ('${U.sup}','หัวหน้า ใบแก้','supervisor',true),('${U.qc}','QC ใบแก้','qc',true),('${U.staff}','พนักงานตัด ใบแก้','staff',true),
      ('${U.admin}','แอดมิน ใบแก้','admin',true),('${U.prod}','ฝ่ายผลิต ใบแก้','production',true);
    insert into public.staff_stations (user_id, station_code) values ('${U.staff}','cut');`)
  const skips = queueSkips(db, 'confirmation-ack')
  const run = async (uid, sql) => { await skips.beforeSql(as, uid, sql); return as(uid, () => db.query(`select ${sql}`)) }
  const pass = async (name, uid, sql) => {
    try { const r = await run(uid, sql); ok(name, true); return Object.values(r.rows[0] ?? {})[0] } catch (e) { ok(name, false, e.message.split('\n')[0]) }
  }
  const reject = async (name, uid, sql, re) => {
    try { await run(uid, sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') } catch (e) { ok(name, re.test(e.message), e.message.split('\n')[0]) }
  }
  const val = async sql => Object.values((await db.query(sql)).rows[0] ?? {})[0]
  const jobAt = async (no, seq) => (await db.query(`
    insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date,
      route_code, confirmation_pdf_path, phase, station_seq, station_status, dtf_film_received_at, spec)
    values ('${no}','ลูกค้าใบแก้','งานทดสอบใบแก้','tshirt',10,'ตัว','2026-12-31','normal','x.pdf','production',${seq},'queued', now(), '{"product":"tshirt"}')
    returning id`)).rows[0].id
  const revise = async (id, rev, at = 'now()') => Number(await val(`insert into public.events (job_id, type, phase, station_code, payload, by, at)
    values ('${id}', 'spec_revised', 'production', null, jsonb_build_object('rev', ${rev}, 'fields', jsonb_build_array('ปก', 'จำนวน'), 'summary', jsonb_build_array('จำนวน 10 → 12')), '${U.admin}', ${at})
    returning id`))
  const flags = async (uid, id) => (await as(uid, () => db.query(`select * from public.confirmation_revision_flags() where job_id = '${id}'`))).rows[0]
  const seq = async code => val(`select seq from public.route_stations where route_code = 'normal' and station_code = '${code}'`)

  const j = await jobAt('SC-CA-1', 1)
  await pass('เริ่มสถานีพิมพ์', U.sup, `public.start_station('${j}')`)
  ok('ยังไม่เคยแก้ใบ: ไม่ติดรับทราบ', !/รับทราบใบแก้/.test(await val(`select array_to_string(private.missing_substeps('${j}'), ' · ')`)))
  await reject('ยังไม่เคยแก้ใบ: รับทราบไม่ได้', U.sup, `public.ack_confirmation_revision('${j}', 'print')`, /ยังไม่มีใบแก้/)
  ok('ยังไม่เคยแก้ใบ: ไม่มีในสรุปใบแก้', (await flags(U.sup, j)) === undefined)

  const e1 = await revise(j, 1, "'2026-11-25 07:32:00+00'")
  await reject('แอดมินแก้ใบแล้ว ยังไม่รับทราบ กดเสร็จไม่ได้ · บอกครั้งที่ วันที่ เวลา', U.sup, `public.finish_station('${j}', 'print')`,
    /รับทราบใบแก้.*ครั้งที่ 1 เมื่อ 25\/11\/2569 14:32 น\./)
  const f1 = await flags(U.qc, j)
  ok('สรุปใบแก้ให้ทุกบทบาท: ครั้งที่ วันเวลา ผู้แก้ ช่องที่แก้', f1?.rev === 1 && f1.revised_by === 'แอดมิน ใบแก้' && f1.fields.join(',') === 'ปก,จำนวน'
    && f1.summary[0] === 'จำนวน 10 → 12' && Number(f1.event_id) === e1 && f1.acked_stations.length === 0, JSON.stringify(f1))
  await reject('QC รับทราบแทนสถานีพิมพ์ไม่ได้', U.qc, `public.ack_confirmation_revision('${j}', 'print')`, /QC รับทราบได้เฉพาะสถานี QC/)
  await reject('พนักงานสถานีตัด รับทราบงานสถานีพิมพ์ไม่ได้', U.staff, `public.ack_confirmation_revision('${j}', 'print')`, /ไม่ใช่สถานีของคุณ/)
  await reject('แอดมินรับทราบแทนหน้างานไม่ได้', U.admin, `public.ack_confirmation_revision('${j}', 'print')`, /ทำขั้นนี้ไม่ได้/)
  await reject('รับทราบจากหน้าสถานีเก่าไม่ได้', U.sup, `public.ack_confirmation_revision('${j}', 'cut')`, /สถานีอื่นแล้ว/)
  await pass('หัวหน้าสถานีรับทราบใบแก้', U.sup, `public.ack_confirmation_revision('${j}', 'print')`)
  await pass('กดรับทราบซ้ำไม่ error', U.sup, `public.ack_confirmation_revision('${j}', 'print')`)
  ok('รับทราบซ้ำไม่บันทึกซ้ำ', Number(await val(`select count(*) from public.confirmation_acks where job_id = '${j}'`)) === 1
    && Number(await val(`select count(*) from public.events where job_id = '${j}' and type = 'confirmation_ack'`)) === 1)
  ok('สรุปใบแก้บอกสถานีที่รับทราบแล้ว', (await flags(U.sup, j))?.acked_stations.join(',') === 'print')
  await pass('รับทราบแล้วกดเสร็จได้', U.sup, `public.finish_station('${j}', 'print')`)

  const next = await val(`select private.station_at(route_code, station_seq) from public.jobs where id = '${j}'`)
  await pass(`สถานีถัดไป (${next}) กดเริ่ม`, U.sup, `public.start_station('${j}')`)
  await reject('สถานีถัดไปต้องรับทราบใบแก้เดิมด้วย', U.sup, `public.finish_station('${j}', '${next}')`, /รับทราบใบแก้/)
  await pass('สถานีถัดไปรับทราบ', U.sup, `public.ack_confirmation_revision('${j}', '${next}')`)
  await revise(j, 1)
  await reject('แก้ใบซ้ำครั้งเดิม (ครั้งที่ 1 อีกรอบ) ต้องรับทราบใหม่', U.sup, `public.finish_station('${j}', '${next}')`, /รับทราบใบแก้/)
  await pass('รับทราบฉบับล่าสุด', U.sup, `public.ack_confirmation_revision('${j}', '${next}')`)
  await pass('รับทราบฉบับล่าสุดแล้วกดเสร็จได้', U.sup, `public.finish_station('${j}', '${next}')`)

  const c = await jobAt('SC-CA-STAFF', await seq('cut'))
  await revise(c, 2)
  await pass('พนักงานตัดเริ่มงาน', U.staff, `public.start_station('${c}')`)
  await pass('พนักงานตัดรับทราบใบแก้ที่สถานีตัวเอง', U.staff, `public.ack_confirmation_revision('${c}', 'cut')`)
  ok('บันทึกว่าใครรับทราบ', await val(`select user_id::text from public.confirmation_acks where job_id = '${c}'`) === U.staff)

  const s = await jobAt('SC-CA-SPLIT', 1)
  const es = await revise(s, 1)
  const child = await pass('แบ่งงานที่มีใบแก้', U.admin, `public.split_job('${s}', 4)`)
  ok('ส่วนที่แบ่งรับใบแก้ของงานต้นทาง', Number((await flags(U.sup, child))?.event_id) === es)
  await pass('ส่วนที่แบ่งกดเริ่ม', U.sup, `public.start_station('${child}')`)
  await reject('ส่วนที่แบ่งต้องรับทราบก่อนกดเสร็จ', U.sup, `public.finish_station('${child}', 'print')`, /รับทราบใบแก้/)

  const qcSeq = await seq('qc_pack')
  const q = await jobAt('SC-CA-QC', qcSeq)
  await revise(q, 1)
  await pass('QC เริ่ม', U.qc, `public.start_station('${q}')`)
  await pass('QC รับทราบที่สถานี QC', U.qc, `public.ack_confirmation_revision('${q}', 'qc_pack')`)
  ok('ฝ่ายผลิตอ่านสรุปใบแก้ได้', (await flags(U.prod, q))?.acked_stations.join(',') === 'qc_pack')
  ok('ผู้ใช้แก้ตารางรับทราบตรงไม่ได้ (ต้องผ่าน RPC)', await as(U.sup, () => db.query(`insert into public.confirmation_acks (job_id, event_id, rev, station_code) values ('${q}', ${es}, 1, 'print')`)).then(() => false, () => true))
  skips.report()
}
