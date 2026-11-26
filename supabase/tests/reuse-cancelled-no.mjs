// ใช้เลขที่ใบของงานที่ยกเลิกแล้วกับใบใหม่ได้ · งานเก่าเปลี่ยนเลขเป็น "(ยกเลิก)" · งานที่เคยแบ่งใช้ซ้ำไม่ได้
import { readFileSync } from 'node:fs'

export async function reuseCancelledNoTests({ db, ok }) {
  const file = '20261211000000_reuse_cancelled_no.sql'
  try { await db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8')); ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, true) }
  catch (e) { ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, false, e.message.split('\n')[0]) }
  const U = { admin: '00000000-0000-0000-0000-00000000ab81', mgr: '00000000-0000-0000-0000-00000000ab82' }
  const run = async (uid, sql) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`)
    const r = await db.query(`select ${sql}`)
    await db.exec('reset role')
    return r
  }
  const tryOnly = async (uid, sql) => {
    await db.exec('savepoint rc')
    try { await run(uid, sql); return null } catch (e) { return e.message.split('\n')[0] }
    finally { await db.exec('rollback to savepoint rc; reset role') }
  }
  const keep = async (uid, sql) => {
    await db.exec('savepoint rc')
    try { const r = await run(uid, sql); await db.exec('release savepoint rc'); return r.rows[0] ? Object.values(r.rows[0])[0] : null }
    catch (e) { await db.exec('rollback to savepoint rc; reset role'); throw e }
  }
  const pass = async (name, uid, sql) => { try { const v = await keep(uid, sql); ok(name, true); return v } catch (e) { ok(name, false, e.message.split('\n')[0]); return null } }
  const reject = async (name, uid, sql, re) => { const err = await tryOnly(uid, sql); ok(name, !!err && re.test(err), err ?? 'ควรถูกปฏิเสธแต่ผ่าน') }
  const receive = (no, customer = 'ลูกค้ารับใบใหม่') => `public.receive_job(p_confirmation_no => '${no}', p_customer_name => '${customer}', p_job_name => 'เสื้อทีม',
    p_product_type_code => 'tshirt', p_qty => 50, p_unit => 'ตัว', p_due_date => current_date + 30, p_route_code => 'plain',
    p_confirmation_pdf_path => null, p_spare_qty => 0, p_confirmation_rev => 0, p_spec => '{}'::jsonb, p_needs_sample => false)::text`
  const form = (no, customer) => `'${JSON.stringify({ product: 'tshirt', h: { doc_no: no, customer }, p: { tshirt: {} } })}'::jsonb`
  const job = async id => (await db.query('select confirmation_no, phase, customer_name from public.jobs where id = $1', [id])).rows[0]

  await db.exec('begin')
  try {
    await db.exec(`
      insert into auth.users values ('${U.admin}','rc-admin@test'),('${U.mgr}','rc-mgr@test');
      insert into public.profiles (user_id,name,role,active) values ('${U.admin}','แอดมิน ใช้เลขซ้ำ','admin',true),('${U.mgr}','ผู้บริหาร ใช้เลขซ้ำ','manager',true);
      update public.production_settings set materials_check = true;
    `)

    await pass('บันทึกใบร่าง SC-RC-1', U.admin, `public.save_confirmation_draft(${form('SC-RC-1', 'ลูกค้าเดิม')})`)
    const old = await pass('รับงาน SC-RC-1', U.admin, receive('SC-RC-1', 'ลูกค้าเดิม'))
    await reject('งานยังไม่ยกเลิก: บันทึกใบใหม่เลขเดิมไม่ได้ (ข้อความเดิม)', U.admin, `public.save_confirmation_draft(${form('SC-RC-1', 'ลูกค้าใหม่')})`, /เป็นของงานที่ส่งงานเข้าโรงงานแล้ว/)
    await reject('งานยังไม่ยกเลิก: รับงานเลขเดิมไม่ได้', U.admin, receive('SC-RC-1'), /เลขที่ใบยืนยัน SC-RC-1 รับเข้าระบบไปแล้ว/)

    await pass('ผู้บริหารยกเลิกงาน SC-RC-1', U.mgr, `public.cancel_job('${old}', 'ลูกค้าเปลี่ยนสินค้า')`)
    const draftId = await pass('งานยกเลิกแล้ว: บันทึกใบใหม่เลขเดิมได้', U.admin, `public.save_confirmation_draft(${form('SC-RC-1', 'ลูกค้าใหม่')})`)
    const d = (await db.query('select status, job_id, customer_name from public.confirmation_drafts where id = $1', [draftId])).rows[0]
    ok('ใบร่างเดิมกลับเป็นใบร่าง ไม่ผูกงานที่ยกเลิก', d?.status === 'draft' && d.job_id === null && d.customer_name === 'ลูกค้าใหม่', JSON.stringify(d))
    ok('บันทึกใบร่างยังไม่เปลี่ยนเลขงานเก่า', (await job(old)).confirmation_no === 'SC-RC-1')

    const fresh = await pass('รับงานใหม่ด้วยเลขเดิม', U.admin, receive('SC-RC-1', 'ลูกค้าใหม่'))
    ok('งานใหม่ได้เลข SC-RC-1 · งานเก่าเปลี่ยนเป็น "SC-RC-1 (ยกเลิก)" และยังยกเลิกอยู่',
      (await job(fresh)).confirmation_no === 'SC-RC-1' && (await job(old)).confirmation_no === 'SC-RC-1 (ยกเลิก)' && (await job(old)).phase === 'cancelled')
    const ev = (await db.query(`select phase, payload from public.events where job_id = $1 and type = 'confirmation_no_freed'`, [old])).rows
    ok('ประวัติงานเก่าบันทึกการเปลี่ยนเลข 1 แถว', ev.length === 1 && ev[0].payload.from === 'SC-RC-1' && ev[0].payload.to === 'SC-RC-1 (ยกเลิก)' && ev[0].phase === 'cancelled', JSON.stringify(ev))
    const d3 = (await db.query('select status, job_id from public.confirmation_drafts where id = $1', [draftId])).rows[0]
    ok('ใบร่างผูกกับงานใหม่', d3.status === 'received' && d3.job_id === fresh)

    await pass('ยกเลิกงานใหม่อีกครั้ง', U.mgr, `public.cancel_job('${fresh}', 'ลูกค้ายกเลิกอีก')`)
    const third = await pass('รับงานเลขเดิมครั้งที่ 3', U.admin, receive('SC-RC-1', 'ลูกค้าครั้งที่สาม'))
    ok('งานที่ยกเลิกครั้งที่ 2 ได้เลข "(ยกเลิก 2)" ไม่ชนของเดิม',
      (await job(fresh)).confirmation_no === 'SC-RC-1 (ยกเลิก 2)' && (await job(third)).confirmation_no === 'SC-RC-1')

    await reject('ฝ่ายที่ไม่ใช่แอดมินรับงานไม่ได้ (สิทธิ์เดิม)', U.mgr, receive('SC-RC-9'), /บทบาทของคุณ/)
    await reject('ฟังก์ชันเปลี่ยนเลขเรียกตรงไม่ได้', U.admin, `private.free_cancelled_no('SC-RC-1')`, /permission denied/)

    await db.exec('update public.production_settings set materials_check = false')
    const parent = await pass('รับงาน SC-RC-S (เข้าสถานีแรก)', U.admin, receive('SC-RC-S'))
    const child = await pass('แบ่งงาน SC-RC-S 20 ชิ้น', U.admin, `public.split_job('${parent}', 20)::text`)
    await pass('ยกเลิกส่วนที่แบ่ง', U.mgr, `public.cancel_job('${child}', 'ยกเลิกส่วนนี้')`)
    await pass('ยกเลิกงานแม่', U.mgr, `public.cancel_job('${parent}', 'ยกเลิกทั้งงาน')`)
    await reject('งานแม่ที่เคยแบ่ง: ใช้เลขเดิมไม่ได้ บอกให้ต่อท้ายเลข', U.admin, `public.save_confirmation_draft(${form('SC-RC-S', 'ลูกค้าใหม่')})`,
      /SC-RC-S เป็นของงานที่ยกเลิกแล้วซึ่งเคยแบ่งงาน ใช้เลขเดิมซ้ำไม่ได้ · ให้ต่อท้ายเลข เช่น SC-RC-S-0002/)
    await reject('งานแม่ที่เคยแบ่ง: รับงานเลขเดิมไม่ได้', U.admin, receive('SC-RC-S'), /เคยแบ่งงาน ใช้เลขเดิมซ้ำไม่ได้/)
    const childNo = (await job(child)).confirmation_no
    await reject('ส่วนที่แบ่งแล้วยกเลิก: ใช้เลขส่วนนั้นซ้ำไม่ได้', U.admin, receive(childNo), /เคยแบ่งงาน ใช้เลขเดิมซ้ำไม่ได้/)
    ok('งานที่เคยแบ่งยังเลขเดิม (ประวัติการแบ่งยังเชื่อมกัน)', (await job(parent)).confirmation_no === 'SC-RC-S' && (await job(child)).confirmation_no === childNo)
  } finally {
    await db.exec('rollback')
  }
}
