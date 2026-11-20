export async function mockupSheetTests({ db, ok, as }) {
  const U = {
    owner: '00000000-0000-0000-0000-000000000001',
    admin: '00000000-0000-0000-0000-000000000051', admin2: '00000000-0000-0000-0000-000000000052',
    prod: '00000000-0000-0000-0000-000000000053', mgr: '00000000-0000-0000-0000-000000000054',
    qc: '00000000-0000-0000-0000-000000000055', staffPrint: '00000000-0000-0000-0000-000000000056',
    staffEmb: '00000000-0000-0000-0000-000000000057', sup: '00000000-0000-0000-0000-000000000058',
  }
  await db.exec(`
    insert into auth.users values ('${U.admin}','ms-admin@test'),('${U.admin2}','ms-admin2@test'),('${U.prod}','ms-prod@test'),
      ('${U.mgr}','ms-mgr@test'),('${U.qc}','ms-qc@test'),('${U.staffPrint}','ms-sp@test'),('${U.staffEmb}','ms-se@test'),('${U.sup}','ms-sup@test');
    insert into public.profiles (user_id,name,role,active) values
      ('${U.admin}','แอดมิน ม.','admin',true),('${U.admin2}','แอดมิน ม.2','admin',true),('${U.prod}','ฝ่ายผลิต ม.','production',true),
      ('${U.mgr}','ผู้บริหาร ม.','manager',true),('${U.qc}','QC ม.','qc',true),('${U.staffPrint}','พนักงานพิมพ์ ม.','staff',true),
      ('${U.staffEmb}','พนักงานปัก ม.','staff',true),('${U.sup}','ผู้ควบคุม ม.','supervisor',true);
    insert into public.staff_stations (user_id, station_code) values ('${U.staffPrint}','print'),('${U.staffEmb}','emb');
  `)
  const firstLine = e => e.message.split(String.fromCharCode(10))[0]
  const q = (uid, sql) => as(uid, () => db.query(sql))
  const call = async (uid, sql) => (await q(uid, `select ${sql} as r`)).rows[0]?.r
  const pass = async (name, uid, sql) => {
    try { const r = await call(uid, sql); ok(name, true); return r } catch (e) { ok(name, false, firstLine(e)) }
  }
  const reject = async (name, uid, sql, re) => {
    try { await call(uid, sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') }
    catch (e) { ok(name, re ? re.test(e.message) : true, firstLine(e)) }
  }
  const spec = {
    app: 'phappim-confirm', v: 1, product: 'tshirt',
    p: { tshirt: { neck: 'คอกลม', neck_color: 'ดำ', print_method: ['DTF'],
      placements: { 'หน้าอกซ้าย': { on: true, size: '8 × 8', note: 'ห่างคอ 8 ซม.' }, 'กลางหลัง': { on: true, tech: 'ซับลิเมชั่น', size: '25' }, 'แขนซ้าย': { on: false } } } },
  }
  const job = (await db.query(`
    insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date,
      route_code, confirmation_pdf_path, phase, station_seq, station_status, spec, confirmation_rev)
    values ('SC-MS/1','ลูกค้าม็อคอัพ','งานม็อคอัพ','tshirt',50,'ตัว','2026-12-31','normal','x.pdf','materials',null,null,'${JSON.stringify(spec)}'::jsonb, 2)
    returning id`)).rows[0].id
  const folder = 'SC-MS_00002f1'
  const sheetOf = async id => (await db.query(`select * from public.mockup_sheets where id = '${id}'`)).rows[0]
  const draft = (overrides = {}) => ({
    views: [{ view: 'front', image_path: `${folder}/sheet/front.png`, width: 1600, height: 2000 },
            { view: 'back', image_path: `${folder}/sheet/back.webp`, width: 1600, height: 2000 }],
    specs: [{ key: 'k1', code: 'S-01', name: 'ขอบคอ', kind: 'sewing', detail: 'ขอบคอกว้าง 2 ซม.', width: 2, unit: 'cm', color: 'ดำ', stations: ['sew'] }],
    callouts: [
      { view: 'front', no: 1, x: 0.5, y: 0.12, box_x: 0.8, box_y: 0.05, title: 'คอเสื้อ', spec_key: 'k1', spec_ref: 'field:neck', stations: ['sew'] },
      { view: 'front', no: 2, x: 0.62, y: 0.3, box_x: 0.9, box_y: 0.3, title: 'อกซ้าย', spec_ref: 'placement:หน้าอกซ้าย', stations: ['print', 'press'] },
      { view: 'back', no: 3, x: 0.5, y: 0.4, box_x: -0.2, box_y: 1.05, title: 'ด้านหลัง', spec_ref: 'placement:กลางหลัง', stations: [] },
    ],
    ...overrides,
  })
  const save = (uid, sheet, version, data) => call(uid, `public.save_mockup_draft('${sheet}', ${version}, '${JSON.stringify(data).replace(/'/g, "''")}'::jsonb)`)
  const trySave = async (name, uid, sheet, version, data, re) => {
    try { const r = await save(uid, sheet, version, data); ok(name, !re, re ? 'ควรถูกปฏิเสธแต่ผ่าน' : ''); return r }
    catch (e) { ok(name, !!re && re.test(e.message), firstLine(e)) }
  }

  ok('ค่าจากใบยืนยัน: ตำแหน่งที่ไม่ใส่เทคนิค ใช้เทคนิคเดียวของใบ',
    (await db.query(`select private.mockup_ref_value('${JSON.stringify(spec)}'::jsonb, 'placement:หน้าอกซ้าย') v`)).rows[0].v === 'DTF · 8 × 8 ซม. · ห่างคอ 8 ซม.')
  ok('ค่าจากใบยืนยัน: ตำแหน่งที่ไม่ได้ติ๊ก = ไม่มีค่า',
    (await db.query(`select private.mockup_ref_value('${JSON.stringify(spec)}'::jsonb, 'placement:แขนซ้าย') v`)).rows[0].v === null)
  const sized = size => db.query(`select private.mockup_ref_value($1::jsonb, 'placement:หน้าอกซ้าย') v`,
    [JSON.stringify({ ...spec, p: { tshirt: { ...spec.p.tshirt, placements: { 'หน้าอกซ้าย': { on: true, tech: 'DTF', size } } } } })]).then(r => r.rows[0].v)
  ok('ค่าจากใบยืนยัน: ขนาดที่พิมพ์หน่วยมาแล้วไม่ต่อ ซม. ซ้ำ', await sized('8x8 ซม.') === 'DTF · 8x8 ซม.', await sized('8x8 ซม.'))
  ok('ค่าจากใบยืนยัน: ขนาดหน่วยอื่นคงตามที่พิมพ์', await sized('3 นิ้ว') === 'DTF · 3 นิ้ว')
  ok('ค่าจากใบยืนยัน: ขนาดตัวเลขล้วนต่อ ซม.', await sized('10 × 12') === 'DTF · 10 × 12 ซม.')
  ok('ไม่มีฟังก์ชันไหนใช้รหัส 40001 / 40P01 (PostgREST ลองซ้ำไม่หยุด)', (await db.query(`select count(*)::int n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prosrc ~ '40001|40P01'`)).rows[0].n === 0)
  ok('ค่าจากใบยืนยัน: ช่องแบบรายการต่อด้วยจุลภาค',
    (await db.query(`select private.mockup_ref_value('${JSON.stringify(spec)}'::jsonb, 'field:print_method') v`)).rows[0].v === 'DTF')

  await reject('ฝ่ายผลิตสร้างม็อคอัพไม่ได้', U.prod, `public.start_mockup_sheet('${job}')`, /บทบาทของคุณ/)
  await reject('ผู้บริหารสร้างม็อคอัพไม่ได้', U.mgr, `public.start_mockup_sheet('${job}')`, /บทบาทของคุณ/)
  await reject('พนักงานสถานีสร้างม็อคอัพไม่ได้', U.staffPrint, `public.start_mockup_sheet('${job}')`, /บทบาทของคุณ/)
  const s1 = await pass('แอดมินสร้างฉบับร่าง', U.admin, `public.start_mockup_sheet('${job}')`)
  await reject('มีร่างอยู่แล้วสร้างซ้ำไม่ได้', U.admin2, `public.start_mockup_sheet('${job}')`, /ยังไม่อนุมัติอยู่แล้ว/)
  ok('ฉบับแรก = ฉบับ 1 สถานะร่าง', (await sheetOf(s1))?.rev === 1 && (await sheetOf(s1))?.status === 'draft')

  await trySave('รูปที่ไม่ใช่โฟลเดอร์ของงานนี้บันทึกไม่ได้', U.admin, s1, 1,
    draft({ views: [{ view: 'front', image_path: 'OTHER/sheet/a.png', width: 10, height: 10 }], callouts: [], specs: [] }), /ไม่ใช่ของงาน/)
  await trySave('ไฟล์ที่ไม่ใช่รูปบันทึกไม่ได้', U.admin, s1, 1,
    draft({ views: [{ view: 'front', image_path: `${folder}/sheet/a.pdf`, width: 10, height: 10 }], callouts: [], specs: [] }), /JPG \/ PNG \/ WEBP/)
  await trySave('จุดนอกภาพบันทึกไม่ได้', U.admin, s1, 1,
    draft({ callouts: [{ view: 'front', no: 1, x: 1.2, y: 0.1, box_x: 0.5, box_y: 0.5, title: 'นอกภาพ', body: 'x' }] }), /นอกภาพ/)
  await trySave('กล่องข้อความเลยขอบว่างรอบภาพบันทึกไม่ได้', U.admin, s1, 1,
    draft({ callouts: [{ view: 'front', no: 1, x: 0.1, y: 0.1, box_x: 1.6, box_y: 0.5, title: 'x', body: 'x' }] }), /นอกภาพ/)
  await trySave('สถานีที่ไม่มีจริงบันทึกไม่ได้', U.admin, s1, 1,
    draft({ callouts: [{ view: 'front', no: 1, x: 0.1, y: 0.1, box_x: 0.5, box_y: 0.5, title: 'x', body: 'x', stations: ['laser'] }] }), /ไม่พบสถานี laser/)
  await trySave('รหัสสเปกซ้ำบันทึกไม่ได้', U.admin, s1, 1,
    draft({ specs: [{ key: 'a', code: 'S-01', name: 'a' }, { key: 'b', code: 'S-01', name: 'b' }], callouts: [] }), /S-01 ซ้ำ/)
  await trySave('Callout อ้างสเปกที่ไม่มีบันทึกไม่ได้', U.admin, s1, 1,
    draft({ callouts: [{ view: 'front', no: 1, x: 0.1, y: 0.1, box_x: 0.5, box_y: 0.5, title: 'x', spec_key: 'zzz' }] }), /อ้างสเปกที่ไม่มี/)
  await trySave('ฝ่ายผลิตบันทึกร่างไม่ได้', U.prod, s1, 1, draft(), /บทบาทของคุณ/)
  ok('ถูกปฏิเสธแล้วร่างยังว่าง (ไม่บันทึกครึ่งๆ)', (await db.query(`select count(*)::int n from public.mockup_views where sheet_id = '${s1}'`)).rows[0].n === 0)

  const v2 = await trySave('แอดมินบันทึกภาพหน้า/หลัง + Callout 3 จุด + สเปก', U.admin, s1, 1, draft())
  ok('บันทึกแล้วเลขฉบับ (version) เพิ่ม', v2 === 2)
  const pts = (await db.query(`select c.no, c.x, c.y, c.box_x, c.box_y, v.view, s.code from public.mockup_callouts c
    join public.mockup_views v on v.id = c.view_id left join public.mockup_specs s on s.id = c.spec_id where c.sheet_id = '${s1}' order by c.no`)).rows
  ok('โหลดกลับได้พิกัดเดิมทุกจุด (กล่องในขอบว่างนอกภาพด้วย)', JSON.stringify(pts.map(p => [p.no, +p.x, +p.y, +p.box_x, +p.box_y, p.view]))
    === JSON.stringify([[1, 0.5, 0.12, 0.8, 0.05, 'front'], [2, 0.62, 0.3, 0.9, 0.3, 'front'], [3, 0.5, 0.4, -0.2, 1.05, 'back']]))
  ok('Callout 1 ผูกกับสเปก S-01', pts[0].code === 'S-01')
  await trySave('แอดมินอีกคนบันทึกด้วยเลขฉบับเก่า = ถูกปฏิเสธ (กันทับกัน)', U.admin2, s1, 1, draft({ callouts: [] }), /มีคนบันทึกม็อคอัพฉบับนี้ไปก่อนแล้ว/)
  ok('ข้อมูลไม่ถูกทับ', (await db.query(`select count(*)::int n from public.mockup_callouts where sheet_id = '${s1}'`)).rows[0].n === 3)
  const v3 = await trySave('แอดมินคนที่ 2 แก้ต่อด้วยเลขฉบับล่าสุดได้ (แอดมินสิทธิ์เท่ากัน)', U.admin2, s1, 2,
    draft({ callouts: [...draft().callouts, { view: 'front', no: 4, x: 0.2, y: 0.5, box_x: 0.02, box_y: 0.6, title: 'แขนซ้าย', stations: ['print'] }] }))
  await reject('ส่งอนุมัติไม่ได้ถ้ามี Callout ไม่มีสเปก', U.admin, `public.submit_mockup_sheet('${s1}', ${v3})`, /Callout 4 ยังไม่มีสเปก/)
  const v4 = await trySave('ลบ Callout 4 ออก', U.admin, s1, v3, draft())
  await reject('ส่งอนุมัติด้วยเลขฉบับเก่าไม่ได้', U.admin, `public.submit_mockup_sheet('${s1}', ${v3})`, /ไปก่อนแล้ว/)

  ok('QC เห็นหัวฉบับร่าง (ไว้เตือนว่ามีฉบับใหม่)', await as(U.qc, async () => (await db.query(`select count(*)::int n from public.mockup_sheets where job_id = '${job}'`)).rows[0].n) === 1)
  ok('QC ยังไม่เห็นภาพ / Callout ของฉบับร่าง', await as(U.qc, async () => (await db.query(`select (select count(*) from public.mockup_callouts where sheet_id = '${s1}') + (select count(*) from public.mockup_views where sheet_id = '${s1}') n`)).rows[0].n) === 0)
  ok('ฝ่ายผลิตเห็นฉบับร่าง', await as(U.prod, async () => (await db.query(`select count(*)::int n from public.mockup_sheets where job_id = '${job}'`)).rows[0].n) === 1)

  const v5 = await pass('แอดมินส่งอนุมัติ', U.admin, `public.submit_mockup_sheet('${s1}', ${v4})`)
  await trySave('รออนุมัติแล้วแก้ร่างไม่ได้', U.admin, s1, v5, draft(), /ไม่ใช่ฉบับร่างแล้ว/)
  await reject('ผู้ควบคุมงานอนุมัติไม่ได้', U.sup, `public.approve_mockup_sheet('${s1}')`, /บทบาทของคุณ/)
  await reject('QC อนุมัติไม่ได้', U.qc, `public.approve_mockup_sheet('${s1}')`, /บทบาทของคุณ/)
  await reject('พนักงานสถานีอนุมัติไม่ได้', U.staffPrint, `public.approve_mockup_sheet('${s1}')`, /บทบาทของคุณ/)
  await reject('ส่งกลับต้องมีเหตุผล', U.prod, `public.return_mockup_sheet('${s1}', ' ')`, /ใส่เหตุผล/)
  await pass('ฝ่ายผลิตส่งกลับให้แก้', U.prod, `public.return_mockup_sheet('${s1}', 'ขนาดโลโก้ไม่ตรงใบ')`)
  const back = await sheetOf(s1)
  ok('ส่งกลับแล้วเป็นร่าง + เก็บเหตุผล', back.status === 'draft' && back.return_reason === 'ขนาดโลโก้ไม่ตรงใบ')
  const v6 = await pass('แอดมินส่งอนุมัติอีกครั้ง', U.admin, `public.submit_mockup_sheet('${s1}', ${back.version})`)
  await pass('ฝ่ายผลิตอนุมัติ', U.prod, `public.approve_mockup_sheet('${s1}', 'ตรวจกับใบแล้ว')`)
  const ap = await sheetOf(s1)
  ok('อนุมัติแล้ว: สถานะ + ผู้อนุมัติ + ฉบับใบยืนยัน', ap.status === 'approved' && ap.approved_by === U.prod && ap.confirmation_rev === 2 && ap.approved_at)
  ok('ค่าจากใบยืนยันถูกแช่ไว้ใน Callout', (await db.query(`select ref_value from public.mockup_callouts where sheet_id = '${s1}' and no = 2`)).rows[0].ref_value === 'DTF · 8 × 8 ซม. · ห่างคอ 8 ซม.')
  const snap = (await db.query(`select data from public.mockup_snapshots where sheet_id = '${s1}'`)).rows[0]?.data
  ok('สร้าง snapshot ครบ ภาพ 2 · Callout 3 · สเปก 1', snap?.views?.length === 2 && snap?.callouts?.length === 3 && snap?.specs?.length === 1 && snap?.rev === 1)
  ok('บันทึกการอนุมัติใน events', (await db.query(`select count(*)::int n from public.events where job_id = '${job}' and type = 'mockup_approved'`)).rows[0].n === 1)
  ok('ไม่ใช้ v6 ซ้ำ', typeof v6 === 'number')

  await db.exec(`update public.jobs set spec = jsonb_set(spec, '{p,tshirt,placements,หน้าอกซ้าย,size}', '"10 × 10"') where id = '${job}'`)
  ok('แก้ใบยืนยันทีหลัง ค่าในฉบับอนุมัติไม่เปลี่ยน', (await db.query(`select ref_value from public.mockup_callouts where sheet_id = '${s1}' and no = 2`)).rows[0].ref_value === 'DTF · 8 × 8 ซม. · ห่างคอ 8 ซม.')

  const immut = async (name, sql) => {
    try { await db.exec(sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') } catch (e) { ok(name, /อนุมัติแล้ว|ถูกแทนที่แล้ว|เพิ่มอย่างเดียว/.test(e.message), firstLine(e)) }
  }
  await immut('แก้ Callout ของฉบับอนุมัติตรงๆ ไม่ได้', `update public.mockup_callouts set x = 0.1 where sheet_id = '${s1}'`)
  await immut('ลบภาพของฉบับอนุมัติไม่ได้', `delete from public.mockup_views where sheet_id = '${s1}'`)
  await immut('แก้สเปกของฉบับอนุมัติไม่ได้', `update public.mockup_specs set name = 'x' where sheet_id = '${s1}'`)
  await immut('เพิ่ม Callout ในฉบับอนุมัติไม่ได้', `insert into public.mockup_callouts (sheet_id, view_id, no, x, y, box_x, box_y, title)
    select '${s1}', id, 9, 0.1, 0.1, 0.1, 0.1, 'x' from public.mockup_views where sheet_id = '${s1}' limit 1`)
  await immut('แก้หัวฉบับอนุมัติไม่ได้', `update public.mockup_sheets set approved_by = null where id = '${s1}'`)
  await immut('ลบฉบับอนุมัติไม่ได้', `delete from public.mockup_sheets where id = '${s1}'`)
  await immut('แก้ snapshot ไม่ได้', `update public.mockup_snapshots set data = '{}' where sheet_id = '${s1}'`)
  await reject('ทิ้งฉบับอนุมัติไม่ได้', U.admin, `public.discard_mockup_draft('${s1}')`, /ทิ้งได้เฉพาะฉบับร่าง/)

  ok('QC เห็น Callout ของฉบับอนุมัติ', await as(U.qc, async () => (await db.query(`select count(*)::int n from public.mockup_callouts where sheet_id = '${s1}'`)).rows[0].n) === 3)
  const staffSees = async uid => as(uid, async () => (await db.query(`select array_agg(c.no order by c.no) nos from public.mockup_callouts c
    join public.mockup_sheets s on s.id = c.sheet_id where s.job_id = '${job}'`)).rows[0].nos ?? [])
  ok('พนักงานพิมพ์เห็นเฉพาะ Callout ของพิมพ์ + ที่ไม่ระบุสถานี', JSON.stringify(await staffSees(U.staffPrint)) === '[2,3]', JSON.stringify(await staffSees(U.staffPrint)))
  ok('พนักงานพิมพ์ไม่เห็นสเปกของเย็บ', await as(U.staffPrint, async () => (await db.query(`select count(*)::int n from public.mockup_specs`)).rows[0].n) === 0)
  ok('พนักงานปัก (งานนี้ไม่ผ่านปัก) ไม่เห็นม็อคอัพของงานนี้', await as(U.staffEmb, async () => (await db.query(`select count(*)::int n from public.mockup_sheets where job_id = '${job}'`)).rows[0].n) === 0)
  ok('พนักงานสถานีอ่าน snapshot ไม่ได้ (มีทุก Callout)', await as(U.staffPrint, async () => (await db.query(`select count(*)::int n from public.mockup_snapshots`)).rows[0].n) === 0)
  ok('ผู้ใช้ที่ไม่มีบัญชีอ่านม็อคอัพไม่ได้', await as('00000000-0000-0000-0000-000000000003', async () => (await db.query(`select count(*)::int n from public.mockup_sheets`)).rows[0].n) === 0)

  await pass('พนักงานพิมพ์รับทราบสเปกที่สถานีพิมพ์', U.staffPrint, `public.ack_mockup_sheet('${s1}', 'print')`)
  await pass('รับทราบซ้ำไม่ error ไม่เพิ่มแถว', U.staffPrint, `public.ack_mockup_sheet('${s1}', 'print')`)
  await reject('พนักงานพิมพ์รับทราบแทนสถานีเย็บไม่ได้', U.staffPrint, `public.ack_mockup_sheet('${s1}', 'sew')`, /สถานีที่จับคู่/)
  await reject('QC รับทราบแทนสถานีอื่นไม่ได้', U.qc, `public.ack_mockup_sheet('${s1}', 'cut')`, /QC \+ Packing/)
  await reject('รับทราบสถานีที่งานไม่ผ่านไม่ได้', U.prod, `public.ack_mockup_sheet('${s1}', 'emb')`, /ไม่ผ่านสถานีนี้/)
  await reject('แอดมินรับทราบไม่ได้', U.admin, `public.ack_mockup_sheet('${s1}', 'print')`, /บทบาทของคุณ/)
  await pass('ฝ่ายผลิตรับทราบที่สถานีเย็บ', U.prod, `public.ack_mockup_sheet('${s1}', 'sew')`)
  const acks = (await db.query(`select user_id, station_code, rev from public.mockup_acks where sheet_id = '${s1}' order by station_code`)).rows
  ok('บันทึกรับทราบ ผู้ใช้ + สถานี + ฉบับ', acks.length === 2 && acks[0].station_code === 'print' && acks[0].user_id === U.staffPrint && acks[0].rev === 1)
  await immut('ลบการรับทราบไม่ได้', `delete from public.mockup_acks where sheet_id = '${s1}'`)

  await reject('แก้ฉบับอนุมัติต้องมีเหตุผล', U.admin, `public.start_mockup_sheet('${job}')`, /ใส่เหตุผล/)
  const s2 = await pass('สร้างฉบับแก้ไข (ฉบับ 2) จากฉบับอนุมัติ', U.admin, `public.start_mockup_sheet('${job}', 'ลูกค้าขอขยายโลโก้')`)
  const copy = (await db.query(`select (select count(*)::int from public.mockup_views where sheet_id = '${s2}') v,
    (select count(*)::int from public.mockup_callouts where sheet_id = '${s2}') c,
    (select count(*)::int from public.mockup_callouts c join public.mockup_specs s on s.id = c.spec_id where c.sheet_id = '${s2}' and s.sheet_id = '${s2}') linked`)).rows[0]
  ok('ฉบับ 2 คัดลอกภาพ Callout และการผูกสเปกมาครบ', copy.v === 2 && copy.c === 3 && copy.linked === 1, JSON.stringify(copy))
  ok('ฉบับ 1 ยังใช้ผลิตอยู่ระหว่างแก้', (await sheetOf(s1)).status === 'approved')
  ok('บันทึกการเริ่มแก้ฉบับใน events', (await db.query(`select payload->>'reason' r from public.events where job_id = '${job}' and type = 'mockup_revision'`)).rows[0]?.r === 'ลูกค้าขอขยายโลโก้')

  await db.exec(`update public.jobs set phase = 'production', station_seq = 1, station_status = 'doing' where id = '${job}'`)
  const s2v = (await sheetOf(s2)).version
  await pass('ส่งอนุมัติฉบับ 2', U.admin, `public.submit_mockup_sheet('${s2}', ${s2v})`)
  await reject('งานเริ่มผลิตแล้ว ฝ่ายผลิตอนุมัติฉบับแก้ไขไม่ได้', U.prod, `public.approve_mockup_sheet('${s2}')`, /แอดมิน ผู้บริหาร หรือเจ้าของอนุมัติ/)
  await pass('ผู้บริหารอนุมัติฉบับแก้ไขหลังเริ่มผลิต', U.mgr, `public.approve_mockup_sheet('${s2}')`)
  ok('ฉบับ 1 ถูกแทนที่ · ฉบับ 2 ใช้ผลิต', (await sheetOf(s1)).status === 'superseded' && (await sheetOf(s2)).status === 'approved')
  ok('ฉบับ 2 อ่านค่าใบยืนยันล่าสุด (10 × 10)', (await db.query(`select ref_value from public.mockup_callouts where sheet_id = '${s2}' and no = 2`)).rows[0].ref_value === 'DTF · 10 × 10 ซม. · ห่างคอ 8 ซม.')
  await immut('ฉบับที่ถูกแทนที่แก้ไม่ได้', `update public.mockup_sheets set status = 'approved' where id = '${s1}'`)
  await reject('รับทราบฉบับที่ถูกแทนที่ไม่ได้', U.prod, `public.ack_mockup_sheet('${s1}', 'cut')`, /เฉพาะม็อคอัพฉบับที่อนุมัติ/)

  const s3 = await pass('สร้างฉบับ 3', U.admin, `public.start_mockup_sheet('${job}', 'ทดสอบฉบับเก่า')`)
  await pass('ทิ้งฉบับร่างได้', U.admin, `public.discard_mockup_draft('${s3}')`)
  ok('ทิ้งร่างแล้วภาพ/Callout ของร่างหายด้วย', (await db.query(`select count(*)::int n from public.mockup_views where sheet_id = '${s3}'`)).rows[0].n === 0)

  const s4 = await pass('สร้างฉบับ 4', U.admin, `public.start_mockup_sheet('${job}', 'ทดสอบฉบับเก่าทับ')`)
  await db.exec(`alter table public.mockup_sheets disable trigger mockup_sheets_guard;
    update public.mockup_sheets set rev = 9 where id = '${s1}';
    alter table public.mockup_sheets enable trigger mockup_sheets_guard;`)
  await db.exec(`update public.mockup_sheets set status = 'pending' where id = '${s4}'`)
  await reject('ฉบับที่เลขเก่ากว่าฉบับอนุมัติ อนุมัติทับไม่ได้', U.mgr, `public.approve_mockup_sheet('${s4}')`, /เก่ากว่าฉบับที่อนุมัติแล้ว/)

  const job3 = (await db.query(`insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date,
      route_code, confirmation_pdf_path, phase, spec, confirmation_rev)
    values ('SC-MS-3','ลูกค้า 3','งาน 3','tshirt',20,'ตัว','2026-12-31','normal','x.pdf','materials','${JSON.stringify(spec)}'::jsonb, 1)
    returning id`)).rows[0].id
  const draft3 = (o = {}) => draft({ views: draft().views.map(v => ({ ...v, image_path: v.image_path.replace(folder, 'SC-MS-3') })), ...o })
  const approve = (sheet, version) => `public.approve_mockup_sheet('${sheet}', null, ${version})`
  const d1 = await pass('แอดมินสร้างร่างงานที่ 3', U.admin, `public.start_mockup_sheet('${job3}')`)
  let dv = await trySave('บันทึกร่างงานที่ 3 (มีจุดที่ยังไม่มีสเปก)', U.admin, d1, 1,
    draft3({ callouts: [...draft().callouts, { view: 'front', no: 4, x: 0.2, y: 0.5, box_x: 0.02, box_y: 0.6, title: 'แขนซ้าย' }] }))
  await reject('อนุมัติจากร่างไม่ได้ถ้ามี Callout ไม่มีสเปก', U.admin, approve(d1, dv), /Callout 4 ยังไม่มีสเปก/)
  dv = await trySave('ลบจุดที่ไม่มีสเปก', U.admin, d1, dv, draft3())
  await reject('อนุมัติร่างโดยไม่ส่งเลขฉบับไม่ได้', U.admin, `public.approve_mockup_sheet('${d1}')`, /ไปก่อนแล้ว/)
  await reject('อนุมัติร่างด้วยเลขฉบับเก่าไม่ได้ (มีคนแก้ทับ)', U.admin, approve(d1, dv - 1), /ไปก่อนแล้ว/)
  await reject('ฝ่ายผลิตอนุมัติฉบับร่างไม่ได้', U.prod, approve(d1, dv), /แอดมินเป็นคนอนุมัติ/)
  await reject('ผู้บริหารอนุมัติฉบับร่างไม่ได้', U.mgr, approve(d1, dv), /แอดมินเป็นคนอนุมัติ/)
  await reject('ผู้ควบคุมงานอนุมัติร่างไม่ได้', U.sup, approve(d1, dv), /บทบาทของคุณ/)
  await reject('พนักงานสถานีอนุมัติร่างไม่ได้', U.staffPrint, approve(d1, dv), /บทบาทของคุณ/)
  ok('ถูกปฏิเสธแล้วยังเป็นร่าง', (await sheetOf(d1)).status === 'draft')
  await pass('แอดมินอนุมัติใช้ผลิตเองจากร่าง ไม่ต้องส่งให้ใครอนุมัติ', U.admin, `public.approve_mockup_sheet('${d1}', 'ตรวจกับใบแล้ว', ${dv})`)
  const a3 = await sheetOf(d1)
  ok('อนุมัติจากร่าง: สถานะ + ผู้อนุมัติเป็นแอดมิน + หมายเหตุ', a3.status === 'approved' && a3.approved_by === U.admin && a3.approve_note === 'ตรวจกับใบแล้ว')
  ok('อนุมัติจากร่าง: มี snapshot + แช่ค่าใบยืนยัน', (await db.query(`select count(*)::int n from public.mockup_snapshots where sheet_id = '${d1}'`)).rows[0].n === 1
    && (await db.query(`select ref_value from public.mockup_callouts where sheet_id = '${d1}' and no = 2`)).rows[0].ref_value === 'DTF · 8 × 8 ซม. · ห่างคอ 8 ซม.')
  ok('อนุมัติจากร่าง: บันทึก events ว่ามาจากร่าง', (await db.query(`select payload->>'from_draft' f from public.events where job_id = '${job3}' and type = 'mockup_approved'`)).rows[0]?.f === 'true')
  await reject('อนุมัติซ้ำไม่ได้', U.admin2, approve(d1, a3.version), /อนุมัติไปแล้ว/)
  await db.exec(`update public.jobs set phase = 'production', station_seq = 1, station_status = 'doing' where id = '${job3}'`)
  const d2 = await pass('สร้างฉบับแก้ไขหลังเริ่มผลิต', U.admin2, `public.start_mockup_sheet('${job3}', 'ลูกค้าเปลี่ยนสีด้าย')`)
  await pass('แอดมินอนุมัติฉบับแก้ไขหลังเริ่มผลิตเองได้', U.admin2, approve(d2, (await sheetOf(d2)).version))
  ok('งานที่ 3: ฉบับ 1 ถูกแทนที่ · ฉบับ 2 ใช้ผลิต', (await sheetOf(d1)).status === 'superseded' && (await sheetOf(d2)).status === 'approved')
  const in3 = (await db.query(`select kind, audience from public.inbox_messages where job_id = '${job3}' order by id`)).rows
  ok('อนุมัติจากร่าง: ไม่มีข้อความรออนุมัติ · แจ้งอนุมัติ 2 ครั้ง · ฉบับแก้ไขแจ้ง QC', !in3.some(m => m.kind === 'mockup_pending')
    && in3.filter(m => m.kind === 'mockup_approved').length === 2 && in3.at(-1).audience.includes('qc'), JSON.stringify(in3))

  await db.exec(`
    create schema storage;
    create table storage.buckets (id text primary key);
    create table storage.objects (bucket_id text, name text);
    insert into storage.buckets values ('mockups');
    insert into storage.objects values ('mockups', '${folder}/sheet/real.png');`)
  try {
    const job2 = (await db.query(`insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date, route_code, confirmation_pdf_path)
      values ('SC-MS-2','ลูกค้า','งาน','tshirt',5,'ตัว','2026-12-31','plain','x.pdf') returning id`)).rows[0].id
    const s5 = await pass('สร้างร่างงานที่ 2', U.owner, `public.start_mockup_sheet('${job2}')`)
    await trySave('รูปที่ยังไม่ได้อัปโหลดจริงบันทึกไม่ได้', U.owner, s5, 1,
      { views: [{ view: 'front', image_path: 'SC-MS-2/sheet/missing.png', width: 10, height: 10 }], specs: [], callouts: [] }, /ยังไม่พบรูปม็อคอัพในระบบ/)
    await trySave('อ้างรูปของงานอื่นที่มีอยู่จริงก็ไม่ได้', U.owner, s5, 1,
      { views: [{ view: 'front', image_path: `${folder}/sheet/real.png`, width: 10, height: 10 }], specs: [], callouts: [] }, /ไม่ใช่ของงาน/)
  } finally {
    await db.exec('drop schema storage cascade')
  }

  const inbox = (await db.query(`select kind, title, audience from public.inbox_messages where job_id = '${job}' order by id`)).rows
  const kinds = inbox.map(m => m.kind)
  ok('ทุกครั้งที่เข้ารออนุมัติแจ้งกล่องจดหมายฝ่ายผลิต + ผู้บริหาร (4 ครั้ง = 4 ข้อความ)', kinds.filter(k => k === 'mockup_pending').length === 4
    && inbox.find(m => m.kind === 'mockup_pending').audience.join() === 'production,manager', JSON.stringify(kinds))
  ok('ส่งกลับแล้วแจ้งแอดมินพร้อมเหตุผล', inbox.some(m => m.kind === 'mockup_returned' && m.audience.join() === 'admin'))
  const changed = inbox.filter(m => m.kind === 'mockup_approved')
  ok('อนุมัติฉบับแรก + ฉบับแก้ไข แจ้ง 2 ครั้ง · ฉบับแก้ไขแจ้ง QC ด้วยว่าต้องรับทราบใหม่', changed.length === 2
    && !changed[0].audience.includes('qc') && changed[1].audience.includes('qc') && /เปลี่ยนเป็นฉบับ 2/.test(changed[1].title), JSON.stringify(changed.map(m => m.title)))
  ok('แจ้งเตือนม็อคอัพไม่มี error ค้าง', (await db.query(`select count(*)::int n from public.inbox_errors where source = 'on_mockup_status_inbox'`)).rows[0].n === 0)

  await db.exec(`alter table public.events disable trigger events_append_only;
    delete from public.jobs where id in ('${job}', '${job3}');
    alter table public.events enable trigger events_append_only;`)
  ok('ลบงานทดสอบ (สคริปต์ล้างวันอาทิตย์) ลบม็อคอัพที่อนุมัติแล้วตามไปได้',
    (await db.query(`select count(*)::int n from public.mockup_sheets where job_id = '${job}'`)).rows[0].n === 0)
}
