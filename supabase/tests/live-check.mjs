// รัน supabase/scripts/live-check.sql บนฐานจำลอง (บัญชีทดสอบ UUID เดียวกับฐานจริง · ปิดอยู่เหมือนหลังเปิดใช้จริง)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const db = new PGlite()
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role authenticated nologin;
  create role anon nologin;
`)
const migDir = join(here, '..', 'migrations')
for (const f of readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) await db.exec(readFileSync(join(migDir, f), 'utf8'))
await db.exec(`
  create schema storage;
  create table storage.buckets (id text primary key);
  create table storage.objects (bucket_id text, name text);
  insert into storage.buckets values ('mockups'), ('confirmations');
  insert into auth.users values
    ('63ad8527-bd2d-4ea5-8f5c-e0602d1212a7','admin@pp142.test'),('60c2aa77-751b-403d-a9aa-a042caca76b9','manager@pp142.test'),
    ('34d97810-626e-42c1-a961-ae0a1da8f1b9','production@pp142.test'),('088bd56e-1d95-42df-8bd9-a7667f545b72','qc@pp142.test');
  insert into public.profiles (user_id, name, role, active) values
    ('63ad8527-bd2d-4ea5-8f5c-e0602d1212a7','ทดสอบ แอดมิน','admin',false),('60c2aa77-751b-403d-a9aa-a042caca76b9','ทดสอบ ผู้บริหาร','manager',false),
    ('34d97810-626e-42c1-a961-ae0a1da8f1b9','ทดสอบ ฝ่ายผลิต','production',false),('088bd56e-1d95-42df-8bd9-a7667f545b72','ทดสอบ ฝ่าย QC','qc',false);
  update public.stations set machines = 1 where code = 'qc_pack';
  insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date, route_code,
    confirmation_pdf_path, phase, station_seq, station_status)
  values ('TEST-BUSY-QC','ลูกค้า','งานใช้เครื่อง QC ค้าง','tshirt',5,'ตัว','2026-12-31','normal','x.pdf','production',
    private.last_seq('normal'), 'doing');
`)
let out = null
try {
  await db.exec(readFileSync(join(here, '..', 'scripts', 'live-check.sql'), 'utf8'))
} catch (e) {
  const m = /RESULTS(\[.*\])/s.exec(e.message)
  if (!m) { console.error('สคริปต์พังก่อนจบ:', e.message); process.exit(1) }
  out = JSON.parse(m[1])
}
if (!out) { console.error('สคริปต์ไม่ได้จบด้วย RESULTS (ไม่ย้อนกลับ)'); process.exit(1) }
const bad = out.filter(r => !r.ok)
for (const r of out) console.log(`${r.ok ? '✓' : '✗'} ${r.n}${r.ok ? '' : '  · ' + r.i}`)
const left = (await db.query(`select count(*)::int n from public.jobs where confirmation_no like 'TEST-LIVE-%'`)).rows[0].n
const active = (await db.query(`select count(*)::int n from public.profiles where active`)).rows[0].n
console.log(`ผ่าน ${out.length - bad.length} · ไม่ผ่าน ${bad.length} · งานค้าง ${left} · บัญชีทดสอบเปิดค้าง ${active}`)
process.exit(bad.length || left || active ? 1 : 0)
