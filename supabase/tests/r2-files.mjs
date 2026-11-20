import { createHmac } from 'node:crypto'

export async function r2FileTests({ db, ok, as }) {
  const U = {
    admin: '00000000-0000-0000-0000-0000000002a1', prod: '00000000-0000-0000-0000-0000000002a2',
    qc: '00000000-0000-0000-0000-0000000002a3', off: '00000000-0000-0000-0000-0000000002a4',
    admin2: '00000000-0000-0000-0000-0000000002a5', nobody: '00000000-0000-0000-0000-0000000002a6',
  }
  await db.exec(`
    insert into auth.users values ('${U.admin}','r2a@test'),('${U.prod}','r2p@test'),('${U.qc}','r2q@test'),
      ('${U.off}','r2o@test'),('${U.admin2}','r2b@test'),('${U.nobody}','r2n@test');
    insert into public.profiles (user_id, name, role, active) values
      ('${U.admin}','แอดมิน R2','admin',true),('${U.prod}','ฝ่ายผลิต R2','production',true),('${U.qc}','QC R2','qc',true),
      ('${U.off}','แอดมินลาออก','admin',false),('${U.admin2}','แอดมิน R2 คนที่สอง','admin',true);`)

  const secret = 'r2-test-secret-0123456789abcdef-0123456789'
  const MiB20 = 20 * 1024 * 1024
  const sign = (key, msg) => createHmac('sha256', key).update(msg).digest('hex')
  const proof = (kind, path, size, type, key = secret) => sign(key, `${kind}|${path}|${size}|${type}`)
  const q = (v) => (v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
  const allowed = (kind, path, size, type) => `select public.file_upload_allowed(${q(kind)}, ${q(path)}, ${size}, ${q(type)})`
  const record = (kind, path, size, type, p = proof(kind, path, size, type)) =>
    `select public.record_file_upload(${q(kind)}, ${q(path)}, ${size}, ${q(type)}, ${q(p)})`
  const tryAs = async (name, uid, sql, re) => {
    try { await as(uid, () => db.query(sql)); ok(name, !re, re ? 'ควรถูกปฏิเสธแต่ผ่าน' : '') }
    catch (e) { ok(name, !!re && re.test(e.message), e.message.split('\n')[0]) }
  }
  const val = async (sql) => Object.values((await db.query(sql)).rows[0] ?? {})[0]

  for (const [key, msg] of [[secret, 'mockups|a/b.jpg|10|image/jpeg'], ['k'.repeat(100), 'ยาวเกิน 64 ไบต์'], ['', '']]) {
    const got = (await db.query(`select encode(private.hmac_sha256(convert_to($1, 'UTF8'), convert_to($2, 'UTF8')), 'hex') h`, [key, msg])).rows[0].h
    ok(`HMAC ในฐานข้อมูลตรงกับ Worker (กุญแจยาว ${key.length})`, got === sign(key, msg))
  }

  ok('ยังไม่เปิดใช้ R2 = ตรวจแบบเดิม (ฐานทดสอบไม่มี Storage จึงผ่าน)', await val(`select private.confirmation_uploaded('x/1.pdf')`) === true)
  await tryAs('ยังไม่เปิดใช้ R2 บันทึกไฟล์ไม่ได้', U.admin, record('confirmations', 'SC-R2-A/aa11.pdf', 100, 'application/pdf'), /ยังไม่เปิดใช้/)
  await expectFail('ลายเซ็นสั้นกว่า 32 ตัวตั้งค่าไม่ได้', `insert into private.file_settings (record_secret) values ('short')`)
  await db.exec(`insert into private.file_settings (record_secret) values ('${secret}')`)
  async function expectFail(name, sql) {
    try { await db.exec(sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') } catch (e) { ok(name, true, e.message.split('\n')[0]) }
  }
  ok('เปิดใช้ R2 แล้ว ไฟล์ที่ไม่มีในรายการไม่นับ', await val(`select private.confirmation_uploaded('x/1.pdf')`) === false)
  await tryAs('ผู้ใช้อ่านค่าลับเองไม่ได้', U.admin, `select record_secret from private.file_settings`, /permission denied/)
  await tryAs('ผู้ใช้เขียนรายการไฟล์ตรงไม่ได้', U.admin,
    `insert into private.file_objects (kind, path, size, content_type) values ('confirmations', 'SC-R2-A/ff.pdf', 1, 'application/pdf')`, /permission denied/)

  await tryAs('รูปม็อคอัพ 20 MiB พอดี ผ่าน', U.admin, allowed('mockups', 'SC-R2-M/abc123.jpg', MiB20, 'image/jpeg'))
  await tryAs('รูปม็อคอัพเกิน 20 MiB 1 ไบต์ ถูกปฏิเสธ', U.admin, allowed('mockups', 'SC-R2-M/abc123.jpg', MiB20 + 1, 'image/jpeg'), /เกิน 20 MB/)
  await tryAs('PDF 20 MiB พอดี ผ่าน', U.admin, allowed('confirmations', 'SC-R2-A/abc123.pdf', MiB20, 'application/pdf'))
  await tryAs('PDF เกิน 20 MiB 1 ไบต์ ถูกปฏิเสธ', U.admin, allowed('confirmations', 'SC-R2-A/abc123.pdf', MiB20 + 1, 'application/pdf'), /เกิน 20 MB/)
  await tryAs('ไฟล์ว่าง ถูกปฏิเสธ', U.admin, allowed('confirmations', 'SC-R2-A/abc123.pdf', 0, 'application/pdf'), /ว่างเปล่า/)
  await tryAs('รูปม็อคอัพ PNG ในโฟลเดอร์ฉบับม็อคอัพ ผ่าน', U.admin, allowed('mockups', 'SC-R2-M/sheet/a1.png', 10, 'image/png'))
  await tryAs('รูปม็อคอัพ WEBP ผ่าน', U.admin, allowed('mockups', 'SC-R2-M/a1.webp', 10, 'image/webp'))
  await tryAs('นามสกุลไม่ตรงชนิดไฟล์ ถูกปฏิเสธ', U.admin, allowed('mockups', 'SC-R2-M/abc.png', 10, 'image/jpeg'), /JPG \/ PNG \/ WEBP/)
  await tryAs('PDF ส่งเป็นรูปม็อคอัพไม่ได้', U.admin, allowed('mockups', 'SC-R2-M/abc.pdf', 10, 'application/pdf'), /JPG \/ PNG \/ WEBP/)
  await tryAs('รูปส่งเป็นใบยืนยันไม่ได้', U.admin, allowed('confirmations', 'SC-R2-A/abc.jpg', 10, 'image/jpeg'), /ต้องเป็น PDF/)
  await tryAs('path ย้อนโฟลเดอร์ไม่ได้', U.admin, allowed('confirmations', '../SC-R2-A/abc.pdf', 10, 'application/pdf'), /ต้องเป็น PDF/)
  await tryAs('path มีช่องว่างไม่ได้', U.admin, allowed('mockups', 'SC-R2-M/a b.jpg', 10, 'image/jpeg'), /JPG/)
  await tryAs('ประเภทไฟล์อื่นไม่ได้', U.admin, allowed('other', 'SC-R2-M/a.jpg', 10, 'image/jpeg'), /ไม่รู้จักประเภทไฟล์/)
  await tryAs('ฝ่ายผลิตอัปโหลดไฟล์ไม่ได้', U.prod, allowed('mockups', 'SC-R2-M/abc123.jpg', 10, 'image/jpeg'), /ทำขั้นนี้ไม่ได้/)
  await tryAs('บัญชีปิดอัปโหลดไม่ได้', U.off, allowed('mockups', 'SC-R2-M/abc123.jpg', 10, 'image/jpeg'), /ถูกปิด/)
  await tryAs('ผู้ใช้ที่ไม่มีบัญชีพนักงานอัปโหลดไม่ได้', U.nobody, allowed('mockups', 'SC-R2-M/abc123.jpg', 10, 'image/jpeg'), /ถูกปิด/)

  const pdfA = 'SC-R2-A/0a1b2c3d4e5f6071.pdf'
  await tryAs('บันทึกไฟล์ด้วยลายเซ็นปลอมไม่ได้', U.admin, record('confirmations', pdfA, 1000, 'application/pdf', 'f'.repeat(64)), /ยืนยันไฟล์ไม่ผ่าน/)
  await tryAs('ลายเซ็นจากกุญแจอื่นไม่ได้', U.admin, record('confirmations', pdfA, 1000, 'application/pdf', proof('confirmations', pdfA, 1000, 'application/pdf', 'x'.repeat(40))), /ยืนยันไฟล์ไม่ผ่าน/)
  await tryAs('ลายเซ็นของขนาดอื่นใช้ไม่ได้', U.admin, record('confirmations', pdfA, 2000, 'application/pdf', proof('confirmations', pdfA, 1000, 'application/pdf')), /ยืนยันไฟล์ไม่ผ่าน/)
  await tryAs('ลายเซ็นถูกต้องแต่บัญชีปิด บันทึกไม่ได้', U.off, record('confirmations', pdfA, 1000, 'application/pdf'), /ถูกปิด/)
  await tryAs('ลายเซ็นถูกต้องแต่เกิน 20 MB บันทึกไม่ได้', U.admin, record('mockups', 'SC-R2-M/big.jpg', MiB20 + 1, 'image/jpeg'), /เกิน 20 MB/)

  const receive = (no, pdf) => `select public.receive_job('${no}', 'ลูกค้า R2', 'งาน R2', 'tshirt', 10, 'ตัว', '2026-12-31', 'normal', ${q(pdf)})`
  await tryAs('PDF ที่ยังไม่อยู่ใน R2 ส่งงานเข้าไม่ได้', U.admin, receive('SC-R2-A', pdfA), /ยังไม่พบไฟล์ PDF/)
  await tryAs('Worker ยืนยัน PDF แล้ว บันทึกได้', U.admin, record('confirmations', pdfA, 1000, 'application/pdf'))
  await tryAs('อัปโหลดซ้ำหลังเน็ตหลุด บันทึกซ้ำได้ไม่ error', U.admin, record('confirmations', pdfA, 1000, 'application/pdf'))
  ok('อัปโหลดซ้ำไม่สร้างรายการไฟล์ซ้ำ', await val(`select count(*)::int from private.file_objects where path = '${pdfA}'`) === 1)
  await tryAs('PDF อยู่ใน R2 แล้ว ส่งงานเข้าได้', U.admin, receive('SC-R2-A', pdfA))
  ok('งานเก็บ path ของ PDF', await val(`select confirmation_pdf_path from public.jobs where confirmation_no = 'SC-R2-A'`) === pdfA)

  await tryAs('ส่งงานเข้าโดยไม่มี PDF ได้', U.admin, receive('SC-R2-M', null))
  const jobM = await val(`select id from public.jobs where confirmation_no = 'SC-R2-M'`)
  const pdfM = 'SC-R2-M/1122334455667788.pdf'
  await tryAs('แนบ PDF ทีหลังที่ยังไม่อยู่ใน R2 ไม่ได้', U.admin, `select public.attach_confirmation_pdf('${jobM}', '${pdfM}')`, /ยังไม่พบไฟล์ PDF/)
  await as(U.admin, () => db.query(record('confirmations', pdfM, MiB20, 'application/pdf')))
  await tryAs('แนบ PDF 20 MiB ที่อยู่ใน R2 แล้วได้', U.admin, `select public.attach_confirmation_pdf('${jobM}', '${pdfM}')`)

  const picM = 'SC-R2-M/aabbccddeeff0011.jpg'
  await tryAs('รูปม็อคอัพที่ยังไม่อยู่ใน R2 ใส่ให้งานไม่ได้', U.admin, `select public.set_job_mockup('${jobM}', '${picM}')`, /ยังไม่พบรูปม็อคอัพ/)
  await as(U.admin, () => db.query(record('mockups', picM, MiB20, 'image/jpeg')))
  await tryAs('รูปม็อคอัพ 20 MiB ใน R2 ใส่ให้งานได้', U.admin, `select public.set_job_mockup('${jobM}', '${picM}')`)
  const picOther = 'SC-R2-A/ffeeddccbbaa9988.jpg'
  await as(U.admin, () => db.query(record('mockups', picOther, 500, 'image/jpeg')))
  await tryAs('รูปของงานอื่นใน R2 ยังใส่ข้ามงานไม่ได้', U.admin, `select public.set_job_mockup('${jobM}', '${picOther}')`, /ไม่ใช่ของงาน/)

  const sheetPic = 'SC-R2-M/sheet/0011223344556677.png'
  await as(U.admin, () => db.query(record('mockups', sheetPic, 800, 'image/png')))
  const readable = async (uid, kind, paths) => as(uid, async () =>
    ((await db.query(`select public.file_read_allowed($1, $2::text[]) r`, [kind, paths])).rows[0].r ?? []).sort())
  const orphan = 'SC-R2-A/9999999999999999.pdf'
  await as(U.admin, () => db.query(record('confirmations', orphan, 10, 'application/pdf')))
  ok('QC เปิด PDF ของใบงานได้', JSON.stringify(await readable(U.qc, 'confirmations', [pdfA, pdfM])) === JSON.stringify([pdfA, pdfM].sort()))
  ok('ฝ่ายผลิตเปิดรูปม็อคอัพของใบงานได้', JSON.stringify(await readable(U.prod, 'mockups', [picM])) === JSON.stringify([picM]))
  await tryAs('บัญชีปิดขอลิงก์เปิดไฟล์ไม่ได้', U.off, `select public.file_read_allowed('confirmations', array['${pdfA}'])`, /ถูกปิด/)
  await tryAs('ผู้ใช้ที่ไม่มีบัญชีพนักงานขอลิงก์ไม่ได้', U.nobody, `select public.file_read_allowed('mockups', array['${picM}'])`, /ถูกปิด/)
  ok('ไฟล์ที่ยังไม่ผูกกับงาน คนอื่นเปิดไม่ได้', (await readable(U.qc, 'confirmations', [orphan])).length === 0)
  ok('ไฟล์ที่ยังไม่ผูกกับงาน แอดมินอีกคนเปิดไม่ได้', (await readable(U.admin2, 'mockups', [sheetPic])).length === 0)
  ok('คนอัปโหลดเปิดไฟล์ตัวเองก่อนผูกกับงานได้ (ดูรูปก่อนบันทึกร่าง)', JSON.stringify(await readable(U.admin, 'mockups', [sheetPic])) === JSON.stringify([sheetPic]))
  ok('path ของ PDF ขอเป็นรูปไม่ได้', (await readable(U.admin, 'mockups', [pdfA])).length === 0)
  ok('ไฟล์ที่ไม่มีอยู่ ไม่ออกลิงก์', (await readable(U.admin, 'confirmations', ['SC-R2-A/0000000000000000.pdf'])).length === 0)

  await db.exec(`delete from private.file_settings; delete from private.file_objects;`)
  ok('ปิด R2 (ย้อนกลับ) = กลับไปตรวจแบบเดิม', await val(`select private.mockup_uploaded('x/1.jpg')`) === true)
}
