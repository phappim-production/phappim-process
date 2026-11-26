// ส่งออกบริษัทภายนอกจากขั้นรอผลิต: ไม่ต้องเช็ควัตถุดิบ · ปล่อยเข้าไลน์แล้วส่งออกจากสถานีแรก · ส่งไม่สำเร็จ = ยังรอผลิต
import { readFileSync } from 'node:fs'

export async function outsourceWaitingTests({ db, ok }) {
  const file = '20261208000000_outsource_from_waiting.sql'
  try { await db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8')); ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, true) }
  catch (e) { ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, false, e.message.split('\n')[0]) }
  const U = { admin: '00000000-0000-0000-0000-00000000ff01', prod: '00000000-0000-0000-0000-00000000ff02' }
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] ?? {})[0]
  const run = async (uid, sql) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`)
    const r = await db.query(`select ${sql}`)
    await db.exec('reset role')
    return r
  }
  const tryOnly = async (uid, sql) => {
    await db.exec('savepoint ow')
    try { await run(uid, sql); return null } catch (e) { return e.message.split('\n')[0] }
    finally { await db.exec('rollback to savepoint ow; reset role') }
  }
  const keep = async (uid, sql) => {
    await db.exec('savepoint ow')
    try { const r = await run(uid, sql); await db.exec('release savepoint ow'); return r.rows[0] ? Object.values(r.rows[0])[0] : null }
    catch (e) { await db.exec('rollback to savepoint ow; reset role'); throw e }
  }
  const pass = async (name, uid, sql) => { try { await keep(uid, sql); ok(name, true) } catch (e) { ok(name, false, e.message.split('\n')[0]) } }
  const reject = async (name, uid, sql, re) => { const err = await tryOnly(uid, sql); ok(name, !!err && re.test(err), err ?? 'ควรถูกปฏิเสธแต่ผ่าน') }
  const receive = (no, route, sample = false) => keep(U.admin, `public.receive_job(p_confirmation_no => '${no}', p_customer_name => 'ลูกค้าส่งออก', p_job_name => 'ผ้าเช็ดแว่น',
    p_product_type_code => 'tshirt', p_qty => 500, p_unit => 'ตัว', p_due_date => current_date + 30, p_route_code => '${route}',
    p_confirmation_pdf_path => null, p_spare_qty => 0, p_confirmation_rev => 0, p_spec => '{}'::jsonb, p_needs_sample => ${sample})::text`)
  const send = (id, vendor, last = null) => `public.send_out('${id}', ${vendor}, ${last ? `'${last}'` : 'null'}, now() + interval '1 hour', 2, now() + interval '3 days', 'ส่งจากรอผลิต')`
  const job = async id => (await db.query('select phase, station_status, current_station, queue_seq from public.job_live where id = $1', [id])).rows[0]

  await db.exec('begin')
  try {
    await db.exec(`
      insert into auth.users values ('${U.admin}','ow-admin@test'),('${U.prod}','ow-prod@test');
      insert into public.profiles (user_id,name,role,active) values ('${U.admin}','แอดมิน ส่งออก','admin',true),('${U.prod}','ฝ่ายผลิต ส่งออก','production',true);
      update public.production_settings set materials_check = true;
    `)
    const vendor = await val(`insert into public.vendors (name) values ('บริษัทรับผลิตทดสอบรอผลิต') returning id`)
    const off = await val(`insert into public.vendors (name, active) values ('บริษัทที่ปิดแล้ว', false) returning id`)
    const out = await receive('SC-OW-OUT', 'outside')
    const earlier = await receive('SC-OW-EARLY', 'plain')
    ok('งานผลิตข้างนอกทั้งหมดรับแล้วค้างที่รอผลิต', (await job(out)).phase === 'materials')

    await reject('ฝ่ายผลิตส่งออกไม่ได้', U.prod, send(out, vendor), /บทบาทของคุณ \(production\)/)
    await reject('บริษัทที่ปิดแล้วส่งไม่ได้ · งานยังรอผลิต', U.admin, send(out, off), /ไม่พบบริษัทนี้/)
    ok('ส่งไม่สำเร็จ = ไม่ปล่อยเข้าไลน์ ไม่มี event ปล่อย', (await job(out)).phase === 'materials'
      && (await val(`select count(*)::int from public.events where job_id = $1 and type = 'released'`, [out])) === 0)

    const qBefore = Number((await job(earlier)).queue_seq)
    await pass('แอดมินส่งออกจากรอผลิตได้ โดยยังไม่มีรายการวัตถุดิบ / รูป', U.admin, send(out, vendor))
    let s = await job(out)
    ok('ส่งออกแล้ว: อยู่ที่บริษัทภายนอก สถานีสั่งผลิตข้างนอก', s.phase === 'production' && s.station_status === 'out' && s.current_station === 'outside', JSON.stringify(s))
    ok('คิวต่อท้ายงานที่รับก่อน (นับวันที่ปล่อย)', Number(s.queue_seq) > qBefore, `${s.queue_seq} vs ${qBefore}`)
    const ev = (await db.query(`select type, payload from public.events where job_id = $1 and type in ('released', 'outsource_sent') order by id`, [out])).rows
    ok('ประวัติ: ปล่อยเข้าไลน์ (ส่งออก ไม่เช็ควัตถุดิบ) แล้วส่งออก', ev.length === 2 && ev[0].type === 'released' && ev[0].payload.manual === true
      && ev[0].payload.outsource === true && ev[0].payload.materials === 0 && ev[1].type === 'outsource_sent', JSON.stringify(ev))
    const lead = await val(`select private.lead_state($1)`, [out])
    ok('เวลาผลิตเริ่มนับวันที่ส่งออก (วันปล่อย)', lead.lead_start === await val(`select ((now() at time zone 'Asia/Bangkok')::date)::text`), JSON.stringify(lead))

    const cut = await receive('SC-OW-CUT', 'normal', true)
    await pass('งานขึ้นตัวอย่าง: ส่งออกจากรอผลิตได้ (ตัวอย่างทำข้างนอก)', U.admin, send(cut, vendor, 'press'))
    s = await job(cut)
    ok('งานขึ้นตัวอย่างอยู่ขั้นตัวอย่างที่บริษัทภายนอก', s.phase === 'sample' && s.station_status === 'out', JSON.stringify(s))

    const svc = await keep(U.admin, `public.receive_job(p_confirmation_no => 'SC-OW-DTF', p_customer_name => 'ลูกค้า', p_job_name => 'DTF',
      p_product_type_code => 'svc_dtf', p_qty => 100, p_unit => 'ชิ้น', p_due_date => current_date + 30, p_route_code => 'dtf_only',
      p_confirmation_pdf_path => null, p_spare_qty => 0, p_confirmation_rev => 0,
      p_spec => '{"product":"svc_dtf","h":{"doc_no":"SC-OW-DTF"},"p":{"svc_dtf":{"film_source":"โรงงานสั่งฟิล์ม"}}}'::jsonb, p_needs_sample => false)::text`)
    await reject('สถานีแรกทำที่โรงงานเท่านั้น (รีดฟิล์ม) ส่งออกไม่ได้', U.admin, send(svc, vendor), /ทำที่โรงงานเท่านั้น/)
    ok('ส่งออกไม่ได้ = ยังรอผลิต', (await job(svc)).phase === 'materials')

    const mid = await receive('SC-OW-MID', 'plain')
    await keep(U.admin, `public.add_job_material('${mid}', 'ผ้า', now() + interval '2 days')`)
    await pass('มีรายการที่ยังไม่ติ๊กก็ส่งออกได้ (บริษัทจัดหาเอง)', U.admin, send(mid, vendor))
  } finally {
    await db.exec('rollback')
  }
}
