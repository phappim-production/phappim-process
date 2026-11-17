export async function settingsTests({ db, ok, as }) {
  const owner = '00000000-0000-0000-0000-000000000001'
  const noProfile = '20261119-1000-4000-8000-000000000002'
  const production = '20261119-1000-4000-8000-000000000001'

  // run.mjs จำลอง auth.users แบบย่อ ส่วน Supabase จริงมี created_at อยู่แล้ว
  await db.exec(`
    alter table auth.users add column created_at timestamptz default '2026-11-17 12:00:00+07';
    insert into auth.users (id, email) values ('${production}', 'production-settings@test'), ('${noProfile}', 'pending-settings@test');
    insert into public.profiles (user_id, name, role) values ('${production}', 'ฝ่ายผลิตทดสอบ', 'production');
  `)

  async function expectFailure(name, action, pattern) {
    try {
      await action()
      ok(name, false, 'ควรถูกปฏิเสธ')
    } catch (error) {
      ok(name, pattern.test(error.message), error.message)
    }
  }

  const users = await as(owner, () => db.query('select * from public.owner_list_users()'))
  const authCount = (await db.query('select count(*)::int as n from auth.users')).rows[0].n
  const noRole = users.rows.find(row => row.user_id === noProfile)
  const ownerRow = users.rows.find(row => row.user_id === owner)
  ok('C2: owner เห็นบัญชี Auth ทุกบัญชีพร้อมอีเมลและวันที่สร้าง',
    users.rows.length === authCount && ownerRow?.email === 'owner@test' && ownerRow?.role === 'owner' &&
    new Date(ownerRow?.created_at).toISOString() === '2026-11-17T05:00:00.000Z')
  ok('C2: บัญชีไม่มี profile อยู่ในรายการและไม่มีชื่อ บทบาท หรือสถานะ', noRole?.name === null &&
    noRole.role === null && noRole.active === null)

  await expectFailure('C2: production เรียกรายชื่อผู้ใช้แล้วถูกปฏิเสธเป็นภาษาไทย',
    () => as(production, () => db.query('select * from public.owner_list_users()')), /บทบาท.*ทำขั้นนี้ไม่ได้/)
  await db.exec('set role anon')
  try {
    await expectFailure('C2: anon ไม่มีสิทธิ์เรียกรายชื่อผู้ใช้',
      () => db.query('select * from public.owner_list_users()'), /permission denied.*owner_list_users/)
  } finally {
    await db.exec('reset role')
  }

  await expectFailure('C2: owner ปิดบัญชีตัวเองไม่ได้',
    () => as(owner, () => db.query('update public.profiles set active = false where user_id = $1', [owner])), /ปิดบัญชีหรือลดบทบาท/)
  await expectFailure('C2: owner ลดบทบาทตัวเองไม่ได้',
    () => as(owner, () => db.query("update public.profiles set role = 'manager' where user_id = $1", [owner])), /ปิดบัญชีหรือลดบทบาท/)
  await expectFailure('C2: owner ลบโปรไฟล์ตัวเองไม่ได้',
    () => as(owner, () => db.query('delete from public.profiles where user_id = $1', [owner])), /ลบโปรไฟล์เจ้าของระบบ/)
  const profile = await as(owner, () => db.query(`
    insert into public.profiles (user_id, name, role, active, section)
    values ($1, 'ยังไม่มีบทบาท', 'qc', true, null) returning user_id, role, active
  `, [noProfile]))
  ok('C2: owner กำหนดบทบาทให้บัญชีที่ยังไม่มี profile ได้', profile.rows[0]?.role === 'qc' && profile.rows[0]?.active)

  await db.exec(`
    insert into public.jobs
      (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date,
       route_code, confirmation_pdf_path, phase, station_seq, station_status, station_started_at)
    values ('TEST-C2-SLA', 'ลูกค้าทดสอบ', 'งานพิมพ์', 'tshirt', 10, 'ตัว', '2026-12-31',
            'normal', 'test.pdf', 'production', 1, 'doing', now());
  `)
  const liveSla = async () => (await as(owner, () => db.query(`
    select current_station, (sla->>'station_sla_days')::numeric::float8 as days from public.job_live
    where confirmation_no = 'TEST-C2-SLA'
  `))).rows[0]
  const before = await liveSla()
  ok('C2: งานทดสอบอยู่สถานีพิมพ์ที่ยังไม่จับเวลา', before?.current_station === 'print' && before.days === null)

  const stationUpdate = await as(owner, () => db.query(`
    update public.stations set sla_days = 2 where code = 'print' returning 1
  `))
  ok('C2: owner แก้เวลามาตรฐานพิมพ์ได้ และ job_live ใช้ 2 วันทันที',
    stationUpdate.rows.length === 1 && (await liveSla()).days === 2)
  const deniedUpdate = await as(production, () => db.query(`
    update public.stations set sla_days = 4 where code = 'print' returning 1
  `))
  ok('C2: production แก้เวลามาตรฐานไม่ได้และค่ายังเป็น 2 วัน',
    deniedUpdate.rows.length === 0 && (await liveSla()).days === 2)

  const editSegment = await as(owner, () => db.query(`
    update public.sla_segments set big_qty = 800, big_sla_days = 4.5 where code = 'subli_ppc' returning big_qty
  `))
  ok('C2: owner แก้เกณฑ์ชิ้นงานใหญ่ของช่วงได้', editSegment.rows[0]?.big_qty === 800)
  await expectFailure('C2: เวลางานใหญ่ต้องมีจำนวนชิ้น',
    () => as(owner, () => db.query(`update public.sla_segments set big_qty = null where code = 'subli_ppc'`)), /sla_segments_big_sla_needs_qty/)

  const editLocked = await as(owner, () => db.query(`
    update public.stations set substeps = jsonb_set(substeps, '{0,name}', '"รับฟิล์มแล้ว"')
    where code = 'dtf_press' returning substeps->0->>'name' as name
  `))
  ok('C2: เปลี่ยนชื่อขั้นที่รอเงื่อนไขได้', editLocked.rows[0]?.name === 'รับฟิล์มแล้ว')
  await expectFailure('C2: เปลี่ยนชนิดขั้นที่ระบบใช้อ้างอิงไม่ได้',
    () => as(owner, () => db.query(`update public.stations set substeps = jsonb_set(substeps, '{0,kind}', '"opt"') where code = 'dtf_press'`)),
    /ขั้นย่อยที่ระบบใช้/)
  await expectFailure('C2: ลบขั้นที่ระบบใช้อ้างอิงไม่ได้',
    () => as(owner, () => db.query(`update public.stations set substeps = substeps - 0 where code = 'dtf_press'`)), /ขั้นย่อยที่ระบบใช้/)

  const material = await as(owner, () => db.query(`
    update public.material_templates set name = 'สั่งฟิล์มทดสอบ' where key = 'dtf_film' returning name
  `))
  ok('C2: เปลี่ยนชื่อแม่แบบที่ระบบติ๊กให้อัตโนมัติได้', material.rows[0]?.name === 'สั่งฟิล์มทดสอบ')
  await expectFailure('C2: ลบแม่แบบที่ระบบติ๊กให้อัตโนมัติไม่ได้',
    () => as(owner, () => db.query(`delete from public.material_templates where key = 'screen_film'`)), /ลบแม่แบบ/)
  await expectFailure('C2: แม่แบบอัตโนมัติแก้ฝ่ายผู้รับผิดชอบไม่ได้',
    () => as(owner, () => db.query(`update public.material_templates set dept = 'qc' where key = 'dtg_film'`)), /แก้ได้เฉพาะชื่อ/)

  const reason = await as(owner, () => db.query(`
    update public.reason_codes set active = false where code = 'M1' returning active
  `))
  ok('C2: owner ปิดรหัสสาเหตุได้และยังเก็บรหัสไว้', reason.rows[0]?.active === false)

  await as(owner, () => db.query(`insert into public.sewing_machines (code, type_code) values ('SN-996', 'single'), ('SN-997', 'single')`))
  const removed = await as(owner, () => db.query(`delete from public.sewing_machines where code = 'SN-996' returning id`))
  ok('C2: owner ลบจักรที่ยังไม่มีประวัติได้', removed.rows.length === 1)
  await db.exec(`
    insert into public.machine_assignments (machine_id, job_id, released_at)
    select m.id, j.id, now() from public.sewing_machines m cross join public.jobs j
    where m.code = 'SN-997' and j.confirmation_no = 'TEST-C2-SLA';
  `)
  await expectFailure('C2: ลบจักรที่มีประวัติจ่ายงานไม่ได้แม้คืนจักรแล้ว',
    () => as(owner, () => db.query(`delete from public.sewing_machines where code = 'SN-997'`)), /จักรมีประวัติ/)
  const disabled = await as(owner, async () => {
    await db.query(`select public.set_machine_status('SN-997', 'off')`)
    return db.query(`select status from public.sewing_machines where code = 'SN-997'`)
  })
  ok('C2: จักรที่มีประวัติปิดใช้งานผ่าน RPC เดิมได้', disabled.rows[0]?.status === 'off')

  const off = await as(owner, () => db.query(`
    update public.inbox_settings set enabled = false where kind = 'hold' returning enabled
  `))
  ok('C2: owner ปิดการแจ้งเตือนรายเรื่องได้', off.rows[0]?.enabled === false)
  const deniedInbox = await as(production, () => db.query(`
    update public.inbox_settings set enabled = false where kind = 'rework' returning enabled
  `))
  const rework = await db.query("select enabled from public.inbox_settings where kind = 'rework'")
  ok('C2: production ปิดการแจ้งเตือนไม่ได้และค่ายังเปิดอยู่', deniedInbox.rows.length === 0 && rework.rows[0]?.enabled)
}
