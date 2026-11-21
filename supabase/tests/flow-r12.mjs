import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const roster = {
  admin: ['admin'], production: ['production'], manager: ['manager'], owner: ['owner'],
  qc: ['staff', 'qc_pack'], outside: ['staff', 'outside'], multi: ['staff', 'print', 'press', 'cut'],
  phase1: ['supervisor'], phase2: ['supervisor'], legacyQc: ['qc'],
}
const actors = Object.fromEntries(Object.keys(roster).map(name => [name, randomUUID()]))
const plan = ['2099-01-02T03:00:00Z', 7, '2099-01-09T03:00:00Z']
const later = ['2099-01-02T03:00:00Z', 9, '2099-01-11T03:00:00Z']
const reason = 'ข้อมูลจำลองรอบ 12'
const blocked = /ผลิตข้างนอกทั้งหมด|บทบาท|ทำขั้นนี้ไม่ได้|เฉพาะสถานี|ไม่ได้อยู่|ไม่มีสิทธิ์|คิว|ฝ่ายผลิต|เย็บ|ผู้ควบคุมงานเฟส/
const script = name => readFileSync(new URL('../scripts/' + name + '.sql', import.meta.url), 'utf8')

export async function flowR12Tests({ db, ok }) {
  const rows = async (sql, args) => (await db.query(sql, args)).rows
  const one = async (sql, args) => (await rows(sql, args))[0]
  const live = id => one('select * from public.job_live where id=$1', [id])
  const history = () => rows('select * from public.events order by id')
  const runs = id => rows('select * from public.outsource_runs where job_id=$1 order by id', [id])

  async function isolated(name, fn) {
    await db.exec('savepoint ' + name)
    try {
      const result = await fn()
      await db.exec('release savepoint ' + name)
      return result
    } catch (error) {
      await db.exec('rollback to savepoint ' + name + '; release savepoint ' + name)
      throw error
    }
  }

  const rpc = (actor, name, args = []) => isolated('r12_rpc', async () => {
    await db.exec('set local role authenticated')
    await rows("select set_config('request.jwt.claim.sub',$1,true)", [actors[actor]])
    const params = args.map((_, i) => '$' + (i + 1)).join(',')
    const result = await one('select public.' + name + '(' + params + ') as value', args)
    await db.exec('reset role')
    return result.value
  })
  const invariant = async () => assert.deepEqual(await rows(
    "select id from public.job_live j where (current_station='outside' and station_status='doing') " +
    "or (select count(*) from public.outsource_runs o where o.job_id=j.id and o.closed_at is null) " +
    "!= case when station_status='out' then 1 else 0 end"), [])

  async function action(actor, name, args, events, jobId) {
    const before = await history()
    const result = await rpc(actor, name, args)
    const after = await history()
    assert.deepEqual(after.slice(0, before.length), before, name)
    const added = after.slice(before.length)
    assert.deepEqual(added.map(event => event.type), events, name)
    assert.ok(added.every(event => event.by === actors[actor]), name)
    if (jobId) assert.ok(added.every(event => event.job_id === jobId), name)
    await invariant()
    return result
  }

  async function deny(actor, name, args, error) {
    const before = await history()
    const jobs = await rows('select * from public.job_live order by id')
    const out = await rows('select * from public.outsource_runs order by id')
    await assert.rejects(() => rpc(actor, name, args), error, actor + ' ' + name)
    assert.deepEqual(await history(), before, name)
    assert.deepEqual(await rows('select * from public.job_live order by id'), jobs, name)
    assert.deepEqual(await rows('select * from public.outsource_runs order by id'), out, name)
    await invariant()
  }

  const change = (id, actor, name, args, events) => action(actor, name, [id, ...args], events, id)
  const receive = (label, route = 'outside', sample = false) =>
    action('admin', 'receive_job', ['TEST-R12-' + label, 'ลูกค้าจำลอง', 'งานจำลอง', 'tshirt',
      10, 'ตัว', '2099-01-15', route, null, 0, 0, '{}', sample], ['received', 'released'])
  const state = async (id, phase, station = null, status = null) => {
    const job = await live(id)
    assert.deepEqual([job.phase, job.current_station, job.station_status], [phase, station, status])
    await invariant()
    return job
  }
  const back = (id, run) => action('admin', 'receive_back', [run, reason], ['outsource_received'], id)
  const send = (id, vendor, last = 'outside', dates = plan) =>
    change(id, 'admin', 'send_out', [vendor, last, ...dates], ['outsource_sent'])
  const start = (id, actor = 'qc') => change(id, actor, 'start_station', [], ['station_start'])
  const passQc = (id, qty) => change(id, 'qc', 'record_qc', [qty], ['qc_result'])
  const finishQc = (id, sample = false) =>
    change(id, 'qc', 'finish_station', ['qc_pack'], ['station_done', sample ? 'sample_sent' : 'done'])
  const deliver = (id, note = reason) => change(id, 'admin', 'mark_delivered', [note], ['delivered'])

  async function check(name, fn) {
    await db.exec('savepoint r12_case')
    try {
      const detail = await fn()
      ok('R12 ' + name, true, detail)
    } catch (error) {
      ok('R12 ' + name, false, error.message)
    } finally {
      await db.exec('rollback to savepoint r12_case; release savepoint r12_case')
    }
  }

  await db.exec('begin')
  try {
    await db.exec('alter table public.events disable trigger events_append_only; delete from public.jobs; alter table public.events enable trigger events_append_only')
    for (const [name, [role, ...stations]] of Object.entries(roster)) {
      await rows('insert into auth.users(id,email) values ($1,$2)', [actors[name], name + '@r12.invalid'])
      await rows('insert into public.profiles(user_id,name,role,active,section) values ($1,$2,$3,true,$4)',
        [actors[name], name, role, name === 'phase1' ? 1 : name === 'phase2' ? 2 : null])
      for (const station of stations) {
        await rows('insert into public.staff_stations(user_id,station_code) values ($1,$2)', [actors[name], station])
      }
    }
    const sla = async id => isolated('r12_sla', async () => {
      await db.exec('set local role authenticated')
      await rows("select set_config('request.jwt.claim.sub',$1,true)", [actors.owner])
      const flags = await rows('select * from public.job_sla_flags() where job_id=$1', [id])
      await db.exec('reset role')
      return flags
    })
    const vendor = await action('admin', 'add_vendor', ['บริษัทจำลองรอบ 12 A', ['outside', 'print', 'press', 'cut', 'sew', 'emb']], [])
    const other = await action('admin', 'add_vendor', ['บริษัทจำลองรอบ 12 B', ['outside']], [])

    await check('A1 รับงาน ส่งออก รับกลับ QC และจัดส่ง', async () => {
      const id = await receive('FULL')
      await state(id, 'production', 'outside', 'queued')
      assert.deepEqual(await sla(id), [])
      const run = await send(id, vendor)
      await state(id, 'production', 'outside', 'out')
      assert.deepEqual(await sla(id), [])
      const [round] = await runs(id)
      assert.deepEqual([round.id, round.vendor_id, round.stations, round.qty, round.closed_at], [run, vendor, ['outside'], 10, null])
      await back(id, run)
      assert.equal((await runs(id))[0].closed_how, 'received')
      await state(id, 'production', 'qc_pack', 'queued')
      assert.deepEqual(await sla(id), [])
      await start(id)
      await state(id, 'production', 'qc_pack', 'doing')
      assert.deepEqual(await sla(id), [{ job_id: id, warn: false, over: false, need_report: false }])
      await passQc(id, 10)
      assert.equal((await state(id, 'production', 'qc_pack', 'doing')).qc_passed, 10)
      assert.equal((await sla(id)).length, 1)
      await finishQc(id)
      assert.equal((await state(id, 'done')).delivered_at, null)
      assert.deepEqual(await sla(id), [])
      const visits = await rows('select station_code,started_at,done_at from public.station_visits where job_id=$1', [id])
      assert.deepEqual(visits.map(visit => visit.station_code), ['qc_pack'])
      assert.ok(visits[0].started_at && visits[0].done_at >= visits[0].started_at)
      await deliver(id)
      assert.ok((await state(id, 'done')).delivered_at)
      assert.deepEqual(await sla(id), [])
    })

    for (const actor of Object.keys(roster)) {
      await check('A2 ไม่มีทางเริ่มที่ outside สำหรับ ' + actor, async () => {
        const first = await receive('GUARD-FIRST')
        const second = await receive('GUARD-NEXT')
        for (const [fn, args] of [
          ['start_station', [first]], ['start_in_queue', [first, null]],
          ['start_in_queue', [second, null]], ['start_in_queue', [second, reason]],
          ['start_sewing', [first]], ['resume_sewing', [first]],
        ]) await deny(actor, fn, args, blocked)
        await change(first, 'admin', 'open_issue', [reason], ['hold'])
        const canClose = ['production', 'manager', 'owner', 'phase1'].includes(actor)
        if (canClose) await change(first, actor, 'close_issue', [null], ['resume'])
        else await deny(actor, 'close_issue', [first, null], blocked)
        await state(first, 'production', 'outside', canClose ? 'queued' : 'hold')
        assert.deepEqual((await history()).filter(event => event.type === 'station_start'), [])
      })
    }

    await check('A2 ปิดปัญหาที่บันทึกสถานะเดิมเป็น doing ถูก trigger กัน', async () => {
      const id = await receive('GUARD-HOLD')
      await change(id, 'admin', 'open_issue', [reason], ['hold'])
      await rows("update public.issues set prev_status='doing' where job_id=$1", [id])
      for (const actor of ['production', 'manager', 'owner', 'phase1']) {
        await deny(actor, 'close_issue', [id, null], /ผลิตข้างนอกทั้งหมด/)
        assert.equal((await one('select closed_at from public.issues where job_id=$1', [id])).closed_at, null)
      }
      await state(id, 'production', 'outside', 'hold')
    })

    await check('A3 ขอบเขตบริษัทและรอบส่งออก', async () => {
      const id = await receive('BOUNDARY')
      const inactive = await action('admin', 'add_vendor', ['บริษัทปิดจำลอง', ['outside']], [])
      await rows('update public.vendors set active=false where id=$1', [inactive])
      assert.deepEqual((await one('select stations from public.vendors where id=$1', [vendor])).stations[0], 'outside')
      await deny('admin', 'send_out', [id, inactive, 'outside', ...plan], /ไม่พบบริษัท/)
      await deny('admin', 'send_out', [id, vendor, 'qc_pack', ...plan], /โรงงานเท่านั้น/)
      for (const actor of ['production', 'manager', 'qc', 'outside', 'multi']) {
        await deny(actor, 'send_out', [id, vendor, 'outside', ...plan], blocked)
      }
      await change(id, 'admin', 'open_issue', [reason], ['hold'])
      await deny('admin', 'send_out', [id, vendor, 'outside', ...plan], /พักงาน/)
      await change(id, 'production', 'close_issue', [null], ['resume'])
      const run = await send(id, vendor)
      await deny('admin', 'send_out', [id, vendor, 'outside', ...plan], /บริษัทภายนอกแล้ว/)
      await deny('admin', 'forward_out', [run, other, 'qc_pack', ...plan], /โรงงานเท่านั้น/)
      await deny('admin', 'update_out_plan', [run, plan[2], 7, plan[0]], /ก่อน/)
      await action('admin', 'update_out_plan', [run, ...later], ['outsource_plan'], id)
      const [updated] = await runs(id)
      assert.equal(updated.back_at.toISOString(), new Date(later[2]).toISOString())
      assert.equal(Number(updated.lead_days), 9)
      await back(id, run)
      await deny('admin', 'receive_back', [run], /ปิดไปแล้ว/)
      await deny('admin', 'send_out', [id, vendor, 'qc_pack', ...plan], /โรงงานเท่านั้น/)
    })

    for (const accepted of [0, 6]) {
      await check('A4 ส่งแก้ ' + (10 - accepted) + '/10 ชิ้น', async () => {
        const id = await receive('REWORK')
        await back(id, await send(id, vendor))
        await start(id)
        if (accepted) await passQc(id, accepted)
        const rejected = 10 - accepted
        await deny('qc', 'send_rework', [id, 1, reason, 'cut'], /อยู่ก่อน QC/)
        await deny('qc', 'send_rework', [id, rejected + 1, reason, 'outside'], /ไม่เกิน/)
        await change(id, 'qc', 'send_rework', [rejected, reason, 'outside'], ['rework'])
        assert.equal((await state(id, 'production', 'outside', 'queued')).is_rework, true)
        const run = await send(id, other)
        assert.deepEqual((await runs(id)).map(row => [row.qty, row.is_rework]), [[10, false], [rejected, true]])
        await back(id, run)
        assert.equal((await state(id, 'production', 'qc_pack', 'queued')).qc_passed, accepted)
        await start(id)
        await deny('qc', 'record_qc', [id, rejected + 1], /ไม่เกิน/)
        await passQc(id, rejected)
        await finishQc(id)
        assert.equal((await state(id, 'done')).qc_passed, 10)
      })
    }

    await check('A5 ตัวอย่างรอบ 1 ไม่ผ่าน รอบ 2 ผ่าน', async () => {
      const id = await receive('SAMPLE', 'outside', true)
      for (const round of [1, 2]) {
        assert.equal((await state(id, 'sample', 'outside', 'queued')).sample_round, round)
        const run = await send(id, vendor)
        await state(id, 'sample', 'outside', 'out')
        await back(id, run)
        await state(id, 'sample', 'qc_pack', 'queued')
        await start(id)
        await finishQc(id, true)
        assert.equal((await live(id)).phase, 'sample_review')
        await change(id, 'admin', 'record_sample_result', [round === 2, reason], ['sample_result'])
      }
      await state(id, 'production', 'outside', 'queued')
    })

    await check('A6 แบ่งงาน ส่งสองบริษัท นัดกลับคนละวัน รับกลับและจัดส่งแยก', async () => {
      const parent = await receive('SPLIT')
      const child = await action('admin', 'split_job', [parent, 4], ['job_split', 'job_split_from'])
      const p = await state(parent, 'production', 'outside', 'queued')
      const c = await state(child, 'production', 'outside', 'queued')
      assert.deepEqual([p.qty, c.qty, c.confirmation_no], [6, 4, p.confirmation_no + '-2'])
      const pRun = await send(parent, vendor)
      const cRun = await send(child, other, 'outside', later)
      const [pRound] = await runs(parent)
      const [cRound] = await runs(child)
      assert.deepEqual([pRound.vendor_id, cRound.vendor_id], [vendor, other])
      assert.notEqual(pRound.back_at.toISOString(), cRound.back_at.toISOString())
      await back(parent, pRun)
      await state(child, 'production', 'outside', 'out')
      await start(parent)
      await passQc(parent, 6)
      await finishQc(parent)
      await deliver(parent, 'TEST-R12-PARENT')
      await back(child, cRun)
      await start(child)
      await passQc(child, 4)
      await finishQc(child)
      await deliver(child, 'TEST-R12-CHILD')
      assert.equal((await live(parent)).delivery_note, 'TEST-R12-PARENT')
      assert.equal((await live(child)).delivery_note, 'TEST-R12-CHILD')
    })

    await check('A7 ยกเลิกก่อนส่งได้ ระหว่างอยู่ข้างนอกต้องรับกลับ', async () => {
      const queued = await receive('CANCEL-WAIT')
      await change(queued, 'manager', 'cancel_job', [reason], ['job_cancelled'])
      await state(queued, 'cancelled')
      await deny('admin', 'send_out', [queued, vendor, 'outside', ...plan], /สถานะงานเปลี่ยน|ไม่ได้อยู่ในสถานี/)
      const out = await receive('CANCEL-OUT')
      const run = await send(out, vendor)
      await deny('manager', 'cancel_job', [out, reason], /รับของกลับ/)
      await back(out, run)
      await change(out, 'manager', 'cancel_job', [reason], ['job_cancelled'])
      await state(out, 'cancelled')
    })

    await check('A8 ส่งข้ามคิวได้ คิว QC ยึดลำดับรับงานและแทรกได้', async () => {
      const a = await receive('QUEUE-A')
      const b = await receive('QUEUE-B')
      const c = await receive('QUEUE-C')
      const queue = async station => (await rows(
        "select id from public.job_live where current_station=$1 and station_status='queued' order by queue_seq", [station])).map(row => row.id)
      assert.deepEqual(await queue('outside'), [a, b, c])
      for (const id of [b, c, a]) await back(id, await send(id, vendor))
      assert.deepEqual(await queue('qc_pack'), [a, b, c])
      await deny('qc', 'start_in_queue', [b, null], /คิวแรก/)
      await change(c, 'manager', 'move_job_ahead', [a, reason], ['queue_insert'])
      assert.deepEqual(await queue('qc_pack'), [c, a, b])
      await change(c, 'qc', 'start_in_queue', [null], ['station_start'])
      await state(c, 'production', 'qc_pack', 'doing')
    })

    const oldRoutes = {
      normal: ['print', 'press', 'cut', 'sew'], dtf: ['cut', 'dtf_press', 'sew'],
      dtg: ['cut', 'dtf_press', 'sew'], screen: ['cut', 'dtf_press', 'sew'],
      emb: ['cut', 'emb', 'sew'], print_emb: ['print', 'press', 'cut', 'emb', 'sew'],
      cut_only: ['cut'], plain: ['cut', 'sew'],
    }
    for (const [route, stations] of Object.entries(oldRoutes)) {
      await check('A9 เส้นทางเดิม ' + route + ' เริ่ม เสร็จ และส่งออกได้', async () => {
        const shipped = await receive('OLD-OUT', route)
        const span = route === 'plain' ? ['cut', 'sew'] : [stations[0]]
        const run = await send(shipped, vendor, span.at(-1))
        assert.deepEqual((await runs(shipped))[0].stations, span)
        await back(shipped, run)
        await state(shipped, 'production', stations[span.length] ?? 'qc_pack', 'queued')

        const id = await receive('OLD-IN', route)
        for (const station of stations) {
          await state(id, 'production', station, 'queued')
          if (station === 'dtf_press') {
            await change(id, 'admin', 'order_film', ['2099-01-04'], ['film_ordered'])
            await change(id, 'admin', 'receive_film', [], ['film_received'])
          }
          if (station === 'sew') {
            await change(id, 'production', 'start_sewing', [], ['machines_assigned', 'station_start'])
            await change(id, 'production', 'finish_sewing', [], ['station_done'])
          } else {
            await start(id, ['print', 'press', 'cut'].includes(station) ? 'multi' : 'production')
            await change(id, ['print', 'press', 'cut'].includes(station) ? 'multi' : 'production', 'finish_station', [station], ['station_done'])
          }
        }
        await state(id, 'production', 'qc_pack', 'queued')
        await start(id)
        await passQc(id, 10)
        await finishQc(id)
      })
    }

    await check('A10 แก้หรือลบประวัติเดิมไม่ได้', async () => {
      const id = await receive('HISTORY')
      await send(id, vendor)
      const before = await history()
      for (const sql of ['update public.events set payload=payload where job_id=$1', 'delete from public.events where job_id=$1']) {
        await assert.rejects(() => isolated('r12_history', () => rows(sql, [id])), /เพิ่มอย่างเดียว/)
      }
      assert.deepEqual(await history(), before)
      await invariant()
    })

    await check('A11 live-check คืน RESULTS พร้อมงาน outside ใน PGlite', async () => {
      const id = await receive('LIVE-CHECK')
      await send(id, vendor)
      await rows('insert into private.file_settings(record_secret) values ($1) on conflict (id) do nothing', [randomUUID()])
      const keys = { adm: 'admin', mgr: 'manager', prd: 'production', qcu: 'legacyQc' }
      const local = script('live-check').replace(/(adm|mgr|prd|qcu) uuid := '[0-9a-f-]+'/g,
        (_, key) => key + " uuid := '" + actors[keys[key]] + "'")
      assert.equal(Object.values(keys).filter(actor => local.includes(actors[actor])).length, 4)
      const before = await history()
      let results
      await assert.rejects(() => isolated('r12_live_check', () => db.exec(local)), error => {
        assert.ok(error.message.startsWith('RESULTS'), error.message)
        results = JSON.parse(error.message.slice('RESULTS'.length))
        return true
      })
      assert.deepEqual(await history(), before)
      await state(id, 'production', 'outside', 'out')
      const failures = results.filter(result => !result.ok)
      assert.deepEqual(failures, [], JSON.stringify(failures))
      return results.length + ' ผลตรวจย่อย'
    })

    await check('A11 golive-cleanup ลบงาน TEST- และเก็บงานจำลองที่ไม่ใช่ TEST-', async () => {
      const test = await receive('CLEAN')
      const keep = await receive('RETAIN')
      await rows("update public.jobs set confirmation_no='R12-SYNTHETIC-KEEP' where id=$1", [keep])
      await send(test, vendor)
      const keepRun = await send(keep, other)
      const results = await db.exec(script('golive-cleanup').replace(/^(begin|commit);\r?$/gm, ''))
      const summary = results.at(-1).rows
      assert.equal(summary.find(row => row.รายการ.startsWith('ลบงานทดสอบ TEST-')).ผล, '1')
      assert.equal(summary.find(row => row.รายการ.startsWith('งานจริงที่เหลือ')).ผล, '1')
      assert.equal(summary.find(row => row.รายการ.startsWith('trigger')).ผล, 'เปิดอยู่ (ถูกต้อง)')
      assert.equal(await live(test), undefined)
      assert.deepEqual(await runs(test), [])
      await state(keep, 'production', 'outside', 'out')
      assert.equal((await runs(keep))[0].id, keepRun)
    })
  } finally {
    await db.exec('rollback')
  }
}
