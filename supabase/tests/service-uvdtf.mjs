// ใบ UV DTF อย่างเดียว: บังคับเส้นทางผลิตข้างนอก · ส่งออกจากรอผลิตได้เลย · สินค้าอื่นยังใช้ผลิตข้างนอกได้
import { readFileSync } from 'node:fs'

export async function serviceUvdtfTests({ db, ok }) {
  const file = '20261213000000_service_uvdtf.sql'
  try { await db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8')); ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, true) }
  catch (e) { ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, false, e.message.split(String.fromCharCode(10))[0]) }
  const U = { admin: '00000000-0000-0000-0000-00000000aa71', prod: '00000000-0000-0000-0000-00000000aa72' }
  const q = s => s.replace(/'/g, "''")
  const run = async (uid, sql) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`)
    const r = await db.query(`select ${sql}`)
    await db.exec('reset role')
    return r
  }
  const tryOnly = async (uid, sql) => {
    await db.exec('savepoint uv')
    try { await run(uid, sql); return null } catch (e) { return e.message.split(String.fromCharCode(10))[0] }
    finally { await db.exec('rollback to savepoint uv; reset role') }
  }
  const keep = async (uid, sql) => {
    await db.exec('savepoint uv')
    try { const r = await run(uid, sql); await db.exec('release savepoint uv'); return r.rows[0] ? Object.values(r.rows[0])[0] : null }
    catch (e) { await db.exec('rollback to savepoint uv; reset role'); throw e }
  }
  const pass = async (name, uid, sql) => { try { await keep(uid, sql); ok(name, true) } catch (e) { ok(name, false, e.message.split(String.fromCharCode(10))[0]) } }
  const reject = async (name, uid, sql, re) => { const err = await tryOnly(uid, sql); ok(name, !!err && re.test(err), err ?? 'ควรถูกปฏิเสธแต่ผ่าน') }
  const spec = no => ({ app: 'phappim-confirm', v: 1, product: 'svc_uvdtf', h: { doc_no: no, customer: 'ลูกค้า UV' }, p: { svc_uvdtf: { uv_unit: 'แผ่น' } } })
  const receive = (no, product, route, s, unit = 'แผ่น') => `public.receive_job(p_confirmation_no => '${no}', p_customer_name => 'ลูกค้า UV', p_job_name => 'สติกเกอร์ UV DTF',
    p_product_type_code => '${product}', p_qty => 50, p_unit => '${unit}', p_due_date => current_date + 20, p_route_code => '${route}',
    p_confirmation_pdf_path => null, p_spare_qty => 0, p_confirmation_rev => 0, p_spec => '${q(JSON.stringify(s))}'::jsonb, p_needs_sample => false)::text`

  await db.exec('begin')
  try {
    await db.exec(`
      insert into auth.users values ('${U.admin}','uv-admin@test'),('${U.prod}','uv-prod@test');
      insert into public.profiles (user_id,name,role,active) values ('${U.admin}','แอดมิน UV','admin',true),('${U.prod}','ฝ่ายผลิต UV','production',true);
      update public.production_settings set materials_check = true;
    `)
    ok('มีสินค้า UV DTF อย่างเดียว หน่วยตั้งต้นแผ่น', (await db.query(`select unit from public.product_types where code = 'svc_uvdtf'`)).rows[0]?.unit === 'แผ่น')
    await reject('ใบ UV DTF ใช้เส้นทางพิมพ์ไม่ได้', U.admin, receive('SC-UV-BAD', 'svc_uvdtf', 'print_only', spec('SC-UV-BAD')), /ผลิตข้างนอกทั้งหมด/)
    await reject('ใบ UV DTF ใช้เส้นทางปกติไม่ได้', U.admin, receive('SC-UV-BAD2', 'svc_uvdtf', 'normal', spec('SC-UV-BAD2')), /ผลิตข้างนอกทั้งหมด/)
    const id = await keep(U.admin, receive('SC-UV-1', 'svc_uvdtf', 'outside', spec('SC-UV-1')))
    ok('ใบ UV DTF รับงานด้วยเส้นทางผลิตข้างนอก · รอผลิต', !!id && (await db.query('select route_code, phase from public.jobs where id = $1', [id])).rows[0]?.phase === 'materials')
    const ch = await keep(U.admin, receive('SC-UV-2', 'svc_uvdtf', 'outside', { ...spec('SC-UV-2'), p: { svc_uvdtf: { uv_unit: 'ชิ้น' } } }, 'ชิ้น'))
    ok('นับเป็นชิ้นได้', (await db.query('select unit from public.jobs where id = $1', [ch])).rows[0]?.unit === 'ชิ้น')
    const vendor = await keep(U.admin, `public.add_vendor('โรงพิมพ์ UV จำลอง', array['outside'])`)
    await pass('ส่งออกบริษัทภายนอกจากรอผลิตได้เลย', U.admin, `public.send_out('${id}', ${vendor}, 'outside', now() + interval '1 hour', 2, now() + interval '3 days', 'สั่งพิมพ์ UV DTF')`)
    ok('อยู่ที่บริษัทภายนอก', (await db.query('select station_status from public.jobs where id = $1', [id])).rows[0]?.station_status === 'out')
    await pass('เสื้อยืดยังใช้เส้นทางผลิตข้างนอกได้ (ไม่ใช่เส้นทางเฉพาะงานบริการ)', U.admin,
      receive('SC-UV-SHIRT', 'tshirt', 'outside', { app: 'phappim-confirm', v: 1, product: 'tshirt', h: { doc_no: 'SC-UV-SHIRT' }, p: { tshirt: {} } }, 'ตัว'))
    await reject('แก้ใบ UV DTF เป็นใบบริการแบบอื่นไม่ได้', U.admin,
      `public.revise_job_spec('${id}', '${q(JSON.stringify({ ...spec('SC-UV-1'), product: 'svc_press', p: { svc_press: {} } }))}'::jsonb, 1, 'ลูกค้า UV', 'สติกเกอร์ UV DTF', 50, 0, current_date + 20, false, array[]::text[])`,
      /เปลี่ยนแบบงานบริการ|เปลี่ยนชนิดสินค้า/)
  } finally {
    await db.exec('rollback')
  }
}
