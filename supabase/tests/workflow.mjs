// ทดสอบ workflow (A1) · เดินงานจริง 3 เส้นทาง และพยายามข้ามกฎทั้ง 12 ข้อ (docs/แผน-1-สัปดาห์.md หัวข้อ 3)
// เรียกจาก run.mjs หลังโหลด migrations แล้ว

import { requiredSteps } from './steps.mjs'

export async function workflowTests({ db, ok, as }) {
  const U = {
    owner: '00000000-0000-0000-0000-000000000001', sup: '00000000-0000-0000-0000-000000000002',
    nobody: '00000000-0000-0000-0000-000000000003',
    admin: '00000000-0000-0000-0000-000000000011', qc: '00000000-0000-0000-0000-000000000012',
    prod: '00000000-0000-0000-0000-000000000013', mgr: '00000000-0000-0000-0000-000000000014',
  }
  await db.exec(`
    insert into auth.users values ('${U.admin}','admin@test'),('${U.qc}','qc@test'),('${U.prod}','prod@test'),('${U.mgr}','mgr@test');
    insert into public.profiles (user_id,name,role,active) values
      ('${U.admin}','แอดมิน','admin',true),('${U.qc}','QC','qc',true),('${U.prod}','ฝ่ายผลิต','production',true),('${U.mgr}','ผู้บริหาร','manager',true);
  `)

  // เรียก SQL ในนามผู้ใช้ · คืน rows
  const q = (uid, sql) => as(uid, async () => (await db.query(sql)).rows)
  const call = async (uid, sql) => { await q(uid, `select ${sql}`) }
  // ต้องผ่าน
  const pass = async (name, uid, sql) => {
    try { await call(uid, sql); ok(name, true) } catch (e) { ok(name, false, e.message.split('\n')[0]) }
  }
  // ต้องถูกปฏิเสธ (และข้อความตรง)
  const reject = async (name, uid, sql, re) => {
    try { await call(uid, sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') }
    catch (e) { ok(name, re ? re.test(e.message) : true, e.message.split('\n')[0]) }
  }
  const job = async id => (await db.query(`select * from public.job_live where id = '${id}'`)).rows[0]
  const sqlStr = s => `'${String(s).replace(/'/g, "''")}'`
  const receive = (no, route, extra = {}) => `public.receive_job(${sqlStr(no)}, 'ลูกค้าทดสอบ', 'งานทดสอบ', 'tshirt', ${extra.qty ?? 10}, 'ตัว', '2026-12-31', ${sqlStr(route)}, ${extra.pdf === undefined ? `'confirmations/${no}.pdf'` : extra.pdf})`
  const newJob = async (no, route, extra) => (await q(U.admin, `select ${receive(no, route, extra)} as id`))[0].id
  const materials = async (id) => (await db.query(`select id, dept, key from public.job_materials where job_id = '${id}' order by id`)).rows
  const checkAll = async (id) => {
    for (const m of await materials(id)) {
      if (m.key === 'dtf_film') continue
      const uid = { admin: U.admin, qc: U.qc, production: U.prod }[m.dept]
      await call(uid, `public.check_material(${m.id})`)
    }
  }
  // ทำสถานีปัจจุบันให้เสร็จ: เริ่ม → ติ๊กขั้นที่ให้ → เสร็จ
  const station = async (id, steps = [], uid = U.sup) => {
    await call(uid, `public.start_station('${id}')`)
    for (const [k, v] of steps) await call(uid, `public.complete_substep('${id}', ${sqlStr(k)}${v === undefined ? '' : `, '${JSON.stringify(v)}'::jsonb`})`)
    await call(uid, `public.finish_station('${id}')`)
  }
  // ขั้นบังคับอ่านจากขั้นย่อยจริงในตาราง (ตัวอย่าง = เฉพาะ req · QC ไม่บังคับ · ผลิตจริง = req + num + appr)
  const SAMPLE = s => requiredSteps(db, s, 'sample')
  const PROD = (s, opts) => requiredSteps(db, s, 'production', opts)
  const tick = async (id, steps, uid = U.sup) => { for (const [k, v] of steps) await call(uid, `public.complete_substep('${id}', ${sqlStr(k)}${v === undefined ? '' : `, '${JSON.stringify(v)}'::jsonb`})`) }
  const route = async code => (await db.query(`select station_code from public.route_stations where route_code = '${code}' order by seq`)).rows.map(r => r.station_code)
  const walkSample = async (id, code) => { for (const s of await route(code)) await station(id, await SAMPLE(s)) }

  // ---------- เวลาทำงาน (ไม่นับวันอาทิตย์) ----------
  const wd = async (a, b) => Number((await db.query(`select private.work_days('${a}'::timestamptz, '${b}'::timestamptz) d`)).rows[0].d)
  ok('เวลาทำงาน เสาร์ 10:00 → จันทร์ 10:00 = 1 วัน (ข้ามอาทิตย์)', Math.abs(await wd('2026-11-21 10:00+07', '2026-11-23 10:00+07') - 1) < 1e-9)
  ok('เวลาทำงาน ศุกร์ 12:00 → เสาร์ 12:00 = 1 วัน', Math.abs(await wd('2026-11-20 12:00+07', '2026-11-21 12:00+07') - 1) < 1e-9)
  ok('เวลาทำงาน ทั้งวันอาทิตย์ = 0', await wd('2026-11-22 00:00+07', '2026-11-23 00:00+07') === 0)
  ok('เวลาทำงาน ช่วงย้อนกลับ = 0', await wd('2026-11-23 00:00+07', '2026-11-22 00:00+07') === 0)

  // ---------- กฎข้อ 12: สิทธิ์ ----------
  await db.exec('set role anon')
  try { await db.query(`select ${receive('SC-ANON', 'normal')}`); ok('กฎ 12: คนไม่ล็อกอินเรียกรับงานไม่ได้', false) }
  catch (e) { ok('กฎ 12: คนไม่ล็อกอินเรียกรับงานไม่ได้', /permission denied/.test(e.message), e.message.split('\n')[0]) }
  finally { await db.exec('reset role') }
  await reject('กฎ 12: ผู้ใช้ไม่มีบทบาทรับงานไม่ได้', U.nobody, receive('SC-NOROLE', 'normal'), /เข้าสู่ระบบ/)
  await reject('กฎ 12: ผู้ควบคุมงานรับงานไม่ได้ (แอดมินเป็นคนส่งงานเข้า)', U.sup, receive('SC-PROD', 'normal'), /แอดมินเป็นคนส่งงานเข้าโรงงาน/)
  await reject('กฎ 12: QC รับงานไม่ได้', U.qc, receive('SC-QCR', 'normal'), /ทำขั้นนี้ไม่ได้/)
  await reject('กฎ 12: ผู้บริหาร (อ่านอย่างเดียว) รับงานไม่ได้', U.mgr, receive('SC-MGR', 'normal'), /ทำขั้นนี้ไม่ได้/)
  await reject('กฎ 12: เรียกฟังก์ชันช่วยใน private ตรงไม่ได้', U.sup, `private.require_role('owner')`, /permission denied/)
  try { await q(U.sup, `insert into public.events (job_id, type) select id, 'x' from public.jobs limit 1`); ok('กฎ 12: ผู้ควบคุมงานเขียน events ตรงไม่ได้', false) }
  catch (e) { ok('กฎ 12: ผู้ควบคุมงานเขียน events ตรงไม่ได้', /row-level security/.test(e.message), e.message.split('\n')[0]) }

  // ---------- กฎข้อ 1: รับงาน ----------
  await reject('กฎ 1: รับงานโดยไม่แนบ PDF ไม่ได้', U.admin, receive('SC-NOPDF2', 'normal', { pdf: "''" }), /ต้องแนบ PDF/)
  await reject('กฎ 1: ไฟล์ที่ไม่ใช่ PDF ไม่ได้', U.admin, receive('SC-JPG', 'normal', { pdf: "'x.jpg'" }), /ต้องแนบ PDF/)
  await reject('รับงาน: จำนวน 0 ไม่ได้', U.admin, receive('SC-Q0B', 'normal', { qty: 0 }), /มากกว่า 0/)
  const A = await newJob('SC-A', 'normal')
  ok('รับงานสำเร็จ → อยู่ขั้นรอวัตถุดิบ', (await job(A)).phase === 'materials')
  ok('สร้างรายการวัตถุดิบจากแม่แบบ (ปกติ 5 รายการ ไม่มีฟิล์ม)', (await materials(A)).length === 5)
  await reject('รับงาน: เลขที่ใบซ้ำไม่ได้', U.admin, receive('SC-A', 'normal'), /รับเข้าระบบไปแล้ว/)

  // ---------- กฎข้อ 2: วัตถุดิบ ----------
  await reject('กฎ 2: วัตถุดิบยังไม่ครบ เริ่มสถานีไม่ได้', U.sup, `public.start_station('${A}')`, /สถานะงานเปลี่ยนไปแล้ว/)
  const mA = await materials(A)
  const adminItem = mA.find(m => m.dept === 'admin')
  await reject('วัตถุดิบ: ฝ่าย QC ติ๊กรายการของแอดมินไม่ได้', U.qc, `public.check_material(${adminItem.id})`, /ฝ่ายอื่นติ๊กไม่ได้/)
  await reject('วัตถุดิบ: ผู้ควบคุมงานติ๊กแทนฝ่ายไม่ได้', U.sup, `public.check_material(${adminItem.id})`, /ทำขั้นนี้ไม่ได้/)
  await pass('วัตถุดิบ: แอดมินติ๊กรายการของตัวเองได้', U.admin, `public.check_material(${adminItem.id})`)
  await pass('วัตถุดิบ: ยกเลิกติ๊กได้ระหว่างรอวัตถุดิบ', U.admin, `public.check_material(${adminItem.id}, false)`)
  ok('ยกเลิกแล้วยังรอวัตถุดิบ', (await job(A)).materials_pending === 5)
  await checkAll(A)
  let a = await job(A)
  ok('กฎ 2: ครบทุกฝ่าย → ไปขึ้นตัวอย่างที่สถานีแรก (พิมพ์) รอคิว', a.phase === 'sample' && a.current_station === 'print' && a.station_status === 'queued', `${a.phase}/${a.current_station}/${a.station_status}`)
  await reject('วัตถุดิบ: ปล่อยงานแล้วแก้ติ๊กไม่ได้', U.admin, `public.check_material(${adminItem.id}, false)`, /ปล่อยงานไปแล้ว/)

  // ---------- กฎข้อ 4, 5, 11: สถานี ----------
  await reject('ติ๊กขั้นย่อยก่อนกดเริ่มไม่ได้', U.sup, `public.complete_substep('${A}', 'check_print')`, /กด "เริ่ม"/)
  await reject('ฝ่าย QC เริ่มสถานีพิมพ์ไม่ได้', U.qc, `public.start_station('${A}')`, /เฉพาะสถานี QC/)
  await pass('เริ่มสถานีพิมพ์', U.sup, `public.start_station('${A}')`)
  await reject('กฎ 11: กดเริ่มซ้ำ (อีกคนกดไปแล้ว) → แจ้งให้โหลดใหม่', U.sup, `public.start_station('${A}')`, /สถานะงานเปลี่ยนไปแล้ว/)
  await tick(A, await requiredSteps(db, 'print', 'sample', { except: ['check_print'] }))
  await reject('กฎ 5: ยังไม่ติ๊ก "ตรวจงานพิมพ์" กดเสร็จไม่ได้', U.sup, `public.finish_station('${A}')`, /ตรวจงานพิมพ์/)
  await reject('ขั้นย่อยที่ไม่มีในสถานีนี้ติ๊กไม่ได้', U.sup, `public.complete_substep('${A}', 'check_color')`, /ไม่พบขั้นย่อย/)
  await call(U.sup, `public.complete_substep('${A}', 'check_print')`)
  await pass('ติ๊กครบแล้วกดเสร็จได้', U.sup, `public.finish_station('${A}')`)
  a = await job(A)
  ok('กฎ 4: เสร็จแล้วไปสถานีถัดไป (รีด) อัตโนมัติ', a.current_station === 'press' && a.station_status === 'queued')
  await reject('กฎ 11: กดเสร็จซ้ำ → แจ้งให้โหลดใหม่', U.sup, `public.finish_station('${A}')`, /สถานะงานเปลี่ยนไปแล้ว/)
  await station(A, await SAMPLE('press'))
  await station(A, await SAMPLE('cut'))
  await call(U.sup, `public.start_station('${A}')`)
  await reject('ขึ้นตัวอย่างไม่มีด่านตัวแรก', U.sup, `public.complete_substep('${A}', 'first_piece')`, /ไม่มีด่านตัวแรก/)
  await pass('เย็บตัวอย่างกดเสร็จครั้งเดียวไป QC', U.sup, `public.finish_sewing('${A}')`)
  await station(A, await SAMPLE('qc_pack'), U.qc)
  a = await job(A)
  ok('ตัวอย่างเดินครบทุกสถานี → รอผลตัวอย่าง', a.phase === 'sample_review' && a.current_station === null)

  // ---------- กฎข้อ 3: ตัวอย่าง ----------
  await reject('กฎ 3: รอผลตัวอย่างอยู่ เริ่มผลิตไม่ได้', U.sup, `public.start_station('${A}')`, /สถานะงานเปลี่ยนไปแล้ว/)
  await reject('ผลตัวอย่าง: ผู้ควบคุมงานบันทึกไม่ได้ (แอดมินเท่านั้น)', U.sup, `public.record_sample_result('${A}', true)`, /ทำขั้นนี้ไม่ได้/)
  await reject('ผลตัวอย่าง: ไม่ผ่านต้องระบุสิ่งที่ต้องแก้', U.admin, `public.record_sample_result('${A}', false)`, /ต้องระบุสิ่งที่ต้องแก้/)
  await pass('ผลตัวอย่าง: ไม่ผ่าน (สีเพี้ยน)', U.admin, `public.record_sample_result('${A}', false, 'สีเพี้ยน')`)
  a = await job(A)
  ok('กฎ 3: ไม่ผ่าน → ขึ้นตัวอย่างรอบ 2 เริ่มที่สถานีแรก', a.phase === 'sample' && a.sample_round === 2 && a.current_station === 'print')
  await walkSample(A, 'normal')
  await pass('ผลตัวอย่าง: รอบ 2 ผ่าน', U.admin, `public.record_sample_result('${A}', true, null, '2026-11-18')`)
  a = await job(A)
  ok('ผ่าน → ผลิตจริงที่สถานีแรก', a.phase === 'production' && a.current_station === 'print' && a.sample_round === 2)
  ok('ประวัติผลตัวอย่างครบ 2 รอบ', (await db.query(`select count(*)::int n from public.sample_results where job_id = '${A}'`)).rows[0].n === 2)

  // ---------- ผลิตจริง + กฎข้อ 10 (ช่วงพิมพ์+รีด+ตัด) ----------
  await station(A, await PROD('print'))
  await station(A, await PROD('press'))
  await call(U.sup, `public.start_station('${A}')`)
  await reject('กฎ 5: ตัดงานผลิตจริงต้องกรอกจำนวนชิ้น', U.sup, `public.finish_station('${A}')`, /นับชิ้น/)
  await reject('ขั้น [กรอกค่า] ต้องเป็นตัวเลข', U.sup, `public.complete_substep('${A}', 'sort_count', '"สิบ"'::jsonb)`, /ต้องกรอกตัวเลข/)
  await tick(A, await PROD('cut'))
  ok('จำนวนชิ้นตัดบันทึกลงงาน', (await job(A)).cut_count === 10)
  // จำลองว่าเริ่มพิมพ์มา 5 วันแล้ว (ช่วงพิมพ์+รีด+ตัดเกิน 3 วัน) แต่สถานีตัดยังไม่เกิน
  await db.exec(`insert into public.events (job_id, type, phase, station_code, at) values ('${A}', 'station_start', 'production', 'print', now() - interval '5 days')`)
  a = await job(A)
  ok('สถานะเวลา: ช่วงพิมพ์+รีด+ตัดเกินมาตรฐาน', a.sla.segment_over === true && a.sla.segment_code === 'subli_ppc', JSON.stringify(a.sla))
  await reject('กฎ 10: ช่วงเกินเวลา ยังไม่รายงาน กดเสร็จไม่ได้', U.sup, `public.finish_station('${A}')`, /พิมพ์ \+ รีด \+ ตัด เกินเวลามาตรฐาน/)
  await reject('รายงานปัญหา: รหัสสาเหตุผิดไม่ได้', U.sup, `public.submit_delay_report('${A}', array['ZZ'], 'x', now() + interval '1 day')`, /รหัสสาเหตุไม่ถูกต้อง/)
  await reject('รายงานปัญหา: ไม่อธิบายไม่ได้', U.sup, `public.submit_delay_report('${A}', array['M1'], '  ', now() + interval '1 day')`, /ต้องอธิบาย/)
  await reject('รายงานปัญหา: วันเสร็จใหม่ต้องอยู่ในอนาคต', U.sup, `public.submit_delay_report('${A}', array['M1'], 'เครื่องเสีย', now() - interval '1 hour')`, /คาดว่าจะเสร็จใหม่/)
  await pass('รายงานปัญหาครบ', U.sup, `public.submit_delay_report('${A}', array['M1','P1'], 'เครื่องพิมพ์เสีย 2 วัน', now() + interval '1 day', 'ช่างซ่อม')`)
  await pass('กฎ 10: รายงานแล้วกดเสร็จได้', U.sup, `public.finish_station('${A}')`)

  // ---------- เย็บ + กฎข้อ 7 ----------
  await call(U.sup, `public.start_station('${A}')`)
  await reject('กฎ 7: ตัวแรกยังไม่ผ่าน กรอกยอดเย็บไม่ได้', U.sup, `public.update_sew_count('${A}', 5)`, /ตัวแรกยังไม่ผ่าน/)
  await reject('ยอดเย็บใช้ปุ่มเฉพาะ ไม่ใช่ติ๊กขั้นย่อย', U.sup, `public.complete_substep('${A}', 'sew_count', '5'::jsonb)`, /กรอกยอดเย็บ/)
  await reject('ฝ่าย QC อนุมัติตัวแรกไม่ได้', U.qc, `public.complete_substep('${A}', 'first_piece')`, /เฉพาะสถานี QC/)
  await call(U.sup, `public.complete_substep('${A}', 'first_piece')`)
  await pass('ตัวแรกผ่านแล้วกรอกยอดเย็บได้', U.sup, `public.update_sew_count('${A}', 5)`)
  await reject('ยอดเย็บเกินจำนวนสั่ง+เผื่อเสียไม่ได้', U.sup, `public.update_sew_count('${A}', 99)`, /ระหว่าง 0 ถึง 10/)
  await pass('เย็บเสร็จครั้งเดียวแม้ยอดระหว่างเย็บเป็นข้อมูลเดิม', U.sup, `public.finish_sewing('${A}')`)

  // ---------- QC + กฎข้อ 8 งานแก้ ----------
  await call(U.qc, `public.start_station('${A}')`)
  await reject('QC: จำนวนผ่านต้องมากกว่า 0', U.qc, `public.record_qc('${A}', 0)`, /มากกว่า 0/)
  await call(U.qc, `public.record_qc('${A}', 7)`)
  await reject('กฎ 8: ส่งแก้ไม่ระบุสาเหตุไม่ได้', U.qc, `public.send_rework('${A}', 3, ' ', 'sew')`, /สาเหตุ/)
  await reject('กฎ 8: ส่งแก้ไม่ระบุจำนวนไม่ได้', U.qc, `public.send_rework('${A}', 0, 'ตะเข็บหลุด', 'sew')`, /จำนวน/)
  await reject('กฎ 8: สถานีต้นเหตุต้องอยู่ก่อน QC', U.qc, `public.send_rework('${A}', 3, 'ตะเข็บหลุด', 'qc_pack')`, /สถานีต้นเหตุ/)
  await reject('กฎ 8: สถานีต้นเหตุต้องอยู่ในเส้นทางงาน', U.qc, `public.send_rework('${A}', 3, 'ตะเข็บหลุด', 'dtf_press')`, /สถานีต้นเหตุ/)
  await pass('กฎ 8: ส่งแก้ 3 ชิ้น สาเหตุตะเข็บหลุด กลับเย็บ', U.qc, `public.send_rework('${A}', 3, 'ตะเข็บหลุด', 'sew')`)
  a = await job(A)
  ok('งานแก้กลับไปเย็บ พร้อมป้ายงานแก้', a.current_station === 'sew' && a.is_rework && a.rework_qty === 3)
  await call(U.sup, `public.start_station('${A}')`)
  await pass('งานแก้ไม่ต้องติ๊กขั้นย่อยซ้ำ กดเสร็จได้', U.sup, `public.finish_station('${A}')`)
  a = await job(A)
  ok('งานแก้เสร็จ → กลับ QC ทันที', a.current_station === 'qc_pack' && a.is_rework)
  await call(U.qc, `public.start_station('${A}')`)
  await reject('กฎ 5: QC ผ่านยังไม่ครบจำนวน กดเสร็จไม่ได้', U.qc, `public.finish_station('${A}')`, /ตรวจ/)
  await call(U.qc, `public.record_qc('${A}', 3)`)
  await tick(A, await PROD('qc_pack', { except: ['boxed'] }), U.qc)
  await reject('กฎ 5: ยังไม่ติ๊ก "ลงลัง"', U.qc, `public.finish_station('${A}')`, /ลงลัง/)
  await call(U.qc, `public.complete_substep('${A}', 'boxed')`)
  await pass('QC ครบ กดเสร็จ', U.qc, `public.finish_station('${A}')`)
  a = await job(A)
  ok('งานเสร็จ: phase done · ล้างป้ายงานแก้ · มีเวลาเสร็จ', a.phase === 'done' && !a.is_rework && a.finished_at !== null && a.qc_passed === 10)
  const types = (await db.query(`select type from public.events where job_id = '${A}'`)).rows.map(r => r.type)
  ok('ทุกการกดถูกบันทึกใน events', ['received', 'material_checked', 'released', 'station_start', 'substep_done', 'station_done',
    'sample_sent', 'sample_result', 'delay_report', 'sew_count', 'qc_result', 'rework', 'done'].every(t => types.includes(t)))
  await reject('งานเสร็จแล้วเริ่มสถานีไม่ได้', U.sup, `public.start_station('${A}')`, /สถานะงานเปลี่ยนไปแล้ว/)

  // ---------- DTF + กฎข้อ 6 + กฎข้อ 10 (สถานี) ----------
  const B = await newJob('SC-B', 'dtf')
  const film = (await materials(B)).find(m => m.key === 'dtf_film')
  ok('งาน DTF มีรายการ "สั่งฟิล์ม DTF"', !!film)
  await reject('ฟิล์ม: ติ๊กเองไม่ได้ (ระบบติ๊กเมื่อบันทึกการสั่ง)', U.admin, `public.check_material(${film.id})`, /ติ๊กให้อัตโนมัติ/)
  await reject('ฟิล์ม: ฝ่ายผลิตบันทึกการสั่งไม่ได้', U.prod, `public.order_film('${B}', '2026-11-20')`, /ทำขั้นนี้ไม่ได้/)
  await reject('ฟิล์ม: บันทึกรับก่อนสั่งไม่ได้', U.admin, `public.receive_film('${B}')`, /ยังไม่ได้บันทึกการสั่งฟิล์ม/)
  await call(U.admin, `public.order_film('${B}', '2026-11-20')`)
  await checkAll(B)
  ok('สั่งฟิล์มแล้ว + วัตถุดิบครบ → ขึ้นตัวอย่าง', (await job(B)).phase === 'sample')
  await station(B, await SAMPLE('cut'))
  await reject('กฎ 6: ยังไม่ได้รับฟิล์ม เริ่มรีด DTF ไม่ได้', U.sup, `public.start_station('${B}')`, /ยังไม่ได้รับฟิล์ม DTF/)
  await call(U.admin, `public.receive_film('${B}')`)
  await pass('กฎ 6: ได้รับฟิล์มแล้วเริ่มรีด DTF ได้', U.sup, `public.start_station('${B}')`)
  await tick(B, await SAMPLE('dtf_press'))
  await call(U.sup, `public.finish_station('${B}')`)
  for (const s of ['sew', 'qc_pack']) await station(B, await SAMPLE(s), s === 'qc_pack' ? U.qc : U.sup)
  await call(U.admin, `public.record_sample_result('${B}', true)`)
  await call(U.sup, `public.start_station('${B}')`)
  await tick(B, await PROD('cut'))
  // ตัดไม่จับเวลารายสถานีตาม SOP จริง (คุมทั้งช่วง) → ตั้งเวลามาตรฐานสั้นๆ เพื่อทดสอบกลไกกฎ 10 ระดับสถานี
  await db.exec(`update public.stations set sla_days = 1 where code = 'cut'`)
  await db.exec(`update public.jobs set station_started_at = now() - interval '5 days' where id = '${B}'`)
  let b = await job(B)
  ok('สถานะเวลา: สถานีตัดเกินมาตรฐาน 1 วัน', b.sla.station_over === true && b.sla.station_sla_days == 1, JSON.stringify(b.sla))
  ok('งาน DTF ไม่อยู่ในช่วงพิมพ์+รีด+ตัด', b.sla.segment_code === undefined)
  await reject('กฎ 10: สถานีเกินเวลา ยังไม่รายงาน กดเสร็จไม่ได้', U.sup, `public.finish_station('${B}')`, /เกินเวลามาตรฐานของสถานีนี้/)
  await call(U.sup, `public.submit_delay_report('${B}', array['W1'], 'ผ้ามาช้า', now() + interval '2 hours')`)
  await pass('กฎ 10: รายงานแล้วกดเสร็จได้', U.sup, `public.finish_station('${B}')`)
  ok('รายงานของสถานีก่อนไม่ติดไปสถานีถัดไป', (await job(B)).sla.station_reported === undefined)

  // ---------- กฎข้อ 9: พักงาน + เวลาพักไม่นับ ----------
  const C = await newJob('SC-C', 'plain')
  await checkAll(C)
  await walkSample(C, 'plain')
  await call(U.admin, `public.record_sample_result('${C}', true)`)
  await reject('กฎ 9: พักงานไม่ระบุสาเหตุไม่ได้', U.sup, `public.open_issue('${C}', '  ')`, /ต้องระบุสาเหตุ/)
  await pass('พักงานตอนรอคิวได้', U.prod, `public.open_issue('${C}', 'รอผ้าเพิ่ม')`)
  ok('สถานะเป็นพักงาน + เห็นสาเหตุ', (await job(C)).station_status === 'hold' && (await job(C)).hold_reason === 'รอผ้าเพิ่ม')
  await reject('พักซ้ำไม่ได้', U.sup, `public.open_issue('${C}', 'x')`, /พักอยู่แล้ว/)
  await reject('พักอยู่ เริ่มสถานีไม่ได้', U.sup, `public.start_station('${C}')`, /พักอยู่/)
  await pass('กด "แก้แล้ว"', U.sup, `public.close_issue('${C}')`)
  ok('แก้แล้วกลับสถานะเดิม (รอคิว)', (await job(C)).station_status === 'queued')
  await call(U.sup, `public.start_station('${C}')`)
  await tick(C, await PROD('cut'))
  // เริ่มตัดมา 2 วัน แต่พักงาน (มีสาเหตุ) เกือบตลอด → เวลาทำงานจริงไม่ถึง 1 วัน ไม่ต้องรายงาน
  await db.exec(`
    update public.jobs set station_started_at = now() - interval '2 days' where id = '${C}';
    insert into public.issues (job_id, station_code, reason, opened_at, closed_at, prev_status)
      values ('${C}', 'cut', 'ไฟดับ', now() - interval '2 days', now() - interval '1 minute', 'doing');`)
  const c = await job(C)
  ok('กฎ 9: เวลาพักไม่นับเป็นเวลาทำงาน', c.sla.station_over === false && Number(c.sla.station_days) < 0.01, JSON.stringify(c.sla))
  await pass('ไม่เกินเวลา กดเสร็จได้โดยไม่ต้องรายงาน', U.sup, `public.finish_station('${C}')`)
  await db.exec(`update public.stations set sla_days = null where code = 'cut'`)

  // ---------- อ่านข้อมูล ----------
  ok('ผู้บริหารอ่านภาพรวมงานได้', (await q(U.mgr, `select id from public.job_live`)).length >= 3)
  ok('ผู้ใช้ไม่มีบทบาทอ่านภาพรวมงานไม่ได้', (await q(U.nobody, `select id from public.job_live`)).length === 0)
  ok('รายงานเวลาต่อสถานีมีข้อมูล', (await q(U.mgr, `select * from public.station_visits where job_id = '${A}' and done_at is not null`)).length > 10)
  await reject('บันทึกแก้ไขต้องมีเหตุผล', U.sup, `public.correct_event('${A}', (select min(id) from public.events where job_id = '${A}'), '')`, /เหตุผล/)
  await pass('หัวหน้าบันทึกแก้ไขย้อนหลังได้', U.sup, `public.correct_event('${A}', (select min(id) from public.events where job_id = '${A}'), 'ใส่เลขที่ใบผิด')`)
}
