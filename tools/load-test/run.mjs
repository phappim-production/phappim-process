import { spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ทดสอบหลายคนกดพร้อมกันบน Postgres จริง (PGlite ต่อได้ 1 connection เลยจำลองกรณีนี้ไม่ได้) · ต้องเปิด Docker
const container = process.env.LOAD_CONTAINER ?? 'pp142-load'
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const results = []
const record = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? '  · ' + detail : ''}`)
}

function psql(sql, timing = false) {
  return new Promise(resolve => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-tA', '-v', 'ON_ERROR_STOP=1', '-f', '-'])
    let out = '', err = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('close', code => resolve({ ok: code === 0, out, err: err.replace(/^psql:[^E]*/m, '').trim() }))
    child.stdin.end((timing ? '\\timing on\n' : '') + sql)
  })
}
async function admin(sql) {
  const r = await psql(sql)
  if (!r.ok) throw new Error(r.err)
  return r.out.trim()
}

const users = {}
const uid = name => (users[name] ??= '22000000-0000-0000-0000-' + String(Object.keys(users).length + 1).padStart(12, '0'))
const lit = v => v === null ? 'null' : Array.isArray(v) ? `array[${v.map(lit).join(', ')}]::text[]` : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`
async function rpc(actor, fn, args = []) {
  const started = Date.now()
  const r = await psql(`begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${uid(actor)}', true) \\g /dev/null
select 'R:' || coalesce(public.${fn}(${args.map(lit).join(', ')})::text, '');
commit;`)
  const value = r.out.split('\n').find(l => l.startsWith('R:'))?.slice(2)
  return { ok: r.ok, value, err: r.err, ms: Date.now() - started }
}
function rpcHeld(actor, fn, args, seconds) {
  return psql(`begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${uid(actor)}', true) \\g /dev/null
select public.${fn}(${args.map(lit).join(', ')}) \\g /dev/null
select pg_sleep(${seconds}) \\g /dev/null
commit;`)
}
const errorKind = err => /deadlock|40P01/.test(err) ? 'deadlock'
  : /could not serialize|40001/.test(err) ? 'serialize'
  : /statement timeout|canceling/.test(err) ? 'timeout'
  : /duplicate key|violates|^ERROR:\s+[A-Za-z]/m.test(err) ? 'raw'
  : 'rule'

const roster = {
  admin: ['admin'], prod1: ['production'], prod2: ['production'], prod3: ['production'],
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['print' + (i + 1), ['staff', 'print']])),
  press1: ['staff', 'press'], press2: ['staff', 'press'],
  cut1: ['staff', 'cut'], cut2: ['staff', 'cut'], cut3: ['staff', 'cut'],
  qc1: ['staff', 'qc_pack'], qc2: ['staff', 'qc_pack'],
  reader: ['manager'],
}

async function setup() {
  const exists = await psql("select 1 from pg_namespace where nspname = 'private'")
  if (exists.out.trim() === '1') throw new Error(`ฐานใน ${container} มีข้อมูลแล้ว · ลบ container แล้วสร้างใหม่ก่อนรัน`)
  await admin(`create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role authenticated nologin; create role anon nologin;`)
  const dir = join(root, 'supabase', 'migrations')
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) await admin(readFileSync(join(dir, f), 'utf8'))
  await admin(`grant usage on schema public, auth to authenticated, anon;
grant all on all tables in schema public to authenticated, anon;
grant execute on all functions in schema auth to authenticated, anon;`)
  const rows = []
  for (const [name, [role, ...stations]] of Object.entries(roster)) {
    rows.push(`insert into auth.users values ('${uid(name)}', '${name}@load.invalid');`,
      `insert into public.profiles(user_id, name, role, active) values ('${uid(name)}', '${name}', '${role}', true);`,
      ...stations.map(s => `insert into public.staff_stations(user_id, station_code) values ('${uid(name)}', '${s}');`))
  }
  await admin(rows.join('\n'))
}

let jobNo = 0
async function receive(route = 'normal') {
  const r = await rpc('admin', 'receive_job', ['LOAD-' + String(++jobNo).padStart(4, '0'), 'ลูกค้าโหลด', 'งานโหลด', 'tshirt', 10, 'ตัว', '2099-01-06', route, null, 0, 0, '{}', false])
  if (!r.ok) throw new Error('receive_job: ' + r.err)
  return r.value
}
const station = async id => admin(`select current_station || '|' || station_status || '|' || phase from public.job_live where id = '${id}'`)

async function capRace() {
  const jobs = []
  for (let i = 0; i < 10; i++) jobs.push(await receive())
  const tries = await Promise.all(jobs.map((id, i) => rpc('print' + (i + 1), 'start_in_queue', [id, 'ทดสอบกดพร้อมกัน'])))
  const ok = tries.filter(t => t.ok).length
  const kinds = tries.filter(t => !t.ok).map(t => errorKind(t.err))
  const doing = Number(await admin("select count(*) from public.job_live where current_station = 'print' and station_status = 'doing'"))
  record('10 คนกดเริ่มพิมพ์พร้อมกัน (เครื่องพิมพ์ 2 เครื่อง) → เริ่มได้ 2 งาน', ok === 2 && doing === 2, `สำเร็จ ${ok} · กำลังทำ ${doing}`)
  record('คนที่เหลือได้ข้อความเครื่องเต็ม ไม่ใช่ deadlock/serialize', kinds.every(k => k === 'rule'),
    tries.find(t => !t.ok)?.err.split('\n')[0] ?? '')

  const target = (await Promise.all(jobs.map(async id => [id, await station(id)]))).find(([, s]) => s.startsWith('print|doing'))[0]
  const taps = await Promise.all([1, 2, 3, 4, 5, 6].map(i => rpc('print' + i, 'finish_station', [target, 'print'])))
  const done = Number(await admin(`select count(*) from public.events where job_id = '${target}' and type = 'station_done'`))
  record('6 เครื่องกด "เสร็จ" งานเดียวกันพร้อมกัน → บันทึกครั้งเดียว', taps.filter(t => t.ok).length === 1 && done === 1,
    `สำเร็จ ${taps.filter(t => t.ok).length} · ประวัติ station_done ${done}`)
  await admin(`alter table public.events disable trigger events_append_only;
delete from public.jobs;
alter table public.events enable trigger events_append_only;`)
}

const freeSingles = () => admin(`select string_agg(m.code, ',' order by m.code) from public.sewing_machines m
where m.type_code = 'single' and m.status = 'ready'
  and not exists (select 1 from public.machine_assignments a where a.machine_id = m.id and a.released_at is null)`)

async function sewRace() {
  const jobs = []
  for (let i = 0; i < 16; i++) jobs.push(await receive('plain'))
  for (const id of jobs) {
    const s = await rpc('cut1', 'start_in_queue', [id, 'เตรียมงานเย็บ'])
    const f = await rpc('cut1', 'finish_station', [id, 'cut'])
    if (!s.ok || !f.ok) throw new Error('เตรียมงานเย็บ: ' + (s.err || f.err))
  }
  const tries = await Promise.all(jobs.map((id, i) =>
    rpc('prod' + (i % 2 + 1), 'start_sewing', [id, ['SN-' + String(Math.floor(i / 2) + 1).padStart(3, '0')]])))
  const ok = tries.filter(t => t.ok).length
  const dup = Number(await admin('select count(*) from (select machine_id from public.machine_assignments where released_at is null group by 1 having count(*) > 1) d'))
  record('ฝ่ายผลิต 2 คนกดเลือกจักรตัวเดียวกันพร้อมกัน 8 คู่ → ได้คู่ละ 1 งาน · ไม่มีจักรซ้ำ', ok === 8 && dup === 0, `สำเร็จ ${ok}/16 · จักรซ้ำ ${dup}`)
  const lost = tries.filter(t => !t.ok)
  record('คนที่กดช้ากว่าได้ข้อความไทยบอกว่าจักรใช้กับงานไหน', lost.every(t => errorKind(t.err) === 'rule' && /ใช้กับงาน/.test(t.err)),
    lost[0]?.err.split('\n')[0] ?? '')

  const sewing = jobs.filter((_, i) => tries[i].ok)
  const spare = (await freeSingles()).split(',')[0]
  const adds = await Promise.all(sewing.slice(0, 4).map((id, i) => rpc('prod' + (i % 3 + 1), 'assign_machines', [id, [spare]])))
  const addDup = Number(await admin('select count(*) from (select machine_id from public.machine_assignments where released_at is null group by 1 having count(*) > 1) d'))
  record(`4 งานกด "จัดการจักร" เพิ่ม ${spare} พร้อมกัน → ได้ 1 งาน`, adds.filter(t => t.ok).length === 1 && addDup === 0,
    `สำเร็จ ${adds.filter(t => t.ok).length} · ${adds.find(t => !t.ok)?.err.split('\n')[0] ?? ''}`)
  record('ไม่มี error ภาษาอังกฤษ / deadlock ตอนแย่งจักร', [...lost, ...adds.filter(t => !t.ok)].every(t => errorKind(t.err) === 'rule'))

  const held = sewing[4]
  const finishing = rpcHeld('prod1', 'finish_sewing', [held], 1.5)
  await new Promise(res => setTimeout(res, 400))
  const late = await rpc('prod2', 'start_sewing', [held, [(await freeSingles()).split(',')[0]]])
  await finishing
  const after = await station(held)
  record('กดเริ่มเย็บชนกับอีกคนกดเย็บเสร็จ → ปฏิเสธ ไม่ไปเริ่ม QC แทน', !late.ok && after.startsWith('qc_pack|queued'),
    `ผล: ${late.ok ? 'เริ่มได้' : late.err.split('\n')[0]} · งานอยู่ ${after}`)

  const auto = await Promise.all(jobs.filter((_, i) => !tries[i].ok).map((id, i) => rpc('prod' + (i % 2 + 1), 'start_sewing', [id, null])))
  const autoRaw = auto.filter(t => !t.ok && errorKind(t.err) === 'raw').length
  console.log(`  (ข้อมูล) โหมดให้ระบบเลือกจักรเอง (หน้าเว็บไม่ใช้) กดพร้อมกัน 8 งาน: สำเร็จ ${auto.filter(t => t.ok).length} · error อังกฤษ ${autoRaw}`)
  await admin(`alter table public.events disable trigger events_append_only;
delete from public.jobs;
alter table public.events enable trigger events_append_only;`)
}

async function fullDay(count) {
  const jobs = []
  for (let i = 0; i < count; i++) jobs.push(await receive())
  const route = ['print', 'press', 'cut', 'sew', 'qc_pack']
  const workers = { print: ['print1', 'print2', 'print3'], press: ['press1', 'press2'], cut: ['cut1', 'cut2', 'cut3'], sew: ['prod1', 'prod2', 'prod3'], qc_pack: ['qc1', 'qc2'] }
  const stats = { ops: 0, rejected: 0, bad: [], ms: [], wrong: [] }
  const deadline = Date.now() + 4 * 60_000
  const call = async (actor, fn, args) => {
    const r = await rpc(actor, fn, args)
    stats.ops++
    stats.ms.push(r.ms)
    if (!r.ok) { if (errorKind(r.err) === 'rule') stats.rejected++; else stats.bad.push(fn + ': ' + r.err.split('\n')[0]) }
    return r
  }
  async function work(code, actor) {
    while (Date.now() < deadline) {
      const left = Number(await admin("select count(*) from public.jobs where phase <> 'done'"))
      if (left === 0) return
      const next = await admin(`select id from public.job_live where current_station = '${code}' and station_status = 'queued' and phase = 'production' order by queue_seq offset ${Math.floor(Math.random() * 2)} limit 1`)
      if (!next) { await new Promise(r => setTimeout(r, 150)); continue }
      const started = code === 'sew' ? await call(actor, 'start_sewing', [next, [(await freeSingles()).split(',')[Math.floor(Math.random() * 2)]]]) : await call(actor, 'start_in_queue', [next, 'ทดสอบโหลด'])
      if (!started.ok) continue
      const now = await station(next)
      if (!now.startsWith(code + '|doing')) { stats.wrong.push(`${actor} กดเริ่ม${code} แต่งานไปอยู่ ${now}`); continue }
      if (code === 'qc_pack') await call(actor, 'record_qc', [next, 10])
      if (code === 'sew') await call(actor, 'finish_sewing', [next])
      else await call(actor, 'finish_station', [next, code])
    }
  }
  const began = Date.now()
  await Promise.all(Object.entries(workers).flatMap(([code, actors]) => actors.map(a => work(code, a))))
  const seconds = (Date.now() - began) / 1000
  const done = Number(await admin("select count(*) from public.jobs where phase = 'done'"))
  record(`จำลองทั้งวัน: ${count} งาน · พนักงาน 13 คนทำพร้อมกันทุกสถานี → เสร็จครบ`, done === count, `เสร็จ ${done}/${count} ใน ${seconds.toFixed(0)} วินาที · คำสั่ง ${stats.ops} · ถูกปฏิเสธตามกฎ ${stats.rejected}`)
  record('กดเริ่มแล้วได้เริ่มสถานีที่ตั้งใจเสมอ (ไม่ไปเริ่มสถานีถัดไปแทน)', stats.wrong.length === 0, stats.wrong.slice(0, 2).join(' | '))
  record('ไม่มี deadlock / serialize / timeout ระหว่างจำลอง', stats.bad.length === 0, stats.bad.slice(0, 3).join(' | '))
  const over = await admin(`with e as (
  select station_code, at, case type when 'station_start' then 1 else -1 end d, id
  from public.events where type in ('station_start', 'station_done') and station_code in ('print', 'press', 'cut', 'qc_pack')),
c as (select station_code, sum(d) over (partition by station_code order by at, d, id) n from e)
select coalesce(string_agg(distinct c.station_code || '=' || n, ', '), '') from c join public.stations s on s.code = c.station_code where n > s.machines`)
  record('ตลอดการจำลองไม่มีสถานีใช้เครื่องเกินจำนวนจริง (ตรวจจากเวลาในประวัติ)', over === '', over)
  const pairs = await admin(`select count(*) from (select job_id, station_code from public.events where type in ('station_start', 'station_done') group by 1, 2 having count(*) filter (where type = 'station_start') <> count(*) filter (where type = 'station_done')) x`)
  record('ทุกงานมีประวัติเริ่ม/เสร็จคู่กันครบทุกสถานี', pairs === '0', `ไม่ครบ ${pairs} คู่`)
  const open = await admin('select count(*) from public.machine_assignments where released_at is null')
  record('จบวันไม่มีจักรค้างจ่าย', open === '0', `ค้าง ${open}`)
  const sorted = [...stats.ms].sort((a, b) => a - b)
  return { p50: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * 0.95)] }
}

async function readLoad(clients, rounds) {
  for (let i = 0; i < 150; i++) await receive()
  const one = `begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${uid('reader')}', true) \\g /dev/null
select count(*) from public.job_live \\g /dev/null
select count(*) from public.job_sla_flags() \\g /dev/null
select public.inbox_unread_count() \\g /dev/null
commit;
`
  const began = Date.now()
  const runs = await Promise.all(Array.from({ length: clients }, () => psql(one.repeat(rounds), true)))
  const seconds = (Date.now() - began) / 1000
  const queries = runs.flatMap(r => {
    const t = [...r.out.matchAll(/Time: ([\d.]+) ms/g)].map(m => Number(m[1]))
    return t.filter((_, i) => i % 7 >= 3 && i % 7 <= 5)
  }).sort((a, b) => a - b)
  const p95 = queries[Math.floor(queries.length * 0.95)]
  record(`อ่านพร้อมกัน ${clients} เครื่อง × ${rounds} รอบ (งาน 150+ งาน) · คิวรี p95 < 500 ms`, runs.every(r => r.ok) && p95 < 500,
    `${queries.length} คิวรีใน ${seconds.toFixed(1)} วินาที · p50 ${queries[Math.floor(queries.length / 2)]} ms · p95 ${p95} ms · ช้าสุด ${queries.at(-1)} ms`)
}

await setup()
console.log('ลง migration + บัญชีทดสอบแล้ว')
await capRace()
await sewRace()
const latency = await fullDay(Number(process.env.LOAD_JOBS ?? 30))
console.log(`เวลาต่อคำสั่ง (รวมเปิด connection ผ่าน docker) p50 ${latency.p50} ms · p95 ${latency.p95} ms`)
await readLoad(20, 20)
const failed = results.filter(r => !r.pass).length
console.log(`ผ่าน ${results.length - failed} · ไม่ผ่าน ${failed}`)
process.exit(failed ? 1 : 0)
