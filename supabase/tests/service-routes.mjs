// ใบงานบริการ: เส้นทางสถานีเดียวตรงกับใบ · เย็บอย่างเดียวใช้สินค้าเสื้อผ้าที่เลือก · เปลี่ยนแบบบริการในใบแก้ไม่ได้ · ลูกค้าส่งฟิล์มเอง
import { readFileSync } from 'node:fs'

export async function serviceRouteTests({ db, ok }) {
  const file = '20261207000000_service_routes.sql'
  try { await db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8')); ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, true) }
  catch (e) { ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, false, e.message.split('\n')[0]) }
  const U = { admin: '00000000-0000-0000-0000-00000000ee01', prod: '00000000-0000-0000-0000-00000000ee02' }
  const q = s => s.replace(/'/g, "''")
  const run = async (uid, sql) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`)
    const r = await db.query(`select ${sql}`)
    await db.exec('reset role')
    return r
  }
  const tryOnly = async (uid, sql) => {
    await db.exec('savepoint sv')
    try { await run(uid, sql); return null } catch (e) { return e.message.split('\n')[0] }
    finally { await db.exec('rollback to savepoint sv; reset role') }
  }
  const keep = async (uid, sql) => {
    await db.exec('savepoint sv')
    try { const r = await run(uid, sql); await db.exec('release savepoint sv'); return r.rows[0] ? Object.values(r.rows[0])[0] : null }
    catch (e) { await db.exec('rollback to savepoint sv; reset role'); throw e }
  }
  const pass = async (name, uid, sql) => { try { await keep(uid, sql); ok(name, true) } catch (e) { ok(name, false, e.message.split('\n')[0]) } }
  const reject = async (name, uid, sql, re) => { const err = await tryOnly(uid, sql); ok(name, !!err && re.test(err), err ?? 'ควรถูกปฏิเสธแต่ผ่าน') }
  const spec = (no, product, part) => ({ app: 'phappim-confirm', v: 1, product, h: { doc_no: no, customer: 'ลูกค้างานบริการ' }, p: { [product]: part } })
  const receive = (no, product, route, s) => `public.receive_job(p_confirmation_no => '${no}', p_customer_name => 'ลูกค้างานบริการ', p_job_name => 'งานบริการ',
    p_product_type_code => '${product}', p_qty => 120, p_unit => 'ชิ้น', p_due_date => current_date + 20, p_route_code => '${route}',
    p_confirmation_pdf_path => null, p_spare_qty => 0, p_confirmation_rev => 0, p_spec => '${q(JSON.stringify(s))}'::jsonb, p_needs_sample => false)::text`
  const live = async id => (await db.query('select phase, current_station, route_code, product_type_code, dtf_film_received_at, dtf_film_ordered_at from public.job_live where id = $1', [id])).rows[0]
  const revise = (id, s, rev) => `public.revise_job_spec('${id}', '${q(JSON.stringify(s))}'::jsonb, ${rev}, 'ลูกค้างานบริการ', 'งานบริการ', 120, 0, current_date + 20, false, array[]::text[])`

  await db.exec('begin')
  try {
    await db.exec(`
      insert into auth.users values ('${U.admin}','sv-admin@test'),('${U.prod}','sv-prod@test');
      insert into public.profiles (user_id,name,role,active) values ('${U.admin}','แอดมิน บริการ','admin',true),('${U.prod}','ฝ่ายผลิต บริการ','production',true);
      update public.production_settings set materials_check = false;
    `)
    const routes = (await db.query(`select route_code, string_agg(station_code, ' → ' order by seq) s from public.route_stations
      where route_code in ('sew_only','print_only','print_press_only','press_only','dtf_only') group by 1 order by 1`)).rows
    ok('เส้นทางงานบริการ 5 เส้น สถานีเดียว (+ รีด) แล้ว QC', JSON.stringify(routes.map(r => `${r.route_code}:${r.s}`)) ===
      JSON.stringify(['dtf_only:dtf_press → qc_pack', 'press_only:press → qc_pack', 'print_only:print → qc_pack', 'print_press_only:print → press → qc_pack', 'sew_only:sew → qc_pack']),
      JSON.stringify(routes))

    const sew = spec('SC-SV-SEW', 'svc_sew', { garment: 'เสื้อยืด (คอกลม / คอวี)', garment_code: 'tshirt', supplied: [{ item: 'ชิ้นส่วนเสื้อที่ตัดแล้ว', qty: 120 }] })
    await reject('เย็บอย่างเดียว: เลือกเส้นทางอื่นไม่ได้ (บอกเส้นทางที่ถูก)', U.admin, receive('SC-SV-SEW', 'tshirt', 'plain', sew), /ต้องใช้เส้นทาง "เย็บอย่างเดียว"/)
    await reject('เย็บอย่างเดียว: สินค้าของงานต้องตรงกับสินค้าที่เลือกในใบ', U.admin, receive('SC-SV-SEW', 'polo', 'sew_only', sew), /สินค้าที่เลือกในใบเย็บอย่างเดียว/)
    const sewId = await keep(U.admin, receive('SC-SV-SEW', 'tshirt', 'sew_only', sew))
    let j = await live(sewId)
    ok('เย็บอย่างเดียว: รับงานได้ ใช้สินค้าเสื้อยืด (สูตรจักร) เข้าสถานีเย็บเป็นสถานีแรก', j.product_type_code === 'tshirt' && j.current_station === 'sew' && j.route_code === 'sew_only', JSON.stringify(j))

    await reject('สินค้าปกติใช้เส้นทางงานบริการไม่ได้', U.admin, receive('SC-SV-TEE', 'tshirt', 'sew_only', spec('SC-SV-TEE', 'tshirt', { fabric: 'คอตตอน' })), /ใช้กับใบงานบริการ/)
    await pass('ใบงานบริการแบบรวมเดิม (service) เลือกเส้นทางงานบริการได้', U.admin, receive('SC-SV-MISC', 'service', 'press_only', spec('SC-SV-MISC', 'service', { services: ['รีดแพค'] })))

    const paper = spec('SC-SV-PAPER', 'svc_print', { print_output: 'ส่งกระดาษให้ลูกค้า (ลูกค้ารีดเอง)' })
    const onFabric = spec('SC-SV-FAB', 'svc_print', { print_output: 'พิมพ์แล้วรีดลงผ้าของลูกค้า' })
    await reject('พิมพ์ส่งกระดาษ: ใช้เส้นทางพิมพ์ + รีดไม่ได้', U.admin, receive('SC-SV-PAPER', 'svc_print', 'print_press_only', paper), /พิมพ์อย่างเดียว \(ส่งกระดาษ\)/)
    const paperId = await keep(U.admin, receive('SC-SV-PAPER', 'svc_print', 'print_only', paper))
    ok('พิมพ์ส่งกระดาษ: เข้าสถานีพิมพ์', (await live(paperId)).current_station === 'print')
    const fabId = await keep(U.admin, receive('SC-SV-FAB', 'svc_print', 'print_press_only', onFabric))
    ok('พิมพ์ + รีดลงผ้าลูกค้า: เข้าสถานีพิมพ์ (ต่อด้วยรีด)', (await live(fabId)).route_code === 'print_press_only')
    await pass('รีดอย่างเดียว: เส้นทางรีด', U.admin, receive('SC-SV-PRESS', 'svc_press', 'press_only', spec('SC-SV-PRESS', 'svc_press', { press_target: 'ผ้าหลา' })))

    const own = await keep(U.admin, receive('SC-SV-DTF1', 'svc_dtf', 'dtf_only', spec('SC-SV-DTF1', 'svc_dtf', { film_source: 'ลูกค้าส่งฟิล์มมาเอง' })))
    j = await live(own)
    ok('DTF ลูกค้าส่งฟิล์มเอง: ไม่ต้องสั่งฟิล์ม (นับว่าได้รับแล้ว) · เข้าสถานีรีดฟิล์ม', !!j.dtf_film_received_at && j.current_station === 'dtf_press', JSON.stringify(j))
    const fac = await keep(U.admin, receive('SC-SV-DTF2', 'svc_dtf', 'dtf_only', spec('SC-SV-DTF2', 'svc_dtf', { film_source: 'โรงงานสั่งฟิล์ม' })))
    ok('DTF โรงงานสั่งฟิล์ม: ยังไม่ได้รับฟิล์ม', !(await live(fac)).dtf_film_received_at)
    await reject('DTF โรงงานสั่งฟิล์ม: เริ่มรีดฟิล์มไม่ได้จนได้รับฟิล์ม', U.prod, `public.start_station('${fac}')`, /ฟิล์ม/)
    await pass('DTF โรงงานสั่งฟิล์ม: แอดมินบันทึกสั่งฟิล์มได้ (เส้นทางนี้ใช้ฟิล์ม)', U.admin, `public.order_film('${fac}', current_date + 2)`)

    await pass('แก้ใบเย็บอย่างเดียวได้ (เทียบสินค้าเสื้อยืดกับใบ svc_sew)', U.admin,
      revise(sewId, { ...sew, p: { svc_sew: { ...sew.p.svc_sew, notes: 'เพิ่มป้ายคอ' } } }, 1))
    await reject('แก้ใบเปลี่ยนสินค้าที่เย็บไม่ได้', U.admin,
      revise(sewId, { ...sew, p: { svc_sew: { ...sew.p.svc_sew, garment: 'เสื้อโปโล', garment_code: 'polo' } } }, 2), /เปลี่ยนชนิดสินค้าหลังรับงานไม่ได้|เปลี่ยนแบบงานบริการ/)
    await reject('แก้ใบเปลี่ยนจากส่งกระดาษเป็นรีดลงผ้าไม่ได้ (เส้นทางผลิตเปลี่ยน)', U.admin,
      revise(paperId, { ...paper, p: { svc_print: { print_output: 'พิมพ์แล้วรีดลงผ้าของลูกค้า' } } }, 1), /เปลี่ยนแบบงานบริการในใบแก้ไม่ได้/)
    await reject('แก้ใบเปลี่ยนผู้จัดหาฟิล์มไม่ได้', U.admin,
      revise(fac, spec('SC-SV-DTF2', 'svc_dtf', { film_source: 'ลูกค้าส่งฟิล์มมาเอง' }), 1), /เปลี่ยนแบบงานบริการในใบแก้ไม่ได้/)
    await db.exec('savepoint sv2')
    let direct = null
    try { await db.query(`update public.jobs set route_code = 'plain' where id = $1`, [sewId]) } catch (e) { direct = e.message.split('\n')[0] }
    await db.exec('rollback to savepoint sv2')
    ok('เปลี่ยนเส้นทางของงานบริการในฐานข้อมูลตรงๆ ถูกปฏิเสธ', /ต้องใช้เส้นทาง "เย็บอย่างเดียว"/.test(direct ?? ''), direct ?? 'ผ่าน')
  } finally {
    await db.exec('rollback')
  }
}
