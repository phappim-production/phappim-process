// รีดฟิล์มส่งออกบริษัทภายนอกได้ทั้งงานตอนยังไม่เริ่มสถานี · เริ่ม/พักแล้วส่งไม่ได้
import { readFileSync } from 'node:fs'

export async function outsourceDtfPressTests({ db, ok }) {
  const file = '20261215000000_outsource_dtf_press.sql'
  try { await db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8')); ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, true) }
  catch (e) { ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, false, e.message.split('\n')[0]) }
  const U = { admin: '00000000-0000-0000-0000-00000000fd01', prod: '00000000-0000-0000-0000-00000000fd02' }
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] ?? {})[0]
  const run = async (uid, sql) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`)
    const r = await db.query(`select ${sql}`)
    await db.exec('reset role')
    return r
  }
  const tryOnly = async (uid, sql) => {
    await db.exec('savepoint od')
    try { await run(uid, sql); return null } catch (e) { return e.message.split('\n')[0] }
    finally { await db.exec('rollback to savepoint od; reset role') }
  }
  const keep = async (uid, sql) => {
    await db.exec('savepoint od')
    try { const r = await run(uid, sql); await db.exec('release savepoint od'); return r.rows[0] ? Object.values(r.rows[0])[0] : null }
    catch (e) { await db.exec('rollback to savepoint od; reset role'); throw e }
  }
  const pass = async (name, uid, sql) => { try { return await keep(uid, sql) ?? ok(name, true) } catch (e) { ok(name, false, e.message.split('\n')[0]) } }
  const reject = async (name, uid, sql, re) => { const err = await tryOnly(uid, sql); ok(name, !!err && re.test(err), err ?? 'ควรถูกปฏิเสธแต่ผ่าน') }
  const receive = (no, route, qty) => keep(U.admin, `public.receive_job(p_confirmation_no => '${no}', p_customer_name => 'ลูกค้ารีดฟิล์ม', p_job_name => 'เสื้อคนงาน',
    p_product_type_code => 'tshirt', p_qty => ${qty}, p_unit => 'ตัว', p_due_date => current_date + 30, p_route_code => '${route}',
    p_confirmation_pdf_path => null, p_spare_qty => 0, p_confirmation_rev => 0, p_spec => '{}'::jsonb, p_needs_sample => false)::text`)
  const send = (id, vendor, last = null) => `public.send_out('${id}', ${vendor}, ${last ? `'${last}'` : 'null'}, now() + interval '1 hour', 2, now() + interval '3 days', 'ส่งรีดฟิล์มข้างนอก')`
  const job = async id => (await db.query('select phase, station_status, current_station from public.job_live where id = $1', [id])).rows[0]
  const lastRun = async id => (await db.query('select id, stations, qty from public.outsource_runs where job_id = $1 order by id desc limit 1', [id])).rows[0]

  await db.exec('begin')
  try {
    await db.exec(`
      insert into auth.users values ('${U.admin}','od-admin@test'),('${U.prod}','od-prod@test');
      insert into public.profiles (user_id,name,role,active) values ('${U.admin}','แอดมิน รีดฟิล์ม','admin',true),('${U.prod}','ฝ่ายผลิต รีดฟิล์ม','production',true);
      update public.production_settings set materials_check = false;
    `)
    const vendor = await val(`insert into public.vendors (name, stations) values ('บริษัทรับรีด DTF ทดสอบ', '{dtf_press}') returning id`)

    const atPress = async (no, qty) => {
      const id = await receive(no, 'dtf', qty)
      await db.query('select private.enter_station($1, 2)', [id])
      return id
    }
    const whole = await atPress('SC-OD-WHOLE', 60)
    ok('งาน DTF รอเริ่มที่รีดฟิล์ม', JSON.stringify(await job(whole)).includes('"current_station":"dtf_press"') && (await job(whole)).station_status === 'queued')
    await reject('ฝ่ายผลิตส่งออกไม่ได้', U.prod, send(whole, vendor), /บทบาทของคุณ \(production\)/)
    await pass('แอดมินส่งออกทั้งงานจากรีดฟิล์มได้ (ยังไม่สั่งฟิล์ม)', U.admin, send(whole, vendor))
    let s = await job(whole)
    ok('ส่งแล้ว: อยู่ที่บริษัทภายนอก สถานีรีดฟิล์ม', s.station_status === 'out' && s.current_station === 'dtf_press', JSON.stringify(s))
    const r1 = await lastRun(whole)
    ok('ส่งทั้งงาน 60 ตัว · บริษัททำรีดฟิล์ม', r1?.qty === 60 && JSON.stringify(r1?.stations) === '["dtf_press"]', JSON.stringify(r1))
    ok('ประวัติบันทึกการส่งออก', (await val(`select count(*)::int from public.events where job_id = $1 and type = 'outsource_sent' and station_code = 'dtf_press'`, [whole])) === 1)
    await pass('รับของกลับได้', U.admin, `public.receive_back(${r1.id}, null)`)
    s = await job(whole)
    ok('รับกลับแล้วไปรอที่เย็บ', s.current_station === 'sew' && s.station_status === 'queued', JSON.stringify(s))

    const span = await atPress('SC-OD-SPAN', 40)
    await pass('ส่งรีดฟิล์มต่อเย็บที่บริษัทเดียวกันได้', U.admin, send(span, vendor, 'sew'))
    const r2 = await lastRun(span)
    ok('บริษัททำ รีดฟิล์ม → เย็บ', JSON.stringify(r2?.stations) === '["dtf_press","sew"]', JSON.stringify(r2))
    const fromCut = await receive('SC-OD-CUT', 'dtf', 40)
    await pass('ส่งจากตัดถึงรีดฟิล์มติดกันได้', U.admin, send(fromCut, vendor, 'dtf_press'))
    ok('บริษัททำ ตัด → รีดฟิล์ม', JSON.stringify((await lastRun(fromCut))?.stations) === '["cut","dtf_press"]')

    const started = await atPress('SC-OD-DOING', 30)
    await keep(U.admin, `public.order_film('${started}', current_date + 1)`)
    await keep(U.admin, `public.receive_film('${started}')`)
    await keep(U.prod, `public.start_station('${started}')`)
    await reject('เริ่มรีดฟิล์มแล้ว ส่งออกไม่ได้ (บอกว่ากำลังทำ)', U.admin, send(started, vendor), /ส่งออกได้เฉพาะงานที่ยังไม่เริ่มสถานีนี้ \(ตอนนี้: กำลังทำ\)/)
    ok('ส่งไม่ได้ = ยังทำที่โรงงาน', (await job(started)).station_status === 'doing')

    const toQc = await atPress('SC-OD-QC', 20)
    await reject('ส่งออกเลยไปถึง QC + Packing ไม่ได้ (บอกสถานีที่ส่งได้)', U.admin, send(toQc, vendor, 'qc_pack'), /ทำที่โรงงานเท่านั้น ส่งออกได้แค่ พิมพ์ · รีด · ตัด · รีดฟิล์ม · เย็บ · ปัก/)
    await pass('เพิ่มบริษัทที่รับรีดฟิล์มได้', U.admin, `public.add_vendor('บริษัทรีดฟิล์มใหม่', '{dtf_press}', null)`)
    await reject('บริษัทรับ QC + Packing ไม่ได้', U.admin, `public.add_vendor('บริษัท QC', '{qc_pack}', null)`, /พิมพ์ · รีด · ตัด · รีดฟิล์ม · เย็บ · ปัก/)
  } finally {
    await db.exec('rollback')
  }
}
