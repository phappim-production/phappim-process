import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const roster = {
  owner: ['owner'], manager: ['manager'],
  admin: ['admin'], admin2: ['admin'], admin3: ['admin'], admin4: ['admin'],
  prod: ['production'], prod2: ['production'],
  multi: ['staff', 'print', 'press', 'cut'], press: ['staff', 'press', 'dtf_press'],
  cut: ['staff', 'cut'], qc: ['staff', 'qc_pack'],
  pending1: ['staff'], pending2: ['staff'], pending3: ['staff'],
  pending4: ['staff'], pending5: ['staff'], disabled: ['staff', 'print'],
}
const actors = Object.fromEntries(Object.keys(roster).map((name, i) =>
  [name, '11000000-0000-0000-0000-' + String(i + 1).padStart(12, '0')]))
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
const capacities = [
  ['print', 2, 'print', 'normal'], ['press', 1, 'heat_press', 'normal'],
  ['cut', 2, 'cut', 'cut_only'], ['dtf_press', 2, 'dtf_press', 'dtf'],
  ['qc_pack', 1, 'qc_pack', 'cut_only'],
]
const staffFor = { print: 'multi', press: 'press', cut: 'cut', dtf_press: 'press', emb: 'prod2', sew: 'prod', qc_pack: 'qc' }
const due = '2099-01-06'
const note = 'ข้อมูลจำลองรอบ 11'
const script = readFileSync(new URL('../scripts/golive-cleanup.sql', import.meta.url), 'utf8')

export async function flowR11Tests({ db, ok }) {
  const rows = async (sql, args) => (await db.query(sql, args)).rows
  const one = async (sql, args) => (await rows(sql, args))[0]
  const live = id => one('select * from public.job_live where id=$1', [id])
  const history = () => rows('select * from public.events order by id')
  const sheet = id => one('select * from public.mockup_sheets where id=$1', [id])
  async function auth(actor, sql, args) {
    await db.exec('savepoint r11_request')
    try {
      await db.exec('set local role authenticated')
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [actors[actor]])
      const result = await rows(sql, args)
      await db.exec('reset role; release savepoint r11_request')
      return result
    } catch (error) {
      await db.exec('rollback to savepoint r11_request; release savepoint r11_request')
      throw error
    }
  }
  async function rpc(actor, fn, args = []) {
    const params = args.map((_, i) => '$' + (i + 1)).join(', ')
    return (await auth(actor, 'select public.' + fn + '(' + params + ') as value', args))[0].value
  }
  async function invariant() {
    assert.deepEqual(await rows(`
      select s.code from public.stations s
      join public.stations peer on coalesce(s.machine_pool,s.code)=coalesce(peer.machine_pool,peer.code)
      join public.job_live j on j.current_station=peer.code and j.station_status='doing' and j.phase in ('production','sample')
      where s.machines is not null group by s.code,s.machines having count(*) > s.machines`), [], 'เครื่องเต็มเกินจำนวน')
    assert.deepEqual(await rows(`
      select machine_id from public.machine_assignments where released_at is null
      group by machine_id having count(*) > 1`), [], 'จ่ายจักรซ้ำ')
    assert.deepEqual(await rows(`
      select j.id from public.jobs j
      where (j.station_status is not distinct from 'hold') is distinct from
            exists (select 1 from public.issues i where i.job_id=j.id and i.closed_at is null)
         or (j.station_status is not distinct from 'out') is distinct from
            exists (select 1 from public.outsource_runs o where o.job_id=j.id and o.closed_at is null)`), [], 'สถานะพักหรือส่งออกขัดกับข้อมูล')
    assert.deepEqual(await rows("select id from public.jobs where phase <> 'done' and delivered_at is not null"), [])
  }
  async function action(actor, fn, args, expected, jobId) {
    const before = await history()
    const result = await rpc(actor, fn, args)
    const after = await history()
    assert.deepEqual(after.slice(0, before.length), before, fn + ' เปลี่ยนประวัติเดิม')
    const added = after.slice(before.length)
    assert.deepEqual(added.map(e => e.type), expected, fn)
    assert.ok(added.every(e => e.by === actors[actor]), fn + ' ผู้กดไม่ตรง')
    if (jobId) assert.ok(added.every(e => e.job_id === jobId), fn + ' ผูกผิดงาน')
    await invariant()
    return result
  }
  const change = (id, actor, fn, args, expected) => action(actor, fn, [id, ...args], expected, id)
  async function deny(actor, fn, args, error) {
    const before = await history()
    const jobs = await rows('select * from public.job_live order by id')
    await assert.rejects(() => rpc(actor, fn, args), actual => {
      if (error instanceof RegExp) assert.match(actual.message, error, fn + ': ' + actual.message)
      else if (typeof error === 'function') return error(actual)
      else assert.equal(actual.code, error.code, fn + ': ' + actual.message)
      return true
    }, fn)
    assert.deepEqual(await history(), before, fn + ' ทิ้งประวัติหลังปฏิเสธ')
    assert.deepEqual(await rows('select * from public.job_live order by id'), jobs, fn + ' เปลี่ยนงานหลังปฏิเสธ')
    await invariant()
  }
  const argsFor = (no, route, sample = false, spec = {}) =>
    ['TEST-R11-' + no, 'ลูกค้าจำลอง', 'งานจำลอง', 'tshirt', 10, 'ตัว', due, route, null, 0, 0, JSON.stringify(spec), sample]
  const receive = (no, route, sample = false, actor = 'admin', spec = {}) =>
    action(actor, 'receive_job', argsFor(no, route, sample, spec), ['received', 'released'])
  const state = async id => {
    const j = await live(id)
    return [j.phase, j.current_station, j.station_status]
  }
  async function film(id) {
    await change(id, 'admin2', 'order_film', [due], ['film_ordered'])
    await change(id, 'admin2', 'receive_film', [], ['film_received'])
  }
  async function start(id, station, actor = staffFor[station]) {
    return station === 'sew'
      ? change(id, actor, 'start_sewing', [], ['machines_assigned', 'station_start'])
      : change(id, actor, 'start_in_queue', [null], ['station_start'])
  }
  async function walk(id, stations, phase) {
    for (const station of stations) {
      assert.deepEqual(await state(id), [phase, station, 'queued'])
      if (station === 'dtf_press' && !(await live(id)).dtf_film_received_at) {
        await deny(staffFor[station], 'start_in_queue', [id, null], /ยังไม่ได้รับ/)
        await film(id)
      }
      await start(id, station)
      assert.deepEqual(await state(id), [phase, station, 'doing'])
      if (station === 'qc_pack' && phase === 'production') {
        await deny('qc', 'finish_station', [id, station], /QC|ผ่าน|ครบ/)
        await change(id, 'qc', 'record_qc', [(await live(id)).qty], ['qc_result'])
      }
      const terminal = station === 'qc_pack' ? [phase === 'sample' ? 'sample_sent' : 'done'] : []
      const sew = station === 'sew'
      await change(id, staffFor[station], sew ? 'finish_sewing' : 'finish_station', sew ? [] : [station], ['station_done', ...terminal])
    }
  }
  async function at(no, route, station) {
    const id = await receive(no, route)
    await walk(id, routes[route].slice(0, routes[route].indexOf(station)), 'production')
    if (station === 'dtf_press') await film(id)
    return id
  }
  async function check(label, test) {
    await db.exec('savepoint r11_case')
    try {
      await test()
      ok('R11 ' + label, true)
    } catch (error) {
      ok('R11 ' + label, false, String(error.message).replace(/\s+/g, ' '))
    } finally {
      await db.exec('rollback to savepoint r11_case; release savepoint r11_case')
    }
  }

  await db.exec('begin')
  try {
    await db.exec(`
      alter table public.events disable trigger events_append_only;
      delete from public.jobs;
      alter table public.events enable trigger events_append_only;
      delete from public.inbox_messages;
      delete from public.confirmation_drafts;
      delete from private.rpc_requests;
      update public.stations set machines=null,machine_pool=null;
      update public.machine_types set shared=code in ('cover','button','buttonhole','ovl4');
      delete from public.product_machine_needs where (product_type_code,type_code) in (('tshirt','flat'),('apron','binding'));
    `)
    for (const [name, [role, ...stations]] of Object.entries(roster)) {
      await db.query('insert into auth.users(id,email) values ($1,$2)', [actors[name], name + '@r11.invalid'])
      await db.query('insert into public.profiles(user_id,name,role,active) values ($1,$2,$3,$4)', [actors[name], name, role, name !== 'disabled'])
      for (const station of stations) {
        await db.query('insert into public.staff_stations(user_id,station_code) values ($1,$2)', [actors[name], station])
      }
    }
    for (const [station, total, pool] of capacities) {
      await db.query('update public.stations set machines=$2,machine_pool=$3 where code=$1', [station, total, pool])
    }
    await check('A1 งานแรกถึงงานที่ 5 และแทรกคิว', async () => {
      assert.deepEqual(await rows('select id from public.job_live'), [])
      assert.deepEqual(await history(), [])
      assert.deepEqual(await rows('select id from public.inbox_messages'), [])
      assert.deepEqual(await auth('owner', 'select * from public.job_sla_flags()'), [])
      const jobs = []
      for (let i = 1; i <= 5; i++) {
        jobs.push(await receive(String(i), 'normal', false, i === 1 ? 'admin' : 'admin' + Math.min(i, 4)))
      }
      const queue = () => auth('multi', 'select id, queue_seq::text from public.job_live order by job_live.queue_seq')
      const firstQueue = await queue()
      assert.deepEqual(firstQueue.map(j => j.id), jobs)
      assert.ok(Number(firstQueue[0].queue_seq) > 0)
      assert.deepEqual(firstQueue.slice(1).map((j, i) => Number(j.queue_seq) - Number(firstQueue[i].queue_seq)), [1024, 1024, 1024, 1024])
      await change(jobs[4], 'manager', 'move_job_ahead', [jobs[0], note], ['queue_insert'])
      assert.deepEqual((await queue()).map(job => job.id), [jobs[4], ...jobs.slice(0, 4)])
      await start(jobs[4], 'print')
      const flags = await auth('multi', 'select * from public.job_sla_flags()')
      assert.deepEqual(flags, [{ job_id: jobs[4], warn: false, over: false, need_report: false }])
    })

    for (const [route, stations] of Object.entries(routes)) {
      for (const sample of [false, true]) {
        await check('A2 ' + route + (sample ? ' · มีตัวอย่าง' : ' · ผลิตเลย'), async () => {
          const id = await receive(route, route, sample)
          if (sample && route === 'normal') {
            await walk(id, stations, 'sample')
            await change(id, 'admin3', 'record_sample_result', [false, note], ['sample_result'])
            assert.equal((await live(id)).sample_round, 2)
          }
          if (sample) {
            await walk(id, stations, 'sample')
            assert.deepEqual(await state(id), ['sample_review', null, null])
            await change(id, 'admin3', 'record_sample_result', [true, null], ['sample_result'])
          }
          await walk(id, stations, 'production')
          assert.deepEqual(await state(id), ['done', null, null])
          await change(id, 'admin4', 'mark_delivered', [note], ['delivered'])
          assert.equal((await live(id)).delivered_by, actors.admin4)
        })
      }
    }

    await check('A2 แอดมินส่งออก/รับกลับ · QC ส่งแก้ · ฝ่ายผลิตกดทำต่อ', async () => {
      const id = await receive('OUT', 'normal')
      const vendor = await rpc('admin3', 'add_vendor', ['บริษัทจำลองรอบ 11', ['print', 'press']])
      const run = await change(id, 'admin3', 'send_out',
        [vendor, 'press', '2099-01-01T00:00:00Z', 2, '2099-01-03T00:00:00Z'], ['outsource_sent'])
      await deny('multi', 'start_in_queue', [id, null], /ส่งออก|ภายนอก|ข้างนอก|รอเริ่ม|สถานะงานเปลี่ยน/)
      await action('admin3', 'receive_back', [run, note], ['outsource_received'], id)
      await start(id, 'cut')
      await change(id, 'cut', 'open_issue', [note], ['hold'])
      await change(id, 'prod2', 'close_issue', [note], ['resume'])
      await change(id, 'cut', 'finish_station', ['cut'], ['station_done'])
      await walk(id, ['sew'], 'production')
      await start(id, 'qc_pack')
      await change(id, 'qc', 'record_qc', [8], ['qc_result'])
      await change(id, 'qc', 'send_rework', [2, note, 'sew'], ['rework'])
      await walk(id, ['sew'], 'production')
      await start(id, 'qc_pack')
      await change(id, 'qc', 'record_qc', [2], ['qc_result'])
      await change(id, 'qc', 'finish_station', ['qc_pack'], ['station_done', 'done'])
    })

    await check('A3 staff มีสิทธิ์ตามสถานีและหน้าที่', async () => {
      const id = await receive('SCOPE', 'normal')
      const other = await receive('OTHER', 'normal')
      const sew = await at('SCOPE-SEW', 'plain', 'sew')
      const draft = await rpc('admin', 'start_mockup_sheet', [id])
      for (const actor of ['press', 'pending1', 'pending2', 'pending3', 'pending4', 'pending5']) {
        await deny(actor, 'start_in_queue', [id, null], /สถานี|จับคู่/)
      }
      await start(id, 'print', 'multi')
      await change(id, 'multi', 'open_issue', [note], ['hold'])
      for (const [fn, args] of [
        ['close_issue', [id, note]], ['move_job_ahead', [other, id, note]],
        ['receive_job', argsFor('DENIED', 'normal')], ['start_sewing', [sew]],
        ['mark_delivered', [id]], ['approve_mockup_sheet', [draft, null, 1]],
      ]) await deny('multi', fn, args, { code: '42501' })
      await change(id, 'prod', 'close_issue', [note], ['resume'])
      await change(id, 'multi', 'finish_station', ['print'], ['station_done'])
      await start(id, 'press', 'multi')
      await change(id, 'multi', 'finish_station', ['press'], ['station_done'])
      await start(id, 'cut', 'multi')
    })

    await check('A3 บัญชีปิดแล้วอ่านตารางและใช้ RPC ไม่ได้', async () => {
      const id = await receive('INACTIVE', 'normal')
      for (const table of ['jobs', 'job_live', 'events', 'stations', 'staff_stations', 'mockup_sheets']) {
        assert.deepEqual(await auth('disabled', 'select * from public.' + table), [], table)
      }
      await deny('disabled', 'start_in_queue', [id, null], { code: '42501' })
      await deny('disabled', 'job_sla_flags', [], { code: '42501' })
    })

    await check('BUG: A3 บัญชีปิดแล้วยังอ่านโปรไฟล์ตัวเองได้', async () => {
      const profiles = await auth('disabled', 'select user_id, active from public.profiles')
      assert.equal(profiles.length, 0, 'บัญชีที่ปิดแล้วยังอ่านโปรไฟล์ตัวเองได้ ' + profiles.length + ' แถว')
    })

    await check('A4 ใบยืนยัน → ร่าง → อนุมัติ → แก้หลังเริ่มผลิต → รับทราบ', async () => {
      const no = 'MOCKUP'
      const image = 'TEST-R11-MOCKUP/main.png'
      const sizes = ['8x8 ซม.', '3 นิ้ว', '10 × 12']
      const labels = ['อกซ้าย', 'อกขวา', 'กลางหลัง']
      const spec = {
        app: 'phappim-confirm', v: 1, h: { doc_no: 'TEST-R11-' + no }, product: 'tshirt',
        mockup_path: image, co_size: { w: 800, h: 600 },
        p: { tshirt: { placements: Object.fromEntries(labels.map((label, i) =>
          [label, { on: true, tech: 'DTF', size: sizes[i] }])) } },
        callouts: labels.map((title, i) => ({
          title, x: [0.2, 0.3, 0.4][i], y: 0.4, bx: [-0.125, 1.125, 0.5][i], by: [0.3, 0.2, 0.5][i],
          ref: 'placement:' + title,
        })),
      }
      await rpc('admin', 'save_confirmation_draft', [JSON.stringify(spec)])
      const id = await receive(no, 'normal', false, 'admin', spec)
      const { mockup_path, spec: imported } = await live(id)
      assert.equal(mockup_path, image)
      assert.deepEqual(imported.callouts, spec.callouts)
      const draft = await action('admin', 'start_mockup_sheet', [id], [])
      const payload = {
        views: [{ view: 'front', image_path: mockup_path, width: imported.co_size.w, height: imported.co_size.h }],
        specs: [],
        callouts: imported.callouts.map((c, i) => ({
          view: 'front', no: i + 1, x: Number(c.x.toFixed(4)), y: c.y, box_x: c.bx, box_y: c.by,
          title: c.title, spec_ref: c.ref, stations: [],
        })),
      }
      const save = (actor, sheetId, version, data) =>
        action(actor, 'save_mockup_draft', [sheetId, version, JSON.stringify(data)], [])
      const first = await save('admin', draft, 1, payload)
      const seeded = await rows('select title, x::float8, y::float8 from public.mockup_callouts where sheet_id=$1 order by no', [draft])
      assert.deepEqual(seeded, imported.callouts.map(({ title, x, y }) => ({ title, x, y })))
      for (const n of [-0.6, 1.6]) {
        for (const axis of ['box_x', 'box_y']) {
          const outside = { ...payload, callouts: [{ ...payload.callouts[0], [axis]: n }] }
          await deny('admin', 'save_mockup_draft', [draft, first, JSON.stringify(outside)], /อยู่นอกภาพ/)
        }
      }
      Object.assign(payload.callouts[0], { title: 'แก้ชื่อโดยแอดมิน', box_x: -0.5, box_y: 1.5 })
      Object.assign(payload.callouts[1], { box_x: 1.5, box_y: -0.5 })
      const current = await save('admin2', draft, first, payload)
      const conflict = error => {
        assert.equal(error.code, 'P0001')
        assert.match(error.message, /มีคน|ไปก่อนแล้ว/)
        return true
      }
      await deny('admin', 'save_mockup_draft', [draft, first, JSON.stringify(payload)], conflict)
      await deny('admin', 'approve_mockup_sheet', [draft, null, first], conflict)
      assert.equal((await sheet(draft)).version, current)
      await action('admin2', 'approve_mockup_sheet', [draft, note, current], ['mockup_approved'], id)
      const saved = await rows('select title,ref_value,box_x,box_y from public.mockup_callouts where sheet_id=$1 order by no', [draft])
      assert.deepEqual(saved.map(c => c.ref_value), ['DTF · 8x8 ซม.', 'DTF · 3 นิ้ว', 'DTF · 10 × 12 ซม.'])
      assert.deepEqual(saved.slice(0, 2).map(c => [Number(c.box_x), Number(c.box_y)]), [[-0.5, 1.5], [1.5, -0.5]])
      assert.equal(saved[0].title, 'แก้ชื่อโดยแอดมิน')
      await start(id, 'print')
      const revision = await rpc('admin3', 'start_mockup_sheet', [id, note])
      await deny('prod', 'approve_mockup_sheet', [revision, null, 1], /แอดมิน/)
      await action('admin3', 'approve_mockup_sheet', [revision, note, (await sheet(revision)).version], ['mockup_approved'], id)
      assert.equal((await sheet(draft)).status, 'superseded')
      assert.equal((await sheet(revision)).approved_by, actors.admin3)
      await deny('cut', 'ack_mockup_sheet', [revision, 'print'], /สถานีที่จับคู่/)
      await deny('qc', 'ack_mockup_sheet', [revision, 'press'], /สถานีที่จับคู่/)
      await action('multi', 'ack_mockup_sheet', [revision, 'print'], [], id)
      await action('qc', 'ack_mockup_sheet', [revision, 'qc_pack'], [], id)
      const acks = await rows('select station_code, user_id from public.mockup_acks where sheet_id=$1 order by station_code', [revision])
      assert.deepEqual(acks, [{ station_code: 'print', user_id: actors.multi }, { station_code: 'qc_pack', user_id: actors.qc }])
    })

    await check('A5 แยกงานแล้วจัดส่งและยกเลิกแยกกัน', async () => {
      const parent = await receive('SPLIT', 'cut_only')
      await deny('admin', 'mark_delivered', [parent], /ยังผลิตไม่เสร็จ/)
      const before = await history()
      const child = await rpc('admin', 'split_job', [parent, 4])
      const after = await history()
      assert.deepEqual(after.slice(0, before.length), before)
      const splitEvents = after.slice(before.length).map(e => [e.type, e.job_id, e.by])
      assert.deepEqual(splitEvents.sort(), [['job_split', parent, actors.admin], ['job_split_from', child, actors.admin]].sort())
      await invariant()
      assert.deepEqual([(await live(parent)).qty, (await live(child)).qty], [6, 4])
      for (const id of [parent, child]) await walk(id, routes.cut_only, 'production')
      for (const actor of ['prod', 'manager', 'qc', 'multi']) {
        await deny(actor, 'mark_delivered', [parent], { code: '42501' })
      }
      await change(parent, 'admin', 'mark_delivered', ['  TEST-R11-TRACK  '], ['delivered'])
      assert.equal((await live(parent)).delivery_note, 'TEST-R11-TRACK')
      assert.equal((await live(child)).delivered_at, null)
      await deny('admin', 'mark_delivered', [parent], /บันทึกจัดส่งไปแล้ว/)
      await deny('admin', 'undo_delivery', [parent, ' '], /ใส่เหตุผล/)
      await deny('qc', 'undo_delivery', [parent, note], { code: '42501' })
      await deny('qc', 'send_rework', [parent, 1, note, 'cut'], /QC|สถานี|ผลิต/)
      await change(child, 'admin4', 'mark_delivered', [null], ['delivered'])
      await change(parent, 'admin', 'undo_delivery', [note], ['delivery_undone'])
      assert.equal((await live(parent)).delivered_at, null)
      assert.ok((await live(child)).delivered_at)
    })

    for (const [station, total, , route] of capacities) {
      await check('A6 เครื่องเต็ม ' + station + ' · ' + total, async () => {
        const actor = staffFor[station]
        const jobs = []
        for (let i = 0; i <= total; i++) jobs.push(await at(station + '-' + i, route, station))
        for (const id of jobs.slice(0, total)) await start(id, station)
        await deny(actor, 'start_in_queue', [jobs[total], null], /เต็ม/)
        await change(jobs[0], actor, 'open_issue', [note], ['hold'])
        await start(jobs[total], station)
        await change(jobs[0], 'prod', 'close_issue', [note], ['resume'])
        assert.equal((await live(jobs[0])).station_status, 'queued')
      })
    }

    await check('A6 ฝ่ายผลิตสองคนเย็บพร้อมกัน · จักรเสียและเย็บต่อ', async () => {
      const a = await at('SEW-A', 'plain', 'sew')
      const b = await at('SEW-B', 'plain', 'sew')
      const first = await start(a, 'sew', 'prod')
      await deny('prod2', 'start_sewing', [b, first], /ใช้กับงาน/)
      const second = await start(b, 'sew', 'prod2')
      assert.ok(first.length && second.length)
      assert.ok(first.every(code => !second.includes(code)))
      const repair = (await one("select now() + interval '1 hour' eta")).eta
      await action('prod', 'set_machine_status', [first[0], 'broken', note, repair.toISOString()],
        ['machines_released', 'hold'], a)
      assert.equal((await live(a)).station_status, 'hold')
      assert.equal((await live(b)).station_status, 'doing')
      await action('prod', 'set_machine_status', [first[0], 'ready'], [])
      await change(a, 'prod', 'resume_sewing', [], ['machines_assigned', 'resume'])
      await change(a, 'prod', 'finish_sewing', [], ['station_done'])
      await change(b, 'prod2', 'finish_sewing', [], ['station_done'])
    })

    await check('A7 สคริปต์ล้างงานบนตารางว่าง รันซ้ำได้พร้อมตารางสรุป', async () => {
      // ตัดคำสั่งธุรกรรมชั้นนอกเพื่อให้สคริปต์อยู่ภายใน rollback ของชุดทดสอบ
      assert.match(script, /^begin;$/m)
      assert.match(script, /^commit;$/m)
      const insideTransaction = script.replace(/^(begin|commit);\r?$/gm, '')
      for (let i = 0; i < 2; i++) {
        const results = await db.exec(insideTransaction)
        const summary = results.at(-1).rows
        assert.equal(summary.find(row => row.รายการ.startsWith('ลบงานทดสอบ TEST-')).ผล, '0')
        assert.equal(summary.find(row => row.รายการ.startsWith('งานจริงที่เหลือ')).ผล, '0')
        assert.equal(summary.find(row => row.รายการ.startsWith('trigger')).ผล, 'เปิดอยู่ (ถูกต้อง)')
        assert.deepEqual(await history(), [])
        await invariant()
      }
    })

    await check('A8 ประวัติแก้หรือลบไม่ได้', async () => {
      const id = await receive('HISTORY', 'plain')
      const before = await history()
      for (const sql of ['update public.events set payload=payload where job_id=$1', 'delete from public.events where job_id=$1']) {
        await db.exec('savepoint r11_history')
        await assert.rejects(() => rows(sql, [id]), /เพิ่มอย่างเดียว/)
        await db.exec('rollback to savepoint r11_history; release savepoint r11_history')
      }
      assert.deepEqual(await history(), before)
      await invariant()
    })
  } finally {
    await db.exec('rollback')
  }
}
