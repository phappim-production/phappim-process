export async function sewingPickTests({ db, ok, as }) {
  const prod = '00000000-0000-0000-0000-000000000013'
  const call = sql => as(prod, () => db.query(`select ${sql}`))
  const pass = async (name, sql) => {
    try { await call(sql); ok(name, true) } catch (e) { ok(name, false, e.message.split('\n')[0]) }
  }
  const reject = async (name, sql, re) => {
    try { await call(sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') } catch (e) { ok(name, re.test(e.message), e.message.split('\n')[0]) }
  }
  // สูตรจักรของสินค้าทดสอบห้ามค้างไปถึงชุดที่เทียบสูตรจักรกับฐานจริง → ลบตอนจบ
  try {
  await db.exec(`
    insert into public.product_types (code, name, category, unit, sort) select v.code, v.name, p.category, p.unit, 999 from public.product_types p, (values ('pick1', 'สินค้าทดสอบเลือกจักร 1'), ('pick2', 'สินค้าทดสอบเลือกจักร 2')) v(code, name) where p.code = 'tshirt';
    insert into public.product_machine_needs (product_type_code, type_code, qty) values ('pick1', 'single', 1), ('pick2', 'single', 2);
    insert into public.sewing_machines (code, type_code, sort, status) values
      ('SN-951', 'single', 9901, 'ready'), ('SN-952', 'single', 9902, 'ready'), ('SN-953', 'single', 9903, 'broken'), ('OL4-951', 'ovl4', 9904, 'ready');
  `)
  const sewJob = async (no, product) => (await db.query(`
    insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date,
      route_code, confirmation_pdf_path, phase, station_seq, station_status)
    values ('${no}','ลูกค้าทดสอบ','งานทดสอบเลือกจักร','${product}',10,'ตัว','2026-12-31','normal','x.pdf','production',4,'queued')
    returning id`)).rows[0].id
  const mine = async id => (await db.query(`select array_agg(m.code order by m.code) codes from public.machine_assignments a
    join public.sewing_machines m on m.id = a.machine_id where a.job_id = '${id}' and a.released_at is null`)).rows[0].codes ?? []

  const a = await sewJob('SC-PICK-A', 'pick1')
  const b = await sewJob('SC-PICK-B', 'pick1')
  const c = await sewJob('SC-PICK-C', 'pick2')
  await reject('เลือกจักรว่างเปล่าไม่ได้', `public.start_sewing('${a}', array[]::text[])`, /เลือกจักรอย่างน้อย 1 ตัว/)
  await reject('เลือกจักรที่เสียไม่ได้', `public.start_sewing('${a}', array['SN-953'])`, /SN-953 เสีย/)
  await reject('เลือกจักรชนิดที่งานนี้ไม่ใช้ไม่ได้', `public.start_sewing('${a}', array['OL4-951'])`, /งานนี้ไม่ใช้/)
  await reject('เลือกจักรรหัสที่ไม่มีไม่ได้', `public.start_sewing('${a}', array['SN-959'])`, /ไม่พบจักรรหัส SN-959/)
  await pass('เริ่มเย็บด้วยจักรที่ช่างเลือก (พิมพ์ตัวเล็ก/เว้นวรรคได้)', `public.start_sewing('${a}', array[' sn-952 '])`)
  ok('งานได้จักรตัวที่เลือก ไม่ใช่ตัวที่ระบบเลือก', JSON.stringify(await mine(a)) === '["SN-952"]', JSON.stringify(await mine(a)))
  ok('เริ่มเย็บแล้วสถานะเป็นกำลังทำ', (await db.query(`select station_status from public.jobs where id = '${a}'`)).rows[0].station_status === 'doing')
  await reject('เลือกจักรที่งานอื่นใช้อยู่ไม่ได้', `public.start_sewing('${b}', array['SN-952'])`, /SN-952 ใช้กับงาน SC-PICK-A/)
  ok('ถูกปฏิเสธแล้วไม่จ่ายจักรค้างไว้', (await mine(b)).length === 0)
  await reject('สินค้าที่ต้องใช้ 2 ตัว เลือกตัวเดียวไม่ได้', `public.start_sewing('${c}', array['SN-951'])`, /ไม่ครบ ต้องใช้อย่างน้อย 2 ตัว/)
  await pass('ไม่เลือกจักร = ระบบเลือกตัวที่ว่างให้เหมือนเดิม', `public.start_sewing('${b}')`)
  ok('ระบบเลือกจักรว่างให้ 1 ตัว', (await mine(b)).length === 1)
  } finally {
    await db.exec(`delete from public.product_machine_needs where product_type_code in ('pick1', 'pick2')`)
  }
}
