export async function reviseSpecTests({ db, ok, as }) {
  const U = {
    owner: '00000000-0000-0000-0000-000000000001',
    admin: '00000000-0000-0000-0000-0000000003c1', prod: '00000000-0000-0000-0000-0000000003c2',
    mgr: '00000000-0000-0000-0000-0000000003c3', qc: '00000000-0000-0000-0000-0000000003c4',
    staff: '00000000-0000-0000-0000-0000000003c5',
  }
  await db.exec(`
    insert into auth.users values ('${U.admin}','rv-admin@test'),('${U.prod}','rv-prod@test'),('${U.mgr}','rv-mgr@test'),
      ('${U.qc}','rv-qc@test'),('${U.staff}','rv-staff@test');
    insert into public.profiles (user_id,name,role,active) values
      ('${U.admin}','แอดมิน แก้ใบ','admin',true),('${U.prod}','ฝ่ายผลิต แก้ใบ','production',true),
      ('${U.mgr}','ผู้บริหาร แก้ใบ','manager',true),('${U.qc}','QC แก้ใบ','qc',true),('${U.staff}','พนักงาน แก้ใบ','staff',true);
    insert into public.staff_stations (user_id, station_code) values ('${U.staff}','print');
  `)
  const q = s => s.replace(/'/g, "''")
  const spec = (no, extra = {}) => ({
    app: 'phappim-confirm', v: 1, product: 'tshirt',
    h: { doc_no: no, customer: 'ลูกค้าแก้ใบ', rev: 0, address: 'ที่อยู่เดิม', ...(extra.h ?? {}) },
    p: { tshirt: { fabric_color: 'ขาว', placements: { 'อกซ้าย': { on: true, tech: 'DTF', size: '8x8' } }, ...(extra.p ?? {}) } },
    ...(extra.top ?? {}),
  })
  const jobOf = async (no, phase = 'production', sample = true) => (await db.query(`
    insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, spare_qty, unit, due_date,
      route_code, confirmation_pdf_path, phase, station_seq, station_status, needs_sample, spec, finished_at)
    values ('${no}','ลูกค้าแก้ใบ','เสื้อทีม','tshirt',100,2,'ตัว','2026-12-20','normal','x.pdf','${phase}',
      ${phase === 'production' ? 1 : 'null'}, ${phase === 'production' ? "'queued'" : 'null'}, ${sample},
      '${q(JSON.stringify(spec(no, { top: { mockup_path: 'old/m.jpg', summary: { qty: 100 } } })))}'::jsonb,
      ${phase === 'done' ? 'now()' : 'null'})
    returning id`)).rows[0].id
  const args = (id, s, o = {}) => {
    const a = { rev: 1, customer: 'ลูกค้าแก้ใบ', name: 'เสื้อทีม', qty: 100, spare: 2, due: '2026-12-20', sample: true, changes: [], ...o }
    const lit = v => v === null ? 'null' : `'${q(String(v))}'`
    return `public.revise_job_spec('${id}', '${q(JSON.stringify(s))}'::jsonb, ${a.rev}, ${lit(a.customer)}, ${lit(a.name)}, ${a.qty}, ${a.spare},
      ${lit(a.due)}, ${a.sample === null ? 'null' : a.sample}, array[${a.changes.map(lit).join(',')}]::text[])`
  }
  const call = async (uid, sql) => (await as(uid, () => db.query(`select ${sql} as r`))).rows[0].r
  const reject = async (name, uid, sql, re) => {
    try { await call(uid, sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') }
    catch (e) { ok(name, re ? re.test(e.message) : true, e.message.split('\n')[0]) }
  }
  const jobRow = async id => (await db.query(`select * from public.jobs where id = '${id}'`)).rows[0]
  const events = async id => (await db.query(`select phase, station_code, payload from public.events where job_id = '${id}' and type = 'spec_revised' order by id`)).rows
  const inbox = async id => (await db.query(`select title, body, audience from public.inbox_messages where job_id = '${id}' and kind = 'spec_revised' order by id`)).rows

  const a = await jobOf('SC-RV-1')
  const s1 = spec('SC-RV-1', { h: { rev: 1, address: 'ที่อยู่ใหม่' }, p: { fabric_color: 'ดำ' } })

  for (const [who, uid] of [['ฝ่ายผลิต', U.prod], ['ผู้บริหาร', U.mgr], ['QC', U.qc], ['พนักงานสถานี', U.staff]]) {
    await reject(`${who}บันทึกใบแก้เข้างานไม่ได้`, uid, args(a, s1), /บทบาทของคุณ/)
  }
  await reject('ต้องใส่แก้ไขครั้งที่', U.admin, args(a, s1, { rev: 0 }), /แก้ไขครั้งที่/)
  await reject('เลขที่ใบไม่ตรงงานถูกปฏิเสธ', U.admin, args(a, spec('SC-RV-9', { h: { rev: 1 } })), /ไม่ตรงกับงาน SC-RV-1/)
  await reject('เปลี่ยนชนิดสินค้าไม่ได้', U.admin, args(a, { ...s1, product: 'polo', p: { polo: {} } }), /เปลี่ยนชนิดสินค้า/)
  await reject('เปลี่ยนการขึ้นตัวอย่างไม่ได้', U.admin, args(a, s1, { sample: false }), /รับเข้าแบบขึ้นตัวอย่าง/)
  await reject('ข้อมูลไม่ใช่ใบยืนยันถูกปฏิเสธ', U.admin, args(a, { h: 'x' }), /ข้อมูลใบยืนยันไม่ถูกต้อง/)
  await reject('จำนวนเป็น 0 ไม่ได้', U.admin, args(a, s1, { qty: 0 }), /มากกว่า 0/)
  await reject('เผื่อเสียติดลบไม่ได้', U.admin, args(a, s1, { spare: -1 }), /ติดลบ/)
  await reject('ไม่มีกำหนดส่งไม่ได้', U.admin, args(a, s1, { due: null }), /กำหนดส่ง/)
  await reject('ไม่มีชื่อลูกค้าไม่ได้', U.admin, args(a, s1, { customer: ' ' }), /ชื่อลูกค้า/)
  ok('ถูกปฏิเสธแล้วงานไม่เปลี่ยน', (await jobRow(a)).spec.p.tshirt.fabric_color === 'ขาว' && (await events(a)).length === 0)

  try {
    await as(U.admin, () => db.query(`update public.jobs set qty = 5 where id = '${a}'`))
    ok('แอดมินแก้ตาราง jobs ตรงไม่ได้ (ต้องผ่านฟังก์ชัน)', (await jobRow(a)).qty === 100)
  } catch { ok('แอดมินแก้ตาราง jobs ตรงไม่ได้ (ต้องผ่านฟังก์ชัน)', true) }

  const r1 = await call(U.admin, args(a, { ...s1, mockup_path: 'x/y.jpg', from_job: true, revise_job: true },
    { qty: 120, due: '2026-12-25', changes: ['สีผ้าพื้น', 'ที่อยู่จัดส่ง', 'สีผ้าพื้น', ' '] }))
  ok('แอดมินบันทึกใบแก้เข้างานได้', r1.changed === true && r1.rev === 1, JSON.stringify(r1))
  const j1 = await jobRow(a)
  ok('สเปกใหม่อยู่ในงาน', j1.spec.p.tshirt.fabric_color === 'ดำ' && j1.spec.h.address === 'ที่อยู่ใหม่')
  ok('จำนวน กำหนดส่ง ครั้งที่แก้ เปลี่ยนตาม', j1.qty === 120 && j1.confirmation_rev === 1
    && new Date(j1.due_date).toISOString().startsWith('2026-12-2'), `${j1.qty} ${j1.confirmation_rev} ${j1.due_date}`)
  ok('ไม่เก็บค่าชั่วคราวของฟอร์มในสเปก', !('mockup_path' in j1.spec) && !('from_job' in j1.spec) && !('revise_job' in j1.spec))
  ok('สถานีและสถานะงานไม่เปลี่ยน', j1.phase === 'production' && j1.station_status === 'queued')
  const ev1 = await events(a)
  ok('ลง events 1 แถว', ev1.length === 1 && ev1[0].station_code !== null, JSON.stringify(ev1))
  ok('events จดจำนวน + กำหนดส่ง + ช่องที่แก้ (ไม่ซ้ำ ไม่ว่าง)', ev1[0]?.payload.summary.includes('จำนวน 100 → 120')
    && ev1[0]?.payload.summary.some(x => x.startsWith('กำหนดส่ง 20/12/2569 → 25/12/2569'))
    && JSON.stringify(ev1[0]?.payload.fields) === JSON.stringify(['สีผ้าพื้น', 'ที่อยู่จัดส่ง']), JSON.stringify(ev1[0]?.payload))
  ok('events เก็บจำนวน/กำหนดส่งเดิมและใหม่ (หน้าเว็บแปลเป็นภาษาพม่าได้)', ev1[0]?.payload.qty_from === 100 && ev1[0]?.payload.qty_to === 120
    && ev1[0]?.payload.due_from === '2026-12-20' && ev1[0]?.payload.due_to === '2026-12-25' && ev1[0]?.payload.renamed.length === 0, JSON.stringify(ev1[0]?.payload))
  const in1 = await inbox(a)
  ok('แจ้งกล่องจดหมายทุกฝ่าย', in1.length === 1 && ['admin', 'production', 'supervisor', 'qc', 'manager'].every(r => in1[0].audience.includes(r)))
  ok('ข้อความแจ้งบอกครั้งที่ + สิ่งที่เปลี่ยน', /แก้ใบยืนยัน SC-RV-1 ครั้งที่ 1/.test(in1[0]?.title) && /จำนวน 100 → 120/.test(in1[0]?.body)
    && /ช่องที่แก้: สีผ้าพื้น, ที่อยู่จัดส่ง/.test(in1[0]?.body), in1[0]?.body)

  const same = await call(U.admin, args(a, s1, { qty: 120, due: '2026-12-25' }))
  ok('บันทึกซ้ำแบบไม่มีอะไรเปลี่ยน = ไม่ลง events ไม่แจ้งซ้ำ', same.changed === false && (await events(a)).length === 1 && (await inbox(a)).length === 1)
  await reject('ครั้งที่แก้ถอยหลังไม่ได้', U.admin, args(a, spec('SC-RV-1', { h: { rev: 0 } }), { rev: 0 }), /แก้ไขครั้งที่/)

  await db.query(`insert into public.qc_results (job_id, passed, failed) values ('${a}', 50, 0)`)
  await reject('ลดจำนวนต่ำกว่าที่ QC ผ่านแล้วไม่ได้', U.admin, args(a, spec('SC-RV-1', { h: { rev: 2 } }), { rev: 2, qty: 40 }), /QC ผ่านไปแล้ว 50 ชิ้น/)
  const r2 = await call(U.admin, args(a, spec('SC-RV-1', { h: { rev: 1 } }), { qty: 50, due: '2026-12-25' }))
  ok('แก้ซ้ำในครั้งที่เดิมได้ (ก่อนลูกค้าเซ็น) · จำนวนเท่ากับที่ QC ผ่านได้', r2.changed === true && (await jobRow(a)).qty === 50)
  ok('เจ้าของบันทึกใบแก้ได้', (await call(U.owner, args(a, spec('SC-RV-1', { h: { rev: 2 } }), { rev: 2, qty: 50, due: '2026-12-25' }))).changed === true)

  const done = await jobOf('SC-RV-2', 'done')
  await reject('งานเสร็จแล้วเปลี่ยนจำนวนไม่ได้', U.admin, args(done, spec('SC-RV-2', { h: { rev: 1 } }), { qty: 150 }), /ผลิตเสร็จแล้ว/)
  ok('งานเสร็จแล้วแก้ที่อยู่ได้', (await call(U.admin, args(done, spec('SC-RV-2', { h: { rev: 1, address: 'ส่งที่ใหม่' } })))).changed === true)

  const cancelled = await jobOf('SC-RV-3', 'cancelled')
  await reject('งานยกเลิกแล้วแก้ใบไม่ได้', U.admin, args(cancelled, spec('SC-RV-3', { h: { rev: 1 } })), /ถูกยกเลิก/)

  const noSample = await jobOf('SC-RV-4', 'production', false)
  await reject('งานไม่ขึ้นตัวอย่าง ส่งใบที่เลือกขึ้นตัวอย่างไม่ได้', U.admin, args(noSample, spec('SC-RV-4', { h: { rev: 1 } })), /รับเข้าแบบไม่ขึ้นตัวอย่าง/)

  const m = await jobOf('SC-RV-5')
  const sheet = (await db.query(`insert into public.mockup_sheets (job_id, rev, status) values ('${m}', 1, 'draft') returning id`)).rows[0].id
  const view = (await db.query(`insert into public.mockup_views (sheet_id, view, image_path, width, height) values ('${sheet}', 'front', 'a.jpg', 10, 10) returning id`)).rows[0].id
  await db.exec(`insert into public.mockup_callouts (sheet_id, view_id, no, x, y, box_x, box_y, title, spec_ref, ref_value) values
    ('${sheet}', '${view}', 1, 0.5, 0.5, 0.1, 0.1, 'อกซ้าย', 'placement:อกซ้าย', 'DTF · 8x8 ซม.'),
    ('${sheet}', '${view}', 2, 0.5, 0.5, 0.1, 0.1, 'สีผ้า', 'field:fabric_color', 'ขาว'),
    ('${sheet}', '${view}', 3, 0.5, 0.5, 0.1, 0.1, 'หมายเหตุ', null, null);
    update public.mockup_sheets set status = 'approved' where id = '${sheet}'`)
  const rm = await call(U.admin, args(m, spec('SC-RV-5', { h: { rev: 1 }, p: { placements: { 'อกซ้าย': { on: true, tech: 'DTF', size: '10x10' } } } })))
  ok('บอกจำนวนจุดในม็อคอัพฉบับอนุมัติที่ยังเป็นค่าเก่า', rm.mockup_stale === 1 && rm.mockup_rev === 1, JSON.stringify(rm))
  ok('ข้อความแจ้งบอกว่าม็อคอัพยังเป็นค่าเก่า', /ม็อคอัพกำกับสเปกฉบับ 1 ยังเป็นค่าเก่า 1 จุด/.test((await inbox(m))[0]?.body ?? ''))

  await db.exec(`update public.inbox_settings set enabled = false where kind = 'spec_revised'`)
  const off = await jobOf('SC-RV-6')
  ok('ปิดแจ้งเตือนแล้วยังบันทึกได้', (await call(U.admin, args(off, spec('SC-RV-6', { h: { rev: 1 }, p: { fabric_color: 'แดง' } })))).changed === true
    && (await inbox(off)).length === 0 && (await events(off)).length === 1)
  await db.exec(`update public.inbox_settings set enabled = true where kind = 'spec_revised'`)

  const parent = await jobOf('SC-RV-7', 'production', false)
  const child = await call(U.admin, `public.split_job('${parent}', 30)`)
  const grandchild = await call(U.admin, `public.split_job('${child}', 10)`)
  const s7 = (o = {}) => spec('SC-RV-7', { h: { rev: 1, address: 'ส่งที่ใหม่' }, p: { fabric_color: 'ดำ' }, ...o })
  await reject('งานที่แบ่งแล้ว เปลี่ยนจำนวนในใบแก้ไม่ได้ (บอกยอดรวมทุกส่วน)', U.admin, args(parent, s7(), { qty: 120, sample: false }),
    /ถูกแบ่งเป็น SC-RV-7, SC-RV-7-2, SC-RV-7-2-2 แล้ว \(รวม 100 ชิ้น\)/)
  ok('ถูกปฏิเสธแล้วจำนวนทุกส่วนไม่เปลี่ยน', (await jobRow(parent)).qty === 70 && (await jobRow(child)).qty === 20 && (await jobRow(grandchild)).qty === 10)
  const rs = await call(U.admin, args(parent, s7(), { qty: 100, sample: false, due: '2026-12-22', changes: ['ที่อยู่จัดส่ง'] }))
  ok('งานที่แบ่งแล้ว ใบแก้ยอดรวมเดิมบันทึกได้', rs.changed === true && JSON.stringify(rs.parts) === '["SC-RV-7","SC-RV-7-2","SC-RV-7-2-2"]', JSON.stringify(rs))
  const [p7, c7, g7] = [await jobRow(parent), await jobRow(child), await jobRow(grandchild)]
  ok('งานแม่คงจำนวนหลังแบ่ง ไม่นับซ้ำกับส่วนที่แบ่ง', p7.qty === 70 && c7.qty === 20 && g7.qty === 10, `${p7.qty} ${c7.qty} ${g7.qty}`)
  ok('สเปก กำหนดส่ง ครั้งที่แก้ เปลี่ยนทุกส่วนที่แบ่ง', [p7, c7, g7].every(x => x.spec.p.tshirt.fabric_color === 'ดำ'
    && x.confirmation_rev === 1 && new Date(x.due_date).toISOString().startsWith('2026-12-2')))
  ok('เผื่อเสียอยู่ที่งานแม่ ส่วนที่แบ่งยังเป็น 0', p7.spare_qty === 2 && c7.spare_qty === 0 && g7.spare_qty === 0)
  ok('ทุกส่วนที่แบ่งลง events แก้ใบ', (await events(child)).length === 1 && (await events(grandchild)).length === 1 && (await events(parent)).length === 1)
  ok('ข้อความแจ้งบอกว่าใช้กับทุกส่วน', /ใช้กับทุกส่วนที่แบ่ง: SC-RV-7, SC-RV-7-2, SC-RV-7-2-2/.test((await inbox(parent))[0]?.body ?? ''))
  await reject('ส่วนที่แบ่งรับใบแก้ตรงไม่ได้ (เลขที่ใบเป็นของงานแม่)', U.admin, args(child, s7(), { qty: 100, sample: false }), /ไม่ตรงกับงาน SC-RV-7-2/)

  const other = await jobOf('SC-RV-7-0002', 'production', false)
  const r8 = await call(U.admin, args(parent, spec('SC-RV-7', { h: { rev: 2 } }), { rev: 2, qty: 100, sample: false, due: '2026-12-22' }))
  ok('ใบอีกสินค้าในออเดอร์เดียวกัน (-0002) ไม่ถูกนับเป็นส่วนที่แบ่ง', r8.parts.length === 3 && (await jobRow(other)).confirmation_rev === 0, JSON.stringify(r8))
}
