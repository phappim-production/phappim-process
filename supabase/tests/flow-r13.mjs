import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { roleMatrix } from './flow-r13-matrix.mjs'
import { queueSkips, startsJob } from './queue-skip.mjs'

const roster = {
  owner: ['owner'], admin: ['admin'], manager: ['manager'], production: ['production'], production2: ['production'],
  phase1: ['supervisor', 1], phase2: ['supervisor', 2], qc: ['qc'],
  multi: ['staff', null, 'print', 'press', 'cut'], single: ['staff', null, 'dtf_press'],
  staffQc: ['staff', null, 'qc_pack'], unassigned: ['staff'], disabled: ['staff', null, 'qc_pack'],
}
const ids = Object.fromEntries(Object.keys(roster).map(key => [key, randomUUID()]))
const reason = 'ทดสอบรอบ 13 ในเครื่อง'
const routes = {
  normal: ['print', 'press', 'cut', 'sew', 'qc_pack'],
  dtf: ['cut', 'dtf_press', 'sew', 'qc_pack'],
  dtg: ['cut', 'dtf_press', 'sew', 'qc_pack'],
  screen: ['cut', 'dtf_press', 'sew', 'qc_pack'],
  emb: ['cut', 'emb', 'sew', 'qc_pack'],
  print_emb: ['print', 'press', 'cut', 'emb', 'sew', 'qc_pack'],
  cut_only: ['cut', 'qc_pack'], plain: ['cut', 'sew', 'qc_pack'], outside: ['outside', 'qc_pack'],
}
const day = '2099-01-06'
const dates = ['2099-01-01T03:00:00Z', 2, '2099-01-03T03:00:00Z']

export async function flowR13Tests({ db, ok }) {
  const skips = queueSkips(db, 'flow-r13')
  const rows = async (sql, args) => (await db.query(sql, args)).rows
  const one = async (sql, args) => (await rows(sql, args))[0]
  const live = id => one('select * from public.job_live where id=$1', [id])
  const history = () => rows('select * from public.events order by id')
  async function transactionPoint(name, fn, alwaysRollback = false) {
    await db.exec('savepoint ' + name)
    try {
      const result = await fn()
      if (alwaysRollback) await db.exec('rollback to savepoint ' + name)
      await db.exec('release savepoint ' + name)
      return result
    } catch (error) {
      await db.exec('rollback to savepoint ' + name + '; release savepoint ' + name)
      throw error
    }
  }
  const auth = (actor, sql, args) => transactionPoint('r13_auth', async () => {
    await db.exec('set local role ' + (actor === 'anon' ? 'anon' : 'authenticated'))
    await rows("select set_config('request.jwt.claim.sub',$1,true)", [ids[actor] ?? ''])
    const result = await rows(sql, args)
    await db.exec('reset role')
    return result
  })
  const rpc = async (actor, name, args = []) =>
    (await auth(actor, 'select public.' + name + '(' + args.map((_, i) => '$' + (i + 1)).join(',') + ') as value', args))[0]?.value
  async function check(name, fn) {
    const label = name.startsWith('BUG: ') ? 'BUG: R13 ' + name.slice(5) : 'R13 ' + name
    try {
      const detail = await transactionPoint('r13_case', fn, true)
      ok(label, true, detail)
    } catch (error) {
      ok(label, false, error.message.replace(/\s+/g, ' '))
    }
  }
  async function invariant() {
    const issues = await rows(
      "select 'pool' problem from public.stations s join public.stations peer on coalesce(peer.machine_pool,peer.code)=coalesce(s.machine_pool,s.code) " +
      "join public.job_live j on j.current_station=peer.code and j.station_status='doing' " +
      "where s.machines is not null group by s.code,s.machines having count(*)>s.machines " +
      "union all select 'machine' from public.machine_assignments where released_at is null group by machine_id having count(*)>1 " +
      "union all select 'queue' from public.jobs group by queue_seq having count(*)>1 " +
      "union all select 'state' from public.job_live j where (current_station='outside' and station_status='doing') " +
      "or (select count(*) from public.outsource_runs o where o.job_id=j.id and o.closed_at is null) != case when station_status='out' then 1 else 0 end " +
      "or (station_status is not distinct from 'hold') is distinct from exists(select 1 from public.issues i where i.job_id=j.id and i.closed_at is null) " +
      "or (phase='cancelled' and (exists(select 1 from public.machine_assignments a where a.job_id=j.id and a.released_at is null) " +
      "or exists(select 1 from public.machine_bookings b where b.job_id=j.id and b.cancelled_at is null and b.ends_at>now())))")
    assert.deepEqual(issues, [])
  }
  async function step(actor, fn, args, types, id) {
    if (startsJob(fn)) await skips.insert(id, ids[actor])
    const before = await history()
    const result = await rpc(actor, fn, args)
    const after = await history()
    assert.deepEqual(after.slice(0, before.length), before, fn)
    assert.deepEqual(after.slice(before.length).map(e => e.type), types, fn)
    assert.ok(after.slice(before.length).every(e => e.by === ids[actor] && (!id || e.job_id === id)), fn)
    await invariant()
    return result
  }
  const change = (id, actor, fn, args, types) => step(actor, fn, [id, ...args], types, id)
  const intake = (label, route, sample) => ['TEST-R13-' + label, 'ลูกค้าจำลอง', 'งานจำลอง', 'tshirt', 10, 'ตัว', day, route, null, 0, 0, '{}', sample]
  const receive = (label, route, sample = false, actor = 'admin') => step(actor, 'receive_job', intake(label, route, sample), ['received', 'released'])
  async function denial(actor, fn, args, matcher) {
    const before = await history()
    await assert.rejects(() => rpc(actor, fn, args), error => {
      assert.match(error.message, matcher)
      assert.ok(!['40001', '40P01'].includes(error.code))
      return true
    })
    assert.deepEqual(await history(), before)
    await invariant()
  }

  await db.exec('begin')
  try {
    await db.exec(
      'alter table public.events disable trigger events_append_only; delete from public.jobs; ' +
      'alter table public.events enable trigger events_append_only; ' +
      'update public.stations set machines=null; ' +
      "update public.stations set machines=case code when 'press' then 1 else 2 end where code in ('press','print','cut','dtf_press'); " +
      "update public.machine_types set shared=code in ('cover','button','buttonhole','ovl4'); " +
      "delete from public.product_machine_needs where product_type_code='tshirt' and type_code='flat'; " +
      "insert into public.sewing_machines(code,type_code) select prefix||'-913',code from public.machine_types " +
      "where code in ('single','ovl4','cover') on conflict do nothing")
    for (const [actor, [role, section, ...stations]] of Object.entries(roster)) {
      await rows('insert into auth.users(id,email) values($1,$2)', [ids[actor], actor + '@r13.invalid'])
      await rows('insert into public.profiles(user_id,name,role,section,active) values($1,$2,$3,$4,$5)',
        [ids[actor], actor, role, section ?? null, actor !== 'disabled'])
      for (const station of stations) await rows('insert into public.staff_stations(user_id,station_code) values($1,$2)', [ids[actor], station])
    }
    const vendor = await rpc('admin', 'add_vendor', ['โรงงานนอกจำลอง C15', ['outside', 'cut', 'emb']])
    const actors = { print: 'multi', press: 'multi', cut: 'multi', dtf_press: 'single', emb: 'production2', sew: 'production', qc_pack: 'staffQc' }
    async function walk(id, stations, phase) {
      for (const station of stations) {
        const current = await live(id)
        assert.deepEqual([current.phase, current.current_station, current.station_status], [phase, station, 'queued'])
        if (station === 'outside') {
          const run = await change(id, 'admin', 'send_out', [vendor, station, ...dates], ['outsource_sent'])
          await step('admin', 'receive_back', [run], ['outsource_received'], id)
          continue
        }
        const actor = actors[station]
        if (station === 'sew') {
          await change(id, actor, 'start_sewing', [], ['machines_assigned', 'station_start'])
          await change(id, actor, 'finish_sewing', [], ['station_done'])
          continue
        }
        await change(id, actor, 'start_station', [], ['station_start'])
        if (station === 'qc_pack' && phase === 'production') await change(id, actor, 'record_qc', [current.qty], ['qc_result'])
        const types = station === 'qc_pack' ? ['station_done', phase === 'sample' ? 'sample_sent' : 'done'] : ['station_done']
        await change(id, actor, 'finish_station', [station], types)
      }
    }
    for (const [route, stations] of Object.entries(routes)) {
      for (const sample of ['none', 'pass', 'retry']) {
        await check('A1 ' + route + ' ' + sample, async () => {
          const id = await receive(route + '-' + sample, route, sample !== 'none', sample === 'pass' ? 'owner' : 'admin')
          if (stations.includes('dtf_press')) {
            await change(id, 'admin', 'order_film', [day], ['film_ordered'])
            await change(id, 'admin', 'receive_film', [], ['film_received'])
          }
          if (sample === 'retry') {
            await walk(id, stations, 'sample')
            await change(id, 'admin', 'record_sample_result', [false, reason], ['sample_result'])
            assert.equal((await live(id)).sample_round, 2)
          }
          if (sample !== 'none') {
            await walk(id, stations, 'sample')
            assert.equal((await live(id)).phase, 'sample_review')
            await change(id, 'admin', 'record_sample_result', [true, null], ['sample_result'])
          }
          await walk(id, stations, 'production')
          assert.equal((await live(id)).phase, 'done')
          await change(id, 'admin', 'mark_delivered', [reason], ['delivered'])
          assert.equal((await live(id)).delivered_by, ids.admin)
        })
      }
    }

    await roleMatrix({ check, rows, rpc, skipQueue: (actor, id) => skips.insert(id, ids[actor]), point: transactionPoint, receive, intake, walk, roster, vendor, dates, reason })

    await check('A4/A5 แบ่งซ้ำ ใบลูกของใบลูก และยกเลิกเฉพาะใบลูก', async () => {
      const id = await receive('SPLIT', 'outside')
      const request = randomUUID()
      const child = await step('admin', 'split_job', [id, 6, request], ['job_split', 'job_split_from'])
      assert.equal(await step('admin', 'split_job', [id, 6, request], []), child)
      const third = await step('admin', 'split_job', [child, 2, randomUUID()], ['job_split', 'job_split_from'])
      assert.equal((await live(third)).confirmation_no, 'TEST-R13-SPLIT-2-2')
      await change(third, 'manager', 'cancel_job', [reason], ['job_cancelled'])
      assert.deepEqual((await Promise.all([id, child, third].map(live))).map(job => [job.qty, job.phase]),
        [[4, 'production'], [4, 'production'], [2, 'cancelled']])
    })

    await check('A4/A5 เริ่มซ้ำและแข่งยกเลิก/เสร็จทั้งสองลำดับ', async () => {
      const a = await receive('CANCEL-FIRST', 'cut_only')
      const b = await receive('FINISH-FIRST', 'cut_only')
      await change(a, 'multi', 'start_station', [], ['station_start'])
      await denial('production2', 'start_station', [a], /เริ่มไปแล้ว/)
      await change(a, 'manager', 'cancel_job', [reason], ['job_cancelled'])
      await denial('production2', 'finish_station', [a, 'cut'], /สถานะ|ไม่ได้/)
      await change(b, 'production', 'start_station', [], ['station_start'])
      await change(b, 'production', 'finish_station', ['cut'], ['station_done'])
      await change(b, 'staffQc', 'start_station', [], ['station_start'])
      const request = randomUUID()
      await change(b, 'staffQc', 'record_qc', [10, request], ['qc_result'])
      await change(b, 'staffQc', 'record_qc', [10, request], [])
      await change(b, 'staffQc', 'finish_station', ['qc_pack'], ['station_done', 'done'])
      await denial('manager', 'cancel_job', [b, reason], /ผลิตเสร็จแล้ว/)
      assert.equal((await live(b)).qc_passed, 10)
    })

    await check('A4/A6 แทรกคิวตอนเครื่องเต็มและกลับคิวเมื่อปิดปัญหา', async () => {
      const a = await receive('PRESS-A', 'normal')
      const b = await receive('PRESS-B', 'normal')
      const c = await receive('PRESS-C', 'normal')
      for (const id of [a, b, c]) {
        await change(id, 'production', 'start_station', [], ['station_start'])
        await change(id, 'production', 'finish_station', ['print'], ['station_done'])
      }
      await change(a, 'production', 'start_station', [], ['station_start'])
      await change(c, 'manager', 'move_job_ahead', [b, reason], ['queue_insert'])
      await denial('production2', 'start_in_queue', [c, reason], /เต็ม/)
      await change(a, 'production', 'open_issue', [reason], ['hold'])
      await change(c, 'production2', 'start_station', [], ['station_start'])
      await change(a, 'production', 'close_issue', [], ['resume'])
      assert.equal((await live(a)).station_status, 'queued')
      assert.equal((await live(c)).station_status, 'doing')
      const event = (await history()).at(-1)
      assert.equal(event.payload.requeued, true)
    })

    await check('A4/A7 ฟิล์มยังไม่มาและ SLA เกินต้องส่งรายงาน', async () => {
      const film = await receive('FILM-SLA', 'dtf')
      await change(film, 'production', 'start_station', [], ['station_start'])
      await change(film, 'production', 'finish_station', ['cut'], ['station_done'])
      await denial('single', 'start_in_queue', [film, null], /ยังไม่ได้รับ/)
      await change(film, 'admin', 'order_film', ['2099-01-04'], ['film_ordered'])
      await change(film, 'admin', 'receive_film', [], ['film_received'])
      await change(film, 'single', 'start_station', [], ['station_start'])

      const cut = await receive('SLA', 'cut_only')
      await change(cut, 'production', 'start_station', [], ['station_start'])
      await rows("update public.jobs set station_started_at=now()-interval '20 days',stage_entered_at=now()-interval '20 days' where id=$1", [cut])
      await denial('production', 'finish_station', [cut, 'cut'], /รายงาน/)
      const { code } = await one('select code from public.reason_codes where active order by code limit 1')
      const request = randomUUID()
      const args = [[code], reason, '2099-01-05T03:00:00Z', null, request]
      const first = await change(cut, 'production', 'submit_delay_report', args, ['delay_report'])
      assert.equal(await change(cut, 'production2', 'submit_delay_report', args, []), first)
      await change(cut, 'production', 'finish_station', ['cut'], ['station_done'])
    })

    async function pendingMockup(id, label) {
      const file = 'TEST-R13-' + label + '/sheet/cafe.png'
      await rows("insert into private.file_settings(record_secret) values(repeat('r',32)) on conflict do nothing")
      await rows("insert into private.file_objects(kind,path,size,content_type) values('mockups',$1,40,'image/png')", [file])
      const sheet = await step('admin', 'start_mockup_sheet', [id], [])
      const payload = {
        views: [{ view: 'front', image_path: file, width: 800, height: 600 }], specs: [],
        callouts: [{ view: 'front', no: 1, x: .4, y: .4, box_x: .7, box_y: .5,
          title: 'คำกำกับเดิม', body: 'สีเขียว', stations: [] }],
      }
      const saved = await step('admin', 'save_mockup_draft', [sheet, 1, payload], [])
      await denial('owner', 'save_mockup_draft', [sheet, 1, payload], /โหลดใหม่|ฉบับล่าสุด/)
      const pending = await step('admin', 'submit_mockup_sheet', [sheet, saved], [])
      assert.equal((await one('select status from public.mockup_sheets where id=$1', [sheet])).status, 'pending')
      return { sheet, payload, pending }
    }

    await check('A4/A5 งานยกเลิกคงประวัติม็อคอัพรออนุมัติและอนุมัติไม่ได้', async () => {
      const label = 'CANCEL-PENDING'
      const id = await receive(label, 'plain')
      const { sheet, pending } = await pendingMockup(id, label)
      await change(id, 'manager', 'cancel_job', [reason], ['job_cancelled'])
      await denial('admin', 'approve_mockup_sheet', [sheet, null, pending], /ยกเลิกแล้ว/)
      assert.equal((await live(id)).phase, 'cancelled')
      assert.equal((await one('select status from public.mockup_sheets where id=$1', [sheet])).status, 'pending')
    })

    await check('A5 คำขออนุมัติเวอร์ชันเก่าต้องไม่อนุมัติข้อมูลที่เพิ่งส่งกลับมาใหม่', async () => {
      const label = 'STALE-APPROVAL'
      const id = await receive(label, 'plain')
      const { sheet, payload, pending } = await pendingMockup(id, label)
      await step('manager', 'return_mockup_sheet', [sheet, reason], [])
      const returned = (await one('select version from public.mockup_sheets where id=$1', [sheet])).version
      payload.callouts[0].body = 'สีแดง'
      const edited = await step('admin', 'save_mockup_draft', [sheet, returned, payload], [])
      const newer = await step('admin', 'submit_mockup_sheet', [sheet, edited], [])
      assert.ok(newer > pending)
      let rejection
      try { await rpc('manager', 'approve_mockup_sheet', [sheet, null, pending]) }
      catch (error) { rejection = error }
      const result = await one('select status,version from public.mockup_sheets where id=$1', [sheet])
      const snapshot = await one("select data->'callouts'->0->>'body' as body from public.mockup_snapshots where sheet_id=$1", [sheet])
      assert.equal(result.status, 'pending', 'คำขอรุ่น ' + pending + ' เปลี่ยนรุ่น ' + newer + ' เป็น ' + result.status + ' พร้อมคำกำกับ ' + snapshot?.body)
      assert.match(rejection?.message ?? '', /โหลดใหม่|ฉบับล่าสุด/)
      assert.equal(snapshot, undefined)
    })

    await check('A8 R2 อ่านเฉพาะไฟล์อ้างอิงและปฏิเสธไฟล์ที่ยังไม่เคยอัปโหลด', async () => {
      await rows("insert into private.file_settings(record_secret) values(repeat('r',32)) on conflict do nothing")
      const id = await receive('FILE', 'outside')
      const path = 'TEST-R13-FILE/cafe.pdf'
      const unrelated = 'TEST-R13-UNRELATED/beef.pdf'
      const photo = 'TEST-R13-FILE/cafe.png'
      await denial('admin', 'attach_confirmation_pdf', [id, path], /ไม่พบไฟล์.*แนบไฟล์/)
      for (const [kind, file, type] of [['confirmations', path, 'application/pdf'], ['mockups', photo, 'image/png']]) {
        await rows('insert into private.file_objects(kind,path,size,content_type) values($1,$2,10,$3)', [kind, file, type])
      }
      await change(id, 'admin', 'attach_confirmation_pdf', [path], ['confirmation_pdf'])
      await change(id, 'admin', 'set_job_mockup', [photo], ['mockup'])
      for (const actor of ['owner', 'admin', 'staffQc']) {
        assert.deepEqual(await rpc(actor, 'file_read_allowed', ['confirmations', [path, unrelated]]), [path])
        assert.deepEqual(await rpc(actor, 'file_read_allowed', ['mockups', [photo]]), [photo])
        await assert.rejects(() => auth(actor, 'select count(*) from private.file_objects'), { code: '42501' })
      }
      await denial('disabled', 'file_read_allowed', ['confirmations', [path]], /บัญชี|เข้าสู่ระบบ/)
      await denial('admin', 'record_file_upload', ['confirmations', unrelated, 10, 'application/pdf', 'fixture'], /ยืนยันไฟล์|อัปโหลด/)
    })

    const protectedJob = await receive('SECURITY', 'outside')
    await change(protectedJob, 'admin', 'send_out', [vendor, 'outside', ...dates], ['outsource_sent'])
    const relations = await rows("select relname name from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v','m') order by relname")
    assert.ok(relations.every(({ name }) => /^[a-z_]+$/.test(name)))
    for (const actor of ['anon', 'disabled']) {
      for (const { name } of relations) {
        const test = ''
        await check(test + 'B1/B2 ' + actor + ' อ่านขอบเขต ' + name, async () => {
          let result
          try {
            result = await auth(actor, 'select count(*)::int n from public.' + name)
          } catch (error) {
            assert.equal(error.code, '42501')
            return
          }
          assert.equal(result[0].n, actor === 'disabled' && name === 'profiles' ? 1 : 0)
        })
      }
    }

    await check('A3/B3 เหตุการณ์และตารางงานแก้ตรงไม่ได้ทุกบทบาท', async () => {
      const id = await receive('GUARD', 'outside')
      for (const actor of Object.keys(roster)) {
        for (const sql of [
          'update public.jobs set qty=999 where id=$1 returning id',
          'delete from public.jobs where id=$1 returning id',
          'update public.events set payload=payload where job_id=$1 returning id',
          'delete from public.events where job_id=$1 returning id',
        ]) {
          try { assert.deepEqual(await auth(actor, sql, [id]), []) }
          catch (error) { assert.equal(error.code, '42501') }
        }
        assert.equal((await live(id)).qty, 10)
      }
      for (const actor of ['admin', 'qc', 'multi']) {
        for (const [sql, args] of [
          ["update public.profiles set role='owner' where user_id=$1 returning user_id", [ids[actor]]],
          ["insert into public.staff_stations (user_id,station_code) values($1,'outside')", [ids[actor]]],
          ["update public.stations set name='ชื่อจำลอง' where code='outside' returning code", []],
          ['update public.vendors set name=$2 where id=$1 returning id', [vendor, reason]],
          ['select private.lock_job($1)', [id]],
        ]) {
          try { assert.deepEqual(await auth(actor, sql, args), []) }
          catch (error) { assert.equal(error.code, '42501') }
        }
        assert.equal((await one('select role from public.profiles where user_id=$1', [ids[actor]])).role, roster[actor][0])
      }
    })

    await check('A7 ตัดวันอาทิตย์และเปลี่ยนวันตอนเที่ยงคืนไทย', async () => {
      for (const zone of ['UTC', 'America/Los_Angeles']) {
        await rows("select set_config('TimeZone',$1,true)", [zone])
        const times = await one("select " +
          "private.work_days('2026-11-21 23:30+07','2026-11-23 00:30+07')::double precision work," +
          "private.work_days('2026-11-22 00:00+07','2026-11-23 00:00+07')::double precision sunday")
        assert.ok(Math.abs(times.work - 1 / 24) < 1e-10)
        assert.equal(times.sunday, 0)
      }
    })

    await check('A9 live-check ตรวจ 106 ข้อและย้อนกลับ', async () => {
      const raw = await readFile(new URL('../scripts/live-check.sql', import.meta.url), 'utf8')
      const keys = { adm: 'admin', mgr: 'manager', prd: 'production', qcu: 'qc' }
      const script = raw.replace(/(adm|mgr|prd|qcu) uuid := '[0-9a-f-]+'/g,
        (_, key) => key + " uuid := '" + ids[keys[key]] + "'")
      for (const actor of Object.values(keys)) assert.ok(script.includes(ids[actor]))
      await rows('insert into private.file_settings(record_secret) values ($1) on conflict do nothing', [randomUUID()])
      const before = await history()
      const jobs = await rows('select * from public.jobs order by id')
      await assert.rejects(() => transactionPoint('r13_live', () => db.exec(script)), error => {
        assert.ok(error.message.startsWith('RESULTS'), error.message)
        const result = JSON.parse(error.message.slice('RESULTS'.length))
        assert.equal(result.length, 106)
        assert.deepEqual(result.filter(row => !row.ok), [])
        return true
      })
      assert.deepEqual(await history(), before)
      assert.deepEqual(await rows('select * from public.jobs order by id'), jobs)
    })

    await check('A9 cleanup ครบสถานะ เก็บงานและไฟล์ที่อ้างถึง ล้างซ้ำได้', async () => {
      const states = ['materials', 'queued', 'doing', 'hold', 'out', 'sample', 'sample_review', 'done', 'cancelled']
      for (const state of states) {
        const id = await receive('CLEAN-' + state, 'cut_only', ['sample', 'sample_review'].includes(state))
        if (state === 'doing') await change(id, 'production', 'start_station', [], ['station_start'])
        if (state === 'hold') await change(id, 'admin', 'open_issue', [reason], ['hold'])
        if (state === 'out') await change(id, 'admin', 'send_out', [vendor, 'cut', ...dates], ['outsource_sent'])
        if (state === 'sample_review') await walk(id, ['cut', 'qc_pack'], 'sample')
        if (state === 'done') await walk(id, ['cut', 'qc_pack'], 'production')
        if (state === 'cancelled') await change(id, 'manager', 'cancel_job', [reason], ['job_cancelled'])
        if (state === 'materials') await rows("update public.jobs set phase='materials',station_seq=null,station_status=null where id=$1", [id])
      }
      const keep = await receive('CLEAN-KEEP', 'outside')
      await rows("update public.jobs set confirmation_no='SYNTHETIC-C15-KEEP',confirmation_pdf_path='SYNTHETIC-C15-KEEP/cafe.pdf' where id=$1", [keep])
      await db.exec("insert into private.file_objects (kind,path,size,content_type,uploaded_at) values " +
        "('confirmations','SYNTHETIC-C15-KEEP/cafe.pdf',10,'application/pdf',now()-interval '2 hours')," +
        "('confirmations','TEST-R13-ORPHAN/cafe.pdf',10,'application/pdf',now()-interval '2 hours')")
      const raw = await readFile(new URL('../scripts/golive-cleanup.sql', import.meta.url), 'utf8')
      const script = raw.replace(/^(begin|commit);\r?$/gm, '')
      const before = await rows('select * from public.events where job_id=$1 order by id', [keep])
      for (const count of [10, 0]) {
        const result = (await db.exec(script)).at(-1).rows
        assert.equal(result.find(row => row.รายการ.startsWith('ลบงานทดสอบ TEST-')).ผล, String(count))
        assert.equal(result.find(row => row.รายการ.startsWith('trigger')).ผล, 'เปิดอยู่ (ถูกต้อง)')
        assert.deepEqual(await rows('select id from public.jobs'), [{ id: keep }])
        assert.deepEqual(await rows('select * from public.events order by id'), before)
        assert.deepEqual(await rows("select path from private.file_objects where path in ('SYNTHETIC-C15-KEEP/cafe.pdf','TEST-R13-ORPHAN/cafe.pdf')"),
          [{ path: 'SYNTHETIC-C15-KEEP/cafe.pdf' }])
      }
    })
  } finally {
    await db.exec('rollback')
  }
  skips.report()
}
