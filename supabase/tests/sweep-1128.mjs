// รีดฟิล์มที่บริษัทภายนอกทำแล้วไม่เตือนฟิล์ม · ร้านขายวัตถุดิบรับงานส่งออกไม่ได้ · เพิ่มบริษัทชื่อเดิมไม่ลบงานที่รับ · แนบใบเซ็นทุกส่วนที่แบ่ง
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'

export async function sweep1128Tests({ db, ok }) {
  const file = '20261217000000_sweep_1128.sql'
  try { await db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8')); ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, true) }
  catch (e) { ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, false, e.message.split('\n')[0]) }
  const U = { admin: '00000000-0000-0000-0000-00000000a801', prod: '00000000-0000-0000-0000-00000000a802' }
  const q = v => `'${String(v).replace(/'/g, "''")}'`
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] ?? {})[0]
  const run = async (uid, sql) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`)
    const r = await db.query(`select ${sql}`)
    await db.exec('reset role')
    return r
  }
  const tryOnly = async (uid, sql) => {
    await db.exec('savepoint sw')
    try { await run(uid, sql); return null } catch (e) { return e.message.split('\n')[0] }
    finally { await db.exec('rollback to savepoint sw; reset role') }
  }
  const keep = async (uid, sql) => {
    await db.exec('savepoint sw')
    try { const r = await run(uid, sql); await db.exec('release savepoint sw'); return r.rows[0] ? Object.values(r.rows[0])[0] : null }
    catch (e) { await db.exec('rollback to savepoint sw; reset role'); throw e }
  }
  const pass = async (name, uid, sql) => { try { return await keep(uid, sql) ?? ok(name, true) } catch (e) { ok(name, false, e.message.split('\n')[0]) } }
  const reject = async (name, uid, sql, re) => { const err = await tryOnly(uid, sql); ok(name, !!err && re.test(err), err ?? 'ควรถูกปฏิเสธแต่ผ่าน') }
  const receive = (no, route, qty = 40) => keep(U.admin, `public.receive_job(p_confirmation_no => ${q(no)}, p_customer_name => 'ลูกค้าตรวจรอบ 28', p_job_name => 'เสื้อทีม',
    p_product_type_code => 'tshirt', p_qty => ${qty}, p_unit => 'ตัว', p_due_date => current_date + 30, p_route_code => '${route}',
    p_confirmation_pdf_path => null, p_spare_qty => 0, p_confirmation_rev => 0, p_spec => '{}'::jsonb, p_needs_sample => false)::text`)
  const send = (id, vendor, last = null) => `public.send_out('${id}', ${vendor}, ${last ? q(last) : 'null'}, now() + interval '1 hour', 2, now() + interval '3 days', null)`
  const lastRun = async id => val('select id from public.outsource_runs where job_id = $1 order by id desc limit 1', [id])
  const filmLate = id => val(`select count(*)::int from public.inbox_messages where kind = 'film_late' and job_id = $1`, [id])

  await db.exec('begin')
  try {
    await db.exec(`
      insert into auth.users values ('${U.admin}','sw-admin@test'),('${U.prod}','sw-prod@test');
      insert into public.profiles (user_id,name,role,active) values ('${U.admin}','แอดมิน ตรวจรอบ 28','admin',true),('${U.prod}','ฝ่ายผลิต ตรวจรอบ 28','production',true);
      update public.production_settings set materials_check = false;
      insert into private.file_settings (record_secret) select 'sweep-1128-secret-0123456789abcdef0123' where not exists (select 1 from private.file_settings);
    `)
    const vendor = await val(`insert into public.vendors (name, stations) values ('บริษัทรับรีด ตรวจรอบ 28', '{dtf_press,sew}') returning id`)
    const supplier = await val(`insert into public.vendors (name, stations, kind) values ('ร้านฟิล์ม ตรวจรอบ 28', '{dtf_press}', 'supplier') returning id`)

    const late = await receive('SC-SW-FILM', 'dtf')
    await db.query('select private.enter_station($1, 2)', [late])
    await db.query(`update public.jobs set dtf_film_eta = current_date - 3 where id = $1`, [late])
    await db.query('select private.inbox_scan_all()')
    ok('ฟิล์มเลยกำหนด งานยังรอที่รีดฟิล์ม = เตือน', (await filmLate(late)) === 1)
    await db.query(`delete from public.inbox_messages where job_id = $1`, [late])

    await reject('ส่งออกให้ร้านขายวัตถุดิบ/ฟิล์มไม่ได้', U.admin, send(late, supplier), /ร้านขายวัตถุดิบ\/ฟิล์ม รับงานส่งออกไม่ได้/)
    ok('ส่งไม่สำเร็จ งานยังอยู่โรงงาน', (await val('select station_status from public.jobs where id = $1', [late])) === 'queued')
    await pass('ส่งรีดฟิล์มให้บริษัทรับงานได้', U.admin, send(late, vendor))
    const run1 = await lastRun(late)
    await reject('ส่งต่อให้ร้านขายวัตถุดิบไม่ได้', U.admin, `public.forward_out(${run1}, ${supplier}, 'sew', now() + interval '1 hour', 2, now() + interval '3 days', null)`, /ร้านขายวัตถุดิบ/)
    await pass('รับของกลับจากบริษัท', U.admin, `public.receive_back(${run1}, null)`)
    ok('รับกลับแล้วไปรอที่เย็บ', (await val('select current_station from public.job_live where id = $1', [late])) === 'sew')
    await db.query('select private.inbox_scan_all()')
    ok('ผ่านรีดฟิล์มแล้ว (บริษัททำ) ไม่เตือนฟิล์มเลยกำหนดอีก', (await filmLate(late)) === 0)
    ok('ประวัติมีการส่งออกและรับกลับ', (await val(`select count(*)::int from public.events where job_id = $1 and type in ('outsource_sent', 'outsource_received')`, [late])) >= 2)

    const before = await val(`select stations from public.vendors where name = 'บริษัทรับรีด ตรวจรอบ 28'`)
    await pass('เพิ่มบริษัทชื่อเดิมพร้อมงานใหม่ได้', U.admin, `public.add_vendor('บริษัทรับรีด ตรวจรอบ 28', '{cut}', null)`)
    const after = await val(`select stations from public.vendors where name = 'บริษัทรับรีด ตรวจรอบ 28'`)
    ok('บริษัทชื่อเดิม: งานที่รับอยู่ไม่หาย + เพิ่มงานใหม่', JSON.stringify(before) === '["dtf_press","sew"]' && JSON.stringify(after) === '["cut","dtf_press","sew"]', JSON.stringify(after))
    await reject('ยังเพิ่มบริษัทรับ QC + Packing ไม่ได้', U.admin, `public.add_vendor('บริษัทรับรีด ตรวจรอบ 28', '{qc_pack}', null)`, /พิมพ์ · รีด · ตัด · รีดฟิล์ม · เย็บ · ปัก/)

    const secret = await val('select record_secret from private.file_settings limit 1')
    const record = (path, type) => `public.record_file_upload('confirmations', ${q(path)}, 1000, ${q(type)}, ${q(createHmac('sha256', secret).update(`confirmations|${path}|1000|${type}`).digest('hex'))})`
    const root = await receive('SC-SW-SPL', 'normal', 80)
    const part = await keep(U.admin, `public.split_job('${root}', 30)::text`)
    const partNo = await val('select confirmation_no from public.jobs where id = $1', [part])
    const signed = 'SC-SW-SPL/feed11.jpg'
    await keep(U.admin, record(signed, 'image/jpeg'))
    await pass('แนบใบเซ็นที่งานแม่หลังแบ่งงานได้', U.admin, `public.attach_confirmation_pdf('${root}', ${q(signed)})`)
    const paths = (await db.query('select confirmation_pdf_path p from public.jobs where id = any($1::uuid[])', [[root, part]])).rows.map(r => r.p)
    ok('ส่วนที่แบ่งได้ใบเซ็นด้วย', paths.length === 2 && paths.every(p => p === signed), JSON.stringify(paths))
    const fromPart = `${partNo.replace(/[^A-Za-z0-9-]/g, '_')}/feed12.png`
    await keep(U.admin, record(fromPart, 'image/png'))
    await pass('แนบใบเซ็นจากส่วนที่แบ่งได้', U.admin, `public.attach_confirmation_pdf('${part}', ${q(fromPart)})`)
    ok('แนบจากส่วนที่แบ่ง = งานแม่เปลี่ยนด้วย', (await val('select confirmation_pdf_path from public.jobs where id = $1', [root])) === fromPart)
    ok('ประวัติแนบใบบันทึกที่งานที่กด', (await val(`select count(*)::int from public.events where job_id = $1 and type = 'confirmation_pdf'`, [part])) === 1)

    await reject('ฝ่ายผลิตแนบใบเซ็นไม่ได้', U.prod, `public.attach_confirmation_pdf('${root}', ${q(signed)})`, /บทบาทของคุณ \(production\)/)
  } finally {
    await db.exec('rollback')
  }
}
