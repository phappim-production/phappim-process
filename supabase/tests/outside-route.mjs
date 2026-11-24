import { skipQueue } from './queue-skip.mjs'

export async function outsideRouteTests({ db, ok, as }) {
  const U = {
    admin: '00000000-0000-0000-0000-000000000091', prod: '00000000-0000-0000-0000-000000000092',
    qc: '00000000-0000-0000-0000-000000000093', staff: '00000000-0000-0000-0000-000000000094',
  }
  await db.exec(`
    insert into auth.users values ('${U.admin}','ox-admin@test'),('${U.prod}','ox-prod@test'),('${U.qc}','ox-qc@test'),('${U.staff}','ox-staff@test');
    insert into public.profiles (user_id,name,role,active) values
      ('${U.admin}','แอดมิน นอก','admin',true),('${U.prod}','ฝ่ายผลิต นอก','production',true),
      ('${U.qc}','QC นอก','qc',true),('${U.staff}','พนักงาน นอก','staff',true);
    insert into public.staff_stations (user_id, station_code) values ('${U.staff}','outside');
  `)
  const call = async (uid, sql) => { await skipQueue(db, as, uid, sql); return as(uid, () => db.query(`select ${sql} as v`)) }
  const pass = async (name, uid, sql) => {
    try { const r = await call(uid, sql); ok(name, true); return r.rows[0]?.v } catch (e) { ok(name, false, e.message.split('\n')[0]) }
  }
  const reject = async (name, uid, sql, re) => {
    try { await call(uid, sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') }
    catch (e) { ok(name, re.test(e.message), e.message.split('\n')[0]) }
  }
  const state = async id => (await db.query(`
    select j.phase, rs.station_code st, j.station_status status, j.is_rework
    from public.jobs j left join public.route_stations rs on rs.route_code = j.route_code and rs.seq = j.station_seq
    where j.id = '${id}'`)).rows[0]
  const count = async (id, type) => (await db.query(`select count(*)::int n from public.events where job_id = '${id}' and type = '${type}'`)).rows[0].n
  const openRun = async id => (await db.query(`select id from public.outsource_runs where job_id = '${id}' and closed_at is null`)).rows[0]?.id
  const plan = `now(), 7, now() + interval '7 days'`
  const vendor = (await db.query(`insert into public.vendors (name, stations) values ('โรงงานนอก ทดสอบ', '{outside}') returning id`)).rows[0].id
  const receive = (no, sample) => `public.receive_job('${no}','ลูกค้านอก','หมวกสั่งผลิต','tshirt',10,'ตัว',current_date + 14,'outside','',0,0,'{}'::jsonb,${sample})`

  ok('มีเส้นทาง ผลิตข้างนอกทั้งหมด = สั่งผลิตข้างนอก → QC+Packing',
    (await db.query(`select string_agg(station_code, ',' order by seq) s from public.route_stations where route_code = 'outside'`)).rows[0].s === 'outside,qc_pack')

  const job = await pass('แอดมินรับงานเส้นทางผลิตข้างนอก', U.admin, receive('SC-OX-1', false))
  let s = await state(job)
  ok('งานใหม่รอที่สถานีสั่งผลิตข้างนอก', s.phase === 'production' && s.st === 'outside' && s.status === 'queued', JSON.stringify(s))

  await reject('ฝ่ายผลิตกดเริ่มที่สั่งผลิตข้างนอกไม่ได้', U.prod, `public.start_station('${job}')`, /ผลิตข้างนอกทั้งหมด/)
  await reject('เริ่มแบบมีเหตุผลข้ามคิวก็ไม่ได้', U.prod, `public.start_in_queue('${job}', 'ด่วน')`, /ผลิตข้างนอกทั้งหมด/)
  await reject('พนักงานที่จับคู่สถานีนี้กดเริ่มไม่ได้', U.staff, `public.start_station('${job}')`, /ผลิตข้างนอกทั้งหมด/)
  ok('ถูกปฏิเสธแล้วงานยังรอส่งออก · ไม่มี events เริ่มงาน', (await state(job)).status === 'queued' && await count(job, 'start') === 0)

  await pass('พักงานที่รอส่งออกได้', U.admin, `public.open_issue('${job}', 'รอโรงงานนอกยืนยันราคา')`)
  await pass('แก้แล้ว ทำต่อ กลับไปรอส่งออก', U.prod, `public.close_issue('${job}', null)`)
  ok('หลังแก้ปัญหา งานกลับมารอคิว (ไม่ใช่กำลังทำ)', (await state(job)).status === 'queued')

  await reject('ส่ง QC + Packing ออกไปด้วยไม่ได้', U.admin, `public.send_out('${job}', ${vendor}, 'qc_pack', ${plan})`, /ทำที่โรงงานเท่านั้น/)
  await reject('ฝ่ายผลิตส่งออกไม่ได้', U.prod, `public.send_out('${job}', ${vendor}, 'outside', ${plan})`, /ทำขั้นนี้ไม่ได้/)
  await pass('แอดมินส่งออกไปโรงงานนอก', U.admin, `public.send_out('${job}', ${vendor}, 'outside', ${plan})`)
  s = await state(job)
  ok('ระหว่างผลิตข้างนอก สถานะเป็นข้างนอก', s.st === 'outside' && s.status === 'out', JSON.stringify(s))
  await reject('ระหว่างอยู่ข้างนอก QC กดเริ่มไม่ได้', U.qc, `public.start_station('${job}')`, /บริษัทภายนอก|สถานะงานเปลี่ยน|QC/)

  await pass('แอดมินรับของกลับ', U.admin, `public.receive_back(${await openRun(job)}, 'ของครบ')`)
  s = await state(job)
  ok('รับกลับแล้วไปรอที่ QC + Packing', s.st === 'qc_pack' && s.status === 'queued', JSON.stringify(s))
  ok('ลง events ส่งออก 1 · รับกลับ 1', await count(job, 'outsource_sent') === 1 && await count(job, 'outsource_received') === 1)

  await pass('QC เริ่มตรวจ', U.qc, `public.start_station('${job}')`)
  await pass('QC ส่งแก้ 2 ชิ้นกลับโรงงานนอก', U.qc, `public.send_rework('${job}', 2, 'ตะเข็บหลุด', 'outside')`)
  s = await state(job)
  ok('งานแก้กลับไปรอที่สั่งผลิตข้างนอก', s.st === 'outside' && s.status === 'queued' && s.is_rework, JSON.stringify(s))
  await reject('งานแก้ก็กดเริ่มที่โรงงานไม่ได้', U.prod, `public.start_station('${job}')`, /ผลิตข้างนอกทั้งหมด/)
  await pass('แอดมินส่งงานแก้ออก', U.admin, `public.send_out('${job}', ${vendor}, 'outside', ${plan})`)
  await pass('รับงานแก้กลับ', U.admin, `public.receive_back(${await openRun(job)}, null)`)
  ok('งานแก้กลับมา QC', (await state(job)).st === 'qc_pack')
  await pass('QC เริ่มรอบแก้', U.qc, `public.start_station('${job}')`)
  await pass('QC ผ่านครบ 10', U.qc, `public.record_qc('${job}', 10, gen_random_uuid())`)
  await pass('QC กดเสร็จ', U.qc, `public.finish_station('${job}', 'qc_pack')`)
  ok('งานผลิตข้างนอกเสร็จ', (await state(job)).phase === 'done')

  const sample = await pass('รับงานผลิตข้างนอกที่ขึ้นตัวอย่าง', U.admin, receive('SC-OX-2', true))
  s = await state(sample)
  ok('ตัวอย่างรอที่สั่งผลิตข้างนอก', s.phase === 'sample' && s.st === 'outside' && s.status === 'queued', JSON.stringify(s))
  await reject('ตัวอย่างกดเริ่มที่โรงงานไม่ได้', U.prod, `public.start_station('${sample}')`, /ผลิตข้างนอกทั้งหมด/)
  await pass('ส่งตัวอย่างออก', U.admin, `public.send_out('${sample}', ${vendor}, 'outside', ${plan})`)
  await pass('รับตัวอย่างกลับ', U.admin, `public.receive_back(${await openRun(sample)}, null)`)
  await pass('QC เริ่มตรวจตัวอย่าง', U.qc, `public.start_station('${sample}')`)
  await pass('QC ส่งตัวอย่าง', U.qc, `public.finish_station('${sample}', 'qc_pack')`)
  ok('ตัวอย่างรอผลจากลูกค้า', (await state(sample)).phase === 'sample_review')

  const normal = await pass('งานเส้นทางปกติยังกดเริ่มได้', U.admin, `public.receive_job('SC-OX-3','ลูกค้า','เสื้อ','tshirt',5,'ตัว',current_date + 14,'normal','',0,0,'{}'::jsonb,false)`)
  await pass('ฝ่ายผลิตเริ่มพิมพ์ได้ตามปกติ', U.prod, `public.start_in_queue('${normal}', 'ทดสอบ')`)
  ok('งานปกติกำลังทำ', (await state(normal)).status === 'doing')
}
