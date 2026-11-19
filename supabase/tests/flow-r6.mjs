
import assert from 'node:assert/strict'

const users = {
  owner: '00000000-0000-0000-0000-000000000001',
  supervisor: '00000000-0000-0000-0000-000000000002',
  admin: '00000000-0000-0000-0000-000000000011',
  qc: '00000000-0000-0000-0000-000000000012',
  production: '00000000-0000-0000-0000-000000000013',
  manager: '00000000-0000-0000-0000-000000000014',
}
const reason = 'เหตุผลทดสอบรอบ 6'
const roles = Object.keys(users)

export async function flowR6Tests({ db, ok, as }) {
  const rows = async (sql, args = []) => (await db.query(sql, args)).rows
  const one = async (sql, args) => (await rows(sql, args))[0]
  const rpc = async (role, name, ...args) => {
    const params = args.map((_, i) => '$' + (i + 1)).join(', ')
    return (await as(users[role], () => savepoint('r6_rpc', () => db.query('select public.' + name + '(' + params + ') as result', args)))).rows[0].result
  }
  const live = id => one('select * from public.job_live where id = $1', [id])
  const core = async id => {
    const j = await live(id)
    return [j.phase, j.station_status, j.current_station, j.visit]
  }
  const events = id => rows('select id, type, "by", station_code, payload from public.events where job_id = $1 order by id', [id])
  const isolated = async (label, test) => {
    await db.exec('begin')
    try {
      await test()
      ok(label, true)
    } catch (error) {
      ok(label, false, error.message.replace(/\s+/g, ' '))
    } finally {
      await db.exec('rollback')
    }
  }
  const savepoint = async (name, test, undo = false) => {
    await db.exec('savepoint ' + name)
    try {
      return await test()
    } catch (error) {
      await db.exec('rollback to savepoint ' + name)
      throw error
    } finally {
      if (undo) await db.exec('rollback to savepoint ' + name)
      await db.exec('release savepoint ' + name)
    }
  }
  const denied = async (id, pattern, call) => {
    const before = await live(id)
    const history = await events(id)
    await assert.rejects(() => savepoint('r6_denied', call), pattern)
    assert.deepEqual(await live(id), before)
    assert.deepEqual(await events(id), history)
  }
  const changes = async (id, role, expected, call) => {
    const before = (await events(id)).length
    const result = await call()
    const delta = (await events(id)).slice(before)
    assert.deepEqual(delta.map(e => [e.type, e.by]), expected.map(type => [type, users[role]]))
    return result
  }

  const job = (label, route = 'cut_only', qty = 10, sample = false) => rpc('admin', 'receive_job',
    'TEST-R6-' + label, 'ลูกค้าจำลอง', 'งานจำลอง', 'tshirt', qty, 'ตัว', '2026-12-31', route, null, 0, 0, '{}', sample)
  const start = (id, role = 'production') => rpc(role, 'start_station', id)
  const finish = (id, role = 'production') => rpc(role, 'finish_station', id)
  const qcJob = async label => {
    const id = await job(label)
    await start(id)
    await finish(id)
    await start(id, 'qc')
    return id
  }
  const vendor = name => rpc('admin', 'add_vendor', ['R6', name].join(' '), ['print', 'press', 'cut', 'sew'], null)
  const { eta, arrival } = await one("select now() + interval '4 days' as eta, now() + interval '1 day' as arrival")
  const { code: delayReason } = await one('select code from public.reason_codes where active order by code limit 1')
  const report = (id, reasons = [delayReason], detail = reason, time = eta) =>
    rpc('production', 'submit_delay_report', id, reasons, detail, time, null)
  const send = (id, company, last, days = 2) => rpc('admin', 'send_out', id, company, last, arrival, days, eta, null)
  const flags = async (role = 'production') => as(users[role], () =>
    rows('select * from public.job_sla_flags() order by job_id'))
  const ownFlag = async id => {
    const flag = (await flags()).find(row => row.job_id === id)
    return flag && [flag.warn, flag.over, flag.need_report]
  }
  const state = async id => (await one('select private.sla_state($1) as state', [id])).state

  // run.mjs เรียกตาราง A–P ของ R5 ก่อนชุดนี้ และใช้กฎ close_issue ฉบับปัจจุบันแล้ว
  for (const fixture of ['cut', 'qc_pack', 'sample', 'sew-ready', 'sew-broken']) {
    for (const role of roles) {
      await isolated('R6 close_issue / ' + fixture + ' / ' + role, async () => {
        const sewing = fixture.startsWith('sew-')
        const id = fixture === 'qc_pack' ? await qcJob('close') :
          await job('close', sewing ? 'plain' : 'cut_only', 10, fixture === 'sample')
        if (sewing) {
          await start(id)
          await finish(id)
          const assigned = await rpc('production', 'start_sewing', id)
          assert.ok(assigned.length > 0)
          if (fixture === 'sew-broken') {
            await rpc('production', 'set_machine_status', assigned[0], 'broken', reason, eta)
            assert.ok((await rows('select * from private.machines_short($1) where short > 0', [id])).length)
          }
        } else if (fixture !== 'qc_pack') {
          await start(id)
        }
        if (fixture !== 'sew-broken') await rpc('production', 'open_issue', id, reason)
        const [phase, status, station, visit] = await core(id)
        assert.equal(status, 'hold')
        const close = () => rpc(role, 'close_issue', id, reason)
        if (role === 'admin' || role === 'qc') {
          await denied(id, { code: '42501', message: /แจ้งผู้บริหารหรือฝ่ายผลิตให้กด/ }, close)
        } else if (fixture === 'sew-broken') {
          await denied(id, /จักรไม่ครบ/, close)
        } else {
          await changes(id, role, ['resume'], close)
          assert.deepEqual(await core(id), [phase, 'doing', station, visit])
          assert.equal((await one('select count(*)::int n from issues where job_id = $1 and closed_at is null', [id])).n, 0)
          if (sewing) assert.equal((await rows('select * from private.machines_short($1) where short > 0', [id])).length, 0)
          await denied(id, /ไม่ได้พัก/, close)
        }
      })
    }
  }

  await isolated('R6 resume_sewing ใช้จักรสำรองและบันทึก resume ครั้งเดียว', async () => {
    const id = await job('resume', 'plain')
    await start(id)
    await finish(id)
    const [machine] = await rpc('production', 'start_sewing', id)
    assert.ok(machine)
    await rpc('production', 'set_machine_status', machine, 'broken', reason, eta)
    await denied(id, { code: '42501' }, () => rpc('manager', 'resume_sewing', id))
    await changes(id, 'production', ['machines_assigned', 'resume'], () => rpc('production', 'resume_sewing', id))
    assert.equal((await live(id)).station_status, 'doing')
    assert.deepEqual(await rows('select * from private.machines_short($1) where short > 0', [id]), [])
    await denied(id, /ไม่ได้พัก/, () => rpc('production', 'resume_sewing', id))
  })

  await isolated('R6 job_sla_flags ปฏิเสธ anon และบัญชีสมมติที่ไม่มีสิทธิ์ใช้งาน', async () => {
    await assert.rejects(() => savepoint('r6_anon', async () => {
      await db.exec("set local role anon; select set_config('request.jwt.claim.sub', '', true)")
      await rows('select * from public.job_sla_flags()')
    }), { code: '42501' })
    for (const uid of [null, '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004']) {
      await assert.rejects(() => as(uid, () => savepoint('r6_inactive', () => rows('select * from public.job_sla_flags()'))),
        { code: '42501', message: /บัญชีที่ใช้งานอยู่/ })
    }
  })

  await isolated('R6 job_sla_flags ทุกบทบาทเห็นเฉพาะงานผลิต doing/hold ที่จับเวลา', async () => {
    const doing = await job('sla-doing')
    const hold = await job('sla-hold')
    const queued = await job('sla-queued')
    const sample = await job('sla-sample', 'cut_only', 10, true)
    const out = await job('sla-out')
    const repair = await qcJob('sla-rework')
    const done = await qcJob('sla-done')
    for (const id of [doing, hold, sample]) await start(id)
    await rpc('production', 'open_issue', hold, reason)
    await send(out, await vendor('SLA'), 'cut')
    await rpc('qc', 'send_rework', repair, 3, reason, 'cut')
    await start(repair)
    await rpc('qc', 'record_qc', done, 10)
    await finish(done, 'qc')
    const batch = [doing, hold, queued, sample, out, repair, done]
    for (const role of roles) {
      const result = await flags(role)
      assert.deepEqual(new Set(result.filter(row => batch.includes(row.job_id)).map(row => row.job_id)), new Set([doing, hold]), role)
    }
  })

  // เทียบค่าธงกับ SLA และคำตอบของ finish_station โดยแยกการบล็อกเพราะพัก/QC ออกจากการบล็อกเพราะเวลา
  const verifySla = async (id, expected, blocked) => {
    const s = await state(id)
    assert.deepEqual([
      !!(s.station_warn || s.segment_warn),
      !!(s.station_over || s.segment_over),
      !!((s.station_over && !s.station_reported) || (s.segment_over && !s.segment_reported)),
    ], expected)
    assert.deepEqual(await ownFlag(id), expected)
    await savepoint('r6_finish', async () => {
      if (blocked) await denied(id, blocked, () => finish(id))
      else await changes(id, 'production', ['station_done'], () => finish(id))
    }, true)
  }
  const stationAge = (id, days) => db.query(
    "update public.jobs set station_started_at = now() - ($2::numeric * interval '1 day') where id = $1", [id, days])
  const insertSegmentStart = (id, days) => db.query(
    "insert into public.events (job_id, type, phase, station_code, at) values ($1, 'station_start', 'production', 'print', now() - ($2::numeric * interval '1 day'))", [id, days])

  await isolated('R6 SLA สถานี: เตือน · เกิน · ส่งรายงาน · พักไม่นับเวลา', async () => {
    await db.exec("update public.stations set sla_days = 4, warn_pct = 50, big_qty = null where code = 'cut'")
    const id = await job('station-clock')
    await start(id)
    await verifySla(id, [false, false, false])
    await stationAge(id, 3)
    await verifySla(id, [true, false, false])
    await stationAge(id, 8)
    await verifySla(id, [true, true, true], /เกินเวลามาตรฐานของสถานี/)
    await denied(id, /เลือกรหัสสาเหตุ/, () => report(id, []))
    await denied(id, /รหัสสาเหตุไม่ถูกต้อง/, () => report(id, ['R6-INVALID']))
    await denied(id, /อธิบายว่าเกิดอะไรขึ้น/, () => report(id, [delayReason], ' '))
    await denied(id, /หลังจากตอนนี้/, () => report(id, [delayReason], reason, new Date(0)))
    await changes(id, 'production', ['delay_report'], () => report(id))
    await verifySla(id, [true, true, false])

    const held = await job('held-clock')
    await start(held)
    await stationAge(held, 8)
    await rpc('production', 'open_issue', held, reason)
    await db.query("update public.issues set opened_at = now() - interval '7 days' where job_id = $1", [held])
    assert.ok(Number((await state(held)).station_days) <= 1)
    await verifySla(held, [false, false, false], /พักอยู่/)
    await rpc('production', 'close_issue', held, reason)
    await verifySla(held, [false, false, false])
  })

  await isolated('R6 SLA ช่วงและสถานีพร้อมกัน: รายงานช่วงไม่ปลดบล็อกสถานีถัดไปที่เกิน', async () => {
    await db.exec("update public.stations set sla_days = 2, warn_pct = 50, big_qty = null where code in ('press', 'cut')")
    await db.exec("update public.sla_segments set sla_days = 4, warn_pct = 50, big_qty = null, big_sla_days = null where route_code = 'normal'")
    const id = await job('segment-clock', 'normal')
    await start(id)
    await finish(id)
    await start(id)
    await insertSegmentStart(id, 3)
    await verifySla(id, [true, false, false])
    await insertSegmentStart(id, 8)
    await verifySla(id, [true, true, true], /ช่วง .*เกินเวลามาตรฐาน/)
    await changes(id, 'production', ['delay_report'], () => report(id))
    await verifySla(id, [true, true, false])
    await finish(id)
    await start(id)
    await stationAge(id, 4)
    const cutSla = await state(id)
    assert.equal(cutSla.segment_reported, true)
    assert.equal(cutSla.station_reported, false)
    await verifySla(id, [true, true, true], /เกินเวลามาตรฐานของสถานี/)
    await report(id)
    await verifySla(id, [true, true, false])
  })

  await isolated('R6 SLA งานใหญ่: ต่ำกว่า big_qty ใช้ค่าปกติ · ถึงเกณฑ์ใช้เวลางานใหญ่', async () => {
    await db.exec("update public.stations set sla_days = 2, big_qty = 100, big_sla_days = 10, warn_pct = 80 where code = 'cut'")
    for (const [qty, threshold, expected, blocked] of [
      [99, 2, [true, true, true], /เกินเวลามาตรฐานของสถานี/],
      [100, 10, [false, false, false], null],
      [101, 10, [false, false, false], null],
    ]) {
      const id = await job('big-' + qty, 'cut_only', qty)
      await start(id)
      await stationAge(id, 5)
      assert.equal((await state(id)).station_sla_days, threshold)
      await verifySla(id, expected, blocked)
    }
    await db.exec("update public.sla_segments set sla_days = 2, big_qty = 100, big_sla_days = 10, warn_pct = 80 where route_code = 'normal'")
    for (const [qty, threshold, expected, blocked] of [
      [99, 2, [true, true, true], /ช่วง .*เกินเวลามาตรฐาน/],
      [100, 10, [false, false, false], null],
      [101, 10, [false, false, false], null],
    ]) {
      const id = await job('big-segment-' + qty, 'normal', qty)
      await start(id)
      await finish(id)
      await start(id)
      await insertSegmentStart(id, 5)
      assert.equal((await state(id)).segment_sla_days, threshold)
      await verifySla(id, expected, blocked)
    }
  })

  await isolated('R6 start_in_queue / finish_station กดซ้ำทันทีและยกเลิกระหว่างทำ', async () => {
    const id = await job('stale', 'normal')
    const begin = () => rpc('production', 'start_in_queue', id, reason)
    await changes(id, 'production', ['station_start'], begin)
    await denied(id, /ไม่ได้รอเริ่ม/, begin)
    await changes(id, 'production', ['station_done'], () => finish(id))
    await denied(id, /ยังไม่ได้เริ่ม|เสร็จไปแล้ว/, () => finish(id))
    await begin()
    // ไม่มี RPC ยกเลิกงานในรุ่นนี้ จัดสถานะจำลองหลังเริ่มเพื่อทดสอบคำสั่งจากจอค้าง
    await db.query("update public.jobs set phase = 'cancelled', station_status = null, station_seq = null where id = $1", [id])
    await denied(id, /ไม่ได้รอเริ่ม/, begin)
    await denied(id, /ยังไม่ได้เริ่ม|เสร็จไปแล้ว/, () => finish(id))
    await denied(id, /ไม่ได้อยู่ในการผลิต/, () => report(id))
  })

  // หน้าจอส่งสถานีที่เห็นไปด้วย · คำขอเก่าจากหน้าพิมพ์ต้องไม่จบสถานีรีด
  await isolated('R6 คำสั่งเสร็จจากสถานีเดิมไม่จบสถานีถัดไปที่เริ่มแล้ว', async () => {
    const id = await job('finish-stale-visit', 'normal')
    const staleFinish = () => rpc('production', 'finish_station', id, 'print')
    await start(id)                      // พิมพ์
    await staleFinish()
    await start(id)                      // รีด
    const before = { job: await core(id), events: (await events(id)).length }
    try { await savepoint('stale_finish', staleFinish) } catch (error) {
      assert.match(error.message, /[ก-๙]/)
    }
    assert.deepEqual({ job: await core(id), events: (await events(id)).length }, before,
      'ส่งคำสั่งเดิมซ้ำขณะรีดกำลังทำ งานต้องยังอยู่ที่รีดและไม่มี event เพิ่ม')
  })

  await isolated('R6 QC และส่งแก้: ศูนย์ · ติดลบ · เกินยอด · ส่งแก้ซ้ำ', async () => {
    const id = await qcJob('qc-bounds')
    const pass = qty => rpc('qc', 'record_qc', id, qty)
    const repair = qty => rpc('qc', 'send_rework', id, qty, reason, 'cut')
    for (const qty of [0, -1, null]) {
      await denied(id, /มากกว่า 0/, () => pass(qty))
      await denied(id, /มากกว่า 0/, () => repair(qty))
    }
    await changes(id, 'qc', ['qc_result'], () => pass(2))
    await denied(id, /ไม่เกิน 8 ชิ้น/, () => pass(9))
    await denied(id, /ไม่เกิน 8 ชิ้น/, () => repair(9))
    await denied(id, /ยังไม่ครบ/, () => finish(id, 'qc'))
    await changes(id, 'qc', ['rework'], () => repair(8))
    await denied(id, /ไม่ได้อยู่ที่ QC/, () => repair(8))
    assert.deepEqual([(await live(id)).rework_qty, (await live(id)).qc_passed], [8, 2])
  })

  // ยอด QC ที่ส่งซ้ำด้วยรหัสคำขอเดิมไม่นับซ้ำ · รหัสใหม่ยังนับได้
  await isolated('R6 ส่งยอด QC เดิมซ้ำไม่นับซ้ำ งานไม่เสร็จก่อนตรวจครบ', async () => {
    const id = await qcJob('qc-retry')
    const pass = () => rpc('qc', 'record_qc', id, 5, '00000000-0000-4000-8000-0000000000a1')
    await changes(id, 'qc', ['qc_result'], pass)
    try { await savepoint('qc_retry', pass) } catch (error) { assert.match(error.message, /[ก-๙]/) }
    let didFinish = true
    try { await savepoint('qc_finish', () => finish(id, 'qc')) } catch (error) {
      assert.match(error.message, /ยังไม่ครบ/)
      didFinish = false
    }
    const j = await live(id)
    assert.deepEqual([j.qc_passed, j.phase, didFinish], [5, 'production', false])
    await rpc('qc', 'record_qc', id, 5, '00000000-0000-4000-8000-0000000000a2')
    assert.equal((await live(id)).qc_passed, 10, 'ตรวจเพิ่มจริง (รหัสคำขอใหม่) ต้องนับ')
  })

  await isolated('R6 แบ่งงานแล้วส่งแก้และส่งออกเฉพาะชิ้นที่ต้องแก้', async () => {
    const parent = await job('split')
    const split = qty => rpc('admin', 'split_job', parent, qty)
    for (const qty of [0, -1, 10, 11]) await denied(parent, /จำนวน/, () => split(qty))
    const child = await changes(parent, 'admin', ['job_split'], () => split(6))
    await denied(parent, /จำนวน/, () => split(6))
    const parentBefore = await live(parent)
    assert.equal(parentBefore.qty + (await live(child)).qty, 10)
    const childEvents = await events(child)
    assert.deepEqual(childEvents.map(event => [event.type, event.by]), [['job_split_from', users.admin]])
    await start(child)
    await finish(child)
    await start(child, 'qc')
    await rpc('qc', 'record_qc', child, 2)
    await denied(child, /ไม่เกิน 4 ชิ้น/, () => rpc('qc', 'send_rework', child, 5, reason, 'cut'))
    await changes(child, 'qc', ['rework'], () => rpc('qc', 'send_rework', child, 4, reason, 'cut'))
    const vendorId = await vendor('Repair')
    const run = await changes(child, 'admin', ['outsource_sent'], () => send(child, vendorId, 'cut'))
    assert.deepEqual(await one('select qty, is_rework from outsource_runs where id = $1', [run]), { qty: 4, is_rework: true })
    await changes(child, 'admin', ['outsource_received'], () => rpc('admin', 'receive_back', run))
    assert.deepEqual((await core(child)).slice(0, 3), ['production', 'queued', 'qc_pack'])
    assert.deepEqual(await live(parent), parentBefore)
  })

    // แบ่งงานซ้ำด้วยรหัสคำขอเดิม คืนใบลูกเดิม ไม่สร้างใบใหม่
    await isolated('R6 ส่งคำสั่งแบ่งงานเดิมซ้ำได้ใบลูกใบเดียว', async () => {
    const parent = await job('split-retry')
    const split = () => rpc('admin', 'split_job', parent, 3, '00000000-0000-4000-8000-0000000000b1')
    const child = await changes(parent, 'admin', ['job_split'], split)
    assert.equal((await live(child)).qty, 3)
    try { await split() } catch (error) { assert.match(error.message, /[ก-๙]/) }
    const family = await rows(
      "select qty from jobs where confirmation_no like 'TEST-R6-split-retry%' order by confirmation_no",
    )
    const eventCount = (await events(parent)).filter(event => event.type === 'job_split').length
    assert.deepEqual([family.map(j => j.qty), eventCount], [[7, 3], 1])
  })

await isolated('R6 ส่งออกและรับกลับหลังส่งต่อ 2 ทอด · รอบปิดเรียกซ้ำไม่ได้', async () => {
    const id = await job('out-chain', 'normal')
    const [a, b, c] = [await vendor('A'), await vendor('B'), await vendor('C')]
    for (const days of [-1, 61]) await denied(id, /วัน/, () => send(id, a, 'print', days))
    const first = await changes(id, 'admin', ['outsource_sent'], () => send(id, a, 'print', 0))
    assert.equal(Number((await one('select lead_days from outsource_runs where id = $1', [first])).lead_days), 0)
    await denied(id, /อยู่ที่บริษัทภายนอกแล้ว/, () => send(id, a, 'print', 0))
    const forward = (last, company, station) => rpc('admin', 'forward_out', last, company, station, arrival, 2, eta, null)
    const second = await changes(id, 'admin', ['outsource_forwarded'], () => forward(first, b, 'press'))
    const third = await changes(id, 'admin', ['outsource_forwarded'], () => forward(second, c, 'cut'))
    for (const run of [first, second]) await denied(id, /ปิดไปแล้ว/, () => rpc('admin', 'receive_back', run))
    await changes(id, 'admin', ['outsource_received'], () => rpc('admin', 'receive_back', third))
    await denied(id, /ปิดไปแล้ว/, () => rpc('admin', 'receive_back', third))
    assert.deepEqual((await core(id)).slice(0, 3), ['production', 'queued', 'sew'])
    assert.deepEqual(await rows('select closed_how, next_run_id from outsource_runs where job_id = $1 order by id', [id]),
      [{ closed_how: 'forwarded', next_run_id: second }, { closed_how: 'forwarded', next_run_id: third },
        { closed_how: 'received', next_run_id: null }])
  })

  await isolated('R6 แทรกคิวด่วน 14 งาน · ไม่ซ้ำ · ปฏิเสธคำสั่งเดิม · เริ่มตามคิวใหม่', async () => {
    const first = await job('queue-first')
    const target = await job('queue-target')
    const urgent = []
    for (let i = 0; i < 14; i++) urgent.push(await job('urgent-' + i))
    for (const id of urgent) {
      const move = () => rpc('manager', 'move_job_ahead', id, target, reason)
      await changes(id, 'manager', ['queue_insert'], move)
      await denied(id, /อยู่ก่อน.*แล้ว/, move)
    }
    await denied(target, /งานอื่น/, () => rpc('manager', 'move_job_ahead', target, target, reason))
    await denied(target, /ใส่เหตุผล/, () => rpc('manager', 'move_job_ahead', target, first, ' '))
    const expected = [first, ...urgent, target]
    const sorted = await rows('select id, queue_seq from jobs where id = any($1::uuid[]) order by queue_seq', [expected])
    assert.deepEqual(sorted.map(j => j.id), expected)
    assert.equal(new Set(sorted.map(j => j.queue_seq)).size, expected.length)
    await denied(target, /ไม่ใช่คิวแรก/, () => rpc('production', 'start_in_queue', target, null))
    await changes(target, 'production', ['queue_skip', 'station_start'],
      () => rpc('production', 'start_in_queue', target, reason))
    const skip = (await events(target)).at(-2)
    assert.ok(skip.payload.ahead.includes((await live(urgent.at(-1))).confirmation_no))
  })

  // รายงานที่ส่งซ้ำด้วยรหัสคำขอเดิม ไม่เกิดรายงานที่สอง
  await isolated('R6 ส่งรายงานเดิมซ้ำในรอบเดียวได้รายงานเดียว', async () => {
    const id = await job('report-retry')
    await start(id)
    const once = () => rpc('production', 'submit_delay_report', id, [delayReason], reason, eta, null, '00000000-0000-4000-8000-0000000000c1')
    await changes(id, 'production', ['delay_report'], once)
    try { await savepoint('report_retry', once) } catch (error) { assert.match(error.message, /[ก-๙]/) }
    const { n } = await one('select count(*)::int n from delay_reports where job_id = $1', [id])
    const eventCount = (await events(id)).filter(event => event.type === 'delay_report').length
    assert.deepEqual([n, eventCount], [1, 1])
  })
}
