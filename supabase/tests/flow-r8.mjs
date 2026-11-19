import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const uid = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const actors = { owner: uid(1), supervisor: uid(2), disabled: uid(4), admin: uid(11),
  qc: uid(12), production: uid(13), manager: uid(14), anon: '' }
const reason = 'ตรวจรอบ 8'
const day = '2099-01-06'
const form = (no, path) => JSON.stringify({ app: 'phappim-confirm', v: 1,
  h: { doc_no: no, customer: 'ลูกค้าจำลอง' }, product: 'tshirt', mockup_path: path })
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

export async function flowR8Tests({ db, ok }) {
  const rows = async (sql, args) => (await db.query(sql, args)).rows
  const one = async (sql, args) => (await rows(sql, args))[0]
  async function isolated(name, run) {
    await db.exec('savepoint ' + name)
    try { return await run() }
    finally { await db.exec('rollback to savepoint ' + name + '; release savepoint ' + name) }
  }
  async function as(role, sql, args) {
    await db.exec('savepoint r8_action')
    try {
      await db.exec('set local role ' + (role === 'anon' ? 'anon' : 'authenticated'))
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [actors[role]])
      const result = await db.query(sql, args)
      await db.exec('reset role; release savepoint r8_action')
      return result
    } catch (error) {
      await db.exec('rollback to savepoint r8_action; release savepoint r8_action')
      throw error
    }
  }
  const call = async (role, name, args = [], tail = '') => {
    const params = args.map((_, i) => '$' + (i + 1)).join(', ') + tail
    const result = await as(role, 'select public.' + name + '(' + params + ') as result', args)
    return result.rows[0]?.result
  }
  const receiveArgs = (no, route, sample) => [no, 'ลูกค้าจำลอง', 'งานรอบ 8', 'tshirt', 10, 'ตัว', day, route, null, 0, 0, '{}', sample]
  const receive = (no, route = 'cut_only', sample = false) => call('admin', 'receive_job', receiveArgs(no, route, sample))
  const live = id => one('select * from public.job_live where id = $1', [id])
  const events = id => rows('select type,payload,station_code,"by" from public.events where job_id=$1 order by id', [id])
  const core = row => [row.phase, row.current_station, row.station_status]
  async function check(label, test) {
    try { await isolated('r8_case', test); ok(label, true) }
    catch (error) { ok(label, false, error.message.replace(/\s+/g, ' ')) }
  }
  async function invariant(id) {
    const counts = await one(
      "select (select count(*)::int from public.machine_assignments a join public.sewing_machines m on m.id=a.machine_id join public.machine_types t on t.code=m.type_code where a.job_id=$1 and a.released_at is null and (m.status <> 'ready' or t.shared)) as invalid_machine, " +
      "(select count(*)::int from public.machine_assignments where job_id=$1 and released_at is null) as held, " +
      "(select count(*)::int from public.machine_bookings where job_id=$1 and cancelled_at is null and ends_at>now()) as booked, " +
      "(select count(*)::int from public.outsource_runs where job_id=$1 and closed_at is null) as outside", [id])
    const job = await live(id)
    assert.equal(counts.invalid_machine, 0)
    assert.ok(counts.outside <= 1)
    const approvedSinceRework = await one(
      'select coalesce(sum(passed),0)::int n from public.qc_results where job_id=$1' +
      ' and id>(select max(id) from public.qc_results where job_id=$1 and failed>0)', [id])
    const unresolved = job.is_rework ? Math.max(0, (job.rework_qty ?? 0) - approvedSinceRework.n) : 0
    assert.ok((job.qc_passed ?? 0) + unresolved <= job.qty)
    assert.equal((await one('select count(*)::int n from public.jobs where queue_seq=$1', [job.queue_seq])).n, 1)
    if (['done', 'cancelled'].includes(job.phase)) {
      assert.deepEqual(core(job), [job.phase, null, null])
      assert.deepEqual([counts.held, counts.booked, counts.outside], [0, 0, 0])
    }
  }
  const change = async (id, role, name, args, types, tail) => {
    const before = (await events(id)).length
    const result = await call(role, name, args, tail)
    const delta = (await events(id)).slice(before)
    assert.deepEqual(delta.map(e => e.type), types, name)
    assert.ok(delta.every(e => e.by === actors[role]), name)
    await invariant(id)
    return result
  }
  const jobCall = (id, role, name, args, types) => change(id, role, name, [id, ...args], types)

  const plan = ", now() + interval '1 hour', 2, now() + interval '3 days'"
  await db.exec('begin')
  try {
    // คืน C และ M ให้ตรง fixture ตอนรอบ 5 วัดตารางก่อนเดินงานต่อท้ายชุด
    await db.exec(
      "delete from public.qc_results where id=(select r.id from public.qc_results r join public.jobs j on j.id=r.job_id where j.confirmation_no='TEST-R5-MATRIX-C' order by r.id desc limit 1);" +
      "update public.jobs set station_seq=1,station_status='doing',station_started_at=now()-interval '15 days' where confirmation_no='TEST-R5-MATRIX-M';" +
      "insert into storage.buckets values ('mockups') on conflict do nothing;" +
      "alter table auth.users add column if not exists created_at timestamptz default now()")
    const fixtures = await rows(
      "select j.*, (select id from public.outsource_runs o where o.job_id=j.id and closed_at is null) as run_id," +
      " (select min(e.id) from public.events e where e.job_id=j.id) as first_event from public.job_live j" +
      " where confirmation_no like 'TEST-R5-MATRIX-%' and confirmation_no<>'TEST-R5-MATRIX-P'")
    assert.equal(fixtures.length, 16)
    const a = fixtures.find(j => j.confirmation_no.endsWith('-A')).id
    const b = fixtures.find(j => j.confirmation_no.endsWith('-B')).id
    const vendors = await rows("select id from public.vendors where name like 'บริษัทจำลอง %' order by name")
    const delay = await one('select code from public.reason_codes where active order by code limit 1')
    const machine = await one("select code from public.sewing_machines where type_code='single' and status='ready' order by code limit 1")
    const booking = await one("select (now()+interval '2 hours')::text start, (now()+interval '3 hours')::text finish")
    const notice = await one("select id from public.inbox_messages order by id limit 1")
    const functions = (await rows("select distinct proname from pg_proc where pronamespace='public'::regnamespace" +
      " and prorettype<>'trigger'::regtype and has_function_privilege('authenticated',oid,'execute') order by proname")).map(r => r.proname)
    const matrix = []
    for (const job of fixtures) {
      const { id, run_id: run, current_station: station, confirmation_no: no, first_event: first } = job
      const state = no.endsWith('-P-2') ? 'P' : no.at(-1)
      const photo = no + '/r8.jpg'
      const draftData = form('TEST-R8-DRAFT-' + state, null)
      const draft = await call('admin', 'save_confirmation_draft', [draftData])
      await db.query("insert into storage.objects values ('mockups',$1)", [photo])
      const args = {
        start_station: [id], start_in_queue: [id, reason], note_queue_skip: [id, reason],
        finish_station: [id], open_issue: [id, reason], close_issue: [id],
        submit_delay_report: [id, [delay.code], reason, '2099-01-02T10:00:00Z', null],
        start_sewing: [id], finish_sewing: [id], report_sewing_issue: [id, reason, false], resume_sewing: [id],
        record_qc: [id, 1], send_rework: [id, 2, reason, 'cut'], record_sample_result: [id, true, null, null],
        order_film: [id, day], receive_film: [id], move_job_ahead: [id, state === 'A' ? b : a, reason],
        send_out: [id, vendors[0].id, station ?? 'cut'], forward_out: [run ?? 0, vendors[2].id, state === 'F' ? 'press' : 'sew'],
        receive_back: [run ?? 0, reason], update_out_plan: [run ?? 0], split_job: [id, 2],
        attach_confirmation_pdf: [id, 'TEST-R5/confirmation.pdf'], correct_event: [id, first, reason],
        set_job_machines: [id, 'single', 2], set_job_mockup: [id, photo],
        save_confirmation_draft: [draftData], cancel_confirmation_draft: [draft],
        receive_job: receiveArgs('TEST-R8-NEW-' + state, 'plain', false),
        update_sew_count: [id, 2], complete_substep: [id, 'first_piece'],
        check_material: [(await one('select min(id) id from public.job_materials where job_id=$1', [id])).id ?? 0],
        assign_machines: [id, [machine.code]], release_machines: [id, [machine.code]],
        book_machines: [id, booking.start, booking.finish], cancel_booking: [id],
        set_machine_status: [machine.code, 'broken', reason], set_repair_eta: [machine.code, booking.finish, reason],
        add_vendor: ['บริษัทจำลองรอบ 8', ['cut']], owner_list_users: [], staff_names: [],
        inbox_mark_read: [[notice?.id ?? 0]], inbox_mark_all_read: [], inbox_scan: [],
        inbox_unread_count: [], job_sla_flags: [], my_role: [], is_owner: [],
      }
      assert.deepEqual(functions.filter(name => !Object.hasOwn(args, name)), [])
      for (const name of functions) {
        const tail = ['send_out', 'forward_out', 'update_out_plan'].includes(name) ? plan : ''
        const beforeEvents = (await events(id)).length
        for (const role of Object.keys(actors)) {
          const cell = await isolated('r8_probe', async () => {
            let allowed = false
            try {
              await call(role, name, args[name], tail)
              allowed = true
              await invariant(id)
              const delta = (await events(id)).slice(beforeEvents)
              const primary = delta.filter(e => [
                'station_start', 'station_done', 'hold', 'resume', 'sample_result', 'rework',
                'outsource_sent', 'outsource_forwarded', 'outsource_received', 'material_checked',
              ].includes(e.type))
              if (core(job).join() !== core(await live(id)).join()) assert.equal(primary.length, 1, delta.map(e => e.type).join())
              if (name === 'set_job_mockup') assert.deepEqual(delta.map(e => e.type), ['mockup'])
              return { allowed }
            } catch (error) {
              return { allowed, code: error.code, message: error.message.replace(/\s+/g, ' ') }
            }
          })
          matrix.push({ state, name, role, ...cell })
        }
      }
    }
    console.log('R8_MATRIX ' + JSON.stringify(matrix))
    const authExceptions = ['my_role', 'is_owner', 'inbox_unread_count']
    ok('R8 ตาราง A–P: anon และบัญชีปิดเรียกคำสั่งงานไม่ได้',
      !matrix.some(cell => ['disabled', 'anon'].includes(cell.role) && cell.allowed && !authExceptions.includes(cell.name)))
    const mismatches = matrix.filter(cell => cell.allowed && cell.message)
    ok('R8 ค่าคงที่หลังคำสั่งที่ผ่านในตาราง A–P', mismatches.length === 0, JSON.stringify(mismatches.slice(0, 6)))

    const relations = await rows("select tablename from pg_tables where schemaname='public' order by tablename")
    const rls = []
    for (const { tablename } of relations) {
      const table = 'public."' + tablename.replaceAll('"', '""') + '"'
      const column = (await one("select quote_ident(column_name::text) col from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position limit 1", [tablename])).col
      for (const role of Object.keys(actors)) {
        const summary = { table: tablename, role }
        for (const [action, sql] of Object.entries({
          read: 'select count(*)::int n from ' + table,
          insert: 'insert into ' + table + ' default values',
          update: 'update ' + table + ' set ' + column + '=' + column,
          delete: 'delete from ' + table,
        })) {
          summary[action] = await isolated('r8_policy', async () => {
            try {
              const result = await as(role, sql)
              return action === 'read' ? result.rows[0].n : result.affectedRows
            } catch (error) { return error.code }
          })
        }
        rls.push(summary)
      }
    }
    console.log('R8_RLS ' + JSON.stringify(rls))
    ok('R8 RLS: anon ไม่เห็นแถวในตาราง public', rls.filter(r => r.role === 'anon').every(r => r.read === 0 || r.read === '42501'))
    ok('R8 RLS: ฝ่ายผลิตอ่านใบร่างไม่ได้', rls.find(r => r.role === 'production' && r.table === 'confirmation_drafts')?.read === 0)
    await check('R8 events เป็นแบบเพิ่มอย่างเดียว แม้ตรวจ trigger ในนาม role ภายใน', async () => {
      for (const sql of ['update public.events set type=type', 'delete from public.events']) {
        await isolated('r8_events', () => assert.rejects(() => db.query(sql), /ประวัติ|events/))
      }
    })

    // คืนค่าที่ชุดก่อนหน้าปรับไป และแยกคิวของเส้นทางใหม่ ภายในธุรกรรมที่จะย้อนคืน
    await db.exec(
      "update public.machine_types set shared=code in ('cover','button','buttonhole','ovl4');" +
      "delete from public.product_machine_needs where (product_type_code,type_code) in (('tshirt','flat'),('apron','binding'));" +
      "update public.outsource_runs set closed_at=now() where closed_at is null;" +
      "update public.machine_assignments set released_at=now() where released_at is null;" +
      "update public.machine_bookings set cancelled_at=now() where cancelled_at is null;" +
      "alter table public.jobs disable trigger jobs_guard_outsourced;" +
      "update public.jobs set phase='cancelled',station_status=null,station_seq=null where phase not in ('done','cancelled');" +
      "alter table public.jobs enable trigger jobs_guard_outsourced;")

    const walk = async (id, stations, phase) => {
      for (const station of stations) {
        const job = await live(id)
        assert.deepEqual(core(job), [phase, station, 'queued'])
        const role = station === 'qc_pack' ? 'qc' : 'production'
        await jobCall(id, role, 'start_in_queue', [null], station === 'sew' ? ['machines_assigned', 'station_start'] : ['station_start'])
        assert.deepEqual(core(await live(id)), [phase, station, 'doing'])
        if (station === 'qc_pack' && phase === 'production') {
          await jobCall(id, role, 'record_qc', [job.qty - job.qc_passed], ['qc_result'])
        }
        const extra = station !== 'qc_pack' ? [] : [phase === 'sample' ? 'sample_sent' : 'done']
        await jobCall(id, role, station === 'sew' ? 'finish_sewing' : 'finish_station',
          station === 'sew' ? [] : [station], ['station_done', ...extra])
      }
    }
    const prepareFilm = async (id, stations) => {
      if (!stations.includes('dtf_press')) return
      await jobCall(id, 'admin', 'order_film', [day], ['film_ordered'])
      await jobCall(id, 'admin', 'receive_film', [], ['film_received'])
    }
    const finishSample = async (id, stations, rounds) => {
      for (let round = 1; round <= rounds; round++) {
        await walk(id, stations, 'sample')
        assert.deepEqual(core(await live(id)), ['sample_review', null, null])
        const pass = round === rounds
        await jobCall(id, 'admin', 'record_sample_result', [pass, pass ? null : reason], ['sample_result'])
        assert.equal((await events(id)).at(-1).payload.round, round)
      }
    }
    for (const [route, stations] of Object.entries(routes)) {
      for (const rounds of [0, 1, 2]) {
        await check('R8 เดินงาน ' + route + ' · ตัวอย่าง ' + rounds + ' รอบ', async () => {
          const id = await receive('TEST-R8-' + route + '-' + rounds, route, rounds > 0)
          await prepareFilm(id, stations)
          await finishSample(id, stations, rounds)
          await walk(id, stations, 'production')
          assert.deepEqual(core(await live(id)), ['done', null, null])
        })
      }
      for (const rounds of [0, 1, 2]) {
        await check('R8 แบ่ง/ส่งออก/งานแก้ ' + route + ' · ตัวอย่าง ' + rounds + ' รอบ', async () => {
          const id = await receive('TEST-R8-COMBINED-' + route, route, rounds > 0)
          await prepareFilm(id, stations)
          await finishSample(id, stations, rounds)
          const child = await jobCall(id, 'admin', 'split_job', [4], ['job_split'])
          assert.equal((await live(child)).qty + (await live(id)).qty, 10)
          assert.equal((await events(child)).at(-1).type, 'job_split_from')
          await invariant(child)
          const outAt = Math.max(0, stations.findIndex((station, i) => i > 0 && ['press', 'cut', 'sew', 'emb'].includes(station)))
          const station = stations[outAt]
          await walk(id, stations.slice(0, outAt), 'production')
          const company = await call('admin', 'add_vendor', ['บริษัทจำลองรอบ 8', [station]])
          const run = await change(id, 'admin', 'send_out', [id, company, station], ['outsource_sent'], plan)
          assert.deepEqual(core(await live(id)), ['production', station, 'out'])
          await change(id, 'admin', 'receive_back', [run, reason], ['outsource_received'])
          await walk(id, stations.slice(outAt + 1, -1), 'production')
          await jobCall(id, 'qc', 'start_in_queue', [null], ['station_start'])
          await jobCall(id, 'qc', 'record_qc', [2], ['qc_result'])
          await jobCall(id, 'qc', 'send_rework', [4, reason, stations[0]], ['rework'])
          assert.deepEqual(core(await live(id)), ['production', stations[0], 'queued'])
          assert.equal((await live(id)).rework_qty, 4)
          await jobCall(id, 'production', 'start_in_queue', [null], ['station_start'])
          await jobCall(id, 'production', 'finish_station', [stations[0]], ['station_done'])
          assert.deepEqual(core(await live(id)), ['production', 'qc_pack', 'queued'])
          await walk(id, ['qc_pack'], 'production')
          assert.equal((await live(id)).qc_passed, 6)
          assert.equal((await live(child)).qty, 4)
        })
      }
    }

    await check('R8 QC ผ่านครบหลังงานแก้ · ป้ายยอดส่งแก้หายทันที', async () => {
      const id = await receive('TEST-R8-REWORK-LABEL')
      await walk(id, ['cut'], 'production')
      await jobCall(id, 'qc', 'start_in_queue', [null], ['station_start'])
      await jobCall(id, 'qc', 'record_qc', [6], ['qc_result'])
      await jobCall(id, 'qc', 'send_rework', [4, reason, 'cut'], ['rework'])
      await walk(id, ['cut'], 'production')
      await jobCall(id, 'qc', 'start_in_queue', [null], ['station_start'])
      await jobCall(id, 'qc', 'record_qc', [4], ['qc_result'])
      const job = await live(id)
      assert.equal(job.qc_passed, 10)
      assert.equal(job.is_rework ? job.rework_qty : 0, 0, 'QC ผ่านครบ 10/10 แต่ job_live ยังส่งป้ายงานแก้ 4 ตัวจนกดเสร็จ')
    })

    await check('R8 ส่ง UUID คำขอ QC เดิมซ้ำ · บันทึกครั้งเดียว', async () => {
      const id = await receive('TEST-R8-REQUEST')
      await walk(id, ['cut'], 'production')
      await jobCall(id, 'qc', 'start_in_queue', [null], ['station_start'])
      const request = '80000000-0000-0000-0000-000000000001'
      await jobCall(id, 'qc', 'record_qc', [3, request], ['qc_result'])
      await jobCall(id, 'qc', 'record_qc', [3, request], [])
      assert.equal((await live(id)).qc_passed, 3)
      assert.equal((await one('select count(*)::int n from private.rpc_requests where request_id=$1', [request])).n, 1)
    })

    for (const [label, name, bucket, expected] of [
      ['มีรูป', 'image.jpg', 'mockups', true], ['หาย', 'missing.jpg', null, false],
      ['ผิดชนิด', 'image.pdf', 'mockups', false], ['ผิด bucket', 'image.jpg', 'confirmations', false],
    ]) {
      await check('R8 รับงานจากใบร่าง · ' + label, async () => {
        const no = 'TEST-R8-DRAFT-MEDIA'
        const key = no + '/' + name
        if (bucket) await db.query('insert into storage.objects values ($1,$2)', [bucket, key])
        await call('admin', 'save_confirmation_draft', [form(no, key)])
        const id = await receive(no)
        assert.equal((await live(id)).mockup_path, expected ? key : null)
        assert.equal((await events(id)).find(e => e.type === 'received').payload.mockup, expected)
      })
    }
    await check('R8 จักร: เริ่มผ่านแม้เพิ่มไม่ผ่าน · เพิ่ม ลด เสีย พัก ซ่อม เย็บต่อ', async () => {
      const id = await receive('TEST-R8-MACHINE', 'plain')
      await walk(id, ['cut'], 'production')
      const initial = await jobCall(id, 'production', 'start_sewing', [], ['machines_assigned', 'station_start'])
      await assert.rejects(() => call('production', 'set_job_machines', [id, 'single', 1000]), /ว่างอยู่/)
      assert.deepEqual(core(await live(id)), ['production', 'sew', 'doing'])
      await assert.rejects(() => call('production', 'set_job_machines', [id, 'single', 0]), /อย่างน้อย/)
      await assert.rejects(() => call('production', 'set_job_machines', [id, 'cover', 1]), /ใช้ร่วม/)
      const extra = await jobCall(id, 'production', 'set_job_machines', ['single', 2], ['machines_assigned'])
      assert.deepEqual(await jobCall(id, 'production', 'set_job_machines', ['single', 1], ['machines_released']), extra)
      await jobCall(id, 'production', 'set_job_machines', ['single', 2], ['machines_assigned'])
      await change(id, 'owner', 'set_machine_status', [extra[0], 'broken', reason], ['machines_released'])
      assert.equal((await live(id)).station_status, 'doing')
      const released = (await events(id)).at(-1)
      assert.deepEqual([released.payload.reason, released.payload.note], ['จักรเสีย', reason])
      await change(id, 'owner', 'set_machine_status', [initial[0], 'broken', reason], ['machines_released', 'hold'])
      assert.equal((await live(id)).station_status, 'hold')
      await call('owner', 'set_machine_status', [initial[0], 'ready'])
      await jobCall(id, 'production', 'resume_sewing', [], ['machines_assigned', 'resume'])
      assert.equal((await live(id)).station_status, 'doing')
    })

    await check('R8 จักร: กันการจองของงานอื่นและจ่ายจักรเสริมนอกสูตรได้', async () => {
      const id = await receive('TEST-R8-MACHINE-BOOK', 'plain')
      await walk(id, ['cut'], 'production')
      const initial = await jobCall(id, 'production', 'start_sewing', [], ['machines_assigned', 'station_start'])
      const other = await receive('TEST-R8-OTHER-BOOK', 'plain')
      await db.query(
        "insert into public.machine_bookings(machine_id,job_id,starts_at,ends_at,booked_by)" +
        " select id,$1,now()-interval '15 minutes',now()+interval '30 minutes',$2" +
        " from public.sewing_machines where type_code='single' and status='ready' and code<>all($3)",
        [other, actors.production, initial])
      await assert.rejects(() => call('production', 'set_job_machines', [id, 'single', 2]), /จองไว้/)
      const extra = await one(
        "select m.type_code from public.sewing_machines m join public.machine_types t on t.code=m.type_code" +
        " where not t.shared and m.status='ready' and not exists(select 1 from public.product_machine_needs n" +
        " where n.product_type_code='tshirt' and n.type_code=m.type_code) order by m.code limit 1")
      assert.ok(extra, 'ต้องมีจักรเสริมนอกสูตรในชุดจำลอง')
      await jobCall(id, 'production', 'set_job_machines', [extra.type_code, 1], ['machines_assigned'])
      await jobCall(id, 'production', 'set_job_machines', [extra.type_code, 0], ['machines_released'])
    })

    await check('R8 Storage policies จริงบนตารางจำลอง · อ่าน 16 / อัปโหลด 16', async () => {
      await db.exec(
        "alter table storage.buckets add column name text, add column public boolean, add column file_size_limit int, add column allowed_mime_types text[];" +
        "alter table storage.objects enable row level security;" +
        "grant usage on schema storage to anon, authenticated;" +
        "grant select,insert on storage.objects to anon, authenticated;")
      for (const file of ['20261118000006_confirmation_pdfs.sql', '20261119170000_admin_receives_jobs.sql', '20261120110000_job_mockups.sql']) {
        const migration = await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8')
        const block = migration.match(/^do \$\$[\s\S]+?^end \$\$;/m)
        assert.ok(block, file)
        await db.exec(block[0])
      }
      for (const bucket of ['confirmations', 'mockups']) {
        await db.query('insert into storage.objects values ($1,$2)', [bucket, 'r8-read'])
        for (const role of Object.keys(actors)) {
          const readable = !['anon', 'disabled'].includes(role)
          const found = await as(role, "select name from storage.objects where bucket_id=$1 and name='r8-read'", [bucket])
          assert.equal(found.rows.length, Number(readable), role + ' read ' + bucket)
          const write = () => as(role, 'insert into storage.objects values ($1,$2)', [bucket, 'r8-upload-' + role])
          if (['owner', 'admin'].includes(role)) assert.equal((await write()).affectedRows, 1)
          else await assert.rejects(write, { code: '42501' })
        }
      }
    })

    await check('R8 ปริมาณ 300 งาน / 20,000 เหตุการณ์ · view และ SLA', async () => {
      for (let i = 0; i < 300; i++) await receive('TEST-R8-LOAD-' + i, Object.keys(routes)[i % 8])
      await db.exec(
        "update public.jobs j set station_seq=s.seq,station_status=case when s.station_code='sew' then 'queued' else 'doing' end,station_started_at=now()-interval '4 hours'" +
        " from public.route_stations s where j.confirmation_no like 'TEST-R8-LOAD-%' and j.route_code=s.route_code" +
        " and s.seq=1+(split_part(j.confirmation_no,'-',4)::int % (select max(seq) from public.route_stations where route_code=j.route_code));" +
        "insert into public.events(job_id,type,phase) select j.id,'received','production' from" +
        " (select id from public.jobs where confirmation_no like 'TEST-R8-LOAD-%' order by confirmation_no) j" +
        " cross join generate_series(1,67) i limit 20000")
      for (const [name, sql] of [
        ['job_live', "select * from public.job_live where confirmation_no like 'TEST-R8-LOAD-%'"],
        ['job_sla_flags', 'select * from public.job_sla_flags()'],
      ]) {
        const start = performance.now()
        const result = await as('production', sql)
        console.log('R8_PERF ' + JSON.stringify({ name, ms: Math.round(performance.now() - start), rows: result.rows.length }))
      }
    })
  } finally {
    await db.exec('rollback')
  }
  await cleanupCheck(db, ok)
}

async function cleanupCheck(parent, ok) {
  // สคริปต์จริงเปิด/ปิดธุรกรรมเอง จึงใช้ฐานจำลองที่ clone ในหน่วยความจำ
  const db = await parent.clone()
  try {
    const sql = await readFile(new URL('../scripts/golive-cleanup.sql', import.meta.url), 'utf8')
    const real = 'R8-CLEAN-REAL'
    await db.exec(
      "insert into public.jobs(confirmation_no,customer_name,job_name,qty,unit,due_date,route_code,product_type_code,queue_seq,mockup_path) values " +
      "('R8-CLEAN-REAL','ลูกค้าจำลอง','งานจริงจำลอง',1,'ตัว','2099-01-06','cut_only','tshirt',98888888,'R8-CLEAN-REAL/file.jpg')," +
      "('TEST-R8-CLEAN-2','ลูกค้าจำลอง','งานทดสอบจำลอง',1,'ตัว','2099-01-06','cut_only','tshirt',98888889,'TEST-R8-CLEAN-2/file.jpg');" +
      "insert into storage.objects values ('mockups','R8-CLEAN-REAL/file.jpg'),('mockups','TEST-R8-CLEAN-2/file.jpg');" +
      "insert into public.confirmation_drafts(confirmation_no,data,status) values ('TEST-R8-CLEAN-DRAFT','{}','draft');")
    const row = async () => (await db.query('select * from public.jobs where confirmation_no=$1', [real])).rows[0]
    const before = await row()
    await db.query("insert into public.events(job_id,type) values ($1,'received')", [before.id])
    const history = async () => (await db.query('select * from public.events where job_id=$1 order by id', [before.id])).rows
    const beforeEvents = await history()
    const result = await db.exec(sql)
    const summary = result.flatMap(item => item.rows ?? [])
    const after = await row()
    ok('R8 ล้างงานแล้วงานจริงจำลองเลขคิวเดิม', before.queue_seq === after.queue_seq,
      String(before.queue_seq) + ' → ' + String(after.queue_seq))
    ok('R8 ล้างงาน: เก็บเหตุการณ์จริงและรายงานรูปที่ไม่มีงานทดสอบอ้าง',
      JSON.stringify(await history()) === JSON.stringify(beforeEvents) &&
      JSON.stringify(summary).includes('TEST-R8-CLEAN-2/file.jpg') &&
      !JSON.stringify(summary).includes('R8-CLEAN-REAL/file.jpg'))
    await db.exec(sql)
    ok('R8 ล้างงาน: รันซ้ำและยังมีแถวงานจริงจำลองเดิม', (await row()).id === before.id)
  } finally { await db.close() }
}
