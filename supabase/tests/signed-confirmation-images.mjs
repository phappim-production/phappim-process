// ใบยืนยันที่ลูกค้าเซ็นแนบเป็นรูปได้ (JPG / PNG / WEBP) นอกจาก PDF · ชนิดต้องตรงนามสกุล · ไฟล์ต้องอยู่ในที่เก็บจริง
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'

export async function signedConfirmationImageTests({ db, ok }) {
  const file = '20261216000000_signed_confirmation_images.sql'
  try { await db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8')); ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, true) }
  catch (e) { ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, false, e.message.split('\n')[0]) }
  const U = { admin: '00000000-0000-0000-0000-00000000ec01', prod: '00000000-0000-0000-0000-00000000ec02' }
  const q = v => `'${String(v).replace(/'/g, "''")}'`
  const run = async (uid, sql) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`)
    const r = await db.query(`select ${sql}`)
    await db.exec('reset role')
    return r
  }
  const tryOnly = async (uid, sql) => {
    await db.exec('savepoint ci')
    try { await run(uid, sql); return null } catch (e) { return e.message.split('\n')[0] }
    finally { await db.exec('rollback to savepoint ci; reset role') }
  }
  const keep = async (uid, sql) => {
    await db.exec('savepoint ci')
    try { const r = await run(uid, sql); await db.exec('release savepoint ci'); return r.rows[0] ? Object.values(r.rows[0])[0] : null }
    catch (e) { await db.exec('rollback to savepoint ci; reset role'); throw e }
  }
  const pass = async (name, uid, sql) => { try { await keep(uid, sql); ok(name, true) } catch (e) { ok(name, false, e.message.split('\n')[0]) } }
  const reject = async (name, uid, sql, re) => { const err = await tryOnly(uid, sql); ok(name, !!err && re.test(err), err ?? 'ควรถูกปฏิเสธแต่ผ่าน') }
  const allowed = (path, type, kind = 'confirmations') => `public.file_upload_allowed(${q(kind)}, ${q(path)}, 1000, ${q(type)})`
  let secret = ''
  const record = (path, type) => `public.record_file_upload('confirmations', ${q(path)}, 1000, ${q(type)}, ${q(createHmac('sha256', secret).update(`confirmations|${path}|1000|${type}`).digest('hex'))})`
  const receive = (no, path) => `public.receive_job(p_confirmation_no => ${q(no)}, p_customer_name => 'ลูกค้ารูปใบเซ็น', p_job_name => 'เสื้อทีม',
    p_product_type_code => 'tshirt', p_qty => 50, p_unit => 'ตัว', p_due_date => current_date + 30, p_route_code => 'normal',
    p_confirmation_pdf_path => ${path === null ? 'null' : q(path)}, p_spare_qty => 0, p_confirmation_rev => 0, p_spec => '{}'::jsonb, p_needs_sample => false)::text`

  await db.exec('begin')
  try {
    await db.exec(`
      insert into auth.users values ('${U.admin}','ci-admin@test'),('${U.prod}','ci-prod@test');
      insert into public.profiles (user_id,name,role,active) values ('${U.admin}','แอดมิน ใบเซ็น','admin',true),('${U.prod}','ฝ่ายผลิต ใบเซ็น','production',true);
      insert into private.file_settings (record_secret) select 'signed-image-secret-0123456789abcdef0123' where not exists (select 1 from private.file_settings);
    `)
    secret = Object.values((await db.query('select record_secret from private.file_settings limit 1')).rows[0])[0]

    for (const [ext, type] of [['jpg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp'], ['pdf', 'application/pdf']]) {
      await pass(`แอดมินอัปโหลดใบเซ็นเป็น .${ext} ได้`, U.admin, allowed(`SC-CI-A/ab12${ext}.${ext}`, type))
    }
    await reject('ชนิดไฟล์ไม่ตรงนามสกุล (.png แต่ส่ง JPG) ไม่ได้', U.admin, allowed('SC-CI-A/ab12.png', 'image/jpeg'), /ต้องเป็น PDF หรือรูป/)
    await reject('รูป .gif ไม่ได้', U.admin, allowed('SC-CI-A/ab12.gif', 'image/gif'), /ต้องเป็น PDF หรือรูป/)
    await reject('ฝ่ายผลิตอัปโหลดใบเซ็นไม่ได้', U.prod, allowed('SC-CI-A/ab12.jpg', 'image/jpeg'), /บทบาทของคุณ \(production\)/)
    await reject('ม็อคอัพยังรับเฉพาะรูป (PDF ไม่ได้)', U.admin, allowed('SC-CI-A/ab12.pdf', 'application/pdf', 'mockups'), /รูปม็อคอัพ/)

    const photo = 'SC-CI-A/feed01.jpg'
    await reject('รูปที่ยังไม่อยู่ในที่เก็บ ส่งงานเข้าไม่ได้', U.admin, receive('SC-CI-A', photo), /ยังไม่พบไฟล์ใบยืนยัน/)
    await pass('บันทึกรูปใบเซ็นที่อยู่ในที่เก็บแล้ว', U.admin, record(photo, 'image/jpeg'))
    const id = await keep(U.admin, receive('SC-CI-A', photo))
    ok('รับงานพร้อมรูปใบเซ็นได้', !!id)
    ok('งานเก็บ path รูปใบเซ็น', (await db.query('select confirmation_pdf_path p from public.jobs where id = $1', [id])).rows[0]?.p === photo)

    const later = await keep(U.admin, receive('SC-CI-B', null))
    const png = 'SC-CI-B/feed02.png'
    await reject('แนบรูปทีหลังที่ยังไม่อัปโหลดไม่ได้', U.admin, `public.attach_confirmation_pdf('${later}', ${q(png)})`, /ยังไม่พบไฟล์ใบยืนยัน/)
    await keep(U.admin, record(png, 'image/png'))
    await pass('แนบรูป PNG ทีหลังได้', U.admin, `public.attach_confirmation_pdf('${later}', ${q(png)})`)
    ok('ประวัติบันทึกการแนบใบยืนยัน', (await db.query(`select count(*)::int n from public.events where job_id = $1 and type = 'confirmation_pdf'`, [later])).rows[0].n === 1)
    await reject('แนบไฟล์ Word ไม่ได้', U.admin, `public.attach_confirmation_pdf('${later}', 'SC-CI-B/feed03.docx')`, /ต้องเป็น PDF หรือรูป/)
    const readable = (await run(U.prod, `public.file_read_allowed('confirmations', array[${q(png)}, 'SC-CI-B/nope.png'])`)).rows[0]
    ok('ทุกบทบาทเปิดรูปใบเซ็นของงานได้ (ไฟล์อื่นไม่ได้)', JSON.stringify(Object.values(readable)[0]) === JSON.stringify([png]), JSON.stringify(readable))
  } finally {
    await db.exec('rollback')
  }
}
