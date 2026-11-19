// รันก่อน sewing.mjs: ยังไม่มีจักรในระบบ จึงเริ่มสถานีเย็บได้โดยไม่ต้องจ่ายจักร

import { requiredSteps, substepSql } from './steps.mjs'

export async function productionTests({ db, ok, as }) {
  const U = {
    prod: '00000000-0000-0000-0000-000000000013', admin: '00000000-0000-0000-0000-000000000011',
    qc: '00000000-0000-0000-0000-000000000012', mgr: '00000000-0000-0000-0000-000000000014',
  }
  const call = (uid, sql) => as(uid, () => db.query(`select ${sql}`))
  const pass = async (name, uid, sql) => {
    try { const r = await call(uid, sql); ok(name, true); return r } catch (e) { ok(name, false, e.message.split('\n')[0]) }
  }
  const reject = async (name, uid, sql, re) => {
    try { await call(uid, sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') }
    catch (e) { ok(name, re ? re.test(e.message) : true, e.message.split('\n')[0]) }
  }
  const jobAt = async (no, route, seq) => (await db.query(`
    insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date,
      route_code, confirmation_pdf_path, phase, station_seq, station_status)
    values ('${no}','ลูกค้าทดสอบ','งานฝ่ายผลิต','tshirt',10,'ตัว','2026-12-31','${route}','x.pdf','production',${seq},'queued')
    returning id`)).rows[0].id
  const state = async id => (await db.query(`select station_seq, station_status, phase from public.jobs where id = '${id}'`)).rows[0]

  await reject('ฝ่ายผลิตรับงานไม่ได้ (แอดมินเป็นคนส่งงานเข้า)', U.prod, `public.receive_job('SC-PRD-NO', 'ลูกค้าทดสอบ', 'งานทดสอบ', 'tshirt', 10, 'ตัว', '2026-12-31', 'normal', 'confirmations/SC-PRD-NO.pdf')`, /แอดมินเป็นคนส่งงานเข้าโรงงาน/)
  await pass('แอดมินส่งงานเข้าได้', U.admin, `public.receive_job('SC-PRD-RCV', 'ลูกค้าทดสอบ', 'งานทดสอบ', 'tshirt', 10, 'ตัว', '2026-12-31', 'normal', 'confirmations/SC-PRD-RCV.pdf')`)

  const p = await jobAt('SC-PRD-PRINT', 'normal', 1)
  await reject('แอดมินเริ่มสถานีพิมพ์ไม่ได้', U.admin, `public.start_station('${p}')`, /บทบาท/)
  await reject('ผู้บริหารเริ่มสถานีพิมพ์ไม่ได้', U.mgr, `public.start_station('${p}')`, /บทบาท/)
  await reject('ฝ่าย QC เริ่มสถานีพิมพ์ไม่ได้ (QC กดได้เฉพาะ QC + Packing)', U.qc, `public.start_station('${p}')`)
  await pass('ฝ่ายผลิตเริ่มสถานีพิมพ์ได้', U.prod, `public.start_station('${p}')`)
  await pass('ฝ่ายผลิตติ๊กขั้นย่อยสถานีพิมพ์ได้', U.prod, `public.complete_substep('${p}', 'check_print')`)
  for (const [k, v] of await requiredSteps(db, 'print', 'production', { except: ['check_print'] })) await call(U.prod, substepSql(p, k, v))
  await pass('ฝ่ายผลิตกดเสร็จสถานีพิมพ์ได้', U.prod, `public.finish_station('${p}')`)
  ok('งานไปสถานีถัดไป (รีด) รอคิว', (await state(p)).station_seq === 2 && (await state(p)).station_status === 'queued')

  const s = await jobAt('SC-PRD-SEW', 'normal', 4)
  await pass('ฝ่ายผลิตเริ่มสถานีเย็บได้ (ไม่จำกัดเฟส)', U.prod, `public.start_station('${s}')`)
  await pass('ฝ่ายผลิตอนุมัติตัวแรกได้ (ขั้นย่อยแบบอนุมัติ)', U.prod, `public.complete_substep('${s}', 'first_piece')`)
  await pass('ฝ่ายผลิตรายงานปัญหาระหว่างเย็บได้', U.prod, `public.report_sewing_issue('${s}', 'ด้ายขาดบ่อย')`)
  await reject('แอดมินกดเย็บเสร็จไม่ได้', U.admin, `public.finish_sewing('${s}')`, /บทบาท/)
  await pass('ฝ่ายผลิตยืนยันเย็บเสร็จได้', U.prod, `public.finish_sewing('${s}')`)
  ok('เย็บเสร็จแล้วงานไป QC + Packing', (await state(s)).station_seq === 5)

  await pass('ฝ่ายผลิตเริ่ม QC + Packing ได้', U.prod, `public.start_station('${s}')`)
  await pass('ฝ่ายผลิตบันทึกยอดผ่าน QC ได้', U.prod, `public.record_qc('${s}', 5)`)
  await pass('ฝ่ายผลิตส่งงานกลับแก้ได้ (จำนวน + สาเหตุ + สถานีต้นเหตุ)', U.prod, `public.send_rework('${s}', 2, 'ตะเข็บเบี้ยว', 'sew')`)
  ok('ส่งแก้แล้วงานกลับไปสถานีเย็บ', (await state(s)).station_seq === 4)
  await pass('ฝ่าย QC ยังบันทึก QC ได้เหมือนเดิม', U.qc, `public.start_station('${await jobAt('SC-PRD-QC', 'normal', 5)}')`)

  const ev = (await db.query(`select id from public.events where job_id = '${p}' order by id limit 1`)).rows[0].id
  await reject('แอดมินแก้ไขย้อนหลังไม่ได้', U.admin, `public.correct_event('${p}', ${ev}, 'กดผิด')`, /บทบาท/)
  await pass('ฝ่ายผลิตแก้ไขย้อนหลังได้ (บันทึกเหตุผล)', U.prod, `public.correct_event('${p}', ${ev}, 'กดเริ่มผิดเวลา')`)
  ok('ทุกการกดของฝ่ายผลิตบันทึกชื่อผู้กดใน events',
    (await db.query(`select count(*)::int n from public.events where job_id = '${s}' and by is distinct from '${U.prod}' and type <> 'qc_recorded'`)).rows[0].n === 0)
}
