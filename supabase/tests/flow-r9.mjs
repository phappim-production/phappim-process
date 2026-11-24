import assert from 'node:assert/strict'
import { queueSkips, startsJob } from './queue-skip.mjs'

const uid = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const actors = { owner: uid(1), supervisor: uid(2), admin: uid(11), qc: uid(12), production: uid(13), manager: uid(14), staff: uid(31) }
const routes = {
  normal: ['print', 'press', 'cut', 'sew', 'qc_pack'],
  dtf: ['cut', 'dtf_press', 'sew', 'qc_pack'],
  dtg: ['cut', 'dtf_press', 'sew', 'qc_pack'],
  screen: ['cut', 'dtf_press', 'sew', 'qc_pack'],
  emb: ['cut', 'emb', 'sew', 'qc_pack'],
  print_emb: ['print', 'press', 'cut', 'emb', 'sew', 'qc_pack'],
  cut_only: ['cut', 'qc_pack'],
  plain: ['cut', 'sew', 'qc_pack'],
}
const capacity = [
  ['print', 2, 'print', 'normal', true],
  ['press', 1, 'heat_press', 'normal', true],
  ['cut', 2, 'cut', 'cut_only', true],
  ['dtf_press', 2, 'dtf_press', 'dtf', false],
  ['qc_pack', 1, 'qc_pack', 'cut_only', false],
]
const due = '2099-01-06'
const note = 'ทดสอบรอบ 9'
const roleFor = station => station === 'qc_pack' ? 'qc' : 'production'
const core = job => [job.phase, job.current_station, job.station_status]

export async function flowR9Tests({ db, ok }) {
  const skips = queueSkips(db, 'flow-r9')
  const rows = async (sql, args) => (await db.query(sql, args)).rows
  const one = async (sql, args) => (await rows(sql, args))[0]
  const live = id => one('select * from public.job_live where id=$1', [id])
  const history = id => rows('select * from public.events where job_id=$1 order by id', [id])
  const held = async id => (await rows('select m.code from public.machine_assignments a join public.sewing_machines m on m.id=a.machine_id where a.job_id=$1 and a.released_at is null order by m.code', [id])).map(row => row.code)
  async function as(role, sql, args) {
    await db.exec('savepoint r9_action')
    try {
      await db.exec('set local role authenticated')
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [actors[role]])
      const result = await db.query(sql, args)
      await db.exec('reset role; release savepoint r9_action')
      return result
    } catch (error) {
      await db.exec('rollback to savepoint r9_action; release savepoint r9_action')
      throw error
    }
  }
  const rpc = async (role, name, args) => {
    const params = args.map((_, i) => '$' + (i + 1)).join(', ')
    return (await as(role, 'select public.' + name + '(' + params + ') as value', args)).rows[0].value
  }
  async function check(label, test) {
    await db.exec('savepoint r9_case')
    try {
      await test()
      ok(label, true)
    } catch (error) {
      ok(label, false, error.message.replace(/\s+/g, ' '))
    } finally {
      await db.exec('rollback to savepoint r9_case; release savepoint r9_case')
    }
  }
  async function invariant() {
    assert.deepEqual(await rows(
      "select s.code, s.machines, count(j.id)::int used from public.stations s left join public.stations peer on coalesce(s.machine_pool,s.code)=coalesce(peer.machine_pool,peer.code)" +
      " left join public.job_live j on j.current_station=peer.code and j.phase in ('sample','production') and j.station_status='doing'" +
      ' where s.machines is not null group by s.code,s.machines having count(j.id)>s.machines'), [])
    assert.deepEqual(await rows(
      'select machine_id from public.machine_assignments where released_at is null group by machine_id having count(*)>1'), [])
  }
  function assertEvents(actual, before, expected, role, name) {
    assert.deepEqual(actual.slice(0, before.length), before, name + ' แก้ประวัติเดิม')
    const delta = actual.slice(before.length)
    assert.deepEqual(delta.map(row => row.type), expected, name)
    assert.ok(delta.every(row => row.by === actors[role]), name + ' ผู้กดไม่ตรง')
    return delta
  }
  const receiveArgs = (no, route, sample) => [no, 'ลูกค้าจำลองรอบ 9', 'งานทดสอบ', 'tshirt', 10, 'ตัว', due, route, null, 0, 0, '{}', sample]
  async function receive(no, route, sample = false) {
    const id = await rpc('admin', 'receive_job', receiveArgs('TEST-R9-' + no, route, sample))
    assertEvents(await history(id), [], ['received', 'released'], 'admin', 'receive_job')
    assert.deepEqual(core(await live(id)), [sample ? 'sample' : 'production', routes[route][0], 'queued'])
    await invariant()
    return id
  }
  async function step(id, role, name, args, expected, prefix = []) {
    if (startsJob(name)) await skips.insert(id, actors[role])
    const before = await history(id)
    const result = await rpc(role, name, [...prefix, ...args])
    const delta = assertEvents(await history(id), before, expected, role, name)
    await invariant()
    return { result, delta }
  }
  const change = (id, role, name, args, expected) => step(id, role, name, args, expected, [id])
  async function deny(id, role, name, args, error, prefix = [id]) {
    const original = await live(id)
    const events = await history(id)
    const machines = await held(id)
    await assert.rejects(() => rpc(role, name, [...prefix, ...args]), error)
    assert.deepEqual(await live(id), original, name + ' เปลี่ยนงานแม้ถูกปฏิเสธ')
    assert.deepEqual(await history(id), events, name + ' เปลี่ยน events แม้ถูกปฏิเสธ')
    assert.deepEqual(await held(id), machines, name + ' เปลี่ยนจักรแม้ถูกปฏิเสธ')
    await invariant()
  }

  async function film(id) {
    await change(id, 'admin', 'order_film', [due], ['film_ordered'])
    await change(id, 'admin', 'receive_film', [], ['film_received'])
  }
  async function walk(id, stations, phase, verifyGates = false) {
    for (const station of stations) {
      assert.deepEqual(core(await live(id)), [phase, station, 'queued'])
      const role = roleFor(station)
      if (station === 'dtf_press' && !(await live(id)).dtf_film_received_at) {
        await deny(id, role, 'start_station', [], /ยังไม่ได้รับ/)
        await film(id)
      }
      if (station === 'sew') {
        await change(id, role, 'start_sewing', [], ['machines_assigned', 'station_start'])
        assert.ok((await held(id)).length > 0)
      } else {
        await change(id, role, 'start_in_queue', [null], ['station_start'])
      }
      assert.deepEqual(core(await live(id)), [phase, station, 'doing'])
      if (station === 'qc_pack' && phase === 'production') {
        if (verifyGates) await deny(id, role, 'finish_station', [station], /QC|ผ่าน|ครบ/)
        await change(id, role, 'record_qc', [10], ['qc_result'])
      }
      const terminal = station === 'qc_pack' ? [phase === 'sample' ? 'sample_sent' : 'done'] : []
      await change(id, role, station === 'sew' ? 'finish_sewing' : 'finish_station',
        station === 'sew' ? [] : [station], ['station_done', ...terminal])
      if (station === 'sew') assert.deepEqual(await held(id), [])
    }
  }
  async function at(no, route, station, sample = false) {
    const id = await receive(no, route, sample)
    await walk(id, routes[route].slice(0, routes[route].indexOf(station)), sample ? 'sample' : 'production')
    if (station === 'dtf_press') await film(id)
    return id
  }

  await db.exec('begin')
  try {
    await db.exec(
      "select set_config('request.jwt.claim.sub', '', true);" +
      "update public.machine_types set shared=code in ('cover','button','buttonhole','ovl4');" +
      "delete from public.product_machine_needs where (product_type_code,type_code) in (('tshirt','flat'),('apron','binding'));" +
      "update public.outsource_runs set closed_at=now() where closed_at is null;" +
      "update public.machine_assignments set released_at=now() where released_at is null;" +
      "update public.machine_bookings set cancelled_at=now() where cancelled_at is null;" +
      "alter table public.jobs disable trigger jobs_guard_outsourced;" +
      "update public.jobs set phase='cancelled',station_status=null,station_seq=null where phase not in ('done','cancelled');" +
      "alter table public.jobs enable trigger jobs_guard_outsourced;")
    await db.exec("update public.stations set machines=null,machine_pool=null")
    for (const [station, total, pool] of capacity) {
      await db.query('update public.stations set machines=$2,machine_pool=$3 where code=$1', [station, total, pool])
    }
    await invariant()

    for (const [route, stations] of Object.entries(routes)) {
      for (const sample of [false, true]) {
        await check('R9 เส้นทาง ' + route + (sample ? ' · มีตัวอย่าง' : ' · ผลิตเลย'), async () => {
          const id = await receive(route, route, sample)
          if (sample) {
            const rounds = route === 'normal' ? 2 : 1
            for (let round = 1; round <= rounds; round++) {
              await walk(id, stations, 'sample')
              assert.deepEqual(core(await live(id)), ['sample_review', null, null])
              const pass = round === rounds
              const { delta } = await change(id, 'admin', 'record_sample_result', [pass, pass ? null : note], ['sample_result'])
              assert.equal(delta[0].payload.round, round)
            }
          }
          await walk(id, stations, 'production', true)
          assert.deepEqual(core(await live(id)), ['done', null, null])
          assert.equal((await live(id)).qc_passed, 10)
        })
      }
    }

    for (const [station, total, , route, canSendOut] of capacity) {
      await check('R9 เครื่องเต็ม · ' + station, async () => {
        const role = roleFor(station)
        const jobs = []
        for (let i = 0; i <= total + 1 + Number(canSendOut); i++) {
          jobs.push(await at(station + '-' + i, route, station, i === 0))
        }
        const active = jobs.slice(0, total)
        const waiting = jobs[total]
        if (canSendOut) {
          const external = jobs.at(-1)
          const vendor = await rpc('admin', 'add_vendor', ['บริษัทจำลองรอบ 9', [station]])
          await change(external, 'admin', 'send_out', [vendor, station, '2099-01-01T00:00:00Z', 2, '2099-01-03T00:00:00Z'], ['outsource_sent'])
          assert.equal((await live(external)).station_status, 'out')
        }
        for (const id of active) await change(id, role, 'start_in_queue', [null], ['station_start'])
        const full = error => {
          assert.match(error.message, /เต็ม/)
          for (let i = 0; i < total; i++) assert.ok(error.message.includes('TEST-R9-' + station + '-' + i))
          return true
        }
        await deny(waiting, role, 'start_station', [], full)
        await deny(waiting, role, 'start_in_queue', [null], full)
        await deny(jobs[total + 1], role, 'start_in_queue', [note], full)
        await change(active[0], role, 'open_issue', [note], ['hold'])
        await change(waiting, role, 'start_in_queue', [null], ['station_start'])
        const { delta } = await change(active[0], 'production', 'close_issue', [note], ['resume'])
        assert.equal(delta[0].payload.requeued, true)
        assert.equal((await live(active[0])).station_status, 'queued')
      })
    }

    await check('R9 รีดกับรีดฟิล์มใช้คนละกลุ่มเครื่อง', async () => {
      const press = await at('PRESS', 'normal', 'press')
      const film1 = await at('FILM1', 'dtf', 'dtf_press')
      const film2 = await at('FILM2', 'dtf', 'dtf_press')
      await change(film1, 'production', 'start_in_queue', [null], ['station_start'])
      await change(film2, 'production', 'start_in_queue', [null], ['station_start'])
      await change(press, 'production', 'start_in_queue', [null], ['station_start'])
      assert.equal((await live(press)).station_status, 'doing')
    })

    await check('R9 เย็บ · เลือกจักร จอง คืน และจักรเสีย', async () => {
      await db.exec("insert into public.sewing_machines(code,type_code,status) values ('SN-961','single','ready'),('SN-962','single','ready'),('SN-963','single','broken'),('SN-964','single','ready')")
      const shared = (await one("select code from public.sewing_machines where type_code='ovl4' and status='ready' order by code limit 1")).code
      const otherType = (await one("select m.code from public.sewing_machines m join public.machine_types t on t.code=m.type_code where not t.shared and m.status='ready' and not exists (select 1 from public.product_machine_needs n where n.product_type_code='tshirt' and n.type_code=m.type_code) order by m.code limit 1")).code
      const a = await at('SEW-A', 'plain', 'sew')
      const b = await at('SEW-B', 'plain', 'sew')
      const automatic = await at('SEW-AUTO', 'plain', 'sew')
      await db.query("insert into public.machine_bookings(machine_id,job_id,starts_at,ends_at,booked_by) select id,$1,now()-interval '1 minute',now()+interval '10 minutes',$2 from public.sewing_machines where code='SN-964'", [b, actors.production])
      await deny(a, 'production', 'start_sewing', [[]], /เลือกจักรอย่างน้อย/)
      await deny(a, 'production', 'start_sewing', [['SN-963']], /SN-963 เสีย/)
      await deny(a, 'production', 'start_sewing', [[shared]], /ใช้ร่วมกัน/)
      await deny(a, 'production', 'start_sewing', [[otherType]], /งานนี้ไม่ใช้/)
      await deny(a, 'production', 'start_sewing', [['SN-964']], /จอง.*TEST-R9-SEW-B/)
      await db.exec("update public.product_machine_needs set qty=2 where product_type_code='tshirt' and type_code='single'")
      await deny(a, 'production', 'start_sewing', [['SN-961']], /ไม่ครบ.*2 ตัว/)
      await db.exec("update public.product_machine_needs set qty=1 where product_type_code='tshirt' and type_code='single'")

      const { result } = await change(a, 'production', 'start_sewing', [['SN-961']], ['machines_assigned', 'station_start'])
      assert.deepEqual(result, ['SN-961'])
      assert.deepEqual(await held(a), ['SN-961'])
      await deny(b, 'production', 'start_sewing', [['SN-961']], /ใช้กับงาน TEST-R9-SEW-A/)
      await change(automatic, 'production', 'start_sewing', [], ['machines_assigned', 'station_start'])
      assert.equal((await held(automatic)).length, 1)
      await change(automatic, 'production', 'finish_sewing', [], ['station_done'])
      assert.deepEqual(await held(automatic), [])

      await change(a, 'production', 'assign_machines', [['SN-962']], ['machines_assigned'])
      await deny(a, 'production', 'release_machines', [['SN-961', 'SN-962']], /ไม่ครบชุด/)
      await change(a, 'production', 'release_machines', [['SN-962']], ['machines_released'])
      await change(a, 'production', 'assign_machines', [['SN-962']], ['machines_assigned'])
      await step(a, 'production', 'set_machine_status', ['SN-962', 'broken', note, new Date(Date.now() + 3_600_000).toISOString()], ['machines_released'])
      assert.deepEqual(core(await live(a)), ['production', 'sew', 'doing'])
      assert.deepEqual(await held(a), ['SN-961'])
      await step(a, 'production', 'set_machine_status', ['SN-962', 'ready'], [])
      await change(a, 'production', 'assign_machines', [['SN-962']], ['machines_assigned'])
      assert.deepEqual(await held(a), ['SN-961', 'SN-962'])
      await change(a, 'production', 'finish_sewing', [], ['station_done'])
      assert.deepEqual(core(await live(a)), ['production', 'qc_pack', 'queued'])
      assert.deepEqual(await held(a), [])
    })

    await check('R9 staff · ขอบเขตสถานีและสิทธิ์ปุ่ม', async () => {
      const link = station => as('owner', 'insert into public.staff_stations(user_id,station_code) values ($1,$2) on conflict do nothing', [actors.staff, station])
      await link('print')
      const id = await receive('STAFF', 'normal')
      const other = await receive('STAFF-OTHER', 'normal')
      const sew = await at('STAFF-SEW', 'plain', 'sew')
      await change(id, 'staff', 'start_in_queue', [null], ['station_start'])
      await change(id, 'staff', 'open_issue', [note], ['hold'])
      await deny(id, 'staff', 'close_issue', [note], { code: '42501' })
      await deny(other, 'staff', 'move_job_ahead', [id, note], { code: '42501' })
      await deny(id, 'staff', 'receive_job', receiveArgs('TEST-R9-STAFF-NEW', 'normal', false), { code: '42501' }, [])
      assert.equal(await one("select id from public.jobs where confirmation_no='TEST-R9-STAFF-NEW'"), undefined)
      await deny(sew, 'staff', 'start_sewing', [], { code: '42501' })
      await change(id, 'production', 'close_issue', [note], ['resume'])
      await change(id, 'staff', 'finish_station', ['print'], ['station_done'])
      await deny(id, 'staff', 'start_in_queue', [null], /ไม่ใช่สถานีของคุณ/)
      const qc = await at('STAFF-QC', 'cut_only', 'qc_pack')
      await deny(qc, 'staff', 'start_in_queue', [null], /ไม่ใช่สถานีของคุณ/)
      await change(qc, 'qc', 'start_in_queue', [null], ['station_start'])
      await deny(qc, 'staff', 'record_qc', [10], /ไม่ใช่สถานีของคุณ/)
      await link('qc_pack')
      await change(qc, 'staff', 'record_qc', [10], ['qc_result'])
      await change(qc, 'staff', 'finish_station', ['qc_pack'], ['station_done', 'done'])
    })

    await check('R9 Audit Log · สถานี ผู้ใช้ การจับคู่ และห้ามแก้ย้อนหลัง', async () => {
      const audit = () => rows('select * from public.audit_log order by id')
      const before = await audit()
      const name = (await one('select name from public.profiles where user_id=$1', [actors.staff])).name
      const station = 'update public.stations set machines=3 where code=$1'
      const profile = 'update public.profiles set name=$2 where user_id=$1'
      const link = 'insert into public.staff_stations(user_id,station_code) values ($1,$2)'
      for (const role of Object.keys(actors).filter(role => role !== 'owner')) {
        assert.equal((await as(role, station, ['print'])).affectedRows, 0)
        assert.equal((await as(role, profile, [actors.staff, note])).affectedRows, 0)
        await assert.rejects(() => as(role, link, [actors.staff, 'press']), { code: '42501' })
        assert.deepEqual((await as(role, 'select id from public.audit_log')).rows, [])
      }
      assert.deepEqual(await audit(), before)
      await as('owner', station, ['print'])
      await as('owner', profile, [actors.staff, note])
      await as('owner', link, [actors.staff, 'press'])
      await as('owner', 'delete from public.staff_stations where user_id=$1 and station_code=$2', [actors.staff, 'press'])
      const records = (await audit()).slice(before.length)
      assert.deepEqual(records.map(row => [row.table_name, row.action, row.row_key, row.by]), [
        ['stations', 'update', 'print', actors.owner], ['profiles', 'update', actors.staff, actors.owner],
        ['staff_stations', 'insert', actors.staff + ':press', actors.owner], ['staff_stations', 'delete', actors.staff + ':press', actors.owner],
      ])
      assert.deepEqual([records[0].old_row.machines, records[0].new_row.machines], [2, 3])
      assert.deepEqual([records[1].old_row.name, records[1].new_row.name], [name, note])
      assert.deepEqual([records[2].old_row, records[2].new_row.station_code, records[3].old_row.station_code, records[3].new_row], [null, 'press', 'press', null])
      for (const sql of ['update public.audit_log set table_name=table_name', 'delete from public.audit_log']) {
        assert.equal((await as('owner', sql)).affectedRows, 0)
        await db.exec('savepoint r9_trigger')
        await assert.rejects(() => db.query(sql), /เพิ่มอย่างเดียว/)
        await db.exec('rollback to savepoint r9_trigger; release savepoint r9_trigger')
      }
      assert.deepEqual(await audit(), [...before, ...records])
    })

    await check('R9 ผู้บริหารรับทราบรายงานและรายการคิว', async () => {
      const ahead = await receive('ACK-FIRST', 'normal')
      const id = await receive('ACK', 'normal')
      const { delta: queue } = await change(id, 'production', 'move_job_ahead', [ahead, note], ['queue_insert'])
      await change(id, 'production', 'start_in_queue', [null], ['station_start'])
      const reason = (await one('select code from public.reason_codes where active order by code limit 1')).code
      const { result: delay } = await change(id, 'production', 'submit_delay_report', [[reason], note, due], ['delay_report'])
      for (const [kind, ref] of [['delay_report', delay], ['queue_event', queue[0].id]]) {
        for (const role of ['admin', 'qc', 'staff', 'production', 'supervisor']) {
          await deny(id, role, 'ack_review', [kind, ref], { code: '42501' }, [])
        }
        assert.deepEqual(await rows('select * from public.manager_acks where job_id=$1 and kind=$2', [id, kind]), [])
        await step(id, 'manager', 'ack_review', [kind, ref], [])
        await step(id, 'manager', 'ack_review', [kind, ref], [])
        const logs = await rows('select by,ref_id from public.manager_acks where job_id=$1 and kind=$2', [id, kind])
        assert.deepEqual(logs, [{ by: actors.manager, ref_id: ref }])
      }
      const wrong = (await history(id)).find(event => event.type === 'received').id
      await deny(id, 'manager', 'ack_review', ['queue_event', wrong], { code: 'P0002' }, [])
      await deny(id, 'manager', 'ack_review', ['received', wrong], { code: '22023' }, [])
      assert.deepEqual(core(await live(id)), ['production', 'print', 'doing'])
    })

    await check('R9 PDF · แนบได้หลังรับและอ่านใบปะงานได้ครบ 7 บทบาท', async () => {
      const id = await receive('PDF', 'cut_only')
      const noPdf = await receive('NO-PDF', 'cut_only')
      await walk(id, routes.cut_only, 'production')
      await walk(noPdf, routes.cut_only, 'production')
      assert.equal((await live(noPdf)).confirmation_pdf_path, null)
      assert.equal((await live(noPdf)).phase, 'done')
      const path = 'TEST-R9-PDF/signed.pdf'
      await db.exec("insert into storage.buckets values ('confirmations') on conflict do nothing")
      await deny(id, 'admin', 'attach_confirmation_pdf', ['TEST-R9-PDF/signed.png'], /ต้องเป็น PDF/)
      await deny(id, 'admin', 'attach_confirmation_pdf', [path], /ยังไม่พบไฟล์ PDF/)
      await db.query("insert into storage.objects values ('confirmations',$1)", [path])
      await deny(id, 'production', 'attach_confirmation_pdf', [path], { code: '42501' })
      await change(id, 'admin', 'attach_confirmation_pdf', [path], ['confirmation_pdf'])
      assert.equal((await live(id)).confirmation_pdf_path, path)
      for (const role of Object.keys(actors)) {
        const result = await as(role, 'select id,confirmation_no,customer_name,job_name,product_type_code,qty,unit,due_date,route_code,needs_sample,sample_round,phase,mockup_path from public.job_live where id=$1', [id])
        assert.deepEqual(result.rows[0], {
          id, confirmation_no: 'TEST-R9-PDF', customer_name: 'ลูกค้าจำลองรอบ 9', job_name: 'งานทดสอบ',
          product_type_code: 'tshirt', qty: 10, unit: 'ตัว', due_date: new Date(due + 'T00:00:00Z'),
          route_code: 'cut_only', needs_sample: false, sample_round: 1, phase: 'done', mockup_path: null,
        }, role)
        for (const [sql, args, count] of [
          ['select name from public.product_types where code=$1', ['tshirt'], 1],
          ['select name from public.routes where code=$1', ['cut_only'], 1],
          ['select seq,station_code from public.route_stations where route_code=$1', ['cut_only'], 2],
          ['select code,name from public.stations where code=any($1::text[])', [routes.cut_only], 2],
        ]) assert.equal((await as(role, sql, args)).rows.length, count, role)
      }
    })

    await check('R9 events เป็นแบบเพิ่มอย่างเดียว', async () => {
      const id = await receive('HISTORY', 'normal')
      const before = await history(id)
      for (const sql of ['update public.events set type=type where job_id=$1', 'delete from public.events where job_id=$1']) {
        assert.equal((await as('owner', sql, [id])).affectedRows, 0)
        await db.exec('savepoint r9_trigger')
        await assert.rejects(() => db.query(sql, [id]), /ประวัติ|events/)
        await db.exec('rollback to savepoint r9_trigger; release savepoint r9_trigger')
      }
      assert.deepEqual(await history(id), before)
    })
  } finally {
    await db.exec('rollback')
  }
  skips.report()
}
