export async function developTests({ db, ok, as }) {
  const U = {
    admin: '00000000-0000-0000-0000-0000000004d1', prod: '00000000-0000-0000-0000-0000000004d2',
  }
  await db.exec(`
    insert into auth.users values ('${U.admin}','dv-admin@test'),('${U.prod}','dv-prod@test');
    insert into public.profiles (user_id,name,role,active) values
      ('${U.admin}','แอดมิน Develop','admin',true),('${U.prod}','ฝ่ายผลิต Develop','production',true);
  `)
  const q = s => s.replace(/'/g, "''")
  const call = async (uid, sql) => (await as(uid, () => db.query(`select ${sql} as r`))).rows[0].r
  const reject = async (name, uid, sql, re) => {
    try { await call(uid, sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') }
    catch (e) { ok(name, re ? re.test(e.message) : true, e.message.split('\n')[0]) }
  }
  const receive = (no, { sample = true, develop = false, spec = {} } = {}) => `public.receive_job(p_confirmation_no => '${no}', p_customer_name => 'ลูกค้า Develop',
    p_job_name => 'ลายใหม่', p_product_type_code => 'tshirt', p_qty => 3, p_unit => 'ตัว', p_due_date => '2026-12-20', p_route_code => 'cut_only',
    p_confirmation_pdf_path => null, p_spec => '${q(JSON.stringify(spec))}'::jsonb, p_needs_sample => ${sample}, p_develop => ${develop})`
  const job = async id => (await db.query(`select * from public.jobs where id = '${id}'`)).rows[0]
  const toReview = id => db.exec(`update public.jobs set phase = 'sample_review', station_seq = null, station_status = null where id = '${id}'`)
  const result = (id, pass, note = null) => `public.record_sample_result('${id}', ${pass}, ${note ? `'${q(note)}'` : 'null'}, null)`

  await reject('งาน Develop ที่เลือกไม่ขึ้นตัวอย่างถูกปฏิเสธ', U.admin, receive('SC-DV-0', { sample: false, develop: true }), /งาน Develop ต้องขึ้นตัวอย่าง/)
  await reject('ฝ่ายผลิตรับงาน Develop เข้าไม่ได้', U.prod, receive('SC-DV-P', { develop: true }), /แอดมินเป็นคนส่งงานเข้าโรงงาน/)
  try {
    await db.exec(`insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date, route_code, phase, needs_sample, develop)
      values ('SC-DV-X','x','x','tshirt',1,'ตัว','2026-12-20','cut_only','materials',false,true)`)
    ok('ตาราง jobs ไม่ยอมให้งาน Develop ไม่ขึ้นตัวอย่าง', false, 'ควรถูกปฏิเสธ')
  } catch (e) { ok('ตาราง jobs ไม่ยอมให้งาน Develop ไม่ขึ้นตัวอย่าง', /jobs_develop_needs_sample/.test(e.message), e.message.split('\n')[0]) }

  const dv = await call(U.admin, receive('SC-DV-1', { develop: true, spec: { h: { doc_no: 'SC-DV-1', sample: 'ขึ้นตัวอย่าง (งาน Develop · จบที่ตัวอย่าง ไม่ผลิตจริง)' }, p: { tshirt: {} }, product: 'tshirt' } }))
  const j1 = await job(dv)
  ok('แอดมินรับงาน Develop: ขึ้นตัวอย่างที่สถานีแรก', j1.develop === true && j1.needs_sample === true && j1.phase === 'sample' && j1.station_seq === 1, `${j1.phase} ${j1.station_seq}`)
  ok('job_live มีคอลัมน์ develop', (await db.query(`select develop from public.job_live where id = '${dv}'`)).rows[0]?.develop === true)
  ok('events รับงานจดว่าเป็นงาน Develop', (await db.query(`select payload->>'develop' d from public.events where job_id = '${dv}' and type = 'received'`)).rows[0]?.d === 'true')

  await toReview(dv)
  await reject('ตัวอย่างไม่ผ่านต้องระบุสิ่งที่ต้องแก้ (งาน Develop)', U.admin, result(dv, false), /ต้องระบุสิ่งที่ต้องแก้/)
  await call(U.admin, result(dv, false, 'สีเข้มไป'))
  const j2 = await job(dv)
  ok('งาน Develop ตัวอย่างไม่ผ่าน → ขึ้นตัวอย่างรอบ 2 (ยังไม่จบ)', j2.phase === 'sample' && j2.sample_round === 2 && j2.finished_at === null, `${j2.phase} ${j2.sample_round}`)

  await toReview(dv)
  await reject('ฝ่ายผลิตบันทึกผลตัวอย่างไม่ได้', U.prod, result(dv, true), /บทบาทของคุณ/)
  await call(U.admin, result(dv, true))
  const j3 = await job(dv)
  ok('งาน Develop ตัวอย่างผ่าน → งานเสร็จ ไม่เข้าผลิตจริง', j3.phase === 'done' && j3.finished_at !== null && j3.station_seq === null && j3.station_status === null, `${j3.phase} ${j3.station_seq}`)
  const ev = (await db.query(`select type, payload from public.events where job_id = '${dv}' and type in ('sample_result','done','released') order by id`)).rows
  ok('events: ผลตัวอย่างผ่าน + เสร็จ (งาน Develop) ไม่มีปล่อยเข้าผลิต', ev.at(-2)?.type === 'sample_result' && ev.at(-1)?.type === 'done' && ev.at(-1)?.payload.develop === true, JSON.stringify(ev.map(e => e.type)))
  await reject('งาน Develop ที่เสร็จแล้วบันทึกผลตัวอย่างซ้ำไม่ได้', U.admin, result(dv, true), /รอผลตัวอย่าง/)
  await call(U.admin, `public.mark_delivered('${dv}', 'ส่งตัวอย่างให้ลูกค้า')`)
  ok('งาน Develop ที่เสร็จแล้วบันทึกจัดส่งได้', (await job(dv)).delivered_at !== null)

  const normal = await call(U.admin, receive('SC-DV-2'))
  await toReview(normal)
  await call(U.admin, result(normal, true))
  const n1 = await job(normal)
  ok('ขึ้นตัวอย่างปกติผ่าน → ยังเข้าผลิตจริงเหมือนเดิม', n1.develop === false && n1.phase === 'production' && n1.station_seq === 1, `${n1.phase} ${n1.station_seq}`)

  const spec = (no, sample) => ({ app: 'phappim-confirm', v: 1, product: 'tshirt', h: { doc_no: no, customer: 'ลูกค้า Develop', rev: 1, sample }, p: { tshirt: {} } })
  const revise = (id, s) => `public.revise_job_spec('${id}', '${q(JSON.stringify(s))}'::jsonb, 1, 'ลูกค้า Develop', 'ลายใหม่', 3, 0, '2026-12-20', true, '{}'::text[])`
  const dv2 = await call(U.admin, receive('SC-DV-3', { develop: true }))
  await reject('ใบแก้เปลี่ยนงาน Develop เป็นผลิตจริงไม่ได้', U.admin, revise(dv2, spec('SC-DV-3', 'ขึ้นตัวอย่าง (ลูกค้าจ่ายค่าตัวอย่าง)')), /งาน Develop \(จบที่ตัวอย่าง\)/)
  await reject('ใบแก้เปลี่ยนงานผลิตจริงเป็น Develop ไม่ได้', U.admin, revise(normal, spec('SC-DV-2', 'ขึ้นตัวอย่าง (งาน Develop · จบที่ตัวอย่าง ไม่ผลิตจริง)')), /รับเข้าแบบผลิตจริง/)
  ok('ใบแก้งาน Develop ที่ยังเลือก Develop บันทึกได้', (await call(U.admin, revise(dv2, spec('SC-DV-3', 'ขึ้นตัวอย่าง (งาน Develop · จบที่ตัวอย่าง ไม่ผลิตจริง)')))).changed === true)

  const noted = (no, sample, note) => ({ ...spec(no, sample), p: { tshirt: { note } } })
  await db.exec(`update public.jobs set phase = 'production', station_seq = 1, station_status = 'queued' where id = '${dv2}'`)
  const dvPart = await call(U.admin, `public.split_job('${dv2}', 1)`)
  ok('ส่วนที่แบ่งจากงาน Develop ยังเป็นงาน Develop', (await job(dvPart)).develop === true)
  await reject('ใบแก้จากส่วนที่แบ่งของงาน Develop เปลี่ยนเป็นผลิตจริงไม่ได้', U.admin, revise(dvPart, noted('SC-DV-3', 'ขึ้นตัวอย่าง (ลูกค้าจ่ายค่าตัวอย่าง)', 'ก')), /งาน Develop \(จบที่ตัวอย่าง\)/)
  const rd = await call(U.admin, revise(dvPart, noted('SC-DV-3', 'ขึ้นตัวอย่าง (งาน Develop · จบที่ตัวอย่าง ไม่ผลิตจริง)', 'ก')))
  const dvFamily = (await db.query(`select spec, develop from public.jobs where confirmation_no like 'SC-DV-3%' order by confirmation_no`)).rows
  ok('ใบแก้งาน Develop ที่แบ่งแล้ว (เปิดจากส่วนที่แบ่ง) บันทึกได้ทุกส่วน', rd.changed === true && rd.parts?.length === 2
    && dvFamily.every(x => x.develop === true && x.spec.p.tshirt.note === 'ก'), JSON.stringify(rd))

  const normalPart = await call(U.admin, `public.split_job('${normal}', 1)`)
  await reject('ใบแก้จากส่วนที่แบ่งของงานผลิตจริง เปลี่ยนเป็น Develop ไม่ได้', U.admin, revise(normalPart, noted('SC-DV-2', 'ขึ้นตัวอย่าง (งาน Develop · จบที่ตัวอย่าง ไม่ผลิตจริง)', 'ข')), /รับเข้าแบบผลิตจริง/)
  const rn = await call(U.admin, revise(normalPart, noted('SC-DV-2', 'ขึ้นตัวอย่าง (ลูกค้าจ่ายค่าตัวอย่าง)', 'ข')))
  ok('ใบแก้งานผลิตจริงที่แบ่งแล้ว ยังบันทึกได้เหมือนเดิม', rn.changed === true && rn.parts?.length === 2, JSON.stringify(rn))
}
