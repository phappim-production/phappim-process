// วันเวลาที่คาดว่าได้รับวัตถุดิบ: เพิ่มต้องมีวันคาดว่าได้รับหรือมีของแล้ว · แก้วันได้ · ปี พ.ศ. ถูกปฏิเสธ · เลยกำหนดเตือนแอดมิน
import { readFileSync } from 'node:fs'

export async function materialEtaTests({ db, ok }) {
  const file = '20261209000000_material_eta.sql'
  try { await db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8')); ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, true) }
  catch (e) { ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, false, e.message.split('\n')[0]) }
  const U = { admin: '00000000-0000-0000-0000-00000000aa71', prod: '00000000-0000-0000-0000-00000000aa72' }
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] ?? {})[0]
  const run = async (uid, sql) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`)
    const r = await db.query(`select ${sql}`)
    await db.exec('reset role')
    return r
  }
  const tryOnly = async (uid, sql) => {
    await db.exec('savepoint me')
    try { await run(uid, sql); return null } catch (e) { return e.message.split('\n')[0] }
    finally { await db.exec('rollback to savepoint me; reset role') }
  }
  const keep = async (uid, sql) => {
    await db.exec('savepoint me')
    try { const r = await run(uid, sql); await db.exec('release savepoint me'); return r.rows[0] ? Object.values(r.rows[0])[0] : null }
    catch (e) { await db.exec('rollback to savepoint me; reset role'); throw e }
  }
  const pass = async (name, uid, sql) => { try { await keep(uid, sql); ok(name, true) } catch (e) { ok(name, false, e.message.split('\n')[0]) } }
  const reject = async (name, uid, sql, re) => { const err = await tryOnly(uid, sql); ok(name, !!err && re.test(err), err ?? 'ควรถูกปฏิเสธแต่ผ่าน') }
  const receive = no => keep(U.admin, `public.receive_job(p_confirmation_no => '${no}', p_customer_name => 'ลูกค้าวันของถึง', p_job_name => 'เสื้อทีม',
    p_product_type_code => 'tshirt', p_qty => 100, p_unit => 'ตัว', p_due_date => current_date + 30, p_route_code => 'plain',
    p_confirmation_pdf_path => null, p_spare_qty => 0, p_confirmation_rev => 0, p_spec => '{}'::jsonb, p_needs_sample => false)::text`)

  await db.exec('begin')
  try {
    await db.exec(`
      insert into auth.users values ('${U.admin}','me-admin@test'),('${U.prod}','me-prod@test');
      insert into public.profiles (user_id,name,role,active) values ('${U.admin}','แอดมิน วันของถึง','admin',true),('${U.prod}','ฝ่ายผลิต วันของถึง','production',true);
      update public.production_settings set materials_check = true;
    `)
    const a = await receive('SC-ME-A')
    await reject('เพิ่มรายการโดยไม่ใส่วันคาดว่าได้รับ และไม่ได้ติ๊กมีของแล้ว = ปฏิเสธ', U.admin, `public.add_job_material('${a}', 'ผ้าคอตตอน 150 หลา')`, /ใส่วันเวลาที่คาดว่าจะได้รับ "ผ้าคอตตอน 150 หลา" หรือติ๊ก "มีของแล้ว"/)
    await reject('ฝ่ายผลิตเพิ่มรายการไม่ได้', U.prod, `public.add_job_material('${a}', 'ผ้า', now() + interval '1 day')`, /บทบาทของคุณ \(production\)/)
    const cloth = await keep(U.admin, `public.add_job_material('${a}', '  ผ้าคอตตอน 150 หลา ', now() + interval '2 days')`)
    ok('เพิ่มพร้อมวันคาดว่าได้รับ: ยังไม่ติ๊ก มีวันที่', (await db.query('select name, eta is not null e, checked_at from public.job_materials where id = $1', [cloth])).rows
      .every(r => r.name === 'ผ้าคอตตอน 150 หลา' && r.e && r.checked_at === null))
    const ink = await keep(U.admin, `public.add_job_material('${a}', 'หมึก', null, true)`)
    ok('มีของแล้ว: เพิ่มแล้วติ๊กให้เลย ไม่ต้องมีวันที่', !!(await val('select checked_at from public.job_materials where id = $1', [ink])))
    await reject('ชื่อซ้ำ (ไม่สนตัวพิมพ์/ช่องว่าง) ไม่เพิ่ม', U.admin, `public.add_job_material('${a}', 'ผ้าคอตตอน 150 หลา ', now())`, /มี "ผ้าคอตตอน 150 หลา" ในรายการแล้ว/)
    await reject('ช่องว่างหลายตัวในชื่อนับเป็นช่องเดียว (ชื่อซ้ำ)', U.admin, `public.add_job_material('${a}', 'ผ้าคอตตอน   150  หลา', now())`, /ในรายการแล้ว/)
    await reject('ปี พ.ศ. ในวันคาดว่าได้รับ ถูกปฏิเสธ', U.admin, `public.add_job_material('${a}', 'ด้าย', '2569-12-01 10:00+07')`, /ปี 2569 ไม่ถูกต้อง/)
    await db.query(`insert into public.job_materials (job_id, name, dept) select $1, 'ของ ' || g, 'admin' from generate_series(1, 28) g`, [a])
    await reject('ครบ 30 รายการแล้วเพิ่มไม่ได้', U.admin, `public.add_job_material('${a}', 'ใหม่', now())`, /ไม่เกิน 30 รายการ/)
    await db.query(`delete from public.job_materials where job_id = $1 and name like 'ของ %'`, [a])

    await reject('แก้วันคาดว่าได้รับเป็นค่าว่างไม่ได้', U.admin, `public.set_material_eta(${cloth}, null)`, /เลือกวันเวลาที่คาดว่าจะได้รับ "ผ้าคอตตอน 150 หลา"/)
    await reject('ฝ่ายผลิตแก้วันไม่ได้', U.prod, `public.set_material_eta(${cloth}, now())`, /บทบาทของคุณ \(production\)/)
    await pass('แอดมินเลื่อนวันคาดว่าได้รับ', U.admin, `public.set_material_eta(${cloth}, now() + interval '5 days')`)
    const ev = (await db.query(`select type, payload from public.events where job_id = $1 and type in ('material_added', 'material_eta') order by id`, [a])).rows
    ok('ประวัติ: เพิ่ม 2 รายการ (มีของแล้ว 1) + เลื่อนวัน 1 ครั้ง (มีวันเดิม)', ev.length === 3 && ev[1].payload.have === true && ev[2].type === 'material_eta' && !!ev[2].payload.from, JSON.stringify(ev))
    const evCount = ev.length
    await pass('ใส่วันเดิมซ้ำ = ไม่บันทึกประวัติซ้ำ', U.admin, `public.set_material_eta(${cloth}, (select eta from public.job_materials where id = ${cloth}))`)
    ok('ไม่มี event เพิ่ม', (await val(`select count(*)::int from public.events where job_id = $1 and type in ('material_added', 'material_eta')`, [a])) === evCount)
    await reject('ชุดรายการ (set_job_materials) เพิ่มรายการใหม่ที่ไม่มีวันที่ไม่ได้ (ใช้ได้แค่ลบ)', U.admin,
      `public.set_job_materials('${a}', array['ผ้าคอตตอน 150 หลา', 'หมึก', 'ของใหม่'])`, /เพิ่มรายการใหม่ด้วยปุ่ม "เพิ่ม"/)
    await reject('รายการที่ได้รับแล้วแก้วันที่ไม่ได้', U.admin, `public.set_material_eta(${ink}, now() + interval '1 day')`, /ติ๊กว่าได้รับแล้ว/)
    await pass('ยกเลิกติ๊กของที่เคยมีของแล้ว (ไม่มีวันที่)', U.admin, `public.check_material(${ink}, false)`)
    ok('ยกเลิกติ๊กแล้วได้วันคาดว่าได้รับ = ตอนนี้ (นับว่าเลยกำหนด ให้แอดมินใส่วันใหม่)',
      (await val(`select eta <= now() and checked_at is null from public.job_materials where id = $1`, [ink])) === true)
    await keep(U.admin, `public.check_material(${ink}, true)`)
    await pass('ลบรายการด้วยชุดรายการเดิม วันที่ของรายการอื่นยังอยู่', U.admin, `public.set_job_materials('${a}', array['ผ้าคอตตอน 150 หลา'])`)
    ok('ลบหมึกแล้ว ผ้ายังมีวันที่', !!(await val('select eta from public.job_materials where id = $1', [cloth])) && !(await val('select count(*)::int from public.job_materials where id = $1', [ink])))

    await db.query(`update public.job_materials set eta = now() - interval '3 hours' where id = $1`, [cloth])
    await db.query('select private.inbox_scan_all()')
    const msg = (await db.query(`select title, body, audience from public.inbox_messages where kind = 'materials_late' and job_id = $1`, [a])).rows
    ok('เลยกำหนดรับแต่ยังไม่ติ๊ก = เตือนแอดมิน บอกชื่อและกำหนด', msg.length === 1 && msg[0].title === 'วัตถุดิบเลยกำหนดรับ SC-ME-A' && msg[0].audience.join() === 'admin'
      && /ยังไม่ได้รับ 1 รายการ: ผ้าคอตตอน 150 หลา \(กำหนด \d+\/\d+\/\d{4} \d\d:\d\d น\.\)/.test(msg[0].body), JSON.stringify(msg))
    await db.query('select private.inbox_scan_all()')
    ok('สแกนซ้ำวันเดียวกันไม่เตือนซ้ำ', (await val(`select count(*)::int from public.inbox_messages where kind = 'materials_late' and job_id = $1`, [a])) === 1)
    await keep(U.admin, `public.check_material(${cloth}, true)`)
    const b = await receive('SC-ME-B')
    await keep(U.admin, `public.add_job_material('${b}', 'ป้ายคอ', now() - interval '1 hour')`)
    await keep(U.admin, `public.check_material((select id from public.job_materials where job_id = '${b}'), true)`)
    await db.query('select private.inbox_scan_all()')
    ok('ติ๊กแล้ว (ได้รับแล้ว) ไม่เตือนแม้วันที่ผ่านไปแล้ว', (await val(`select count(*)::int from public.inbox_messages where kind = 'materials_late' and job_id = $1`, [b])) === 0)

    await keep(U.admin, `public.add_job_material('${b}', 'ด้าย', now() + interval '1 day')`)
    await db.query(`update public.jobs set phase = 'production', station_seq = 1, station_status = 'queued' where id = $1`, [b])
    await reject('ปล่อยแล้วเพิ่มรายการไม่ได้', U.admin, `public.add_job_material('${b}', 'อื่น', now())`, /ปล่อยเข้าไลน์การผลิตแล้ว/)
    await reject('ปล่อยแล้วแก้วันไม่ได้', U.admin, `public.set_material_eta((select id from public.job_materials where job_id = '${b}' and name = 'ด้าย'), now())`, /ปล่อยเข้าไลน์การผลิตแล้ว/)
  } finally {
    await db.exec('rollback')
  }
}
