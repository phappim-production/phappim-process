// ขั้นรอผลิต: รับงานแล้วค้างที่ "รอผลิต" จนแอดมินเช็ควัตถุดิบครบ + มีรูปวัตถุดิบ แล้วกดปล่อยเข้าไลน์ · เวลาผลิตนับจากวันปล่อย
import { readFileSync } from 'node:fs'

export async function materialsCheckTests({ db, ok }) {
  const file = '20261206000000_materials_check.sql'
  try { await db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8')); ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, true) }
  catch (e) { ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, false, e.message.split('\n')[0]) }
  const U = {
    admin: '00000000-0000-0000-0000-00000000dd01', prod: '00000000-0000-0000-0000-00000000dd02',
    mgr: '00000000-0000-0000-0000-00000000dd03', qc: '00000000-0000-0000-0000-00000000dd04',
  }
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] ?? {})[0]
  // คำสั่งที่ล้มทำให้ธุรกรรมใช้ไม่ได้จน rollback · reset role หลัง rollback to savepoint เท่านั้น
  const run = async (uid, sql) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`)
    const r = await db.query(`select ${sql}`)
    await db.exec('reset role')
    return r
  }
  const tryOnly = async (uid, sql) => {
    await db.exec('savepoint mc')
    try { await run(uid, sql); return null } catch (e) { return e.message.split('\n')[0] }
    finally { await db.exec('rollback to savepoint mc; reset role') }
  }
  const keep = async (uid, sql) => {
    await db.exec('savepoint mc')
    try { const r = await run(uid, sql); await db.exec('release savepoint mc'); return r.rows[0] ? Object.values(r.rows[0])[0] : null }
    catch (e) { await db.exec('rollback to savepoint mc; reset role'); throw e }
  }
  const pass = async (name, uid, sql) => { try { await keep(uid, sql); ok(name, true) } catch (e) { ok(name, false, e.message.split('\n')[0]) } }
  const reject = async (name, uid, sql, re) => { const err = await tryOnly(uid, sql); ok(name, !!err && re.test(err), err ?? 'ควรถูกปฏิเสธแต่ผ่าน') }
  const receive = (no, sample = false) => keep(U.admin, `public.receive_job(p_confirmation_no => '${no}', p_customer_name => 'ลูกค้ารอผลิต', p_job_name => 'เสื้อทีม',
    p_product_type_code => 'tshirt', p_qty => 600, p_unit => 'ตัว', p_due_date => current_date + 30, p_route_code => 'normal',
    p_confirmation_pdf_path => null, p_spare_qty => 0, p_confirmation_rev => 0, p_spec => '{}'::jsonb, p_needs_sample => ${sample})::text`)
  const job = async id => (await db.query('select phase, station_seq, station_status, queue_seq from public.jobs where id = $1', [id])).rows[0]

  await db.exec('begin')
  try {
    await db.exec(`
      insert into auth.users values ('${U.admin}','mc-admin@test'),('${U.prod}','mc-prod@test'),('${U.mgr}','mc-mgr@test'),('${U.qc}','mc-qc@test');
      insert into public.profiles (user_id,name,role,active) values
        ('${U.admin}','แอดมิน รอผลิต','admin',true),('${U.prod}','ฝ่ายผลิต รอผลิต','production',true),
        ('${U.mgr}','ผู้บริหาร รอผลิต','manager',true),('${U.qc}','QC รอผลิต','qc',true);
      update public.production_settings set materials_check = true;
      insert into private.file_settings (record_secret) values (repeat('m', 32)) on conflict do nothing;
    `)
    const a = await receive('SC-MC-A')
    let s = await job(a)
    ok('เปิดขั้นรอผลิต: รับงานแล้วอยู่ "รอผลิต" ยังไม่เข้าสถานี', s.phase === 'materials' && s.station_seq === null, JSON.stringify(s))
    ok('ยังไม่ปล่อย = เวลาผลิตยังไม่เริ่มนับ', JSON.stringify(await val(`select private.lead_state($1)`, [a])) === '{}')
    const b = await receive('SC-MC-B')

    await reject('ยังไม่มีรายการวัตถุดิบ ปล่อยเข้าไลน์ไม่ได้', U.admin, `public.release_job('${a}')`, /เพิ่มรายการวัตถุดิบที่ต้องเช็คอย่างน้อย 1 รายการ/)
    await reject('ฝ่ายผลิตแก้รายการวัตถุดิบไม่ได้ (แอดมินคนเดียว)', U.prod, `public.set_job_materials('${a}', array['ผ้า'])`, /บทบาทของคุณ \(production\)/)
    await reject('รายการเกิน 30 ข้อถูกปฏิเสธ', U.admin, `public.set_job_materials('${a}', array(select 'ของ ' || g from generate_series(1, 31) g))`, /ไม่เกิน 30 รายการ/)
    await pass('แอดมินพิมพ์รายการวัตถุดิบ (ตัดช่องว่าง · ซ้ำ/ว่างไม่นับ)', U.admin, `public.set_job_materials('${a}', array['  ผ้าคอตตอน ', 'ด้าย', 'ผ้าคอตตอน', '', 'ป้ายคอ'])`)
    ok('ได้ 3 รายการตามลำดับที่พิมพ์', (await val(`select string_agg(name, ',' order by id) from public.job_materials where job_id = $1`, [a])) === 'ผ้าคอตตอน,ด้าย,ป้ายคอ')
    await pass('แก้รายการ: เอาป้ายคอออก', U.admin, `public.set_job_materials('${a}', array['ผ้าคอตตอน', 'ด้าย'])`)
    await reject('ยังไม่ได้ติ๊ก = บอกชื่อรายการที่ขาด', U.admin, `public.release_job('${a}')`, /ยังไม่ได้ติ๊กวัตถุดิบ: ผ้าคอตตอน, ด้าย/)
    const ids = (await db.query(`select id from public.job_materials where job_id = $1 order by id`, [a])).rows.map(r => r.id)
    await reject('ฝ่ายผลิตติ๊กวัตถุดิบไม่ได้', U.prod, `public.check_material(${ids[0]}, true)`, /บทบาทของคุณ \(production\)/)
    await pass('แอดมินติ๊กผ้า', U.admin, `public.check_material(${ids[0]}, true)`)
    await pass('แอดมินติ๊กด้าย', U.admin, `public.check_material(${ids[1]}, true)`)
    await reject('ติ๊กครบแต่ยังไม่มีรูป ปล่อยไม่ได้', U.admin, `public.release_job('${a}')`, /ถ่ายรูปวัตถุดิบอย่างน้อย 1 รูป/)

    const folder = await val(`select private.mockup_folder('SC-MC-A')`)
    const photo = `${folder}/abc123def456.jpg`
    await reject('รูปที่ยังอัปโหลดไม่สำเร็จ แนบไม่ได้', U.admin, `public.add_material_photos('${a}', array['${photo}'])`, /อัปโหลดไม่สำเร็จ/)
    await db.query(`insert into private.file_objects (kind, path, size, content_type) values ('mockups', $1, 10, 'image/jpeg'), ('mockups', 'SC-OTHER/abc.jpg', 10, 'image/jpeg')`, [photo])
    await reject('รูปจากโฟลเดอร์งานอื่น แนบไม่ได้', U.admin, `public.add_material_photos('${a}', array['SC-OTHER/abc.jpg'])`, /อัปโหลดไม่สำเร็จ/)
    await reject('ฝ่ายผลิตแนบรูปวัตถุดิบไม่ได้', U.prod, `public.add_material_photos('${a}', array['${photo}'])`, /บทบาทของคุณ \(production\)/)
    await pass('แอดมินแนบรูปวัตถุดิบ', U.admin, `public.add_material_photos('${a}', array['${photo}', '${photo}'])`)
    ok('รูปซ้ำนับครั้งเดียว', (await val(`select count(*)::int from public.job_material_photos where job_id = $1`, [a])) === 1)
    ok('รูปวัตถุดิบเปิดดูได้ (ฝ่ายผลิต)', ((await keep(U.prod, `public.file_read_allowed('mockups', array['${photo}'])`)) ?? []).includes(photo))

    await reject('ฝ่ายผลิตปล่อยเข้าไลน์ไม่ได้', U.prod, `public.release_job('${a}')`, /บทบาทของคุณ \(production\)/)
    await reject('ผู้บริหารปล่อยเข้าไลน์ไม่ได้', U.mgr, `public.release_job('${a}')`, /บทบาทของคุณ \(manager\)/)
    const qBefore = Number((await job(b)).queue_seq)
    await pass('ครบแล้ว แอดมินปล่อยเข้าไลน์ได้', U.admin, `public.release_job('${a}')`)
    s = await job(a)
    ok('ปล่อยแล้วเข้าสถานีแรก รอคิว', s.phase === 'production' && s.station_seq === 1 && s.station_status === 'queued', JSON.stringify(s))
    ok('ลำดับคิวต่อท้ายงานที่รับก่อนหน้าแต่ยังรอผลิต (นับตามวันที่ของพร้อม)', Number(s.queue_seq) > qBefore, `${s.queue_seq} vs ${qBefore}`)
    const ev = await val(`select payload from public.events where job_id = $1 and type = 'released'`, [a])
    ok('บันทึก event ปล่อยงาน (แอดมินกด) พร้อมจำนวนรายการ/รูป', ev?.manual === true && ev?.materials === 2 && ev?.photos === 1, JSON.stringify(ev))
    await db.query(`update public.jobs set created_at = now() - interval '20 days' where id = $1`, [a])
    const lead = await val(`select private.lead_state($1)`, [a])
    ok('เวลาผลิตเริ่มนับวันที่ปล่อย ไม่ใช่วันรับงาน (รับมา 20 วันก็ยังเริ่มวันนี้ · 600 ตัว = 15 วันทำงาน)', lead.lead_days === 15 && lead.lead_start === await val(`select ((now() at time zone 'Asia/Bangkok')::date)::text`), JSON.stringify(lead))
    await reject('ปล่อยซ้ำไม่ได้', U.admin, `public.release_job('${a}')`, /ปล่อยเข้าไลน์การผลิตไปแล้ว/)
    await reject('ปล่อยแล้วแก้รายการไม่ได้', U.admin, `public.set_job_materials('${a}', array['เพิ่ม'])`, /ปล่อยเข้าไลน์การผลิตแล้ว/)
    await reject('ปล่อยแล้วติ๊กไม่ได้', U.admin, `public.check_material(${ids[0]}, false)`, /ปล่อยเข้าไลน์การผลิตแล้ว/)
    await reject('ปล่อยแล้วลบรูปไม่ได้', U.admin, `public.remove_material_photo((select id from public.job_material_photos where job_id = '${a}' limit 1))`, /ปล่อยเข้าไลน์การผลิตแล้ว/)

    const c = await receive('SC-MC-C', true)
    await keep(U.admin, `public.set_job_materials('${c}', array['ผ้า'])`)
    await keep(U.admin, `public.check_material((select id from public.job_materials where job_id = '${c}'), true)`)
    const cPhoto = `${await val(`select private.mockup_folder('SC-MC-C')`)}/c0ffee.jpg`
    await db.query(`insert into private.file_objects (kind, path, size, content_type) values ('mockups', $1, 10, 'image/jpeg')`, [cPhoto])
    await keep(U.admin, `public.add_material_photos('${c}', array['${cPhoto}'])`)
    await pass('แอดมินลบรูปวัตถุดิบก่อนปล่อยได้', U.admin, `public.remove_material_photo((select id from public.job_material_photos where job_id = '${c}'))`)
    await keep(U.admin, `public.add_material_photos('${c}', array['${cPhoto}'])`)
    await pass('งานขึ้นตัวอย่าง: ปล่อยแล้วไปขั้นตัวอย่าง', U.admin, `public.release_job('${c}')`)
    ok('งานขึ้นตัวอย่างอยู่ phase sample', (await job(c)).phase === 'sample')

    await pass('ผู้บริหารยกเลิกงานที่ยังรอผลิตได้', U.mgr, `public.cancel_job('${b}', 'ลูกค้ายกเลิกก่อนเข้าไลน์')`)
    await reject('งานยกเลิกแล้วปล่อยไม่ได้', U.admin, `public.release_job('${b}')`, /ถูกยกเลิกแล้ว/)

    const e = await receive('SC-MC-E')
    await keep(U.admin, `public.set_job_materials('${e}', array['ผ้า', 'ด้าย'], array[]::text[])`)
    await reject('อีกเครื่องแก้รายการก่อน (รายการที่เห็นไม่ตรง) = ไม่บันทึกทับ', U.admin,
      `public.set_job_materials('${e}', array['ผ้า', 'หมึก'], array['ผ้า'])`, /เพิ่งถูกแก้จากเครื่องอื่น/)
    await pass('รายการที่เห็นตรงกับล่าสุด บันทึกได้', U.admin, `public.set_job_materials('${e}', array['ผ้า', 'ด้าย', 'หมึก'], array['ผ้า', 'ด้าย'])`)
    const eFolder = await val(`select private.mockup_folder('SC-MC-E')`)
    const [eMock, ePhoto] = [`${eFolder}/m0ck.png`, `${eFolder}/beef01.jpg`]
    await db.query(`insert into private.file_objects (kind, path, size, content_type) values ('mockups', $1, 10, 'image/png'), ('mockups', $2, 10, 'image/jpeg')`, [eMock, ePhoto])
    await db.query(`update public.jobs set mockup_path = $2 where id = $1`, [e, eMock])
    await reject('รูปม็อคอัพของงานใช้เป็นรูปวัตถุดิบไม่ได้', U.admin, `public.add_material_photos('${e}', array['${eMock}'])`, /รูปม็อคอัพของงาน/)
    await keep(U.admin, `public.add_material_photos('${e}', array['${ePhoto}'])`)
    await reject('แนบรูปเดิมซ้ำ = บอกว่าแนบไว้แล้ว (ไม่ขึ้นว่าเพิ่มแล้ว)', U.admin, `public.add_material_photos('${e}', array['${ePhoto}'])`, /แนบไว้แล้ว/)

    const f = await receive('SC-MC-F')
    await db.query(`update public.jobs set stage_entered_at = now() - interval '6 days' where id = any($1::uuid[])`, [[e, f]])
    await db.query('select private.inbox_scan_all()')
    const late = (await db.query(`select job_id, title, body, audience from public.inbox_messages where kind = 'materials_late' and job_id = any($1::uuid[]) order by title`, [[e, f]])).rows
    ok('รอผลิตเกิน 2 วันทำงาน เตือนแอดมิน ทั้งงานที่ยังไม่มีรายการ และงานที่ยังไม่ติ๊ก', late.length === 2 && late.every(m => m.audience.join() === 'admin' && /ปล่อยเข้าไลน์/.test(m.body)), JSON.stringify(late))
    ok('ข้อความเตือนบอกจำนวนที่ยังไม่ติ๊ก', late.some(m => m.job_id === e && /ยังไม่ได้ติ๊ก 3 รายการ/.test(m.body)), JSON.stringify(late.map(m => m.body)))

    await keep(U.mgr, `public.cancel_job('${e}', 'ลูกค้ายกเลิก')`)
    await reject('งานยกเลิกแล้วลบรูปวัตถุดิบ = บอกว่ายกเลิก', U.admin, `public.remove_material_photo((select id from public.job_material_photos where job_id = '${e}'))`, /ถูกยกเลิกแล้ว/)

    await db.query(`update public.jobs set created_at = now() - interval '1 day' where id = $1`, [f])
    await db.exec('update public.production_settings set materials_check = false')
    await db.query(`select private.release_if_ready($1)`, [f])
    ok('ปิดขั้นภายหลัง: งานที่รออยู่ไม่หลุดเข้าไลน์เอง (เช่น ตอนสั่งฟิล์ม)', (await job(f)).phase === 'materials')
    await pass('ปิดขั้นภายหลัง: แอดมินกดปล่อยงานที่ค้างได้โดยไม่ต้องเช็ค', U.admin, `public.release_job('${f}')`)
    ok('งานที่ค้างเข้าสถานีแรก', (await job(f)).phase === 'production')

    await db.exec('update public.production_settings set materials_check = false')
    const d = await receive('SC-MC-D')
    s = await job(d)
    ok('ปิดขั้นรอผลิต: รับงานแล้วเข้าสถานีแรกทันทีเหมือนเดิม', s.phase === 'production' && s.station_seq === 1, JSON.stringify(s))
  } finally {
    await db.exec('rollback')
  }
}
