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
  await queueRound4({ db, ok, as, U, call, reject, pass })
}

async function queueRound4({ db, ok, as, U, call, reject, pass }) {
  const receive = async (no, route = 'plain', sample = false) => (await call(U.admin,
    `public.receive_job('${no}', 'ลูกค้าคิว', 'งานคิว', 'tshirt', 10, 'ตัว', '2026-12-31', '${route}', null, p_needs_sample => ${sample})`
  )).rows[0].r
  const row = async id => (await db.query(
    'select trim_scale(queue_seq)::text as queue_seq, current_station, phase, station_status, is_rework, sample_round from public.job_live where id = $1', [id],
  )).rows[0]
  const move = (job, before) => `public.move_job_ahead('${job}', '${before}', 'งานด่วนทดสอบ')`
  const skip = (job, reason = 'null') => `public.note_queue_skip('${job}', ${reason})`
  const retire = () => db.exec("update public.jobs set phase = 'cancelled', station_status = null where phase not in ('done', 'cancelled')")
  const eventCount = async (id, type) => (await db.query(
    'select count(*)::int as n from public.events where job_id = $1 and type = $2', [id, type],
  )).rows[0].n

  await retire()
  const left = await receive('R4-LEFT')
  const right = await receive('R4-RIGHT')
  const inserted = []
  const queueValues = [(await row(left)).queue_seq, (await row(right)).queue_seq]
  for (let i = 1; i <= 60; i++) {
    const id = await receive(`R4-MID-${i}`)
    await call(U.prod, move(id, right))
    inserted.push(id)
    queueValues.push((await row(id)).queue_seq)
  }
  const { rows: dense } = await db.query(
    'select id from public.jobs where id = any($1::uuid[]) order by queue_seq, id',
    [[left, ...inserted, right]],
  )
  const firstDuplicate = values => values.findIndex((value, i) => values.indexOf(value) !== i)
  const unique = new Set(queueValues).size
  ok('แทรก 60 ครั้งในช่วงเดิมได้ลำดับถูกและเลขไม่ซ้ำ (จัดเลขใหม่เมื่อช่องว่างหมด)',
    unique === 62 && dense.every((r, i) => r.id === [left, ...inserted, right][i]),
    `เลขคิวต่างกัน ${unique}/62, แทรกซ้ำครั้งแรกที่ ${unique === 62 ? 'ไม่มี' : firstDuplicate(queueValues) - 1}`)
  const webValues = queueValues.map(Number)
  const webUnique = new Set(webValues).size
  ok('เลขคิว 62 งานยังแยกกันได้เมื่อแปลงเป็น Number ในหน้าเว็บ', webUnique === 62,
    `Number ต่างกัน ${webUnique}/62, แทรกซ้ำครั้งแรกที่ ${webUnique === 62 ? 'ไม่มี' : firstDuplicate(webValues) - 1}`)

  await retire()
  const anchor = await receive('R4-ANCHOR')
  const targets = [await receive('R4-URGENT1'), await receive('R4-URGENT2')]
  // PGlite มีหนึ่ง connection จึงใช้ตัวตนเดียวตลอด batch และวัดผลของการจัดคิวแบบอนุกรม
  await as(U.prod, () => Promise.all(targets.map(id => db.query(`select ${move(id, anchor)}`))))
  const ordered = (await db.query('select id from public.jobs where id = any($1::uuid[]) order by queue_seq', [[anchor, ...targets]])).rows
  ok('แทรกก่อนงานเดียวกันสองคำขอแบบอนุกรม ได้คิวตามลำดับคำขอ',
    ordered.map(r => r.id).join() === [...targets, anchor].join())
  // เลขเสมอทำให้หน้าเว็บกับฐานข้อมูลเห็นคิวแรกต่างกัน → ฐานข้อมูลไม่ยอมให้เลขซ้ำ
  try {
    await db.query("update public.jobs set queue_seq = (select queue_seq from public.jobs where id = $1) where id = $2", [targets[0], targets[1]])
    ok('เลขคิวซ้ำกันไม่ได้ (unique)', false, 'ควรถูกปฏิเสธแต่ผ่าน')
  } catch (e) { ok('เลขคิวซ้ำกันไม่ได้ (unique)', /duplicate|unique/.test(e.message), e.message.split(String.fromCharCode(10))[0]) }
  await reject('งานคิวที่สองต้องใส่เหตุผล', U.prod, skip(targets[1]), /ไม่ใช่คิวแรก.*R4-URGENT1/)
  const seqs = (await db.query('select queue_seq::text as q from public.jobs')).rows.map(r => r.q)
  ok('เลขคิวเป็นจำนวนเต็มทุกงาน', seqs.every(q => /^-?\d+$/.test(q)), seqs.find(q => !/^-?\d+$/.test(q)))

  const roles = [
    ['owner', '00000000-0000-0000-0000-000000000001', true, true],
    ['admin', U.admin, false, false],
    ['production', U.prod, true, true],
    ['qc', U.qc, false, true],
    ['manager', U.mgr, true, false],
    ['supervisor', '00000000-0000-0000-0000-000000000002', true, true],
    ['บัญชีปิดใช้', '00000000-0000-0000-0000-000000000004', false, false],
  ]
  const aclTarget = await receive('R4-ACL-FIRST', 'cut_only')
  await db.query('update public.jobs set station_seq = (select seq from public.route_stations where route_code = $2 and station_code = $3) where id = $1',
    [aclTarget, 'cut_only', 'qc_pack'])
  for (const [role, uid, mayMove, mayNote] of roles) {
    const id = await receive(`R4-ACL-${role}`, 'cut_only')
    await db.query('update public.jobs set station_seq = (select station_seq from public.jobs where id = $2) where id = $1', [id, aclTarget])
    const reason = role === 'บัญชีปิดใช้' ? /บัญชีที่ใช้งานอยู่/ : /ทำขั้นนี้ไม่ได้/
    if (mayNote) {
      const result = await call(uid, skip(id, "'ทดสอบบทบาท'"))
      ok(`${role}: บันทึกเหตุผลข้ามคิว QC ได้`, result.rows[0].r === true && await eventCount(id, 'queue_skip') === 1)
    } else {
      await reject(`${role}: บันทึกเหตุผลข้ามคิวไม่ได้`, uid, skip(id, "'ทดสอบบทบาท'"), reason)
    }
    if (mayMove) {
      await call(uid, move(id, aclTarget))
      ok(`${role}: แทรกคิวผ่าน RPC ได้`, await eventCount(id, 'queue_insert') === 1)
    } else {
      await reject(`${role}: แทรกคิวไม่ได้`, uid, move(id, aclTarget), reason)
    }
    const before = (await row(id)).queue_seq
    try { await as(uid, () => db.query('update public.jobs set queue_seq = -10000 where id = $1', [id])) }
    catch (e) { if (e.code !== '42501') throw e }
    ok(`${role}: แก้เลขคิวตรงไม่ได้`, (await row(id)).queue_seq === before)
  }
  const { rows: grants } = await db.query(`
    select role,
      has_function_privilege(role, 'public.move_job_ahead(uuid,uuid,text)', 'EXECUTE') as can_move,
      has_function_privilege(role, 'public.note_queue_skip(uuid,text)', 'EXECUTE') as can_note,
      has_sequence_privilege(role, 'public.job_queue_seq', 'USAGE, SELECT, UPDATE') as can_sequence
    from (values ('anon'), ('authenticated')) as roles(role)
  `)
  const anonymous = grants.find(r => r.role === 'anon')
  ok('ไม่ได้ล็อกอิน: ไม่มีสิทธิ์เรียก RPC คิวทั้งสอง', !anonymous.can_move && !anonymous.can_note)
  ok('ทุกบทบาทแอปและผู้ไม่ล็อกอินไม่มีสิทธิ์ใช้ sequence ตรง', grants.every(r => !r.can_sequence))
  const beforeAnon = (await row(aclTarget)).queue_seq
  await db.exec("set role anon; select set_config('request.jwt.claim.sub', '', false)")
  try { await db.query('update public.jobs set queue_seq = -10000 where id = $1', [aclTarget]) }
  catch (e) { if (e.code !== '42501') throw e }
  finally { await db.exec('reset role') }
  ok('ไม่ได้ล็อกอิน: แก้เลขคิวตรงไม่ได้', (await row(aclTarget)).queue_seq === beforeAnon)

  await retire()
  const older = await receive('R4-HOLD')
  const repair = await receive('R4-REWORK', 'cut_only')
  const sample = await receive('R4-SAMPLE', 'cut_only', true)
  const other = await receive('R4-PRINT', 'normal')
  const waiting = await receive('R4-PLAIN')
  const repairBefore = await row(repair)
  const sampleBefore = await row(sample)
  const workflow = (id, ...names) => names.reduce(
    (previous, name) => previous.then(() => call(U.prod, `public.${name}('${id}')`)), Promise.resolve(),
  )
  await call(U.prod, `public.open_issue('${older}', 'รอผ้า')`)
  await workflow(repair, 'start_station', 'finish_station', 'start_station')
  await call(U.qc, `public.send_rework('${repair}', 1, 'ตัดคลาด', 'cut')`)
  await workflow(sample, 'start_station', 'finish_station', 'start_station', 'finish_station')
  await call(U.admin, `public.record_sample_result('${sample}', false, 'สีเพี้ยน')`)
  const repairAfter = await row(repair)
  const sampleAfter = await row(sample)
  ok('ส่งกลับแก้กลับเข้าคิวเดิมของสถานีตัด',
    repairAfter.is_rework && repairAfter.station_status === 'queued' && repairAfter.current_station === 'cut' &&
    repairAfter.queue_seq === repairBefore.queue_seq)
  ok('ตัวอย่างไม่ผ่านเริ่มรอบที่สองด้วยคิวเดิม',
    sampleAfter.sample_round === 2 && sampleAfter.phase === 'sample' && sampleAfter.station_status === 'queued' &&
    sampleAfter.queue_seq === sampleBefore.queue_seq)
  ok('งานพักและงานคนละสถานีอยู่ในสถานะที่ใช้ทดสอบ',
    (await row(older)).station_status === 'hold' && (await row(other)).current_station === 'print')
  await reject('ข้ามคิวสถานีตัดนับงานแก้และตัวอย่างต่างเส้นทาง แต่ไม่นับงานพักหรือต่างสถานี',
    U.prod, skip(waiting), /คิวก่อนหน้า: R4-REWORK, R4-SAMPLE\)/)

  // ตั้งตัวอย่างคิวแรกติดลบเพื่อไม่ต้องแทรกผ่านงานเก่าที่ปิดไปแล้วจำนวนมาก
  await db.query('update public.jobs set queue_seq = -2 where id = $1', [repair])
  await call(U.prod, move(sample, repair))
  const newcomer = await receive('R4-NEW')
  const { rows: [fresh] } = await db.query(`
    select (select queue_seq from public.jobs where id = $2) < 0 as negative,
      queue_seq > (select max(queue_seq) from public.jobs where id <> $1) as last
    from public.jobs where id = $1
  `, [newcomer, sample])
  ok('งานรับใหม่ต่อท้ายหลังแทรกคิวติดลบ', fresh.negative && fresh.last)

  await retire()
  const first = await receive('R4-SEW-FIRST')
  const second = await receive('R4-SEW-SECOND')
  await workflow(first, 'start_station', 'finish_station')
  await workflow(second, 'start_station', 'finish_station')
  const { rows: machines } = await db.query("select code from public.sewing_machines where status = 'ready' order by code")
  const owner = roles[0][1]
  for (const { code } of machines) await call(owner, `public.set_machine_status('${code}', 'off')`)
  for (let attempt = 1; attempt <= 2; attempt++) {
    await reject(`เริ่มเย็บก่อนคิวถูกปฏิเสธเมื่อจักรไม่พร้อม (ครั้งที่ ${attempt})`, U.prod,
      `public.start_in_queue('${second}', 'ลูกค้าเร่ง')`, /จักร/)
  }
  await reject('ไม่ใช่คิวแรกและไม่ใส่เหตุผล เริ่มไม่ได้', U.prod, `public.start_in_queue('${second}', null)`, /ไม่ใช่คิวแรกแล้ว.*R4-SEW-FIRST/)
  const skips = await eventCount(second, 'queue_skip')
  const after = await row(second)
  ok('บันทึกและเริ่ม เมื่อเริ่มไม่ผ่าน ไม่มี queue_skip ค้าง',
    after.station_status === 'queued' && skips === 0, `สถานะ ${after.station_status}, queue_skip ${skips}`)

  // เริ่มจากหน้าคิว (start_in_queue) · คิวแรกไม่ต้องมีเหตุผล · ข้ามคิวบันทึกเหตุผลเมื่อเริ่มสำเร็จ
  for (const { code } of machines) await call(owner, `public.set_machine_status('${code}', 'ready')`)
  await retire()
  const q1 = await receive('R4-SQ-1')
  const q2 = await receive('R4-SQ-2')
  const q3 = await receive('R4-SQ-3')
  await pass('คิวแรกเริ่มได้โดยไม่ต้องมีเหตุผล', U.prod, `public.start_in_queue('${q1}', null)`)
  ok('คิวแรกเริ่มแล้วไม่มีบันทึกข้ามคิว', (await row(q1)).station_status === 'doing' && await eventCount(q1, 'queue_skip') === 0)
  await pass('คิวหลังเริ่มได้เมื่อใส่เหตุผล', U.prod, `public.start_in_queue('${q3}', 'ผ้างานคิวก่อนยังไม่มา')`)
  ok('เริ่มก่อนคิวสำเร็จ บันทึกเหตุผล 1 ครั้งและงานที่ข้าม', (await row(q3)).station_status === 'doing' && await eventCount(q3, 'queue_skip') === 1)
  await reject('แอดมินเริ่มงานจากหน้าคิวไม่ได้', U.admin, `public.start_in_queue('${q2}', null)`, /ทำขั้นนี้ไม่ได้/)
  await reject('QC เริ่มสถานีอื่นจากหน้าคิวไม่ได้', U.qc, `public.start_in_queue('${q2}', null)`, /เฉพาะสถานี QC/)
  await reject('QC บันทึกข้ามคิวสถานีอื่นไม่ได้', U.qc, skip(q2, "'x'"), /เฉพาะสถานี QC/)

  const tail = await receive('R4-TAIL')
  const { rows: [lastRow] } = await db.query('select bool_and(queue_seq < (select queue_seq from public.jobs where id = $1)) as ok from public.jobs where id <> $1', [tail])
  ok('หลังจัดเลขคิวใหม่ งานรับใหม่ยังอยู่ท้ายสุด', lastRow.ok)
}
