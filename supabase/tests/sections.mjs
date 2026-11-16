// ทดสอบผู้ควบคุมงาน 2 เฟส (docs/แผน-1-สัปดาห์.md หัวข้อ 1.3)
// เรียกจาก run.mjs หลัง workflow.mjs · ใช้ผู้ใช้จาก run.mjs/workflow.mjs ร่วม (owner, sup ไม่กำหนดเฟส, qc)

export async function sectionTests({ db, ok, as }) {
  const U = {
    owner: '00000000-0000-0000-0000-000000000001', sup: '00000000-0000-0000-0000-000000000002',
    qc: '00000000-0000-0000-0000-000000000012', prod: '00000000-0000-0000-0000-000000000013',
    sup1: '00000000-0000-0000-0000-000000000021', sup2: '00000000-0000-0000-0000-000000000022',
  }
  await db.exec(`
    insert into auth.users values ('${U.sup1}','sup1@test'),('${U.sup2}','sup2@test');
    insert into public.profiles (user_id,name,role,active,section) values
      ('${U.sup1}','ผู้ควบคุมงานเฟส 1','supervisor',true,1),('${U.sup2}','ผู้ควบคุมงานเฟส 2','supervisor',true,2);
  `)
  const call = (uid, sql) => as(uid, () => db.query(`select ${sql}`))
  const pass = async (name, uid, sql) => {
    try { await call(uid, sql); ok(name, true) } catch (e) { ok(name, false, e.message.split('\n')[0]) }
  }
  const reject = async (name, uid, sql, re) => {
    try { await call(uid, sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') }
    catch (e) { ok(name, re ? re.test(e.message) : true, e.message.split('\n')[0]) }
  }
  // วางงานไว้ที่สถานีตามลำดับในเส้นทางโดยตรง · ทดสอบเฉพาะสิทธิ์ ไม่ต้องเดินทุกขั้น
  const jobAt = async (no, route, seq, phase = 'production') => (await db.query(`
    insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date,
      route_code, confirmation_pdf_path, phase, station_seq, station_status)
    values ('${no}','ลูกค้าทดสอบ','งานทดสอบเฟส','tshirt',10,'ตัว','2026-12-31','${route}','x.pdf','${phase}',${seq},'queued')
    returning id`)).rows[0].id

  // ---------- ข้อมูลตั้งค่า ----------
  const sec = async code => (await db.query(`select section from public.stations where code = '${code}'`)).rows[0].section
  ok('เฟส 1: พิมพ์ · รีด · ตัด · รีด DTF', [await sec('print'), await sec('press'), await sec('cut'), await sec('dtf_press')].every(s => s === 1))
  ok('เฟส 2: เย็บ · QC + Packing', await sec('sew') === 2 && await sec('qc_pack') === 2)
  try {
    await db.exec(`update public.profiles set section = 1 where user_id = '${U.qc}'`)
    ok('กำหนดเฟสให้บทบาทที่ไม่ใช่ผู้ควบคุมงานไม่ได้', false, 'ควรถูกปฏิเสธแต่ผ่าน')
  } catch (e) { ok('กำหนดเฟสให้บทบาทที่ไม่ใช่ผู้ควบคุมงานไม่ได้', /profiles_section_supervisor_only/.test(e.message)) }
  await as(U.sup1, () => db.query(`update public.profiles set section = 2 where user_id = '${U.sup1}'`))
  ok('ผู้ควบคุมงานเปลี่ยนเฟสตัวเองไม่ได้', (await db.query(`select section from public.profiles where user_id = '${U.sup1}'`)).rows[0].section === 1)

  // ---------- งานอยู่สถานีเฟส 1 (พิมพ์) ----------
  const p1 = await jobAt('SC-SEC-P1', 'normal', 1)
  await reject('ผู้ควบคุมงานเฟส 2 เริ่มสถานีพิมพ์ไม่ได้', U.sup2, `public.start_station('${p1}')`, /เฟส 1/)
  await reject('ผู้ควบคุมงานเฟส 2 พักงานที่อยู่สถานีพิมพ์ไม่ได้', U.sup2, `public.open_issue('${p1}', 'ทดสอบ')`, /เฟส 1/)
  await pass('ผู้ควบคุมงานเฟส 1 เริ่มสถานีพิมพ์ได้', U.sup1, `public.start_station('${p1}')`)
  await reject('ผู้ควบคุมงานเฟส 2 ติ๊กขั้นย่อยสถานีพิมพ์ไม่ได้', U.sup2, `public.complete_substep('${p1}', 'check_print')`, /เฟส 1/)
  await pass('ผู้ควบคุมงานเฟส 1 ติ๊กขั้นย่อยสถานีพิมพ์ได้', U.sup1, `public.complete_substep('${p1}', 'check_print')`)
  await reject('ผู้ควบคุมงานเฟส 2 กดเสร็จสถานีพิมพ์ไม่ได้', U.sup2, `public.finish_station('${p1}')`, /เฟส 1/)
  await pass('ผู้ควบคุมงานเฟส 1 กดเสร็จสถานีพิมพ์ได้', U.sup1, `public.finish_station('${p1}')`)

  // ---------- รีด DTF อยู่เฟส 1 ----------
  const d1 = await jobAt('SC-SEC-DTF', 'dtf', 2)
  await reject('ผู้ควบคุมงานเฟส 2 พักงานที่สถานีรีด DTF ไม่ได้', U.sup2, `public.open_issue('${d1}', 'ทดสอบ')`, /เฟส 1/)
  await pass('ผู้ควบคุมงานเฟส 1 พักงานที่สถานีรีด DTF ได้', U.sup1, `public.open_issue('${d1}', 'ทดสอบ')`)

  // ---------- งานอยู่สถานีเฟส 2 (เย็บ · QC) ----------
  const s2 = await jobAt('SC-SEC-SEW', 'normal', 4)
  await reject('ผู้ควบคุมงานเฟส 1 เริ่มสถานีเย็บไม่ได้', U.sup1, `public.start_station('${s2}')`, /เฟส 2/)
  await pass('ผู้ควบคุมงานเฟส 2 เริ่มสถานีเย็บได้', U.sup2, `public.start_station('${s2}')`)
  await reject('ผู้ควบคุมงานเฟส 1 กรอกยอดเย็บไม่ได้', U.sup1, `public.update_sew_count('${s2}', 1)`, /เฟส 2/)
  await reject('ผู้ควบคุมงานเฟส 1 รายงานปัญหางานที่อยู่สถานีเย็บไม่ได้', U.sup1,
    `public.submit_delay_report('${s2}', array['M1'], 'ทดสอบ', now() + interval '2 days')`, /เฟส 2/)
  const q2 = await jobAt('SC-SEC-QC', 'normal', 5)
  await reject('ผู้ควบคุมงานเฟส 1 เริ่ม QC ไม่ได้', U.sup1, `public.start_station('${q2}')`, /เฟส 2/)
  await pass('ฝ่าย QC เริ่ม QC + Packing ได้เหมือนเดิม', U.qc, `public.start_station('${q2}')`)
  await reject('ผู้ควบคุมงานเฟส 1 บันทึกผล QC ไม่ได้', U.sup1, `public.record_qc('${q2}', 1)`, /เฟส 2/)
  await pass('ผู้ควบคุมงานเฟส 2 บันทึกผล QC ได้', U.sup2, `public.record_qc('${q2}', 1)`)

  // ---------- ข้อยกเว้น ----------
  const any = await jobAt('SC-SEC-ANY', 'normal', 4)
  await pass('ผู้ควบคุมงานที่ไม่กำหนดเฟส กดได้ทุกเฟส', U.sup, `public.start_station('${any}')`)
  const own = await jobAt('SC-SEC-OWN', 'normal', 1)
  await pass('owner กดได้ทุกเฟส', U.owner, `public.start_station('${own}')`)
  await pass('ฝ่ายผลิตพักงานได้ไม่ขึ้นกับเฟส', U.prod, `public.open_issue('${any}', 'ทดสอบ')`)
  const ev = (await db.query(`select id from public.events where job_id = '${s2}' order by id limit 1`)).rows[0].id
  await pass('ผู้ควบคุมงานเฟส 1 แก้ไขย้อนหลังงานที่อยู่เฟส 2 ได้', U.sup1, `public.correct_event('${s2}', ${ev}, 'แก้เวลากดผิด')`)
  await reject('แก้ไขย้อนหลังงานที่ไม่มีอยู่ ถูกปฏิเสธ', U.sup1,
    `public.correct_event('00000000-0000-0000-0000-0000000000ff', ${ev}, 'x')`, /ไม่พบงาน/)
  await pass('ผู้ควบคุมงานเฟส 2 รับงานใหม่ได้', U.sup2,
    `public.receive_job('SC-SEC-NEW', 'ลูกค้าทดสอบ', 'งานใหม่', 'tshirt', 10, 'ตัว', '2026-12-31', 'normal', 'confirmations/SC-SEC-NEW.pdf')`)
}
