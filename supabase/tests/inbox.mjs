
export async function inboxTests({ db, ok, as }) {
  const U = {
    owner: '00000000-0000-0000-0000-000000000001',
    nobody: '00000000-0000-0000-0000-000000000003',
    prod: '00000000-0000-0000-0000-000000000101',
    qc: '00000000-0000-0000-0000-000000000102',
    admin: '00000000-0000-0000-0000-000000000103',
    mgr: '00000000-0000-0000-0000-000000000104',
  }

  await db.exec(`
    insert into auth.users (id, email) values
      ('${U.prod}', 'inb-prod@test'),
      ('${U.qc}', 'inb-qc@test'),
      ('${U.admin}', 'inb-admin@test'),
      ('${U.mgr}', 'inb-mgr@test')
    on conflict (id) do nothing;
    insert into public.profiles (user_id, name, role, active) values
      ('${U.prod}', 'ผลิตกล่อง', 'production', true),
      ('${U.qc}', 'QCกล่อง', 'qc', true),
      ('${U.admin}', 'แอดมินกล่อง', 'admin', true),
      ('${U.mgr}', 'ผู้บริหารกล่อง', 'manager', true)
    on conflict (user_id) do nothing;
  `)

  // ล้างข้อความเก่าจากชุดทดสอบก่อนหน้าเพื่อให้เริ่มนับจาก 0 ชัดเจน
  await db.exec(`delete from public.inbox_messages; delete from public.inbox_errors;`)

  const expectErr = async (name, fn, re) => {
    try { await fn(); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') }
    catch (e) { ok(name, re ? re.test(e.message) : true, e.message.split('\n')[0]) }
  }

  const jHold = (await as(U.admin, () => db.query(`
    select public.receive_job('SC-INB-HOLD', 'ลูกค้ากล่อง', 'งานพัก', 'tshirt', 100, 'ตัว', '2026-12-31', 'plain', 'inb-hold.pdf') as id
  `))).rows[0].id
  await db.exec(`update public.job_materials set checked_at = now() where job_id = '${jHold}'`)
  await db.exec(`update public.jobs set phase = 'production', station_seq = 1, station_status = 'queued' where id = '${jHold}'`)
  const issueId = (await as(U.prod, () => db.query(`select public.open_issue('${jHold}', 'ด้ายหมด') as id`))).rows[0].id

  const holdCount1 = (await db.query(`select count(*)::int n from public.inbox_messages where kind = 'hold' and job_id = '${jHold}'`)).rows[0].n
  ok('inbox: พักงาน 1 ครั้ง -> 1 ข้อความ hold', holdCount1 === 1)

  // จำลอง event hold ซ้ำด้วย issue_id เดิม -> dedupe_key เดิม ต้องยังเป็น 1
  await db.exec(`
    insert into public.events (job_id, type, phase, station_code, payload)
    values ('${jHold}', 'hold', 'production', 'cut', jsonb_build_object('issue_id', ${issueId}, 'reason', 'ด้ายหมด'))
  `)
  const holdCount2 = (await db.query(`select count(*)::int n from public.inbox_messages where kind = 'hold' and job_id = '${jHold}'`)).rows[0].n
  ok('inbox: trigger ซ้ำด้วย issue เดิม -> ยัง 1 (ไม่ซ้ำ)', holdCount2 === 1)

  // sample_result pass=true ไม่สร้างข้อความ, pass=false สร้าง sample_failed
  await db.exec(`
    insert into public.events (job_id, type, phase, payload) values
      ('${jHold}', 'sample_result', 'sample_review', '{"round":1,"pass":true}'::jsonb),
      ('${jHold}', 'sample_result', 'sample_review', '{"round":2,"pass":false,"note":"สีอ่อนไป"}'::jsonb),
      ('${jHold}', 'rework', 'production', '{"qty":5,"reason":"ตะเข็บหลุด","from":"qc_pack"}'::jsonb),
      ('${jHold}', 'sewing_issue_reported', 'production', '{"reason":"เข็มหักบ่อย"}'::jsonb)
  `)
  ok('inbox: sample_result pass=false สร้าง 1 ข้อความ (pass=true ไม่สร้าง)',
    (await db.query(`select count(*)::int n from public.inbox_messages where kind = 'sample_failed' and job_id = '${jHold}'`)).rows[0].n === 1)
  ok('inbox: rework สร้างข้อความ',
    (await db.query(`select count(*)::int n from public.inbox_messages where kind = 'rework' and job_id = '${jHold}'`)).rows[0].n === 1)
  ok('inbox: sewing_issue สร้างข้อความ',
    (await db.query(`select count(*)::int n from public.inbox_messages where kind = 'sewing_issue' and job_id = '${jHold}'`)).rows[0].n === 1)

  await db.exec(`
    insert into public.sewing_machines (code, type_code, sort) values ('SN-099', 'single', 999)
    on conflict (code) do nothing
  `)
  await as(U.prod, () => db.query(`
    select public.set_machine_status('SN-099', 'broken', 'มอเตอร์ไหม้', now() + interval '2 days')
  `))
  const mb1 = (await db.query(`select count(*)::int n from public.inbox_messages where kind = 'machine_broken'`)).rows[0].n
  ok('inbox: แจ้งจักรเสีย -> 1 ข้อความ machine_broken', mb1 === 1)

  await as(U.prod, () => db.query(`
    select public.set_repair_eta('SN-099', now() + interval '4 days', 'รออะไหล่')
  `))
  const mb2 = (await db.query(`select count(*)::int n from public.inbox_messages where kind = 'machine_broken'`)).rows[0].n
  ok('inbox: เลื่อนเวลาซ่อม (set_repair_eta) ไม่สร้างข้อความซ้ำ', mb2 === 1)

  await as(U.owner, () => db.exec(`update public.inbox_settings set enabled = false where kind = 'delay_report'`))
  await db.exec(`
    insert into public.events (job_id, type, phase, station_code, payload)
    values ('${jHold}', 'delay_report', 'production', 'cut', '{"report_id":99999,"new_eta":"2026-12-30T10:00:00Z"}'::jsonb)
  `)
  ok('inbox: ปิด kind ใน inbox_settings -> ไม่สร้างข้อความ',
    (await db.query(`select count(*)::int n from public.inbox_messages where kind = 'delay_report'`)).rows[0].n === 0)
  await as(U.owner, () => db.exec(`update public.inbox_settings set enabled = true where kind = 'delay_report'`))

  const jOk = (await as(U.admin, () => db.query(`
    select public.receive_job('SC-INB-OK', 'ลูกค้าปกติ', 'งานปกติ', 'tshirt', 10, 'ตัว', ((now() at time zone 'Asia/Bangkok')::date + 20), 'plain', 'inb-ok.pdf') as id
  `))).rows[0].id
  // สร้างงานเข้าเงื่อนไข due_soon (วันนี้), film_late (dtf เลยกำหนด), materials_late (> 2 วันทำงาน)
  const jScan = (await as(U.admin, () => db.query(`
    select public.receive_job('SC-INB-SCAN', 'ลูกค้าสแกน', 'งานเร่ง', 'tshirt', 50, 'ตัว', ((now() at time zone 'Asia/Bangkok')::date + 1), 'dtf', 'inb-scan.pdf') as id
  `))).rows[0].id
  await db.exec(`
    update public.jobs
    set dtf_film_eta = ((now() at time zone 'Asia/Bangkok')::date - 1),
        stage_entered_at = now() - interval '5 days'
    where id = '${jScan}'
  `)

  const scan1 = (await as(U.admin, () => db.query(`select public.inbox_scan() as n`))).rows[0].n
  ok('inbox: inbox_scan() สร้างข้อความสำหรับงานเข้าเงื่อนไข', scan1 >= 2, `added=${scan1}`)
  ok('inbox: งานที่ไม่เข้าเงื่อนไข -> ไม่มีข้อความ',
    (await db.query(`select count(*)::int n from public.inbox_messages where job_id = '${jOk}'`)).rows[0].n === 0)

  const scan2 = (await as(U.prod, () => db.query(`select public.inbox_scan() as n`))).rows[0].n
  ok('inbox: inbox_scan() ครั้งที่ 2 ติดกัน -> ไม่ซ้ำ (0 แถวใหม่)', scan2 === 0, `added=${scan2}`)

  const qcKinds = (await as(U.qc, () => db.query(`select distinct kind from public.inbox_messages`))).rows.map(r => r.kind)
  ok('inbox RLS: QC เห็นข้อความ rework', qcKinds.includes('rework'))
  ok('inbox RLS: QC ไม่เห็นข้อความ machine_broken', !qcKinds.includes('machine_broken'))

  const mgrKinds = (await as(U.mgr, () => db.query(`select distinct kind from public.inbox_messages`))).rows.map(r => r.kind)
  ok('inbox RLS: ผู้บริหารเห็นข้อความ hold', mgrKinds.includes('hold'))

  const totalMsgs = (await db.query(`select count(*)::int n from public.inbox_messages`)).rows[0].n
  const ownerMsgs = (await as(U.owner, () => db.query(`select count(*)::int n from public.inbox_messages`))).rows[0].n
  ok('inbox RLS: owner เห็นทุกข้อความ', ownerMsgs === totalMsgs && totalMsgs > 0)

  ok('inbox RLS: ผู้ใช้ไม่มีบทบาทเห็น 0 ข้อความ',
    (await as(U.nobody, () => db.query(`select count(*)::int n from public.inbox_messages`))).rows[0].n === 0)
  await expectErr('inbox RPC: ผู้ใช้ไม่มีบทบาทเรียก inbox_scan ไม่ได้',
    () => as(U.nobody, () => db.query(`select public.inbox_scan()`)), /ไม่มีสิทธิ์/)
  await expectErr('inbox RPC: ผู้ใช้ไม่มีบทบาทเรียก inbox_unread_count ไม่ได้',
    () => as(U.nobody, () => db.query(`select public.inbox_unread_count()`)), /ไม่มีสิทธิ์/)

  await db.exec('set role anon')
  try {
    await db.query('select public.inbox_unread_count()')
    ok('inbox RPC: คนไม่ล็อกอิน (anon) เรียกฟังก์ชันไม่ได้', false)
  } catch (e) {
    ok('inbox RPC: คนไม่ล็อกอิน (anon) เรียกฟังก์ชันไม่ได้', /permission denied/.test(e.message), e.message.split('\n')[0])
  } finally {
    await db.exec('reset role')
  }

  const reworkMsgId = (await db.query(`select id from public.inbox_messages where kind = 'rework' limit 1`)).rows[0].id
  const machineMsgId = (await db.query(`select id from public.inbox_messages where kind = 'machine_broken' limit 1`)).rows[0].id

  const prodUnreadBefore = (await as(U.prod, () => db.query(`select public.inbox_unread_count() as n`))).rows[0].n
  await as(U.qc, () => db.query(`select public.inbox_mark_read(array[${reworkMsgId}::bigint])`))
  await as(U.qc, () => db.query(`select public.inbox_mark_read(array[${reworkMsgId}::bigint])`))

  const prodUnreadAfter = (await as(U.prod, () => db.query(`select public.inbox_unread_count() as n`))).rows[0].n
  ok('inbox: inbox_mark_read ของ QC ไม่ทำให้ production เห็นว่าอ่านแล้ว', prodUnreadBefore === prodUnreadAfter)

  // QC พยายาม mark ข้อความ machine_broken ที่ตัวเองมองไม่เห็น -> ต้องไม่ถูกบันทึกใน inbox_reads
  await as(U.qc, () => db.query(`select public.inbox_mark_read(array[${machineMsgId}::bigint])`))
  const qcMarkedMachine = (await db.query(`select count(*)::int n from public.inbox_reads where message_id = ${machineMsgId} and user_id = '${U.qc}'`)).rows[0].n
  ok('inbox: ทำเครื่องหมายข้อความที่ตัวเองมองไม่เห็นไม่ได้', qcMarkedMachine === 0)

  await as(U.qc, () => db.query(`select public.inbox_mark_all_read()`))
  ok('inbox: inbox_mark_all_read ทำให้ unread_count ของ QC เป็น 0',
    (await as(U.qc, () => db.query(`select public.inbox_unread_count() as n`))).rows[0].n === 0)

  const beforeCount = (await db.query(`select count(*)::int n from public.inbox_messages`)).rows[0].n
  for (const [label, uid] of [['production', U.prod], ['owner', U.owner]]) {
    await expectErr(`inbox: ${label} insert inbox_messages ตรงไม่ได้`,
      () => as(uid, () => db.exec(`insert into public.inbox_messages (kind, dedupe_key, title, body, audience) values ('hold', 'x', 'x', 'x', array['owner'])`)),
      /row-level security/)
    const upd = await as(uid, () => db.query(`update public.inbox_messages set title = 'hack'`))
    ok(`inbox: ${label} update inbox_messages ตรงไม่ได้`, upd.affectedRows === 0)
    const del = await as(uid, () => db.query(`delete from public.inbox_messages`))
    ok(`inbox: ${label} delete inbox_messages ตรงไม่ได้`, del.affectedRows === 0)
    await expectErr(`inbox: ${label} insert inbox_reads ตรงไม่ได้`,
      () => as(uid, () => db.exec(`insert into public.inbox_reads (message_id, user_id) values (${reworkMsgId}, '${uid}')`)),
      /row-level security/)
  }
  ok('inbox: ข้อมูล inbox_messages ยังอยู่ครบหลังพยายามแก้/ลบ',
    (await db.query(`select count(*)::int n from public.inbox_messages`)).rows[0].n === beforeCount)

  await db.exec(`insert into public.inbox_errors (source, message) values ('test', 'err')`)
  ok('inbox RLS: owner อ่าน inbox_errors ได้',
    (await as(U.owner, () => db.query(`select count(*)::int n from public.inbox_errors`))).rows[0].n === 1)
  ok('inbox RLS: production อ่าน inbox_errors ไม่ได้',
    (await as(U.prod, () => db.query(`select count(*)::int n from public.inbox_errors`))).rows[0].n === 0)
}
