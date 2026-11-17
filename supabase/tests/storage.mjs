// PDF ใบยืนยันต้องอยู่ใน Storage จริงก่อนรับงาน (migration 20261118000006 · กฎข้อ 1)
// PGlite ไม่มี Storage จึงจำลองตาราง storage.buckets / storage.objects แบบย่อ แล้วลบทิ้งหลังทดสอบ

export async function storageTests({ db, ok, as }) {
  const prod = '00000000-0000-0000-0000-000000000013'
  const receive = (no, path, customer = 'ลูกค้าทดสอบ') => as(prod, () => db.query(`select public.receive_job(
    '${no}', '${customer}', 'งานทดสอบ', 'tshirt', 10, 'ตัว', '2026-12-31', 'normal', '${path}') as id`))
  const tryReceive = async (name, no, path, re, customer) => {
    try { await receive(no, path, customer); ok(name, !re, re ? 'ควรถูกปฏิเสธแต่ผ่าน' : '') }
    catch (e) { ok(name, !!re && re.test(e.message), e.message.split('\n')[0]) }
  }

  await tryReceive('ยังไม่มี Storage (ฐานข้อมูลทดสอบ) = ข้ามการตรวจไฟล์', 'SC-ST-NOSTORE', 'confirmations/a.pdf')

  await db.exec(`
    create schema storage;
    create table storage.buckets (id text primary key);
    create table storage.objects (bucket_id text, name text);
    insert into storage.buckets values ('confirmations');`)
  await tryReceive('กฎ 1: ไม่ได้อัปโหลด PDF จริง (ส่งแค่ชื่อไฟล์) รับงานไม่ได้', 'SC-ST-FAKE', 'SC-ST-FAKE/1.pdf', /ยังไม่พบไฟล์ PDF/)
  await db.exec(`insert into storage.objects values ('confirmations', 'SC-ST-REAL/1.pdf'), ('other', 'SC-ST-WRONG/1.pdf')`)
  await tryReceive('ไฟล์อยู่ bucket อื่น ไม่นับ', 'SC-ST-WRONG', 'SC-ST-WRONG/1.pdf', /ยังไม่พบไฟล์ PDF/)
  await tryReceive('ชื่อลูกค้าว่าง รับงานไม่ได้', 'SC-ST-REAL', 'SC-ST-REAL/1.pdf', /ชื่อลูกค้า/, '  ')
  await tryReceive('อัปโหลด PDF แล้ว รับงานได้', 'SC-ST-REAL', 'SC-ST-REAL/1.pdf')
  ok('รับงานแล้วเก็บ path ของไฟล์', (await db.query(`select confirmation_pdf_path p from public.jobs where confirmation_no = 'SC-ST-REAL'`)).rows[0]?.p === 'SC-ST-REAL/1.pdf')
  await db.exec('drop schema storage cascade')
}
