import { randomUUID } from 'node:crypto'
import { loadTest, errorKind } from './lib.mjs'

// ทดสอบจังหวะชนของล็อกใน 20261127000000 / 20261128000000 บน Postgres จริง · ต้องเปิด Docker
const { results, record, psql, admin, rpc, setup } = loadTest(process.env.RACE_CONTAINER ?? 'pp142-race')
const ROUNDS = Number(process.env.RACE_ROUNDS ?? 20)
const ONLY = (process.env.RACE_ONLY ?? 'a,b,c,d,e,f,g').split(',')

const roster = {
  admin: ['admin'], mgr: ['manager'],
  ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => ['prod' + (i + 1), ['production']])),
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const firstLine = e => e.split('\n')[0]
const num = async sql => Number(await admin(sql))

const tally = () => ({ ok: 0, rule: 0, deadlock: 0, serialize: 0, timeout: 0, raw: 0, samples: {} })
function tallyAll(t, rs) {
  for (const r of rs) {
    if (r.ok) { t.ok++; continue }
    const k = errorKind(r.err)
    t[k]++
    t.samples[k] ??= firstLine(r.err)
  }
}
const clean = t => t.deadlock + t.serialize + t.timeout + t.raw === 0
const kinds = t => `สำเร็จ ${t.ok} · ข้อความไทย ${t.rule} · deadlock ${t.deadlock} · serialize ${t.serialize} · timeout ${t.timeout} · อังกฤษ ${t.raw}`
  + ['deadlock', 'serialize', 'timeout', 'raw'].filter(k => t.samples[k]).map(k => ` | ${t.samples[k]}`).join('')
function recordErrors(label, t) {
  record(`${label} ไม่มี deadlock / serialize / timeout / error อังกฤษ`, clean(t), kinds(t))
}

async function waitFor(sql, want, what) {
  const end = Date.now() + 20_000
  while (Date.now() < end) {
    if (await num(sql) >= want) return
    await sleep(30)
  }
  throw new Error('รอไม่ถึง: ' + what)
}

// ประตูเริ่มพร้อมกัน: ทุกคำสั่งเปิดธุรกรรมแล้วรอ advisory lock แบบ shared จนครบ แล้วปลดพร้อมกัน (docker exec เริ่มช้าเร็วต่างกันหลายร้อย ms)
const GATE = 7142
let gateNo = 0
async function race(calls) {
  const key = ++gateNo
  const lk = `from pg_locks where locktype = 'advisory' and classid = ${GATE} and objid = ${key} and objsubid = 2`
  const gate = psql(`select pg_advisory_lock(${GATE}, ${key}) \\g /dev/null\nselect pg_sleep(60);`)
  await waitFor(`select count(*) ${lk} and granted`, 1, 'ประตู')
  const runs = calls.map(([actor, fn, args]) =>
    rpc(actor, fn, args, { before: `select pg_advisory_xact_lock_shared(${GATE}, ${key}) \\g /dev/null\n` }))
  await waitFor(`select count(*) ${lk} and not granted`, calls.length, 'คำสั่งรอที่ประตูครบ')
  await admin(`select pg_terminate_backend(pid) ${lk} and granted`)
  await gate
  return Promise.all(runs)
}

async function must(actor, fn, args) {
  const r = await rpc(actor, fn, args)
  if (!r.ok) throw new Error(`${fn}: ${r.err}`)
  return r.value
}

let jobNo = 0
const newNo = () => 'RACE-' + String(++jobNo).padStart(5, '0')
const receiveArgs = (route, qty) => [newNo(), 'ลูกค้าทดสอบ', 'งานทดสอบ', 'tshirt', qty, 'ตัว', '2099-01-06', route, null, 0, 0, '{}', false]
const receive = (route = 'normal', qty = 10) => must('admin', 'receive_job', receiveArgs(route, qty))
async function receiveMany(n, route = 'normal', qty = 10) {
  const ids = await Promise.all(Array.from({ length: n }, () => receive(route, qty)))
  return byQueue(ids)
}
async function byQueue(ids) {
  return (await admin(`select string_agg(id::text, ',' order by queue_seq) from public.jobs where id = any(array[${ids.map(i => `'${i}'`).join(',')}]::uuid[])`)).split(',')
}
const noOf = id => admin(`select confirmation_no from public.jobs where id = '${id}'`)
const seqOf = id => admin(`select queue_seq from public.jobs where id = '${id}'`)
const state = async id => (await admin(`select coalesce(current_station, '-') || '|' || coalesce(station_status, '-') || '|' || phase from public.job_live where id = '${id}'`)).split('|')

async function step(id) {
  const [cur, status] = await state(id)
  if (status === 'queued') await must('prod1', 'start_in_queue', [id, 'เตรียมทดสอบ'])
  if (cur === 'sew') return must('prod1', 'finish_sewing', [id])
  if (cur === 'qc_pack') {
    const left = await num(`select qty - coalesce((select sum(passed) from public.qc_results where job_id = '${id}'), 0) from public.jobs where id = '${id}'`)
    if (left > 0) await must('prod1', 'record_qc', [id, left])
  }
  return must('prod1', 'finish_station', [id, cur])
}
async function moveTo(id, code) {
  for (let i = 0; i < 8; i++) {
    const [cur, , phase] = await state(id)
    if (code === 'done' ? phase === 'done' : cur === code) return
    await step(id)
  }
  throw new Error(`พางานไป ${code} ไม่ถึง`)
}
async function moveAll(ids, code, width = 2) {
  for (let i = 0; i < ids.length; i += width) await Promise.all(ids.slice(i, i + width).map(id => moveTo(id, code)))
}

async function reset() {
  await admin(`alter table public.events disable trigger events_append_only;
delete from public.machine_status_log;
delete from public.jobs;
alter table public.events enable trigger events_append_only;
select set_config('app.machine_status_rpc', 'on', false) \\g /dev/null
update public.sewing_machines set status = 'ready', note = null, repair_eta = null where status <> 'ready';`)
}
async function machinesOff(codes) {
  await admin(`select set_config('app.machine_status_rpc', 'on', false) \\g /dev/null
update public.sewing_machines set status = 'off' where code = any(array[${codes.map(c => `'${c}'`).join(',')}]);`)
}
const singles = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => 'SN-' + String(from + i).padStart(3, '0'))
const repairEta = () => new Date(Date.now() + 86_400_000).toISOString()

const machineInvariants = async () => ({
  dup: await num('select count(*) from (select machine_id from public.machine_assignments where released_at is null group by 1 having count(*) > 1) d'),
  brokenHeld: await num(`select count(*) from public.machine_assignments a join public.sewing_machines m on m.id = a.machine_id
    where a.released_at is null and m.status <> 'ready'`),
  doingShort: await num(`select count(*) from public.jobs j where j.phase in ('sample', 'production') and j.station_status = 'doing'
    and private.station_at(j.route_code, j.station_seq) = 'sew' and exists (select 1 from private.machines_short(j.id) s where s.short > 0)`),
})

// (a) ล็อกคิวเดียวกันกัน split_job สร้างส่วนใหม่ที่ค้างสเปกเก่าระหว่าง revise_job_spec หาครอบครัวงาน
async function reviseVsSplit(rounds) {
  await reset()
  const t = tally(), wrong = []
  let revised = 0
  for (let r = 0; r < rounds; r++) {
    const root = await receive('normal', 12)
    const rootNo = await noOf(root)
    const part = await must('admin', 'split_job', [root, 3])
    const due = `2099-03-${String(1 + (r % 28)).padStart(2, '0')}`
    const spec = JSON.stringify({ h: { doc_no: rootNo }, p: { marker: 'ใหม่', round: r }, product: 'tshirt' })
    const res = await race([
      ['admin', 'revise_job_spec', [r % 2 ? part : root, spec, 1, 'ลูกค้าแก้ใบ', 'งานแก้ใบ', 12, 0, due, false]],
      ['admin', 'split_job', [part, 1]],
      ['admin', 'split_job', [root, 2]],
    ])
    tallyAll(t, res)
    const [n, fresh, qty] = (await admin(`select count(*) || '|' || count(*) filter (where spec -> 'p' ->> 'marker' = 'ใหม่'
        and spec -> 'p' ->> 'round' = '${r}' and due_date = '${due}' and confirmation_rev = 1 and customer_name = 'ลูกค้าแก้ใบ') || '|' || sum(qty)
      from public.jobs where id in (select private.split_family('${root}'))`)).split('|').map(Number)
    const expected = 2 + res.slice(1).filter(x => x.ok).length
    if (n !== expected || qty !== 12) wrong.push(`รอบ ${r}: ครอบครัว ${n} ส่วน (ควรเป็น ${expected}) รวม ${qty} ชิ้น`)
    if (res[0].ok) {
      revised++
      if (fresh !== n) wrong.push(`รอบ ${r}: แก้ใบสำเร็จแต่ ${n - fresh}/${n} ส่วนยังเป็นสเปกเก่า`)
    } else if (fresh !== 0) wrong.push(`รอบ ${r}: แก้ใบถูกปฏิเสธแต่ ${fresh} ส่วนได้สเปกใหม่`)
  }
  record(`(a) แก้ใบชนแบ่งงาน 2 ทาง × ${rounds} รอบ → ทุกส่วน (รวมส่วนที่เพิ่งแบ่ง) ได้สเปก/กำหนดส่ง/ครั้งที่แก้ใหม่`,
    wrong.length === 0 && revised > 0, `แก้ใบสำเร็จ ${revised}/${rounds}${wrong.length ? ' · ' + wrong.slice(0, 2).join(' | ') : ''}`)
  recordErrors('(a)', t)
}

// งาน 4 งานรอคิวที่สถานีเย็บ เรียงตามคิว
async function sewScene() {
  await reset()
  const jobs = await receiveMany(4, 'plain')
  await moveAll(jobs, 'sew')
  return jobs
}

// (b) จักรเข็มเดี่ยวว่างตัวสุดท้าย · ล็อก pp142.sewing_machines
async function lastMachine(rounds) {
  const t = tally(), wrong = [], winners = {}
  for (let r = 0; r < rounds; r++) {
    const [jSet, jResume, jStart, jStart2] = await sewScene()
    await must('prod1', 'start_in_queue', [jSet, 'เตรียม'])
    await must('prod1', 'start_in_queue', [jResume, 'เตรียม'])
    await must('prod1', 'set_machine_status', ['SN-002', 'broken', 'ทดสอบเสีย', repairEta()])
    await machinesOff(singles(3, 13))
    // resume_sewing ถึงล็อกจักรก่อนเกือบทุกครั้ง · บางรอบตัดออกให้คำสั่งอื่นได้ชนะบ้าง
    const calls = [
      ['prod1', 'start_sewing', [jStart]],
      ['prod2', 'start_in_queue', [jStart2, 'ลูกค้าเร่ง']],
      ['prod4', 'set_job_machines', [jSet, 'single', 2]],
      ['prod3', 'resume_sewing', [jResume]],
    ].slice(0, 4 - (r % 3))
    const res = await race(calls)
    tallyAll(t, res)
    const won = res.map((x, i) => x.ok ? calls[i][1] : null).filter(Boolean)
    for (const w of won) winners[w] = (winners[w] ?? 0) + 1
    const inv = await machineInvariants()
    const last = await num(`select count(*) from public.machine_assignments a join public.sewing_machines m on m.id = a.machine_id where m.code = 'SN-014' and a.released_at is null`)
    if (won.length !== 1 || last !== 1 || inv.dup || inv.doingShort) wrong.push(`รอบ ${r}: สำเร็จ ${won.length} · SN-014 จ่าย ${last} · จักรซ้ำ ${inv.dup} · เย็บโดยจักรไม่ครบ ${inv.doingShort}`)
    const dupKey = res.find(x => !x.ok && /duplicate key/.test(x.err))
    if (dupKey) wrong.push(`รอบ ${r}: ${firstLine(dupKey.err)}`)
  }
  record(`(b) 2–4 คำสั่ง (start_sewing · start_in_queue · resume_sewing · set_job_machines) แย่งจักรตัวสุดท้าย × ${rounds} รอบ → ได้ 1 · ไม่มีจักรซ้ำ`,
    wrong.length === 0, `ผู้ชนะ ${JSON.stringify(winners)}${wrong.length ? ' · ' + wrong.slice(0, 2).join(' | ') : ''}`)
  recordErrors('(b)', t)
}

// (c) แจ้งจักรเสียชนเริ่มเย็บ / เย็บต่อ / เพิ่มจักร / พักงาน · set_machine_status ล็อกงานก่อนจักร
async function brokenVsSewing(rounds) {
  const t = tally(), wrong = []
  for (let r = 0; r < rounds; r++) {
    const [a, b, c] = await sewScene()
    await must('prod1', 'start_in_queue', [a, 'เตรียม'])
    await must('prod1', 'start_in_queue', [b, 'เตรียม'])
    let calls
    if (r % 2 === 0) {
      await must('prod1', 'set_machine_status', ['SN-002', 'broken', 'ทดสอบเสีย', repairEta()])
      await machinesOff(singles(3, 13))
      calls = [
        ['prod5', 'set_machine_status', ['SN-014', 'broken', 'มอเตอร์ไหม้', repairEta()]],
        ['prod1', 'start_sewing', [c]],
        ['prod3', 'resume_sewing', [b]],
        ['prod4', 'set_job_machines', [a, 'single', 2]],
      ]
    } else {
      await must('prod1', 'report_sewing_issue', [b, 'ด้ายขาด', true])
      await machinesOff(singles(3, 13))
      calls = [
        ['prod5', 'set_machine_status', ['SN-001', 'broken', 'เข็มหัก', repairEta()]],
        ['prod6', 'set_machine_status', ['SN-002', 'broken', 'มอเตอร์ไหม้', repairEta()]],
        ['prod3', 'resume_sewing', [b]],
        ['prod4', 'set_job_machines', [a, 'single', 2]],
        ['prod2', 'report_sewing_issue', [a, 'ผ้าติด', true]],
        ['prod1', 'start_sewing', [c]],
      ]
    }
    const res = await race(calls)
    tallyAll(t, res)
    const inv = await machineInvariants()
    if (inv.dup || inv.brokenHeld || inv.doingShort) wrong.push(`รอบ ${r}: จักรซ้ำ ${inv.dup} · จักรเสียยังจ่ายอยู่ ${inv.brokenHeld} · เย็บโดยจักรไม่ครบ ${inv.doingShort}`)
  }
  record(`(c) แจ้งจักรเสียชนเริ่มเย็บ/เย็บต่อ/เพิ่มจักร/พักงาน × ${rounds} รอบ → จักรเสียไม่ถูกจ่าย · งานที่กำลังเย็บมีจักรครบ`,
    wrong.length === 0, wrong.slice(0, 2).join(' | '))
  recordErrors('(c)', t)
}

// (d) กฎคิว: เริ่มได้เฉพาะคิวแรก ณ ตอนล็อก · เริ่มก่อนคิวต้องมี queue_skip 1 แถวของรอบนี้
async function queueRule(rounds) {
  const N = 6
  const variants = [
    { name: 'ปัก start_station ไม่ใส่เหตุผล', route: 'emb', station: 'emb', fn: 'start_station', reason: false, rounds },
    { name: 'ปัก start_in_queue ใส่เหตุผล', route: 'emb', station: 'emb', fn: 'start_in_queue', reason: true, rounds },
    { name: 'พิมพ์ (2 เครื่อง) start_in_queue ใส่เหตุผล', route: 'normal', station: 'print', fn: 'start_in_queue', reason: true, rounds: Math.ceil(rounds / 2), cap: 2 },
    { name: 'เย็บ start_sewing ไม่ใส่เหตุผล', route: 'plain', station: 'sew', fn: 'start_sewing', reason: false, rounds: Math.ceil(rounds / 2) },
  ]
  for (const v of variants) {
    const t = tally(), wrong = []
    let started = 0
    for (let r = 0; r < v.rounds; r++) {
      await reset()
      const order = await receiveMany(N, v.route)
      if (v.station !== 'print') await moveAll(order, v.station)
      const res = await race(order.map((id, i) => ['prod' + (i % 6 + 1), v.fn, v.reason ? [id, 'ลูกค้าเร่ง'] : [id]]))
      tallyAll(t, res)
      const doing = []
      for (const id of order) doing.push((await state(id))[1] === 'doing')
      started += doing.filter(Boolean).length
      if (doing.some((d, i) => d !== res[i].ok)) wrong.push(`รอบ ${r}: ผลคำสั่งไม่ตรงสถานะงาน`)
      const skips = new Map((await admin(`select coalesce(string_agg(e.job_id || '=' || (e.payload ->> 'visit') || '/' || j.visit || '/' || (e.payload -> 'ahead')::text, ';'), '')
        from public.events e join public.jobs j on j.id = e.job_id where e.type = 'queue_skip' and e.station_code = '${v.station}'`)).split(';').filter(Boolean)
        .map(s => { const [id, rest] = s.split('='); return [id, rest] }))
      const skipCount = await num(`select count(*) from public.events where type = 'queue_skip' and station_code = '${v.station}'`)
      if (skipCount !== skips.size) wrong.push(`รอบ ${r}: บางงานมี queue_skip เกิน 1 แถว`)
      const nos = await Promise.all(order.map(noOf))
      if (!v.reason) {
        const k = doing.indexOf(false) === -1 ? N : doing.indexOf(false)
        if (k === 0 || doing.slice(k).some(Boolean)) wrong.push(`รอบ ${r}: งานที่เริ่มไม่ใช่ลำดับต้นคิว (${doing.map(d => d ? 'เริ่ม' : '-').join(' ')})`)
        if (skipCount) wrong.push(`รอบ ${r}: มี queue_skip ${skipCount} แถวทั้งที่ไม่ใส่เหตุผล`)
        const off = res.find(x => !x.ok && !/ไม่ใช่คิวแรก/.test(x.err))
        if (off) wrong.push(`รอบ ${r}: ถูกปฏิเสธด้วยเหตุอื่น ${firstLine(off.err)}`)
      } else {
        const want = v.cap ?? N
        if (doing.filter(Boolean).length !== want) wrong.push(`รอบ ${r}: เริ่มได้ ${doing.filter(Boolean).length} งาน (ควรเป็น ${want})`)
        if (skips.has(order[0])) wrong.push(`รอบ ${r}: งานคิวแรกมี queue_skip`)
        order.forEach((id, i) => {
          const s = skips.get(id)
          if (!s) return
          const [visit, jobVisit, ahead] = s.split('/')
          const aheadNos = JSON.parse(ahead)
          if (!doing[i]) wrong.push(`รอบ ${r}: งานที่เริ่มไม่ได้ยังมี queue_skip ค้าง`)
          if (visit !== jobVisit) wrong.push(`รอบ ${r}: queue_skip visit ${visit} ≠ งาน ${jobVisit}`)
          if (!aheadNos.length || aheadNos.some(no => !nos.slice(0, i).includes(no))) wrong.push(`รอบ ${r}: ahead ผิด ${ahead}`)
        })
        if (v.cap) {
          const off = res.find(x => !x.ok && !/เต็ม/.test(x.err))
          if (off) wrong.push(`รอบ ${r}: ถูกปฏิเสธด้วยเหตุอื่น ${firstLine(off.err)}`)
        }
      }
      if (v.station === 'sew') {
        const inv = await machineInvariants()
        if (inv.dup || inv.doingShort) wrong.push(`รอบ ${r}: จักรซ้ำ ${inv.dup} · จักรไม่ครบ ${inv.doingShort}`)
      }
    }
    record(`(d) ${N} คนกดเริ่มพร้อมกัน: ${v.name} × ${v.rounds} รอบ`, wrong.length === 0,
      `เริ่มได้รวม ${started}/${N * v.rounds}${wrong.length ? ' · ' + wrong.slice(0, 2).join(' | ') : ''}`)
    recordErrors(`(d) ${v.name}:`, t)
  }
}

// (e) แทรกคิวช่องเดิมซ้ำจน queue_renumber ทำงาน ขณะรับงาน/แบ่งงานพร้อมกัน
async function renumberRace(scenarios, wavesPer = 8) {
  const t = tally(), wrong = []
  let waves = 0, renumbered = 0
  for (let s = 0; s < scenarios; s++) {
    await reset()
    const finished = await receiveMany(2, 'cut_only')
    await moveAll(finished, 'done', 1)
    const cancelled = await receive('normal')
    await must('mgr', 'cancel_job', [cancelled, 'ลูกค้ายกเลิก'])
    const order0 = await receiveMany(22, 'normal')
    const B = order0[4]
    const movers = order0.slice(6).reverse()
    const splitPool = order0.slice(0, 6)
    const frozen = () => admin(`select string_agg(id || '=' || queue_seq, ',' order by id) from public.jobs where phase in ('done', 'cancelled')`)
    const frozen0 = await frozen()
    const nos0 = await Promise.all(order0.map(noOf))
    const lastEvent = await num('select coalesce(max(id), 0) from public.events')
    let okReceives = [], okSplits = 0, mi = 0, bSeq = await seqOf(B)
    for (let w = 0; w < wavesPer; w++) {
      const res = await race([
        ['prod1', 'move_job_ahead', [movers[mi++], B, 'ลูกค้าเร่ง']],
        ['prod2', 'move_job_ahead', [movers[mi++], B, 'ลูกค้าเร่ง']],
        ['admin', 'receive_job', receiveArgs('normal', 10)],
        ['admin', 'receive_job', receiveArgs('normal', 10)],
        ['admin', 'split_job', [splitPool[w % splitPool.length], 1]],
      ])
      waves++
      tallyAll(t, res)
      okReceives.push(...res.slice(2, 4).filter(x => x.ok).map(x => x.value))
      okSplits += res[4].ok ? 1 : 0
      const now = await seqOf(B)
      if (now !== bSeq) renumbered++
      bSeq = now
    }
    const total = await num('select count(*) from public.jobs')
    if (total !== 3 + 22 + okReceives.length + okSplits) wrong.push(`ชุด ${s}: งานหาย/เกิน (${total} ≠ ${3 + 22 + okReceives.length + okSplits})`)
    if (await num('select count(*) - count(distinct queue_seq) from public.jobs')) wrong.push(`ชุด ${s}: queue_seq ซ้ำ`)
    if (await frozen() !== frozen0) wrong.push(`ชุด ${s}: งานที่จบแล้วถูกเปลี่ยนเลขคิว`)
    const moves = (await admin(`select coalesce(string_agg(e.type || '|' || j.confirmation_no || '|' || coalesce(e.payload ->> 'before', e.payload ->> 'child'), ';' order by e.id), '')
      from public.events e join public.jobs j on j.id = e.job_id where e.id > ${lastEvent} and e.type in ('queue_insert', 'job_split')`)).split(';').filter(Boolean)
    const model = [...nos0]
    for (const m of moves) {
      const [type, no, other] = m.split('|')
      if (type === 'queue_insert') {
        model.splice(model.indexOf(no), 1)
        model.splice(model.indexOf(other), 0, no)
      } else model.splice(model.indexOf(no) + 1, 0, other)
    }
    const actual = (await admin(`select string_agg(confirmation_no, ',' order by queue_seq) from public.jobs where phase not in ('done', 'cancelled')`)).split(',')
      .filter(no => model.includes(no))
    if (actual.join(',') !== model.join(',')) wrong.push(`ชุด ${s}: ลำดับคิวไม่ตรงกับที่แทรก/แบ่ง`)
    const recvAfter = okReceives.length === 0 ? 't' : await admin(`select (select min(queue_seq) from public.jobs where id = any(array[${okReceives.map(i => `'${i}'`).join(',')}]::uuid[]))
        > (select max(queue_seq) from public.jobs where confirmation_no = any(array[${model.map(n => `'${n}'`).join(',')}]))`)
    if (recvAfter !== 't') wrong.push(`ชุด ${s}: งานรับใหม่แทรกเข้ากลางคิวเดิม`)
  }
  record(`(e) แทรกคิวช่องเดิม 2 คน + รับงาน 2 + แบ่งงาน 1 พร้อมกัน × ${waves} รอบ → ไม่มีงานหาย · งานจบแล้วคงเลข · ลำดับคงเดิม`,
    wrong.length === 0 && renumbered > 0, `จัดเลขคิวใหม่ ${renumbered} ครั้ง${wrong.length ? ' · ' + wrong.slice(0, 3).join(' | ') : ''}`)
  recordErrors('(e)', t)
}

// ใช้ช่องก่อนงาน B จนห่างไม่ถึง 2 · การแทรกครั้งถัดไปจะเรียก queue_renumber
async function exhaustGap(B, movers) {
  let i = 0
  while (await num(`select (select queue_seq from public.jobs where id = '${B}') - (select max(queue_seq) from public.jobs where queue_seq < (select queue_seq from public.jobs where id = '${B}'))`) >= 2) {
    await must('prod1', 'move_job_ahead', [movers[i++], B, 'เตรียมช่อง'])
  }
}

// (e2) queue_renumber ล็อกทั้งตาราง jobs ขณะถือแถวงานไว้ · อีกคนกดเริ่มงานนั้นพอดี
async function renumberLockOrder(forced, natural) {
  const t = tally(), wrong = []
  for (let r = 0; r < forced; r++) {
    await reset()
    const order = await receiveMany(16, 'normal')
    const B = order[2], J = order[15]
    await exhaustGap(B, order.slice(3, 15).reverse())
    const bSeq = await seqOf(B)
    const target = r % 2 ? B : J
    const holder = rpc('prod1', 'note_queue_skip', [B, 'ถือแถวไว้'], { hold: 2.5 })
    await waitFor(`select count(*) from pg_stat_activity where wait_event = 'PgSleep'`, 1, 'ถือแถว B')
    const mover = rpc('prod2', 'move_job_ahead', [J, B, 'ลูกค้าเร่ง'])
    await waitFor(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'`, 1, 'แทรกคิวรอแถว B')
    const starter = rpc('prod3', 'start_in_queue', [target, 'ทดสอบ'])
    await waitFor(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'`, 2, 'กดเริ่มรอแถว')
    const [h, m, s] = await Promise.all([holder, mover, starter])
    tallyAll(t, [h, m, s])
    const dead = [m, s].find(x => !x.ok && errorKind(x.err) === 'deadlock')
    if (dead) wrong.push(`รอบ ${r} (กดเริ่ม${target === B ? 'งาน B' : 'งานที่แทรก'}): ${firstLine(dead.err)}`)
    if (m.ok && await seqOf(B) === bSeq) wrong.push(`รอบ ${r}: ไม่ได้จัดเลขคิวใหม่`)
  }
  record(`(e2) แทรกคิวที่ต้องจัดเลขใหม่ ชนคนกดเริ่มงานที่แทรก/งานที่ถูกแทรกก่อน (บังคับจังหวะ) × ${forced} รอบ → ไม่มี deadlock`,
    wrong.length === 0, wrong.slice(0, 2).join(' | '))
  recordErrors('(e2) บังคับจังหวะ', t)

  const n = tally()
  const deadlocks = { move_job_ahead: 0, split_job: 0 }
  for (let r = 0; r < natural; r++) {
    await reset()
    const order = await receiveMany(16, 'normal')
    const B = order[2], J = order[15]
    await exhaustGap(B, order.slice(3, 15).reverse())
    const P = await admin(`select id from public.jobs where queue_seq < (select queue_seq from public.jobs where id = '${B}') order by queue_seq desc limit 1`)
    const first = r % 2 ? ['admin', 'split_job', [P, 1]] : ['prod2', 'move_job_ahead', [J, B, 'ลูกค้าเร่ง']]
    const res = await race([
      first,
      ['prod3', 'start_in_queue', [B, 'ทดสอบ']],
      ['prod4', 'start_in_queue', [r % 2 ? P : J, 'ทดสอบ']],
    ])
    tallyAll(n, res)
    deadlocks[first[1]] += res.filter(x => !x.ok && errorKind(x.err) === 'deadlock').length
  }
  record(`(e2) แบบเดียวกันไม่บังคับจังหวะ: แทรกคิว/แบ่งงานที่ต้องจัดเลขใหม่ ชนกดเริ่ม (เริ่มพร้อมกัน) × ${natural} รอบ → ไม่มี deadlock`,
    deadlocks.move_job_ahead + deadlocks.split_job === 0, `deadlock: แทรกคิว ${deadlocks.move_job_ahead} · แบ่งงาน ${deadlocks.split_job} · ${kinds(n)}`)
}

// (f) รหัสคำขอเดียวกันส่งพร้อมกัน 5 ครั้ง = ผลครั้งเดียว
async function idempotency(rounds) {
  const t = tally(), wrong = []
  for (let r = 0; r < rounds; r++) {
    await reset()
    const qcJob = await receive('cut_only')
    const splitJob = await receive('normal')
    await moveTo(qcJob, 'qc_pack')
    await must('prod1', 'start_in_queue', [qcJob, 'เตรียม'])
    const [qcReq, delayReq, splitReq] = [randomUUID(), randomUUID(), randomUUID()]
    const eta = new Date(Date.now() + 2 * 86_400_000).toISOString()
    const calls = [
      ...Array.from({ length: 5 }, (_, i) => ['prod' + (i + 1), 'record_qc', [qcJob, 3, qcReq]]),
      ...Array.from({ length: 5 }, (_, i) => ['prod' + (i + 1), 'submit_delay_report', [qcJob, ['M1'], 'ผ้ามาช้า', eta, null, delayReq]]),
      ...Array.from({ length: 5 }, () => ['admin', 'split_job', [splitJob, 2, splitReq]]),
    ]
    const res = await race(calls)
    tallyAll(t, res)
    const qc = await admin(`select count(*) || '|' || coalesce(sum(passed), 0) from public.qc_results where job_id = '${qcJob}'`)
    const delays = await num(`select count(*) from public.delay_reports where job_id = '${qcJob}'`)
    const splits = await num(`select count(*) from public.events where job_id = '${splitJob}' and type = 'job_split'`)
    const same = xs => xs.every(x => x.ok) && new Set(xs.map(x => x.value)).size === 1
    if (qc !== '1|3' || !res.slice(0, 5).every(x => x.ok)) wrong.push(`รอบ ${r}: QC ${qc} (แถว|ยอด)`)
    if (delays !== 1 || !same(res.slice(5, 10))) wrong.push(`รอบ ${r}: รายงานล่าช้า ${delays} แถว`)
    if (splits !== 1 || !same(res.slice(10))) wrong.push(`รอบ ${r}: แบ่งงาน ${splits} ครั้ง`)
  }
  record(`(f) รหัสคำขอเดิมส่งพร้อมกัน 5 ครั้ง × 3 ฟังก์ชัน (record_qc · submit_delay_report · split_job) × ${rounds} รอบ → บันทึกครั้งเดียว คืนผลเดิม`,
    wrong.length === 0, wrong.slice(0, 2).join(' | '))
  recordErrors('(f)', t)
}

// (g) พักงาน → แก้แล้วกลับเข้าคิว (เครื่องเต็ม) → แย่งเครื่องเริ่มใหม่ · เวลามาตรฐานของสถานีนับต่อ
async function requeueSla(rounds) {
  const t = tally(), wrong = []
  const sla = async id => Number(await admin(`select coalesce(private.sla_state('${id}') ->> 'station_days', '-1')`))
  let restarted = 0
  for (let r = 0; r < rounds; r++) {
    await reset()
    const [A, B, C, D] = await receiveMany(4, 'cut_only')
    await moveAll([A, B, C, D], 'qc_pack')
    await must('prod1', 'start_in_queue', [A, 'เตรียม'])
    await admin(`update public.jobs set station_started_at = station_started_at - interval '3 hours' where id = '${A}'`)
    const started0 = await admin(`select station_started_at from public.jobs where id = '${A}'`)
    const before = await sla(A)
    await must('prod1', 'open_issue', [A, 'เครื่องแพ็กติดขัด'])
    await must('prod2', 'start_in_queue', [B, 'ทำงานถัดไประหว่างรอ'])
    tallyAll(t, await race([
      ['prod1', 'close_issue', [A]],
      ['prod2', 'start_in_queue', [C, 'แย่งเครื่อง']],
      ['prod3', 'start_in_queue', [D, 'แย่งเครื่อง']],
    ]))
    const resumed = await admin(`select payload ->> 'requeued' from public.events where job_id = '${A}' and type = 'resume'`)
    if ((await state(A))[1] !== 'queued' || resumed !== 'true') wrong.push(`รอบ ${r}: แก้แล้วไม่ได้กลับเข้าคิว (${(await state(A))[1]})`)
    for (let w = 0; w < 6 && (await state(A))[1] !== 'doing'; w++) {
      const calls = []
      for (const id of [B, C, D]) {
        if ((await state(id))[1] !== 'doing') continue
        await must('prod4', 'record_qc', [id, 10])
        calls.push(['prod4', 'finish_station', [id, 'qc_pack']])
      }
      for (const id of [A, C, D]) if ((await state(id))[1] === 'queued') calls.push(['prod' + (calls.length + 1), 'start_in_queue', [id, 'แย่งเครื่อง']])
      tallyAll(t, await race(calls))
    }
    if ((await state(A))[1] !== 'doing') { wrong.push(`รอบ ${r}: งาน A ไม่ได้เริ่มใหม่`); continue }
    restarted++
    const started1 = await admin(`select station_started_at from public.jobs where id = '${A}'`)
    const after = await sla(A)
    if (started1 !== started0) wrong.push(`รอบ ${r}: station_started_at ถูกล้าง ${started0} → ${started1}`)
    if (!(before > 0.1) || after < before - 0.0015) wrong.push(`รอบ ${r}: เวลาสถานี ${before} → ${after} วัน`)
  }
  record(`(g) พัก → กลับเข้าคิว → แย่งเครื่อง QC (1 เครื่อง) เริ่มใหม่ × ${rounds} รอบ → เวลามาตรฐานสถานีนับต่อ ไม่เริ่มนับใหม่`,
    wrong.length === 0 && restarted === rounds, `เริ่มใหม่ ${restarted}/${rounds}${wrong.length ? ' · ' + wrong.slice(0, 2).join(' | ') : ''}`)
  recordErrors('(g)', t)
}

const began = Date.now()
await setup(roster)
console.log(`ลง migration + บัญชีทดสอบแล้ว (${(await admin('select version()')).split(' on ')[0]})`)
const checks = {
  a: () => reviseVsSplit(Number(process.env.RACE_ROUNDS ?? 30)),
  b: () => lastMachine(ROUNDS),
  c: () => brokenVsSewing(ROUNDS),
  d: () => queueRule(ROUNDS),
  e: async () => { await renumberRace(Math.max(1, Math.round(ROUNDS / 5))); await renumberLockOrder(Math.min(6, ROUNDS), ROUNDS) },
  f: () => idempotency(ROUNDS),
  g: () => requeueSla(ROUNDS),
}
for (const k of ONLY) {
  try { await checks[k]() } catch (e) { record(`(${k}) สคริปต์หยุดกลางทาง`, false, firstLine(String(e.message ?? e))) }
}
const failed = results.filter(r => !r.pass).length
console.log(`ผ่าน ${results.length - failed} · ไม่ผ่าน ${failed} · ${((Date.now() - began) / 1000).toFixed(0)} วินาที`)
process.exit(failed ? 1 : 0)
