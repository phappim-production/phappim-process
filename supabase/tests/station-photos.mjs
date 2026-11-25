import { queueSkips } from './queue-skip.mjs'

export async function stationPhotoTests({ db, ok, as }) {
  const U = {
    sup: '00000000-0000-0000-0000-0000000005a1', admin: '00000000-0000-0000-0000-0000000005a2',
    mgr: '00000000-0000-0000-0000-0000000005a3', qc: '00000000-0000-0000-0000-0000000005a4',
    prod: '00000000-0000-0000-0000-0000000005a5', owner: '00000000-0000-0000-0000-000000000001',
  }
  await db.exec(`
    insert into auth.users values ('${U.sup}','sp1@test'),('${U.admin}','sp2@test'),('${U.mgr}','sp3@test'),('${U.qc}','sp4@test'),('${U.prod}','sp5@test');
    insert into public.profiles (user_id, name, role, active) values
      ('${U.sup}','หัวหน้าสถานี รูป','supervisor',true),('${U.admin}','แอดมิน รูป','admin',true),
      ('${U.mgr}','ผู้จัดการ รูป','manager',true),('${U.qc}','QC รูป','qc',true),('${U.prod}','ฝ่ายผลิต รูป','production',true);`)
  const skips = queueSkips(db, 'station-photos')
  const q = v => `'${String(v).replace(/'/g, "''")}'`
  const arr = list => `array[${list.map(q).join(',')}]::text[]`
  const run = async (uid, sql) => { await skips.beforeSql(as, uid, sql); return as(uid, () => db.query(`select ${sql}`)) }
  const pass = async (name, uid, sql) => {
    try { const r = await run(uid, sql); ok(name, true); return Object.values(r.rows[0] ?? {})[0] } catch (e) { ok(name, false, e.message.split('\n')[0]) }
  }
  const reject = async (name, uid, sql, re) => {
    try { await run(uid, sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') } catch (e) { ok(name, re.test(e.message), e.message.split('\n')[0]) }
  }
  const val = async sql => Object.values((await db.query(sql)).rows[0] ?? {})[0]
  const jobAt = async (no, route, seq) => (await db.query(`
    insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date,
      route_code, confirmation_pdf_path, phase, station_seq, station_status, dtf_film_received_at)
    values ('${no}','ลูกค้ารูป','งานทดสอบรูป','tshirt',10,'ตัว','2026-12-31','${route}','x.pdf','production',${seq},'queued', now())
    returning id`)).rows[0].id
  const station = async id => val(`select private.station_at(route_code, station_seq) from public.jobs where id = '${id}'`)
  const photo = async (id, name) => {
    const r = (await db.query(`select private.mockup_folder(confirmation_no) f, private.station_at(route_code, station_seq) s, visit v from public.jobs where id = $1`, [id])).rows[0]
    const p = `${r.f}/${r.s}/${r.v}/${name}.jpg`
    await db.exec(`insert into private.file_objects (kind, path, size, content_type) values ('station_photos', ${q(p)}, 1000, 'image/jpeg') on conflict do nothing`)
    return p
  }
  await db.exec(`insert into private.file_settings (record_secret) values (repeat('s', 32)) on conflict do nothing`)

  const enable = on => db.exec(`update public.station_photo_settings set enabled_at = ${on ? 'now()' : 'null'}`)
  try {
    const old = await jobAt('SC-PH-OLD', 'normal', 1)
    await pass('ยังไม่เปิดใช้: เริ่มงานได้', U.sup, `public.start_station('${old}')`)
    await db.exec(`update public.jobs set station_started_at = now() - interval '1 minute' where id = '${old}'`)
    await enable(true)
    ok('สถานีที่ต้องรออนุมัติชิ้นแรก: พิมพ์ รีด รีดฟิล์ม ตัด ปัก สกรีน',
      (await val(`select string_agg(code, ',' order by code) from public.stations where first_piece_check`)) === 'cut,dtf_press,emb,press,print,screen')
    await pass('งานที่เริ่มก่อนเปิดใช้ กดเสร็จได้โดยไม่ต้องมีรูป', U.sup, `public.finish_station('${old}', 'print')`)
    await reject('เจ้าของเท่านั้นเปิด/ปิดฟีเจอร์', U.admin, `public.set_station_photos_enabled(false)`, /ทำขั้นนี้ไม่ได้/)
    await as(U.owner, () => db.exec(`update public.station_photo_settings set enabled_at = null`)).catch(() => {})
    ok('ผู้ใช้แก้ค่าเปิดใช้ตรงไม่ได้ (ต้องผ่าน RPC)', await val(`select enabled_at is not null from public.station_photo_settings`) === true)

    const j = await jobAt('SC-PH-1', 'normal', 1)
    const st = await station(j)
    ok('งานทดสอบอยู่สถานีพิมพ์', st === 'print', st)
    const p1 = await photo(j, 'aa01')
    await reject('ยังไม่กดเริ่ม ส่งรูปชิ้นแรกไม่ได้', U.sup, `public.submit_first_piece('${j}', 'print', ${arr([p1])})`, /กด "เริ่ม" ก่อนถ่ายรูป/)
    await pass('กดเริ่มสถานีพิมพ์', U.sup, `public.start_station('${j}')`)
    await reject('ยังไม่มีรูปใดเลย กดเสร็จไม่ได้ · บอกให้ถ่ายชิ้นแรกและรูปงานเสร็จ', U.sup, `public.finish_station('${j}', 'print')`,
      /ถ่ายรูปชิ้นแรกส่งให้แอดมินอนุมัติก่อน · ถ่ายรูปงานเสร็จอย่างน้อย 1 รูป/)
    await reject('ยังไม่ผ่านชิ้นแรก ส่งรูปงานเสร็จไม่ได้', U.sup, `public.add_finish_photos('${j}', 'print', ${arr([p1])})`, /ถ่ายรูปชิ้นแรกส่งให้แอดมิน/)
    await reject('ส่งรูปเปล่าไม่ได้', U.sup, `public.submit_first_piece('${j}', 'print', array[]::text[])`, /ยังไม่มีรูป/)
    await reject('รูปของงานอื่นใช้ไม่ได้', U.sup, `public.submit_first_piece('${j}', 'print', ${arr(['SC-OTHER/print/0/aa01.jpg'])})`, /ไม่ใช่ของงาน SC-PH-1/)
    await reject('รูปของสถานีอื่นใช้ไม่ได้', U.sup, `public.submit_first_piece('${j}', 'print', ${arr(['SC-PH-1/cut/0/aa01.jpg'])})`, /ไม่ใช่ของงาน/)
    await reject('รูปที่ยังไม่ขึ้นที่เก็บไฟล์ใช้ไม่ได้', U.sup, `public.submit_first_piece('${j}', 'print', ${arr(['SC-PH-1/print/0/zz99.jpg'])})`, /ยังอัปโหลดไม่เสร็จ/)
    await reject('ส่งรูปเกิน 6 รูปไม่ได้', U.sup, `public.submit_first_piece('${j}', 'print', ${arr(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(x => `SC-PH-1/print/0/${x}.jpg`))})`, /ไม่เกิน 6 รูป/)
    await reject('ส่งจากหน้าสถานีเก่า (สถานีไม่ตรง) ไม่ได้', U.sup, `public.submit_first_piece('${j}', 'press', ${arr([p1])})`, /ไปอยู่สถานีอื่นแล้ว/)
    await reject('QC ส่งรูปสถานีพิมพ์ไม่ได้', U.qc, `public.submit_first_piece('${j}', 'print', ${arr([p1])})`, /QC ส่งรูปได้เฉพาะ/)
    const c1 = await pass('หัวหน้าสถานีส่งรูปชิ้นแรกได้', U.sup, `public.submit_first_piece('${j}', 'print', ${arr([p1])}, 'สีตามม็อคอัพ')`)
    await reject('ส่งชิ้นแรกซ้ำระหว่างรออนุมัติไม่ได้', U.sup, `public.submit_first_piece('${j}', 'print', ${arr([p1])})`, /รอแอดมินอนุมัติ/)
    ok('แจ้งแอดมิน/ผู้จัดการในกล่องข้อความ', await val(`select audience::text from public.inbox_messages where dedupe_key = 'fp:${c1}'`) === '{admin,manager}')
    await reject('รออนุมัติ กดเสร็จไม่ได้', U.sup, `public.finish_station('${j}', 'print')`, /รูปชิ้นแรกรอแอดมินอนุมัติ/)
    await reject('หัวหน้าสถานีอนุมัติชิ้นแรกเองไม่ได้', U.sup, `public.decide_first_piece(${c1}, true)`, /ทำขั้นนี้ไม่ได้/)
    await reject('QC อนุมัติชิ้นแรกไม่ได้', U.qc, `public.decide_first_piece(${c1}, true)`, /ทำขั้นนี้ไม่ได้/)
    await reject('ไม่ผ่านต้องมีเหตุผล', U.admin, `public.decide_first_piece(${c1}, false, '  ')`, /ใส่เหตุผลที่ไม่ผ่าน/)
    await as(U.admin, () => db.exec(`update public.station_checks set status = 'approved' where id = ${c1}`)).catch(() => {})
    ok('ผู้ใช้แก้สถานะรูปตรงไม่ได้ (ต้องผ่าน RPC)', await val(`select status from public.station_checks where id = ${c1}`) === 'pending')
    await pass('แอดมินกด "ไม่ผ่าน" พร้อมเหตุผล', U.admin, `public.decide_first_piece(${c1}, false, 'สีเพี้ยน')`)
    await reject('ตัดสินซ้ำไม่ได้', U.mgr, `public.decide_first_piece(${c1}, true)`, /ตัดสินไปแล้ว/)
    ok('แจ้งหน้างานว่าชิ้นแรกไม่ผ่าน', String(await val(`select body from public.inbox_messages where dedupe_key = 'fpr:${c1}'`)).includes('สีเพี้ยน'))
    await reject('ชิ้นแรกไม่ผ่าน กดเสร็จไม่ได้ · บอกเหตุผล', U.sup, `public.finish_station('${j}', 'print')`, /ชิ้นแรกไม่ผ่าน \(สีเพี้ยน\)/)
    const p2 = await photo(j, 'aa02')
    await reject('ไม่ผ่านแล้วส่งรูปเดิมซ้ำไม่ได้', U.sup, `public.submit_first_piece('${j}', 'print', ${arr([p1])})`, /เคยส่งไปแล้ว ให้ถ่ายรูปใหม่/)
    const c2 = await pass('แก้แล้วส่งรูปชิ้นแรกใหม่ได้', U.sup, `public.submit_first_piece('${j}', 'print', ${arr([p2])})`)
    ok('ส่งใหม่บันทึกใน events ว่าเป็นการส่งซ้ำ', await val(`select (payload->>'resend')::boolean from public.events where job_id = '${j}' and type = 'first_piece_sent' order by id desc limit 1`) === true)
    await pass('ผู้จัดการกด "ผ่าน" ได้', U.mgr, `public.decide_first_piece(${c2}, true)`)
    await reject('ผ่านชิ้นแรกแล้วส่งชิ้นแรกอีกไม่ได้', U.sup, `public.submit_first_piece('${j}', 'print', ${arr([p2])})`, /ชิ้นแรกผ่านแล้ว/)
    await reject('ผ่านชิ้นแรกแต่ยังไม่มีรูปงานเสร็จ กดเสร็จไม่ได้', U.sup, `public.finish_station('${j}', 'print')`, /ถ่ายรูปงานเสร็จอย่างน้อย 1 รูป/)
    await reject('ใช้รูปชิ้นแรกที่ผ่านแล้วเป็นรูปงานเสร็จไม่ได้', U.sup, `public.add_finish_photos('${j}', 'print', ${arr([p2])})`, /เคยส่งไปแล้ว/)
    const p3 = await photo(j, 'aa03')
    const flag = async () => (await as(U.qc, () => db.query(`select * from public.station_photo_flags() where job_id = '${j}'`))).rows[0]
    const f1 = await flag()
    ok('สรุปสถานะรูปให้หน้าเว็บ: ผ่านชิ้นแรก ยังไม่มีรูปงานเสร็จ', f1?.needs_first_piece === true && f1.first_piece === 'approved' && f1.finish_photos === 0, JSON.stringify(f1))
    const fin = await pass('ส่งรูปงานเสร็จได้', U.sup, `public.add_finish_photos('${j}', 'print', ${arr([p3])})`)
    const again = await pass('ส่งรูปงานเสร็จชุดเดิมซ้ำหลังเน็ตหลุด ไม่ error', U.sup, `public.add_finish_photos('${j}', 'print', ${arr([p3])})`)
    ok('ส่งรูปงานเสร็จชุดเดิมซ้ำ ได้รายการเดิม ไม่เพิ่มแถว', String(again) === String(fin), `${fin} / ${again}`)
    ok('สรุปสถานะรูปนับรูปงานเสร็จ', (await flag())?.finish_photos === 1)
    ok('ทุกขั้นบันทึกใน events', await val(`select string_agg(type, ',' order by id) from public.events where job_id = '${j}' and (type like 'first_piece%' or type = 'finish_photo')`)
      === 'first_piece_sent,first_piece_rejected,first_piece_sent,first_piece_ok,finish_photo')
    await pass('ครบทั้งชิ้นแรกและรูปงานเสร็จ กดเสร็จได้', U.sup, `public.finish_station('${j}', 'print')`)
    ok('งานไปสถานีถัดไป', (await station(j)) !== 'print')
    ok('ทุกคนที่เห็นงานเห็นรูป', (await as(U.qc, () => db.query(`select public.file_read_allowed('station_photos', ${arr([p1, p3])}) r`))).rows[0].r.length === 2)
    ok('รูปที่ไม่ได้ผูกกับงานเปิดไม่ได้', (await as(U.qc, () => db.query(`select public.file_read_allowed('station_photos', ${arr(['SC-PH-1/print/0/nope.jpg'])}) r`))).rows[0].r.length === 0)

    const next = await station(j)
    await pass(`กดเริ่มสถานีถัดไป (${next})`, U.sup, `public.start_station('${j}')`)
    await reject('รูปรอบก่อนใช้ที่สถานีใหม่ไม่ได้', U.sup, `public.finish_station('${j}', '${next}')`, /ถ่ายรูปชิ้นแรก|ถ่ายรูปงานเสร็จ/)

    const qcSeq = await val(`select seq from public.route_stations where route_code = 'normal' and station_code = 'qc_pack'`)
    const s = await jobAt('SC-PH-QC', 'normal', qcSeq)
    ok('งานทดสอบอยู่สถานี QC', (await station(s)) === 'qc_pack')
    await pass('QC กดเริ่ม', U.qc, `public.start_station('${s}')`)
    const qp = await photo(s, 'bb01')
    await reject('สถานีที่ไม่ล็อกชิ้นแรก ส่งรูปชิ้นแรกไม่ได้', U.qc, `public.submit_first_piece('${s}', 'qc_pack', ${arr([qp])})`, /ไม่ต้องส่งรูปชิ้นแรก/)
    const qp2 = await photo(s, 'bb02')
    await pass('สถานีที่ไม่ล็อกชิ้นแรก ส่งรูปงานเสร็จได้ทันที (2 รูป)', U.qc, `public.add_finish_photos('${s}', 'qc_pack', ${arr([qp, qp2])})`)
    ok('สรุปสถานะนับจำนวนรูป ไม่ใช่จำนวนครั้งที่ส่ง', (await as(U.qc, () => db.query(`select finish_photos from public.station_photo_flags() where job_id = '${s}'`))).rows[0]?.finish_photos === 2)
    const miss = await val(`select array_to_string(private.missing_substeps('${s}'), ' · ')`)
    ok('QC ยังติดแค่ยอดตรวจ ไม่ติดรูป', !/รูป/.test(miss) && /QC ตรวจผ่าน/.test(miss), miss)

    const w = await jobAt('SC-PH-W', 'normal', 1)
    await pass('เริ่มงานจับเวลารออนุมัติ', U.sup, `public.start_station('${w}')`)
    const wp = await photo(w, 'cc01')
    const cw = await pass('ส่งชิ้นแรก', U.sup, `public.submit_first_piece('${w}', 'print', ${arr([wp])})`)
    await db.exec(`update public.station_checks set sent_at = now() - interval '20 minutes' where id = ${cw}`)
    await db.exec(`update public.station_photo_settings set enabled_at = now() - interval '2 hours';
      update public.jobs set station_started_at = now() - interval '1 hour' where id = '${w}'`)
    ok('สรุปสถานะส่งเวลาเตือนที่ตั้งไว้ให้หน้าเว็บ', (await as(U.qc, () => db.query(`select remind_minutes from public.station_photo_flags() where job_id = '${w}'`))).rows[0]?.remind_minutes === 15)
    ok('pg_cron เรียกตัวตรวจที่รวมเตือนรูปชิ้นแรก', Number(await val(`select count(*) from pg_proc where proname = 'inbox_scan_cron'`)) === 1
      && Number(await val(`select private.inbox_scan_cron()`)) >= 0)
    await as(U.sup, () => db.query(`select public.inbox_scan()`))
    ok('รอเกิน 15 นาที เตือนผู้จัดการ + ฝ่ายผลิต', await val(`select audience::text from public.inbox_messages where dedupe_key = 'fpl:${cw}'`) === '{manager,production}')
    await as(U.sup, () => db.query(`select public.inbox_scan()`))
    ok('เตือนรอบเดียวต่อรายการ', Number(await val(`select count(*) from public.inbox_messages where dedupe_key = 'fpl:${cw}'`)) === 1)

    await db.exec(`update public.jobs set station_status = 'queued' where id = '${w}'`)
    ok('งานกลับเข้าคิวระหว่างรออนุมัติ ยังอยู่ในรายการรออนุมัติของแอดมิน',
      (await as(U.admin, () => db.query(`select first_piece from public.station_photo_flags() where job_id = '${w}'`))).rows[0]?.first_piece === 'pending')
    await db.exec(`update public.jobs set station_status = 'doing' where id = '${w}'`)

    await db.exec(`update public.stations set first_piece_check = false where code = 'print'; delete from public.inbox_messages where dedupe_key = 'fpl:${cw}'`)
    await as(U.sup, () => db.query(`select public.inbox_scan()`))
    ok('เลิกล็อกชิ้นแรกของสถานีระหว่างรอ: ไม่เตือนรอนาน', Number(await val(`select count(*) from public.inbox_messages where dedupe_key = 'fpl:${cw}'`)) === 0)
    await db.exec(`update public.stations set first_piece_check = true where code = 'print'`)

    const sp = await jobAt('SC-PH-SPLIT', 'normal', 1)
    await pass('งานที่จะแบ่ง: เริ่มสถานีพิมพ์', U.sup, `public.start_station('${sp}')`)
    const spc = await pass('งานที่จะแบ่ง: ส่งชิ้นแรก', U.sup, `public.submit_first_piece('${sp}', 'print', ${arr([await photo(sp, 'dd01')])})`)
    await db.exec(`update public.jobs set station_status = 'queued' where id = '${sp}'`)
    const child = await pass('แบ่งงานที่รออนุมัติชิ้นแรก (กลับเข้าคิวแล้ว)', U.admin, `public.split_job('${sp}', 4)`)
    ok('ส่วนที่แบ่งรอรูปชิ้นแรกของงานต้นทาง', (await as(U.admin, () => db.query(`select first_piece_id from public.station_photo_flags() where job_id = '${child}'`))).rows[0]?.first_piece_id === spc)
    await pass('ส่วนที่แบ่งกดเริ่ม', U.sup, `public.start_station('${child}')`)
    await reject('ส่วนที่แบ่งส่งชิ้นแรกซ้ำระหว่างรอไม่ได้', U.sup, `public.submit_first_piece('${child}', 'print', ${arr([await photo(child, 'dd02')])})`, /รอแอดมินอนุมัติ/)
    await pass('ยกเลิกงานต้นทาง', U.owner, `public.cancel_job('${sp}', 'ทดสอบยกเลิกงานแม่')`)
    await pass('งานต้นทางยกเลิกแล้ว ยังตัดสินรูปให้ส่วนที่แบ่งได้', U.admin, `public.decide_first_piece(${spc}, true)`)
    ok('ส่วนที่แบ่งเห็นว่าชิ้นแรกผ่าน', (await as(U.admin, () => db.query(`select first_piece from public.station_photo_flags() where job_id = '${child}'`))).rows[0]?.first_piece === 'approved')

    const staff = '00000000-0000-0000-0000-0000000005a6'
    await db.exec(`insert into auth.users values ('${staff}','sp6@test');
      insert into public.profiles (user_id, name, role, active) values ('${staff}','พนักงานตัด รูป','staff',true);
      insert into public.staff_stations (user_id, station_code) values ('${staff}','cut');`)
    const cutSeq = await val(`select seq from public.route_stations where route_code = 'normal' and station_code = 'cut'`)
    const cj = await jobAt('SC-PH-STAFF', 'normal', cutSeq)
    await pass('พนักงานตัดเริ่มงานสถานีตัด', staff, `public.start_station('${cj}')`)
    const cp = await photo(cj, 'ee01')
    await pass('พนักงานสถานีอัปโหลดรูปจากสถานีได้', staff, `public.file_upload_allowed('station_photos', ${q(cp)}, 1000, 'image/jpeg')`)
    const lone = '00000000-0000-0000-0000-0000000005a7'
    await db.exec(`insert into auth.users values ('${lone}','sp7@test');
      insert into public.profiles (user_id, name, role, active) values ('${lone}','พนักงานยังไม่จับคู่ รูป','staff',true);`)
    await reject('พนักงานที่ยังไม่จับคู่สถานีอัปโหลดรูปไม่ได้', lone, `public.file_upload_allowed('station_photos', ${q(cp)}, 1000, 'image/jpeg')`, /ไม่ใช่สถานีของคุณ/)
    await reject('อัปโหลดเข้าโฟลเดอร์งานที่ไม่มีอยู่ไม่ได้', staff, `public.file_upload_allowed('station_photos', 'SC-OTHER-JOB/cut/99/hack01.jpg', 1000, 'image/jpeg')`, /ไม่ใช่ของงานที่กำลังทำ/)
    await reject('อัปโหลดเข้ารอบอื่นของงานเดียวกันไม่ได้', staff, `public.file_upload_allowed('station_photos', ${q(cp.replace('/cut/0/', '/cut/9/'))}, 1000, 'image/jpeg')`, /ไม่ใช่ของงานที่กำลังทำ/)
    await reject('QC อัปโหลดรูปสถานีตัดไม่ได้', U.qc, `public.file_upload_allowed('station_photos', ${q(cp)}, 1000, 'image/jpeg')`, /QC ส่งรูปได้เฉพาะ/)
    await pass('หัวหน้าสถานีอัปโหลดรูปงานที่กำลังทำได้', U.sup, `public.file_upload_allowed('station_photos', ${q(cp)}, 1000, 'image/jpeg')`)
    ok('พนักงานที่ยังไม่จับคู่สถานีเปิดรูปสถานีไม่ได้', (await as(lone, () => db.query(`select public.file_read_allowed('station_photos', ${arr([p1, p3])}) r`))).rows[0].r.length === 0)
    ok('พนักงานที่จับคู่สถานีแล้วเปิดรูปสถานีได้', (await as(staff, () => db.query(`select public.file_read_allowed('station_photos', ${arr([p1, p3])}) r`))).rows[0].r.length === 2)
    await pass('พนักงานตัดส่งรูปชิ้นแรกงานที่สถานีตัวเอง', staff, `public.submit_first_piece('${cj}', 'cut', ${arr([cp])})`)
    const pj = await jobAt('SC-PH-STAFF-P', 'normal', 1)
    await pass('หัวหน้าเริ่มงานพิมพ์', U.sup, `public.start_station('${pj}')`)
    await reject('พนักงานตัดอัปโหลดรูปงานสถานีพิมพ์ไม่ได้', staff, `public.file_upload_allowed('station_photos', 'SC-PH-STAFF-P/print/0/ee03.jpg', 1000, 'image/jpeg')`, /ไม่ใช่สถานีของคุณ/)
    await jobAt('SC-PH-QUEUED', 'normal', 1)
    await reject('งานที่ยังไม่กดเริ่ม อัปโหลดรูปไม่ได้', U.sup, `public.file_upload_allowed('station_photos', 'SC-PH-QUEUED/print/0/ee04.jpg', 1000, 'image/jpeg')`, /ไม่ใช่ของงานที่กำลังทำ/)
    await reject('พนักงานตัดส่งรูปงานสถานีพิมพ์ไม่ได้', staff, `public.submit_first_piece('${pj}', 'print', ${arr([await photo(pj, 'ee02')])})`, /ไม่ใช่สถานีของคุณ/)
    await reject('พนักงานตัดอนุมัติชิ้นแรกไม่ได้', staff, `public.decide_first_piece(${spc}, true)`, /ทำขั้นนี้ไม่ได้/)

    const sewSeq = await val(`select seq from public.route_stations where route_code = 'normal' and station_code = 'sew'`)
    const sj = await jobAt('SC-PH-SEW', 'normal', sewSeq)
    await db.exec(`set session_replication_role = replica;
      update public.jobs set station_status = 'doing', station_started_at = now() where id = '${sj}';
      set session_replication_role = origin;`)
    ok('สถานีเย็บ: ไม่มีรูปงานเสร็จ ยังเย็บเสร็จไม่ได้', /ถ่ายรูปงานเสร็จอย่างน้อย 1 รูป/.test(await val(`select array_to_string(private.missing_substeps('${sj}'), ' · ')`)))
    await reject('สถานีเย็บไม่ต้องส่งรูปชิ้นแรก', U.prod, `public.submit_first_piece('${sj}', 'sew', ${arr([await photo(sj, 'ff01')])})`, /ไม่ต้องส่งรูปชิ้นแรก/)
    await pass('ฝ่ายผลิตส่งรูปงานเสร็จของสถานีเย็บ', U.prod, `public.add_finish_photos('${sj}', 'sew', ${arr([await photo(sj, 'ff02')])})`)
    ok('สถานีเย็บ: มีรูปงานเสร็จแล้ว ไม่ติดรูป', !/รูป/.test(await val(`select coalesce(array_to_string(private.missing_substeps('${sj}'), ' · '), '')`)))

    const oj = await jobAt('SC-PH-OUT', 'normal', 1)
    await pass('งานที่จะส่งออก: เริ่มสถานีพิมพ์', U.sup, `public.start_station('${oj}')`)
    const oc = await pass('งานที่จะส่งออก: ส่งชิ้นแรก', U.sup, `public.submit_first_piece('${oj}', 'print', ${arr([await photo(oj, 'gg01')])})`)
    await db.exec(`set session_replication_role = replica;
      update public.jobs set station_status = 'out' where id = '${oj}';
      set session_replication_role = origin;`)
    await reject('ส่งงานออกข้างนอกแล้ว ตัดสินรูปชิ้นแรกที่ค้างไม่ได้', U.admin, `public.decide_first_piece(${oc}, true)`, /ส่งออกข้างนอกแล้ว/)
    ok('ส่งออกแล้ว รูปยังรออยู่ (ไม่ถูกตัดสิน)', await val(`select status from public.station_checks where id = ${oc}`) === 'pending')
    await db.exec(`set session_replication_role = replica;
      update public.jobs set station_status = 'doing' where id = '${oj}';
      set session_replication_role = origin;`)
    const offJob = await jobAt('SC-PH-OFF', 'normal', 1)
    await pass('งานที่ค้างตอนปิดระบบ: เริ่มสถานีพิมพ์', U.sup, `public.start_station('${offJob}')`)
    const offCheck = await pass('งานที่ค้างตอนปิดระบบ: ส่งชิ้นแรก', U.sup, `public.submit_first_piece('${offJob}', 'print', ${arr([await photo(offJob, 'hh01')])})`)
    await pass('เปิด/ปิดฟีเจอร์: เจ้าของปิดได้', U.owner, `public.set_station_photos_enabled(false)`)
    await reject('ปิดระบบรูปแล้ว ตัดสินรูปชิ้นแรกที่ค้างไม่ได้', U.admin, `public.decide_first_piece(${offCheck}, true)`, /ปิดระบบรูปยืนยันงานแล้ว/)
    await reject('ปิดระบบรูปแล้ว อัปโหลดรูปสถานีไม่ได้', U.sup, `public.file_upload_allowed('station_photos', 'SC-PH-OFF/print/0/hh02.jpg', 1000, 'image/jpeg')`, /ไม่ใช่ของงานที่กำลังทำ/)
    ok('เปิด/ปิดฟีเจอร์ บันทึกในบันทึกการเปลี่ยนแปลง', Number(await val(`select count(*) from public.audit_log where table_name = 'station_photo_settings'`)) > 0)
    await pass('ปิดแล้ว งานที่ค้างรูปกดเสร็จได้', U.sup, `public.finish_station('${w}', 'print')`)
    await enable(true)
    await reject('งานออกจากสถานีแล้ว ตัดสินรูปที่ค้างไม่ได้', U.admin, `public.decide_first_piece(${cw}, true)`, /ออกจากสถานีนี้แล้ว/)
    await enable(false)
    await db.exec(`update public.station_checks set sent_at = now() - interval '30 minutes' where id = ${cw}; delete from public.inbox_messages where dedupe_key = 'fpl:${cw}'`)
    await as(U.sup, () => db.query(`select public.inbox_scan()`))
    ok('รูปที่ค้างหลังงานออกจากสถานี ไม่เตือนรอนาน', Number(await val(`select count(*) from public.inbox_messages where dedupe_key = 'fpl:${cw}'`)) === 0)
    const tooMany = await db.query(`insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date, route_code, confirmation_pdf_path)
      values ('SC-PH-BIG','ลูกค้า','งาน','tshirt',999999999,'ตัว','2026-12-31','normal','x.pdf')`).then(() => 'ผ่าน', e => e.message)
    ok('จำนวนงานเกิน 100,000 ถือว่าพิมพ์ผิด', /มากเกินไป ตรวจว่าพิมพ์ตัวเลขถูกไหม/.test(tooMany), tooMany)
    ok('จำนวน 100,000 พอดี รับได้', !!(await jobAt('SC-PH-MAX', 'normal', 1).then(id => db.query(`update public.jobs set qty = 100000 where id = '${id}' returning id`))).rows.length)
  } finally {
    await enable(false)
    await db.exec(`delete from private.file_settings; delete from private.file_objects where kind = 'station_photos'`)
  }
  skips.report()
}
