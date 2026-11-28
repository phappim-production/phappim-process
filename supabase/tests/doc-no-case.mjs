// เลขที่ใบต่างกันแค่ตัวพิมพ์เล็ก-ใหญ่ = เลขเดียวกัน (R22-01)
import { readFileSync } from 'node:fs'

export async function docNoCaseTests({ db, ok }) {
  const file = '20261219000000_doc_no_case.sql'
  try { await db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8')); ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, true) }
  catch (e) { ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, false, e.message.split('\n')[0]) }
  const U = { admin: '00000000-0000-0000-0000-00000000ac81', mgr: '00000000-0000-0000-0000-00000000ac82' }
  const run = async (uid, sql) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`)
    const r = await db.query(`select ${sql}`)
    await db.exec('reset role')
    return r
  }
  const tryOnly = async (uid, sql) => {
    await db.exec('savepoint dc')
    try { await run(uid, sql); return null } catch (e) { return e.message.split('\n')[0] }
    finally { await db.exec('rollback to savepoint dc; reset role') }
  }
  const keep = async (uid, sql) => {
    await db.exec('savepoint dc')
    try { const r = await run(uid, sql); await db.exec('release savepoint dc'); return r.rows[0] ? Object.values(r.rows[0])[0] : null }
    catch (e) { await db.exec('rollback to savepoint dc; reset role'); throw e }
  }
  const pass = async (name, uid, sql) => { try { const v = await keep(uid, sql); ok(name, true); return v } catch (e) { ok(name, false, e.message.split('\n')[0]); return null } }
  const reject = async (name, uid, sql, re) => { const err = await tryOnly(uid, sql); ok(name, !!err && re.test(err), err ?? 'ควรถูกปฏิเสธแต่ผ่าน') }
  const receive = no => `public.receive_job(p_confirmation_no => '${no}', p_customer_name => 'ลูกค้าตัวพิมพ์', p_job_name => 'เสื้อทีม',
    p_product_type_code => 'tshirt', p_qty => 50, p_unit => 'ตัว', p_due_date => current_date + 30, p_route_code => 'plain',
    p_confirmation_pdf_path => null, p_spare_qty => 0, p_confirmation_rev => 0, p_spec => '{}'::jsonb, p_needs_sample => false)::text`
  const form = no => `'${JSON.stringify({ product: 'tshirt', h: { doc_no: no, customer: 'ลูกค้าตัวพิมพ์' }, p: { tshirt: {} } })}'::jsonb`
  const TWIN = /ซ้ำกับใบ SC-DC-1 ที่มีในระบบแล้ว \(ต่างกันแค่ตัวพิมพ์เล็ก-ใหญ่\)/

  await db.exec('begin')
  try {
    await db.exec(`
      insert into auth.users values ('${U.admin}','dc-admin@test'),('${U.mgr}','dc-mgr@test');
      insert into public.profiles (user_id,name,role,active) values ('${U.admin}','แอดมิน ตัวพิมพ์','admin',true),('${U.mgr}','ผู้บริหาร ตัวพิมพ์','manager',true);
      update public.production_settings set materials_check = true;
    `)

    const first = await pass('รับงาน SC-DC-1', U.admin, receive('SC-DC-1'))
    await reject('รับงาน sc-dc-1 (ตัวเล็ก) ไม่ได้ · บอกเลขที่มีอยู่', U.admin, receive('sc-dc-1'), TWIN)
    await reject('รับงาน Sc-Dc-1 (ปนกัน) ไม่ได้', U.admin, receive('Sc-Dc-1'), TWIN)
    await reject('รับงานเลขเดียวกัน (ตัวใหญ่) ยังได้ข้อความเดิม', U.admin, receive('SC-DC-1'), /เลขที่ใบยืนยัน SC-DC-1 รับเข้าระบบไปแล้ว/)
    await reject('บันทึกใบร่าง sc-dc-1 ไม่ได้', U.admin, `public.save_confirmation_draft(${form('sc-dc-1')})`, TWIN)
    await pass('เลขอื่น SC-DC-2 รับได้ตามปกติ', U.admin, receive('SC-DC-2'))

    await pass('บันทึกใบร่าง SC-DC-D', U.admin, `public.save_confirmation_draft(${form('SC-DC-D')})`)
    await pass('บันทึกใบร่าง SC-DC-D ซ้ำ (แก้ใบเดิม) ได้', U.admin, `public.save_confirmation_draft(${form('SC-DC-D')})`)
    await reject('บันทึกใบร่าง sc-dc-d ไม่ได้ (มีใบร่างตัวใหญ่แล้ว)', U.admin, `public.save_confirmation_draft(${form('sc-dc-d')})`, /ซ้ำกับใบ SC-DC-D/)
    await reject('รับงาน sc-dc-d ไม่ได้ (มีใบร่างตัวใหญ่แล้ว)', U.admin, receive('sc-dc-d'), /ซ้ำกับใบ SC-DC-D/)
    await pass('รับงาน SC-DC-D จากใบร่างได้', U.admin, receive('SC-DC-D'))
    const drafts = (await db.query(`select count(*)::int n from public.confirmation_drafts where lower(confirmation_no) = 'sc-dc-d'`)).rows[0].n
    ok('มีใบร่างของ SC-DC-D ใบเดียว', drafts === 1, String(drafts))

    await pass('ผู้บริหารยกเลิกงาน SC-DC-1', U.mgr, `public.cancel_job('${first}', 'ลูกค้ายกเลิก')`)
    const lower = await pass('งานตัวใหญ่ยกเลิกแล้ว: รับ sc-dc-1 ได้', U.admin, receive('sc-dc-1'))
    await reject('มีงาน sc-dc-1 อยู่: รับ SC-DC-1 อีกไม่ได้', U.admin, receive('SC-DC-1'), /ซ้ำกับใบ sc-dc-1/)
    const n = (await db.query(`select count(*)::int n from public.jobs where lower(confirmation_no) = 'sc-dc-1' and phase <> 'cancelled'`)).rows[0].n
    ok('งานที่ยังไม่ยกเลิกของเลขนี้มีงานเดียว', n === 1 && !!lower, String(n))
    await reject('ฟังก์ชันตรวจเลขเรียกตรงไม่ได้', U.admin, `private.doc_no_case_check('x')`, /permission denied/)
  } finally {
    await db.exec('rollback')
  }
}
