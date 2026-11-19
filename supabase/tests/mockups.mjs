// PGlite ไม่มี Storage จึงจำลอง storage.buckets / storage.objects แบบย่อ แล้วลบทิ้งหลังทดสอบ

export async function mockupTests({ db, ok, as }) {
  const U = {
    admin: '00000000-0000-0000-0000-000000000011',
    prod: '00000000-0000-0000-0000-000000000013', mgr: '00000000-0000-0000-0000-000000000014',
  }
  const firstLine = e => e.message.split(String.fromCharCode(10))[0]
  const call = (uid, sql) => as(uid, () => db.query(`select ${sql} as r`))
  const pass = async (name, uid, sql) => {
    try { const r = await call(uid, sql); ok(name, true); return r.rows[0]?.r } catch (e) { ok(name, false, firstLine(e)) }
  }
  const reject = async (name, uid, sql, re) => {
    try { await call(uid, sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') }
    catch (e) { ok(name, re ? re.test(e.message) : true, firstLine(e)) }
  }
  const form = (no, mockup) => `'${JSON.stringify({
    app: 'phappim-confirm', v: 1, h: { doc_no: no, customer: 'ลูกค้ารูป' }, product: 'tshirt', p: { tshirt: {} }, imgs: [], mockup_path: mockup,
  })}'::jsonb`
  const receive = no => `public.receive_job('${no}', 'ลูกค้ารูป', 'งาน', 'tshirt', 10, 'ตัว', '2026-12-31', 'plain', null, 0, 0, '{}', false)`
  const job = async no => (await db.query(`select * from public.job_live where confirmation_no = '${no}'`)).rows[0]

  await db.exec(`
    create schema storage;
    create table storage.buckets (id text primary key);
    create table storage.objects (bucket_id text, name text);
    insert into storage.buckets values ('mockups'), ('confirmations');
    insert into storage.objects values ('mockups', 'SC-MK-1/1.jpg'), ('mockups', 'SC-MK-3/2.png'), ('mockups', 'SC-MK-3/3.jpg'), ('confirmations', 'SC-MK-3/9.jpg');`)

  await pass('บันทึกใบยืนยันพร้อม path รูปม็อคอัพ', U.admin, `public.save_confirmation_draft(${form('SC-MK-1', 'SC-MK-1/1.jpg')})`)
  await pass('ส่งงานเข้าจากใบที่มีรูป', U.admin, receive('SC-MK-1'))
  const j1 = await job('SC-MK-1')
  ok('งานได้รูปม็อคอัพจากใบร่าง (อ่านผ่าน job_live)', j1?.mockup_path === 'SC-MK-1/1.jpg')
  ok('events ตอนรับงานบอกว่ามีรูป', (await db.query(`select payload->>'mockup' m from public.events where job_id = '${j1.id}' and type = 'received'`)).rows[0]?.m === 'true')

  // รูปในใบร่างยังไม่ถูกอัปโหลด = ส่งงานเข้าได้ แต่งานยังไม่มีรูป (รูปไม่ขวางการรับงาน)
  await pass('บันทึกใบที่ path รูปไม่มีไฟล์จริง', U.admin, `public.save_confirmation_draft(${form('SC-MK-2', 'SC-MK-2/1.jpg')})`)
  await pass('ส่งงานเข้าได้แม้รูปหาย', U.admin, receive('SC-MK-2'))
  ok('รูปที่ไม่มีไฟล์จริงไม่ถูกผูกกับงาน', (await job('SC-MK-2'))?.mockup_path === null)

  await pass('ส่งงานเข้าโดยไม่มีใบร่าง', U.admin, receive('SC-MK-3'))
  const j3 = await job('SC-MK-3')
  ok('งานไม่มีใบร่าง = ยังไม่มีรูป', j3?.mockup_path === null)

  const set = path => `public.set_job_mockup('${j3.id}', '${path}')`
  await reject('ฝ่ายผลิตเปลี่ยนรูปม็อคอัพไม่ได้', U.prod, set('SC-MK-3/2.png'), /ทำขั้นนี้ไม่ได้/)
  await reject('ผู้บริหารเปลี่ยนรูปม็อคอัพไม่ได้', U.mgr, set('SC-MK-3/2.png'), /ทำขั้นนี้ไม่ได้/)
  await reject('ไฟล์ที่ไม่ใช่รูปใช้เป็นม็อคอัพไม่ได้', U.admin, set('SC-MK-3/2.pdf'), /ไฟล์ภาพ/)
  await reject('รูปที่ยังไม่อัปโหลดใช้ไม่ได้', U.admin, set('SC-MK-3/nope.jpg'), /ยังไม่พบรูปม็อคอัพ/)
  await reject('รูปที่อยู่ bucket อื่นไม่นับ', U.admin, set('SC-MK-3/9.jpg'), /ยังไม่พบรูปม็อคอัพ/)
  await reject('งานที่ไม่มีอยู่จริง', U.admin, `public.set_job_mockup('00000000-0000-0000-0000-00000000ffff', 'SC-MK-3/2.png')`, /ไม่พบงาน/)
  await pass('แอดมินเพิ่มรูปม็อคอัพทีหลังได้', U.admin, set('SC-MK-3/2.png'))
  await reject('รูปของงานอื่น (คนละโฟลเดอร์) ใช้กับงานนี้ไม่ได้', U.admin, `public.set_job_mockup('${j3.id}', 'SC-MK-1/1.jpg')`, /ไม่ใช่ของงาน SC-MK-3/)
  await pass('แอดมินเปลี่ยนรูปซ้ำได้', U.admin, `public.set_job_mockup('${j3.id}', 'SC-MK-3/3.jpg')`)
  const ev = (await db.query(`select payload from public.events where job_id = '${j3.id}' and type = 'mockup' order by at, id`)).rows
  ok('เพิ่ม/เปลี่ยนรูปบันทึกใน events ครั้งละ 1 แถว (ครั้งที่สอง = เปลี่ยน)',
    ev.length === 2 && ev[0].payload.replaced === false && ev[1].payload.replaced === true)
  ok('งานใช้รูปล่าสุด', (await job('SC-MK-3'))?.mockup_path === 'SC-MK-3/3.jpg')
  ok('โฟลเดอร์รูปตรงกับหน้าเว็บ (ตัวไทย/ช่องว่าง = _ · ว่าง = job)',
    (await db.query(`select private.mockup_folder(' SC-MK ไทย ') a, private.mockup_folder('  ') b`)).rows[0]?.a === 'SC-MK____' &&
    (await db.query(`select private.mockup_folder('  ') b`)).rows[0]?.b === 'job')

  try {
    await as(U.admin, () => db.query(`update public.jobs set mockup_path = 'x.jpg' where id = '${j3.id}'`))
  } catch { /* RLS / สิทธิ์ปฏิเสธก็ถือว่าผ่าน */ }
  ok('แก้ mockup_path ตรงในตารางไม่ได้', (await job('SC-MK-3'))?.mockup_path === 'SC-MK-3/3.jpg')

  await db.exec('drop schema storage cascade')
}
