import { spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const errorKind = err => /deadlock|40P01/.test(err) ? 'deadlock'
  : /could not serialize|40001/.test(err) ? 'serialize'
  : /statement timeout|canceling/.test(err) ? 'timeout'
  : /duplicate key|violates|^ERROR:\s+[A-Za-z]/m.test(err) ? 'raw'
  : 'rule'

export const lit = v => v === null ? 'null' : Array.isArray(v) ? `array[${v.map(lit).join(', ')}]::text[]` : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`

// ทุกคำสั่งเป็น connection แยกผ่าน docker exec psql (PGlite ต่อได้ 1 connection เลยจำลองหลายคนกดพร้อมกันไม่ได้)
export function loadTest(container) {
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
  // before: คำสั่งก่อนเปลี่ยนบทบาท (เช่น รอประตูเริ่มพร้อมกัน) · hold: ค้างธุรกรรมไว้หลังเรียกฟังก์ชัน
  async function rpc(actor, fn, args = [], { before = '', hold = 0 } = {}) {
    const started = Date.now()
    const r = await psql(`begin;
${before}set local role authenticated;
select set_config('request.jwt.claim.sub', '${uid(actor)}', true) \\g /dev/null
select 'R:' || coalesce(public.${fn}(${args.map(lit).join(', ')})::text, '');
${hold ? `select pg_sleep(${hold}) \\g /dev/null\n` : ''}commit;`)
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

  async function setup(roster) {
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

  return { container, results, record, psql, admin, uid, rpc, rpcHeld, setup }
}
