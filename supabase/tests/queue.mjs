// คิวงาน (20261120000000): เรียงตามลำดับรับเข้า · แทรกงานด่วนต้องมีเหตุผล · เริ่มข้ามคิวต้องบันทึกเหตุผล
// รันท้ายสุด: ยกเลิกงานของชุดอื่นก่อน เพื่อให้คิวของสถานีมีแค่งานในชุดนี้

export async function queueTests({ db, ok, as }) {
  const U = {
    admin: '00000000-0000-0000-0000-000000000011', qc: '00000000-0000-0000-0000-000000000012',
    prod: '00000000-0000-0000-0000-000000000013', mgr: '00000000-0000-0000-0000-000000000014',
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
  await db.exec(`update public.jobs set phase = 'cancelled', station_status = null where phase not in ('done', 'cancelled')`)

  const receive = no => call(U.admin, `public.receive_job('${no}', 'ลูกค้าคิว', 'งานคิว', 'tshirt', 10, 'ตัว', '2026-12-31', 'plain', null, 0, 0, '{}', false)`)
    .then(r => r.rows[0].r)
  const a = await receive('SC-Q-1')
  const b = await receive('SC-Q-2')
  const c = await receive('SC-Q-3')
  const seq = async () => (await db.query(`select confirmation_no from public.job_live where confirmation_no like 'SC-Q-%' order by queue_seq`)).rows.map(r => r.confirmation_no).join(',')
  ok('งานใหม่ต่อท้ายคิวตามลำดับรับเข้า', await seq() === 'SC-Q-1,SC-Q-2,SC-Q-3', await seq())

  // แทรกงานด่วน
  await reject('แทรกงานไม่มีเหตุผลไม่ได้', U.prod, `public.move_job_ahead('${c}', '${a}', ' ')`, /ใส่เหตุผล/)
  await reject('แอดมินแทรกงานไม่ได้ (หัวหน้าฝ่ายผลิต/ผู้บริหาร/เจ้าของ)', U.admin, `public.move_job_ahead('${c}', '${a}', 'ลูกค้าเร่ง')`, /ทำขั้นนี้ไม่ได้/)
  await reject('QC แทรกงานไม่ได้', U.qc, `public.move_job_ahead('${c}', '${a}', 'ลูกค้าเร่ง')`, /ทำขั้นนี้ไม่ได้/)
  await reject('แทรกก่อนงานตัวเองไม่ได้', U.prod, `public.move_job_ahead('${c}', '${c}', 'ลูกค้าเร่ง')`, /งานอื่น/)
  await reject('งานที่อยู่ก่อนแล้วแทรกไม่ได้', U.prod, `public.move_job_ahead('${a}', '${c}', 'ลูกค้าเร่ง')`, /อยู่ก่อนงาน/)
  await pass('หัวหน้าฝ่ายผลิตแทรกงานด่วนเป็นคิวแรกได้', U.prod, `public.move_job_ahead('${c}', '${a}', 'ลูกค้าเลื่อนวันส่ง')`)
  ok('คิวใหม่: งานด่วนขึ้นก่อน ที่เหลือลำดับเดิม', await seq() === 'SC-Q-3,SC-Q-1,SC-Q-2', await seq())
  await pass('ผู้บริหารแทรกระหว่างสองงานได้', U.mgr, `public.move_job_ahead('${b}', '${a}', 'ลูกค้า VIP')`)
  ok('แทรกระหว่างงานได้ ไม่ต้องเลื่อนเลขงานอื่น', await seq() === 'SC-Q-3,SC-Q-2,SC-Q-1', await seq())
  const ev = (await db.query(`select payload from public.events where job_id = '${c}' and type = 'queue_insert'`)).rows
  ok('แทรกคิวบันทึกประวัติพร้อมเหตุผล', ev.length === 1 && ev[0].payload.reason === 'ลูกค้าเลื่อนวันส่ง' && ev[0].payload.before === 'SC-Q-1')
  try {
    await as(U.prod, () => db.query(`update public.jobs set queue_seq = 0 where id = '${a}'`))
    ok('แก้ลำดับคิวตรงไม่ได้ (ต้องผ่านฟังก์ชัน)', Number((await db.query(`select queue_seq from public.jobs where id = '${a}'`)).rows[0].queue_seq) !== 0)
  } catch (e) { ok('แก้ลำดับคิวตรงไม่ได้ (ต้องผ่านฟังก์ชัน)', /permission denied|row-level/.test(e.message), firstLine(e)) }

  // เริ่มข้ามคิว
  ok('คิวแรกไม่ต้องใส่เหตุผล', await pass('ตรวจคิวแรก', U.prod, `public.note_queue_skip('${c}', null)`) === false)
  await reject('เริ่มงานที่ไม่ใช่คิวแรกต้องใส่เหตุผล', U.prod, `public.note_queue_skip('${a}', '')`, /ไม่ใช่คิวแรก \(คิวก่อนหน้า: SC-Q-3, SC-Q-2\)/)
  ok('ใส่เหตุผลแล้วบันทึกได้', await pass('เริ่มข้ามคิวพร้อมเหตุผล', U.prod, `public.note_queue_skip('${a}', 'ผ้างานก่อนหน้ายังไม่มา')`) === true)
  const sk = (await db.query(`select payload from public.events where job_id = '${a}' and type = 'queue_skip'`)).rows
  ok('ข้ามคิวบันทึกเหตุผลและงานที่ข้าม', sk.length === 1 && sk[0].payload.ahead.join(',') === 'SC-Q-3,SC-Q-2')
  await reject('แอดมินบันทึกข้ามคิวไม่ได้', U.admin, `public.note_queue_skip('${a}', 'x')`, /ทำขั้นนี้ไม่ได้/)
  await pass('เริ่มงานคิวแรก', U.prod, `public.start_station('${c}')`)
  await reject('งานที่เริ่มแล้วไม่ต้องตรวจคิว', U.prod, `public.note_queue_skip('${c}', 'x')`, /สถานะงานเปลี่ยนไปแล้ว/)
  await db.exec(`update public.jobs set phase = 'cancelled', station_status = null where id = '${b}'`)
  await reject('งานยกเลิกแล้วแทรกคิวไม่ได้', U.prod, `public.move_job_ahead('${b}', '${c}', 'x')`, /เสร็จหรือยกเลิกแล้ว/)
}
