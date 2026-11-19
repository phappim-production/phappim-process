
export async function outsourcingTests({ db, ok, as }) {
  const U = {
    admin: '00000000-0000-0000-0000-000000000011', qc: '00000000-0000-0000-0000-000000000012',
    prod: '00000000-0000-0000-0000-000000000013', mgr: '00000000-0000-0000-0000-000000000014',
    owner: '00000000-0000-0000-0000-000000000001',
  }
  const firstLine = e => e.message.split(String.fromCharCode(10))[0]
  const call = (uid, sql) => as(uid, () => db.query(`select ${sql} as r`))
  const pass = async (name, uid, sql) => {
    try { const r = await call(uid, sql); ok(name, true); return r.rows[0]?.r } catch (e) { ok(name, false, firstLine(e)) }
  }
  const reject = async (name, uid, sql, re) => {
    try { await call(uid, sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') }
    catch (e) { ok(name, re ? re.test(e.message) : true, firstLine(e)) }
  }
  const job = async id => (await db.query(`select j.*, private.station_at(j.route_code, j.station_seq) as st from public.jobs j where id = $1`, [id])).rows[0]
  const run = async id => (await db.query('select * from public.outsource_runs where id = $1', [id])).rows[0]
  const events = async (id, type) => (await db.query('select payload from public.events where job_id = $1 and type = $2 order by id', [id, type])).rows
  const receive = async (no, route, qty = 500) => (await call(U.admin,
    `public.receive_job('${no}', 'ลูกค้าส่งออก', 'งาน', 'tshirt', ${qty}, 'ตัว', '2026-12-31', '${route}', null, p_needs_sample => false)`)).rows[0].r
  const plan = (arrive = "now() + interval '1 hour'", days = 3, back = "now() + interval '4 days'") => `${arrive}, ${days}, ${back}`

  const A = await pass('แอดมินเพิ่มบริษัทภายนอก (พิมพ์-รีด-ตัด)', U.admin, `public.add_vendor('บ.A พิมพ์ตัด', array['print','press','cut'], '081-000-0000')`)
  const B = await pass('แอดมินเพิ่มบริษัทเย็บ', U.admin, `public.add_vendor('บ.B เย็บ', array['sew'])`)
  await reject('ฝ่ายผลิตเพิ่มบริษัทไม่ได้ (แอดมินบันทึก)', U.prod, `public.add_vendor('บ.X')`, /ทำขั้นนี้ไม่ได้/)
  await reject('ชื่อบริษัทว่างไม่ได้', U.admin, `public.add_vendor('  ')`, /ใส่ชื่อบริษัท/)
  await reject('บริษัทรับ QC ไม่ได้', U.admin, `public.add_vendor('บ.Q', array['qc_pack'])`, /พิมพ์ · รีด · ตัด · เย็บ · ปัก/)
  ok('ทุกคนอ่านรายชื่อบริษัทได้', (await as(U.prod, () => db.query('select count(*)::int n from public.vendors'))).rows[0].n >= 2)

  const j1 = await receive('SC-OUT-1', 'normal')
  ok('งานเริ่มที่สถานีพิมพ์', (await job(j1)).st === 'print')
  await reject('ฝ่ายผลิตส่งออกไม่ได้', U.prod, `public.send_out('${j1}', ${A}, 'cut', ${plan()})`, /ทำขั้นนี้ไม่ได้/)
  await reject('ผู้บริหารส่งออกไม่ได้', U.mgr, `public.send_out('${j1}', ${A}, 'cut', ${plan()})`, /ทำขั้นนี้ไม่ได้/)
  await reject('ไม่กรอกวันของถึงบริษัท ส่งออกไม่ได้', U.admin, `public.send_out('${j1}', ${A}, 'cut', null, 3, now())`, /กรอกให้ครบ/)
  await reject('วันของกลับก่อนวันของถึงบริษัท ไม่ได้', U.admin,
    `public.send_out('${j1}', ${A}, 'cut', ${plan("now() + interval '2 days'", 3, 'now()')})`, /ต้องไม่ก่อน/)
  await reject('ส่ง QC + Packing ออกไม่ได้', U.admin, `public.send_out('${j1}', ${A}, 'qc_pack', ${plan()})`, /ทำที่โรงงานเท่านั้น/)
  await reject('สถานีที่ไม่อยู่ในเส้นทางไม่ได้', U.admin, `public.send_out('${j1}', ${A}, 'emb', ${plan()})`, /ไม่อยู่ในเส้นทาง/)
  const r1 = await pass('แอดมินส่ง พิมพ์-รีด-ตัด ออกไป บ.A', U.admin, `public.send_out('${j1}', ${A}, 'cut', ${plan()}, 'ส่งรถบริษัท')`)
  const s1 = await job(j1)
  const run1 = await run(r1)
  ok('งานอยู่ข้างนอก (out) ที่สถานีพิมพ์', s1.station_status === 'out' && s1.st === 'print')
  ok('รอบส่งออกจดสถานี จำนวน วันใช้ และกำหนดกลับ', run1.stations.join() === 'print,press,cut' && run1.qty === 500 && Number(run1.lead_days) === 3 && !run1.closed_at)
  ok('ประวัติงานมี "ส่งออก" พร้อมชื่อบริษัท', (await events(j1, 'outsource_sent'))[0]?.payload.vendor === 'บ.A พิมพ์ตัด')
  await reject('ฝ่ายผลิตกดเริ่มงานที่อยู่ข้างนอกไม่ได้', U.prod, `public.start_station('${j1}')`, /บริษัทภายนอก/)
  await reject('เริ่มจากหน้าคิวไม่ได้', U.prod, `public.start_in_queue('${j1}', null)`, /สถานะงานเปลี่ยนไปแล้ว/)
  await reject('ส่งออกซ้ำไม่ได้', U.admin, `public.send_out('${j1}', ${A}, 'cut', ${plan()})`, /อยู่ที่บริษัทภายนอกแล้ว/)
  try {
    await db.exec(`update public.jobs set phase = 'cancelled' where id = '${j1}'`)
    ok('ยกเลิก/เปลี่ยนงานที่อยู่ข้างนอกตรงๆ ไม่ได้ (ต้องรับของกลับก่อน)', false)
  } catch (e) { ok('ยกเลิก/เปลี่ยนงานที่อยู่ข้างนอกตรงๆ ไม่ได้ (ต้องรับของกลับก่อน)', /รับของกลับ/.test(e.message), firstLine(e)) }

  await pass('แอดมินเลื่อนกำหนดได้', U.admin, `public.update_out_plan(${r1}, now(), 5, now() + interval '6 days')`)
  ok('กำหนดใหม่บันทึกแล้ว', Number((await run(r1)).lead_days) === 5 && (await events(j1, 'outsource_plan')).length === 1)
  await reject('แก้กำหนดให้กลับก่อนถึงไม่ได้', U.admin, `public.update_out_plan(${r1}, now() + interval '3 days', 1, now())`, /ต้องไม่ก่อน/)

  await reject('ส่งต่อบริษัทเดิมไม่ได้', U.admin, `public.forward_out(${r1}, ${A}, 'sew', ${plan()})`, /บริษัทเดิม/)
  await reject('ส่งต่อรวม QC ไม่ได้', U.admin, `public.forward_out(${r1}, ${B}, 'qc_pack', ${plan()})`, /ทำที่โรงงานเท่านั้น/)
  const r2 = await pass('แอดมินส่งต่อจาก บ.A ไป บ.B เย็บ', U.admin, `public.forward_out(${r1}, ${B}, 'sew', ${plan()})`)
  const s2 = await job(j1)
  ok('งานย้ายไปสถานีเย็บ ยังอยู่ข้างนอก', s2.st === 'sew' && s2.station_status === 'out')
  const closed1 = await run(r1)
  ok('รอบ บ.A ปิดแบบส่งต่อ และชี้ไปรอบ บ.B', closed1.closed_how === 'forwarded' && Number(closed1.next_run_id) === Number(r2))
  await reject('ส่งต่อรอบที่ปิดแล้วไม่ได้', U.admin, `public.forward_out(${r1}, ${B}, 'sew', ${plan()})`, /ปิดไปแล้ว/)

  await reject('ฝ่ายผลิตรับของกลับไม่ได้ (แอดมินบันทึก)', U.prod, `public.receive_back(${r2})`, /ทำขั้นนี้ไม่ได้/)
  await pass('แอดมินรับของกลับเข้าโรงงาน', U.admin, `public.receive_back(${r2}, 'ครบ 500 ตัว')`)
  const s3 = await job(j1)
  ok('งานเข้า QC + Packing รอเริ่ม', s3.st === 'qc_pack' && s3.station_status === 'queued')
  ok('รอบ บ.B ปิดแบบรับกลับ', (await run(r2)).closed_how === 'received')
  await reject('รับของกลับซ้ำไม่ได้', U.admin, `public.receive_back(${r2})`, /ปิดไปแล้ว/)

  await pass('QC เริ่มตรวจ', U.qc, `public.start_station('${j1}')`)
  await pass('QC ส่งกลับแก้ 20 ตัวที่เย็บ', U.qc, `public.send_rework('${j1}', 20, 'ตะเข็บหลุด', 'sew')`)
  const s4 = await job(j1)
  ok('งานแก้กลับมารอที่เย็บ (เลือกได้ว่าแก้เองหรือส่งออก)', s4.st === 'sew' && s4.station_status === 'queued' && s4.is_rework)
  const r3 = await pass('ส่งงานแก้ไป บ.B', U.admin, `public.send_out('${j1}', ${B}, 'sew', ${plan()})`)
  ok('รอบงานแก้จดจำนวนแก้ 20 ตัว', (await run(r3)).qty === 20 && (await run(r3)).is_rework)
  await reject('งานแก้ส่งต่อบริษัทอื่นไม่ได้ (ต้องกลับ QC)', U.admin, `public.forward_out(${r3}, ${A}, 'sew', ${plan()})`, /กลับมา QC/)
  await pass('รับงานแก้กลับ', U.admin, `public.receive_back(${r3})`)
  ok('งานแก้กลับเข้า QC + Packing', (await job(j1)).st === 'qc_pack')

  const j2 = await receive('SC-OUT-2', 'plain')
  const after = await receive('SC-OUT-3', 'plain', 10)
  await reject('ฝ่ายผลิตแบ่งงานไม่ได้', U.prod, `public.split_job('${j2}', 300)`, /ทำขั้นนี้ไม่ได้/)
  await reject('แบ่งเท่าจำนวนทั้งหมดไม่ได้', U.admin, `public.split_job('${j2}', 500)`, /ระหว่าง 1 ถึง 499/)
  await reject('แบ่ง 0 ไม่ได้', U.admin, `public.split_job('${j2}', 0)`, /ระหว่าง 1 ถึง 499/)
  const child = await pass('แอดมินแบ่ง 300 ตัวออกเป็นงานใหม่', U.admin, `public.split_job('${j2}', 300)`)
  const p = await job(j2), c = await job(child), n = await job(after)
  ok('งานเดิมเหลือ 200 · งานใหม่ 300 เลขที่ใบ -2 อยู่สถานีเดียวกัน', p.qty === 200 && c.qty === 300 && c.confirmation_no === 'SC-OUT-2-2' && c.st === p.st && c.station_status === 'queued')
  ok('งานใหม่อยู่คิวถัดจากงานเดิม ก่อนงานที่รับทีหลัง', Number(p.queue_seq) < Number(c.queue_seq) && Number(c.queue_seq) < Number(n.queue_seq))
  ok('ประวัติทั้งสองงานบันทึกการแบ่ง', (await events(j2, 'job_split')).length === 1 && (await events(child, 'job_split_from'))[0]?.payload.parent === 'SC-OUT-2')
  const child3 = await pass('แบ่งซ้ำได้ เลขที่ใบ -3', U.admin, `public.split_job('${j2}', 50)`)
  ok('แบ่งครั้งที่สองได้ -3', (await job(child3)).confirmation_no === 'SC-OUT-2-3' && (await job(j2)).qty === 150)
  await pass('ส่งงานที่แบ่งออกไปเย็บข้างนอก (เริ่มจากตัด)', U.admin, `public.send_out('${child}', ${B}, 'sew', ${plan()})`)
  ok('งานที่แบ่งอยู่ข้างนอก งานเดิมยังรอที่โรงงาน', (await job(child)).station_status === 'out' && (await job(j2)).station_status === 'queued')
  await pass('ฝ่ายผลิตเริ่มตัดงานเดิมได้', U.prod, `public.start_station('${j2}')`)
  await reject('งานที่เริ่มแล้วแบ่งไม่ได้', U.admin, `public.split_job('${j2}', 10)`, /ยังไม่เริ่มสถานีนี้/)
  await reject('งานที่เริ่มแล้วส่งออกไม่ได้', U.admin, `public.send_out('${j2}', ${A}, 'cut', ${plan()})`, /ยังไม่เริ่มสถานีนี้/)
  const seqs = (await db.query('select queue_seq::text q from public.jobs')).rows.map(r => r.q)
  ok('เลขคิวยังไม่ซ้ำหลังแบ่งงาน', new Set(seqs).size === seqs.length)
}
