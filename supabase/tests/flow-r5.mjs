import assert from 'node:assert/strict'

const users = {
  owner: '00000000-0000-0000-0000-000000000001',
  admin: '00000000-0000-0000-0000-000000000011',
  production: '00000000-0000-0000-0000-000000000013',
  qc: '00000000-0000-0000-0000-000000000012',
  manager: '00000000-0000-0000-0000-000000000014',
}
const roles = Object.keys(users)
const routes = {
  normal: ['print', 'press', 'cut', 'sew', 'qc_pack'],
  plain: ['cut', 'sew', 'qc_pack'],
  dtf: ['cut', 'dtf_press', 'sew', 'qc_pack'],
  dtg: ['cut', 'dtf_press', 'sew', 'qc_pack'],
  screen: ['cut', 'dtf_press', 'sew', 'qc_pack'],
  emb: ['cut', 'emb', 'sew', 'qc_pack'],
  print_emb: ['print', 'press', 'cut', 'emb', 'sew', 'qc_pack'],
  cut_only: ['cut', 'qc_pack'],
}
const plan = "now() + interval '1 hour', 2, now() + interval '3 days'"
const day = '2026-12-31'
const pdf = 'TEST-R5/confirmation.pdf'
const reason = 'เหตุผลทดสอบรอบ 5'
const eventTypes = {
  start_station: 'station_start', start_in_queue: 'station_start', note_queue_skip: 'queue_skip',
  finish_station: 'station_done', open_issue: 'hold', close_issue: 'resume', submit_delay_report: 'delay_report',
  start_sewing: 'station_start', finish_sewing: 'station_done', report_sewing_issue: 'sewing_issue_reported',
  resume_sewing: 'resume', record_qc: 'qc_result', send_rework: 'rework', record_sample_result: 'sample_result',
  order_film: 'film_ordered', receive_film: 'film_received', move_job_ahead: 'queue_insert',
  send_out: 'outsource_sent', forward_out: 'outsource_forwarded', receive_back: 'outsource_received',
  update_out_plan: 'outsource_plan', split_job: 'job_split', attach_confirmation_pdf: 'confirmation_pdf',
  correct_event: 'correction',
}

// อ้างบทบาทจาก API และระบุสถานะที่ผ่านใน fixture นี้แยกจากผลที่ฐานตอบ
const rules = {
  start_station: ['owner production qc', 'ABP'],
  start_in_queue: ['owner production qc', 'ABHP'],
  note_queue_skip: ['owner production qc', 'ABHJP'],
  finish_station: ['owner production qc', 'K'],
  open_issue: ['owner admin production qc', 'ABCHJKMP'],
  close_issue: ['owner manager production', 'D'],
  submit_delay_report: ['owner admin production qc', 'ABCDFGHIJKLMP'],
  start_sewing: ['owner production', 'H'],
  finish_sewing: ['owner production', 'K'],
  report_sewing_issue: ['owner production', 'K'],
  resume_sewing: ['owner production', 'L'],
  record_qc: ['owner production qc', 'C'],
  send_rework: ['owner production qc', 'C'],
  record_sample_result: ['owner admin', 'E'],
  order_film: ['owner admin', 'J'],
  receive_film: ['owner admin', 'J'],
  move_job_ahead: ['owner production manager', 'BCDEFGHIJKLMP'],
  send_out: ['owner admin', 'ABHP'],
  forward_out: ['owner admin', 'FG'],
  receive_back: ['owner admin', 'FGI'],
  update_out_plan: ['owner admin', 'FGI'],
  split_job: ['owner admin', 'ABJP'],
  attach_confirmation_pdf: ['owner admin', 'ABCDEFGHIJKLMNP'],
  correct_event: ['owner production', 'ABCDEFGHIJKLMNOP'],
}

export async function flowR5Tests({ db, ok, as }) {
  const query = async (sql, args) => (await db.query(sql, args)).rows
  const one = async (sql, args) => (await query(sql, args))[0]
  const exec = async (role, name, sqlArgs, values = []) => {
    const result = await as(users[role], () => db.query('select public.' + name + '(' + sqlArgs + ') as result', values))
    return result.rows[0].result
  }
  const rpc = (role, name, values) => exec(role, name, values.map((_, i) => '$' + (i + 1)).join(', '), values)
  const receive = (label, route, sample = false) => exec('admin', 'receive_job',
    '$1, $2, $3, $4, 10, $5, $6, $7, null, p_needs_sample => $8',
    ['TEST-R5-' + label, 'ลูกค้าจำลอง', 'งานจำลอง', 'tshirt', 'ตัว', day, route, sample])
  const live = id => one('select * from public.job_live where id = $1', [id])
  const events = id => query('select id, type, phase, station_code, payload, by from public.events where job_id = $1 order by id', [id])

  // แยกคิวชุดนี้จากชุดก่อนโดยคืนรอบข้างนอกก่อนเปลี่ยน fixture เป็นงานปิด
  const openRuns = await query('select id from public.outsource_runs where closed_at is null')
  for (const { id } of openRuns) await rpc('admin', 'receive_back', [id])
  await db.exec("update public.jobs set phase = 'cancelled', station_status = null where phase not in ('done', 'cancelled')")

  const start = (id, station) => rpc(station === 'qc_pack' ? 'qc' : 'production', 'start_in_queue', [id, null])
  const finish = (id, station) => rpc(station === 'qc_pack' ? 'qc' : 'production',
    station === 'sew' ? 'finish_sewing' : 'finish_station', [id])

  async function walk(id, route, phase, stations) {
    for (const station of stations) {
      const job = await live(id)
      assert.deepEqual([job.phase, job.current_station, job.station_status], [phase, station, 'queued'])
      const count = (await events(id)).length
      const machines = await start(id, station)
      assert.equal((await live(id)).station_status, 'doing')
      if (station === 'sew') assert.ok(machines.length > 0, 'สถานีเย็บต้องได้รับจักร')
      if (station === 'qc_pack' && phase === 'production') await rpc('qc', 'record_qc', [id, job.qty])
      await finish(id, station)
      const delta = (await events(id)).slice(count)
      const names = [...(station === 'sew' ? ['machines_assigned'] : []), 'station_start',
        ...(station === 'qc_pack' && phase === 'production' ? ['qc_result'] : []), 'station_done']
      if (station === routes[route].at(-1)) names.push(phase === 'sample' ? 'sample_sent' : 'done')
      assert.deepEqual(delta.map(e => e.type), names)
      for (const event of delta) {
        assert.equal(event.station_code, ['done', 'sample_sent'].includes(event.type) ? null : station)
        assert.equal(event.phase, event.type === 'done' ? 'done' : phase)
        assert.ok(event.by)
      }
    }
  }

  for (const [route, stations] of Object.entries(routes)) {
    for (const sample of [false, true]) {
      const label = route + (sample ? '-sample' : '-production')
      const repeats = sample && ['dtf', 'print_emb'].includes(route) ? 2 : Number(sample)
      let idForRecovery
      try {
        const id = idForRecovery = await receive(label, route, sample)
        if (stations.includes('dtf_press')) {
          await rpc('admin', 'order_film', [id, day])
          await rpc('admin', 'receive_film', [id])
          assert.deepEqual((await events(id)).filter(e => e.type.startsWith('film_')).map(e => e.type), ['film_ordered', 'film_received'])
        }
        for (let round = 1; round <= repeats; round++) {
          await walk(id, route, 'sample', stations)
          assert.equal((await live(id)).phase, 'sample_review')
          const passed = round === repeats
          await rpc('admin', 'record_sample_result', [id, passed, passed ? null : 'สีไม่ตรงตัวอย่าง'])
          const result = (await events(id)).at(-1)
          assert.equal(result.type, 'sample_result')
          assert.deepEqual([result.payload.round, result.payload.pass], [round, passed])
        }
        await walk(id, route, 'production', stations)
        const done = await live(id)
        assert.deepEqual([done.phase, done.current_station, done.station_status, done.qc_passed], ['done', null, null, 10])
        assert.ok(done.finished_at)
        const visits = await query(`
          select station_code, phase, visit, started_at, done_at from public.station_visits where job_id = $1 order by visit
        `, [id])
        const expected = [...Array.from({ length: repeats }, () => stations.map(s => ['sample', s])).flat(),
          ...stations.map(s => ['production', s])]
        assert.deepEqual(visits.map(v => [v.phase, v.station_code]), expected)
        assert.ok(visits.every((v, i) => v.visit === i + 1 && v.started_at && v.done_at && v.done_at >= v.started_at))
        ok('R5 เดินงาน ' + label, true, visits.length + ' visits · ตัวอย่าง ' + repeats + ' รอบ')
      } catch (error) {
        ok('BUG: R5 เดินงาน ' + label, false, error.message.split('\n')[0])
        if (typeof idForRecovery === 'string') await db.query(
          "update public.jobs set phase = 'cancelled', station_status = null, station_seq = null where id = $1", [idForRecovery],
        )
      }
    }
  }

  await db.exec(`
    create schema storage;
    create table storage.buckets (id text primary key);
    create table storage.objects (bucket_id text, name text);
    insert into storage.buckets values ('confirmations');
    insert into storage.objects values ('confirmations', 'TEST-R5/confirmation.pdf');
  `)

  const vendor = name => rpc('admin', 'add_vendor', [name, ['print', 'press', 'cut', 'sew', 'emb'], null])
  const va = await vendor('บริษัทจำลอง A')
  const vb = await vendor('บริษัทจำลอง B')
  const vc = await vendor('บริษัทจำลอง C')
  const send = (id, station) => exec('admin', 'send_out', '$1, $2, $3, ' + plan, [id, va, station])
  const forward = (id, company, station) => exec('admin', 'forward_out', '$1, $2, $3, ' + plan, [id, company, station])
  const build = (label, route = 'cut_only', sample = false) => receive('MATRIX-' + label, route, sample)
  // Fixture ใช้การเริ่มแบบตรงเฉพาะตอนจัดสถานะ เพื่อคง A และ B ไว้รอเป็นสองอันดับแรก
  async function through(id, stations, role = 'production') {
    for (const station of stations) {
      await rpc(role, station === 'sew' ? 'start_sewing' : 'start_station', [id])
      await finish(id, station)
    }
  }
  const a = await build('A')
  const b = await build('B')
  const c = await build('C')
  await through(c, ['cut'])
  await rpc('qc', 'start_station', [c])
  await rpc('qc', 'record_qc', [c, 2])
  const d = await build('D')
  await rpc('production', 'start_station', [d])
  await rpc('production', 'open_issue', [d, reason])
  const e = await build('E', 'cut_only', true)
  await through(e, routes.cut_only)
  const f = await build('F', 'normal')
  const rf = await send(f, 'print')
  const g = await build('G', 'normal')
  const rg = await forward(await send(g, 'print'), vb, 'cut')

  async function setupRework(label, route, source) {
    const id = await build(label, route)
    await through(id, routes[route].slice(0, -1))
    await rpc('qc', 'start_station', [id])
    await rpc('qc', 'send_rework', [id, 3, reason, source])
    return id
  }
  const h = await setupRework('H', 'plain', 'sew')
  const i = await setupRework('I', 'plain', 'cut')
  const ri = await send(i, 'cut')
  const j = await build('J', 'dtf')
  await rpc('admin', 'order_film', [j, day])
  await through(j, ['cut'])
  // K, L และการทดลอง H ต้องมีจักรคนละชุดพร้อมกัน แม้ชุดก่อนหน้าจะปรับสูตรหรือปิดจักรไว้
  await db.exec(`
    insert into public.sewing_machines (type_code, code)
    select n.type_code, split_part(existing.code, '-', 1) || '-' || i
    from public.product_machine_needs n
    cross join lateral (
      select code from public.sewing_machines where type_code = n.type_code order by code limit 1
    ) existing
    cross join lateral generate_series(901, 900 + 3 * n.qty) i
    where n.product_type_code = 'tshirt'
  `)
  const k = await build('K', 'plain')
  const l = await build('L', 'plain')
  await through(l, ['cut'])
  const assigned = await rpc('production', 'start_sewing', [l])
  await rpc('owner', 'set_machine_status', [assigned[0], 'broken', reason])
  // ให้มีจักรสำรองสำหรับ resume_sewing และตรวจว่าชุดเริ่มต้นของ K ได้จักรครบ
  await rpc('owner', 'set_machine_status', [assigned[0], 'ready'])
  await through(k, ['cut'])
  await rpc('production', 'start_sewing', [k])
  const m = await build('M')
  await rpc('production', 'start_station', [m])
  await db.exec("update public.stations set sla_days = 1 where code = 'cut'")
  await db.query("update public.jobs set station_started_at = now() - interval '15 days' where id = $1", [m])
  const n = await build('N')
  await through(n, ['cut'])
  await rpc('qc', 'start_station', [n])
  await rpc('qc', 'record_qc', [n, 10])
  await finish(n, 'qc_pack')
  const o = await build('O')
  await db.query("update public.jobs set phase = 'cancelled', station_status = null, station_seq = null where id = $1", [o])
  const parent = await build('P')
  const p = await rpc('admin', 'split_job', [parent, 4])
  const parentRow = await live(parent)
  const childRow = await live(p)
  ok('R5 แบ่งงาน: ผลรวมเท่าเดิม คิวถัดไป และประวัติครบทั้งคู่',
    parentRow.qty + childRow.qty === 10 && childRow.confirmation_no === parentRow.confirmation_no + '-2' &&
    childRow.current_station === parentRow.current_station && (await events(parent)).at(-1).type === 'job_split' &&
    (await events(p)).at(-1).type === 'job_split_from')
  assert.equal((await live(m)).sla?.station_over, true)
  assert.equal((await live(m)).sla?.station_reported, false)
  const { code: delayReason } = await one('select code from public.reason_codes where active order by code limit 1')
  const delayWhen = (await one("select (now() + interval '1 day')::text as eta")).eta

  const states = {
    A: [a, 'production', 'queued', 'cut'], B: [b, 'production', 'queued', 'cut'],
    C: [c, 'production', 'doing', 'qc_pack'], D: [d, 'production', 'hold', 'cut'],
    E: [e, 'sample_review', null, null], F: [f, 'production', 'out', 'print', rf],
    G: [g, 'production', 'out', 'press', rg], H: [h, 'production', 'queued', 'sew'],
    I: [i, 'production', 'out', 'cut', ri], J: [j, 'production', 'queued', 'dtf_press'],
    K: [k, 'production', 'doing', 'sew'], L: [l, 'production', 'hold', 'sew'],
    M: [m, 'production', 'doing', 'cut'], N: [n, 'done', null, null],
    O: [o, 'cancelled', null, null], P: [p, 'production', 'queued', 'cut'],
  }
  const matrix = []
  for (const [state, [id, phase, status, station, run = 0]] of Object.entries(states)) {
    const before = await live(id)
    assert.deepEqual(core(before), [phase, status, station], 'fixture ' + state)
    const history = await events(id)
    const firstEvent = history[0].id
    const lastEvent = Number(history.at(-1).id)
    const calls = {
      start_station: [id], start_in_queue: [id, reason], note_queue_skip: [id, reason],
      finish_station: [id], open_issue: [id, reason], close_issue: [id, reason],
      submit_delay_report: [id, [delayReason], reason, delayWhen, null],
      start_sewing: [id], finish_sewing: [id], report_sewing_issue: [id, reason, false], resume_sewing: [id],
      record_qc: [id, 1], send_rework: [id, 2, reason, 'cut'], record_sample_result: [id, true, null, null],
      order_film: [id, day], receive_film: [id], move_job_ahead: [id, state === 'A' ? b : a, reason],
      send_out: [id, va, station ?? 'cut'], forward_out: [run, vc, state === 'F' ? 'press' : 'sew'],
      receive_back: [run, reason], update_out_plan: [run], split_job: [id, 2],
      attach_confirmation_pdf: [id, pdf], correct_event: [id, firstEvent, reason],
    }
    assert.deepEqual(Object.keys(calls), Object.keys(rules))
    for (const [name, args] of Object.entries(calls)) {
      const [allowedRoles, allowedStates] = rules[name]
      for (const role of roles) {
        const limitedQC = ['start_station', 'start_in_queue', 'note_queue_skip', 'finish_station'].includes(name)
        const expected = allowedRoles.split(' ').includes(role) && allowedStates.includes(state) &&
          !(role === 'qc' && limitedQC && station !== 'qc_pack')
        const cell = await probe(db, as, role, name, args, async result => {
          const after = await live(id)
          const delta = (await events(id)).filter(event => Number(event.id) > lastEvent)
          const types = delta.map(event => event.type)
          assert.ok(delta.every(event => event.by === users[role]), 'ผู้บันทึกเหตุการณ์')
          const next = {
            start_station: [phase, 'doing', station], start_in_queue: [phase, 'doing', station],
            start_sewing: [phase, 'doing', station],
            finish_station: ['production', 'queued', 'qc_pack'], open_issue: [phase, 'hold', station],
            close_issue: [phase, 'doing', station], finish_sewing: ['production', 'queued', 'qc_pack'],
            resume_sewing: [phase, 'doing', station], send_rework: ['production', 'queued', 'cut'],
            record_sample_result: ['production', 'queued', 'cut'], send_out: [phase, 'out', station],
            forward_out: [phase, 'out', state === 'F' ? 'press' : 'sew'],
            receive_back: [phase, 'queued', { F: 'press', G: 'sew', I: 'qc_pack' }[state]],
          }
          const isFirst = ['A', 'H', 'J'].includes(state)
          const expectedEvents = name === 'note_queue_skip' && isFirst ? [] :
            name === 'start_in_queue' || name === 'start_sewing' ? [
              ...(name === 'start_in_queue' && !isFirst ? ['queue_skip'] : []),
              ...(station === 'sew' ? ['machines_assigned'] : []), 'station_start',
            ] : name === 'resume_sewing' ? ['machines_assigned', 'resume'] : [eventTypes[name]]
          assert.equal(types.join(), expectedEvents.join(), 'เหตุการณ์ของคำสั่ง: ' + types.join())
          assert.deepEqual(core(after), next[name] ?? core(before), 'สถานะหลังคำสั่ง')
          if (name === 'split_job') {
            const child = await live(result)
            assert.equal(after.qty + child.qty, before.qty)
            assert.deepEqual(core(child), core(before))
            assert.equal((await events(result)).at(-1).type, 'job_split_from')
          }
          if (name === 'receive_back' && state === 'I') assert.equal(after.is_rework, true)
        }, expected)
        matrix.push({ state, name, role, expected, ...cell })
      }
    }
  }

  for (const [state] of Object.entries(states)) {
    const cells = matrix.filter(cell => cell.state === state)
    const mismatches = cells.filter(cell => !cell.matches)
    console.log('R5 ตารางสถานะ ' + state + ': ตรงข้อกำหนด ' + (cells.length - mismatches.length) + '/' + cells.length)
    if (!mismatches.length) ok('R5 ตารางสถานะ ' + state + ' ตรงข้อกำหนดทุกช่อง', true)
    for (const cell of mismatches) {
      ok('BUG: R5 ' + [cell.state, cell.name, cell.role].join(' / '), false,
        (cell.expected ? 'ควรผ่าน' : 'ควรปฏิเสธ') + ' · ' + (cell.message || 'คำสั่งผ่าน'))
    }
  }
  console.log('R5_MATRIX ' + JSON.stringify(matrix))

  const withoutReason = await probe(db, as, 'production', 'start_in_queue', [b, null], async () => {}, false)
  ok('R5 คิวที่สองไม่มีเหตุผล: เริ่มไม่ได้', withoutReason.matches && /ไม่ใช่คิวแรก/.test(withoutReason.message), withoutReason.message)
  await rpc('production', 'submit_delay_report', [m, [delayReason], reason, delayWhen, null])
  assert.equal((await live(m)).sla?.station_reported, true)
  await finish(m, 'cut')
  ok('R5 เกินเวลา: รายงานแล้วจึงผ่านไป QC', (await live(m)).current_station === 'qc_pack')

  // เริ่มจาก QC ผ่านแล้ว 2 จาก 10 ชิ้น ตรวจขอบเขตยอดสะสมกับยอดส่งแก้จาก fixture เดิม
  // เพดาน = จำนวนงาน − ยอดผ่านสะสม (migration 20261120040000) · เกิน 1 ชิ้นต้องปฏิเสธ · พอดีต้องผ่าน
  for (const [name, args, label, expected, pattern] of [
    ['record_qc', [c, 9], 'ยอด QC สะสม 11 จากงาน 10 ชิ้น ต้องถูกปฏิเสธ', false, /ไม่เกิน 8 ชิ้น/],
    ['send_rework', [c, 11, reason, 'cut'], 'ส่งกลับแก้ 11 จากงาน 10 ชิ้น ต้องถูกปฏิเสธ', false, /ไม่เกิน 8 ชิ้น/],
    ['send_rework', [c, 9, reason, 'cut'], 'ส่งกลับแก้ 9 เมื่อผ่านแล้ว 2/10 ต้องถูกปฏิเสธ', false, /ไม่เกิน 8 ชิ้น/],
    ['record_qc', [c, 8], 'ยอด QC สะสมครบ 10/10 พอดี ผ่าน', true, null],
    ['send_rework', [c, 8, reason, 'cut'], 'ส่งกลับแก้ 8 ชิ้นที่ยังไม่ผ่าน ผ่าน', true, null],
  ]) {
    let accepted
    const trial = await probe(db, as, 'qc', name, args, async () => {
      const job = await live(c)
      accepted = name === 'record_qc' ? 'ยอดผ่านสะสม ' + job.qc_passed :
        'phase ' + job.phase + ', สถานี ' + job.current_station + ', ยอดแก้ ' + job.rework_qty
      if (name === 'record_qc') assert.ok(job.qc_passed <= 10, accepted)
      else assert.ok(job.current_station === 'cut' && job.rework_qty === args[1], accepted)
    }, expected)
    ok('R5 ' + label, trial.matches && (!pattern || pattern.test(trial.message)),
      trial.allowed ? (expected ? accepted : 'ฐานรับยอดเกินจำนวนงาน · ' + accepted) : trial.message)
  }
  // ยอดเต็มแล้ว: บันทึกเพิ่มหรือส่งแก้ต้องบอกให้กดเสร็จ
  await rpc('qc', 'record_qc', [c, 8])
  for (const [name, args] of [['record_qc', [c, 1]], ['send_rework', [c, 1, reason, 'cut']]]) {
    const full = await probe(db, as, 'qc', name, args, async () => {}, false)
    ok('R5 ผ่านครบ 10/10 แล้ว ' + name + ' ต้องบอกให้กดเสร็จ', full.matches && /ผ่านครบ 10\/10/.test(full.message), full.message)
  }
}

function core(row) {
  return [row.phase, row.station_status, row.current_station]
}

async function probe(db, as, role, name, args, inspect, expected) {
  const placeholders = args.map((_, i) => '$' + (i + 1)).join(', ')
  const parameters = ['send_out', 'forward_out', 'update_out_plan'].includes(name)
    ? placeholders + ', ' + plan : placeholders
  let allowed = false
  let message = ''
  let code = ''
  await db.exec('begin')
  try {
    const result = await as(users[role], async () => {
      await db.exec('savepoint r5_rpc')
      try {
        const response = await db.query('select public.' + name + '(' + parameters + ') as result', args)
        allowed = true
        return response.rows[0].result
      } catch (error) {
        await db.exec('rollback to savepoint r5_rpc')
        message = error.message.split('\n')[0]
        code = error.code
      }
    })
    if (allowed) {
      try { await inspect(result) } catch (error) { message = error.message.split('\n')[0] }
    }
    return { allowed, message, code, matches: allowed ? expected && !message : !expected && /[ก-๙]/.test(message) }
  } finally {
    await db.exec('rollback')
  }
}
