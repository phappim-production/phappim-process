// ทดสอบ migrations บน Postgres ในเครื่อง (PGlite) โดยไม่ต้องมี Supabase/Docker
// รัน: cd supabase/tests && npm test
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const migDir = join(here, '..', 'migrations')
const db = new PGlite()
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✓' : '✗'} ${name}${extra ? '  · ' + extra : ''}`) }
async function expectError(name, sql, re) {
  try { await db.exec(sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') }
  catch (e) { ok(name, re ? re.test(e.message) : true, e.message.split('\n')[0]) }
}

// ---- จำลองส่วนที่ Supabase มีให้: schema auth, auth.uid(), บทบาท authenticated/anon ----
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role authenticated nologin;
  create role anon nologin;
`)

// ---- 1. migrations ----
for (const f of readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(migDir, f), 'utf8')); ok(`migration ${f}`, true) }
  catch (e) { ok(`migration ${f}`, false, e.message); process.exit(1) }
}
await db.exec(`
  grant usage on schema public, auth to authenticated, anon;
  grant all on all tables in schema public to authenticated, anon;
  grant execute on all functions in schema auth to authenticated, anon;
  -- ฟังก์ชันใน public/private ใช้สิทธิ์ตามที่ migration กำหนดเอง (ทดสอบกฎข้อ 12)
`)

// ---- 2. ข้อมูลตั้งค่า ----
const count = async t => (await db.query(`select count(*)::int n from public.${t}`)).rows[0].n
ok('สถานี 8 สถานี', await count('stations') === 8)
ok('เส้นทาง 3 เส้น', await count('routes') === 3)
ok('ลำดับสถานีในเส้นทาง 12 แถว', await count('route_stations') === 12)
ok('สินค้า 37 รายการ', await count('product_types') === 37)
ok('แม่แบบวัตถุดิบ 6 รายการ', await count('material_templates') === 6)
const r = await db.query(`select string_agg(s.name, ' → ' order by rs.seq) path from route_stations rs join stations s on s.code = rs.station_code where rs.route_code = 'dtf'`)
ok('เส้นทาง DTF เรียงถูก', r.rows[0].path === 'ตัดงาน → รีด DTF → เย็บงาน → QC + Packing', r.rows[0].path)
const bad = await db.query(`select code from stations where jsonb_typeof(substeps) <> 'array' or jsonb_array_length(substeps) = 0`)
ok('ทุกสถานีมีขั้นย่อย', bad.rows.length === 0)

// ---- 3. ผู้ใช้ทดสอบ ----
const U = { owner: '00000000-0000-0000-0000-000000000001', sup: '00000000-0000-0000-0000-000000000002',
            nobody: '00000000-0000-0000-0000-000000000003', off: '00000000-0000-0000-0000-000000000004' }
await db.exec(`
  insert into auth.users values ('${U.owner}','owner@test'),('${U.sup}','sup@test'),('${U.nobody}','x@test'),('${U.off}','off@test');
  insert into public.profiles (user_id,name,role,active) values
    ('${U.owner}','เจ้าของ','owner',true),('${U.sup}','ผู้ควบคุมงาน','supervisor',true),('${U.off}','ลาออก','qc',false);
  insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date, route_code, confirmation_pdf_path)
    values ('SC-TEST','ลูกค้าทดสอบ','งานทดสอบ','tshirt',10,'ตัว','2026-12-31','normal','test.pdf');
  insert into public.events (job_id, type) select id, 'received' from public.jobs;
`)
const as = async (uid, fn) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`)
  try { return await fn() } finally { await db.exec('reset role') }
}
const n = async t => (await db.query(`select count(*)::int n from public.${t}`)).rows[0].n

// ---- 4. Row Level Security ----
ok('ผู้ใช้ที่ไม่มี profile อ่านสินค้าไม่ได้', await as(U.nobody, () => n('product_types')) === 0)
ok('ผู้ใช้ที่ถูกปิด (active=false) อ่านงานไม่ได้', await as(U.off, () => n('jobs')) === 0)
ok('ผู้ควบคุมงานอ่านสินค้าได้ 37', await as(U.sup, () => n('product_types')) === 37)
ok('ผู้ควบคุมงานเห็นงาน', await as(U.sup, () => n('jobs')) === 1)
ok('ผู้ควบคุมงานเห็นแค่ profile ตัวเอง', await as(U.sup, () => n('profiles')) === 1)
ok('owner เห็น profile ทุกคน', await as(U.owner, () => n('profiles')) === 3)

await as(U.sup, () => db.exec(`update public.stations set name='x' where code='cut'`))
// update ที่ RLS กรองจะไม่ error แต่ไม่มีแถวเปลี่ยน → ตรวจผลจริง
const cutName = (await db.query(`select name from stations where code='cut'`)).rows[0].name
ok('ชื่อสถานีตัดไม่ถูกเปลี่ยนโดยผู้ควบคุมงาน', cutName === 'ตัดงาน', cutName)
await as(U.sup, () => expectError('ผู้ควบคุมงานสร้างงานตรงไม่ได้ (ต้องผ่าน RPC)',
  `insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date, route_code, confirmation_pdf_path)
   values ('SC-X','a','b','tshirt',1,'ตัว','2026-12-31','normal','x.pdf')`, /row-level security/))
await as(U.owner, async () => {
  await db.exec(`update public.stations set name='ตัดงาน (แก้)' where code='cut'`)
})
ok('owner แก้ข้อมูลตั้งค่าได้', (await db.query(`select name from stations where code='cut'`)).rows[0].name === 'ตัดงาน (แก้)')
await db.exec(`update public.stations set name='ตัดงาน' where code='cut'`)

// ---- 5. กฎข้อมูล ----
await expectError('รับงานโดยไม่มี PDF ใบยืนยันไม่ได้',
  `insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date, route_code)
   values ('SC-NOPDF','a','b','tshirt',1,'ตัว','2026-12-31','normal')`, /confirmation_pdf_path/)
await expectError('เลขที่ใบยืนยันซ้ำไม่ได้',
  `insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date, route_code, confirmation_pdf_path)
   values ('SC-TEST','a','b','tshirt',1,'ตัว','2026-12-31','normal','x.pdf')`, /duplicate|unique/)
await expectError('จำนวนต้องมากกว่า 0',
  `insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date, route_code, confirmation_pdf_path)
   values ('SC-Q0','a','b','tshirt',0,'ตัว','2026-12-31','normal','x.pdf')`, /check/)
await expectError('สินค้าที่ไม่มีในระบบใช้ไม่ได้',
  `insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date, route_code, confirmation_pdf_path)
   values ('SC-P','a','b','no_such','1','ตัว','2026-12-31','normal','x.pdf')`, /foreign key/)
await expectError('พักงานต้องมีสาเหตุ',
  `insert into public.issues (job_id, reason) select id, '   ' from public.jobs limit 1`, /check/)
await expectError('แก้ events ไม่ได้ (แม้เป็นผู้ดูแลฐานข้อมูล)', `update public.events set type='x'`, /เพิ่มอย่างเดียว/)
await expectError('ลบ events ไม่ได้', `delete from public.events`, /เพิ่มอย่างเดียว/)

// ---- 6. ฟังก์ชันสิทธิ์และ policy (migration 3) ----
const fn = await db.query(`select n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname in ('my_role','is_owner')`)
ok('ฟังก์ชันสิทธิ์อยู่ใน schema private เท่านั้น', fn.rows.length === 2 && fn.rows.every(r => r.nspname === 'private'))
await db.exec('set role anon')
try { await db.query('select private.my_role()'); ok('คนไม่ล็อกอิน (anon) เรียกฟังก์ชันสิทธิ์ไม่ได้', false) }
catch (e) { ok('คนไม่ล็อกอิน (anon) เรียกฟังก์ชันสิทธิ์ไม่ได้', /permission denied/.test(e.message), e.message.split('\n')[0]) }
finally { await db.exec('reset role') }
const multi = await db.query(`select tablename from pg_policies where schemaname = 'public' and cmd in ('SELECT','ALL') group by 1 having count(*) > 1`)
ok('ไม่มี policy อ่านซ้อนกันในตารางเดียว', multi.rows.length === 0, multi.rows.map(r => r.tablename).join(','))
const fkNoIdx = await db.query(`
  select c.conrelid::regclass::text t, c.conname from pg_constraint c
  where c.contype = 'f' and c.connamespace = 'public'::regnamespace
    and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])`)
ok('foreign key ทุกตัวมี index', fkNoIdx.rows.length === 0, fkNoIdx.rows.map(r => r.conname).join(','))

// ---- 7. workflow (A1) ----
const { workflowTests } = await import('./workflow.mjs')
await workflowTests({ db, ok, as })

// ---- 8. ผู้ควบคุมงาน 2 เฟส ----
const { sectionTests } = await import('./sections.mjs')
await sectionTests({ db, ok, as })

console.log(`\nผ่าน ${pass} · ไม่ผ่าน ${fail}`)
process.exit(fail ? 1 : 0)
