// ทดสอบ migrations บน Postgres ในเครื่อง (PGlite) โดยไม่ต้องมี Supabase/Docker
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

// จำลองส่วนที่ Supabase มีให้: schema auth, auth.uid(), บทบาท authenticated/anon
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role authenticated nologin;
  create role anon nologin;
`)

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
// ชุดทดสอบเดิมรับงานแล้วเริ่มสถานีแรกทันที · ขั้นรอผลิต (เช็ควัตถุดิบ) ทดสอบแยกใน materials-check.mjs
await db.exec('update public.production_settings set materials_check = false')

const count = async t => (await db.query(`select count(*)::int n from public.${t}`)).rows[0].n
ok('สถานี 9 สถานี', await count('stations') === 9)
ok('เส้นทาง 14 เส้น (รวมงานบริการ 5)', await count('routes') === 14)
ok('ลำดับสถานีในเส้นทาง 45 แถว', await count('route_stations') === 45)
ok('สินค้า 41 รายการ (รวมงานบริการ 3)', await count('product_types') === 41)
{
  const recipe = async code => (await db.query(`select type_code || ':' || qty r from public.product_machine_needs where product_type_code = $1 order by 1`, [code])).rows.map(x => x.r).join()
  const jersey = await recipe('jersey')
  ok('เสื้อเจอร์ซีย์มีสูตรจักรเหมือนเสื้อกีฬา', !!jersey && jersey === await recipe('sport'), jersey)
}
ok('แม่แบบวัตถุดิบ 8 รายการ', await count('material_templates') === 8)
const r = await db.query(`select string_agg(s.name, ' → ' order by rs.seq) path from route_stations rs join stations s on s.code = rs.station_code where rs.route_code = 'dtf'`)
ok('เส้นทาง DTF เรียงถูก', r.rows[0].path === 'ตัดงาน → รีดฟิล์ม (DTF / DTG / สกรีน) → เย็บงาน → QC + Packing', r.rows[0].path)
const bad = await db.query(`select code from stations where code <> 'outside' and (jsonb_typeof(substeps) <> 'array' or jsonb_array_length(substeps) = 0)`)
ok('ทุกสถานีในโรงงานมีขั้นย่อย (สั่งผลิตข้างนอกไม่มี)', bad.rows.length === 0)

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

ok('ผู้ใช้ที่ไม่มี profile อ่านสินค้าไม่ได้', await as(U.nobody, () => n('product_types')) === 0)
ok('ผู้ใช้ที่ถูกปิด (active=false) อ่านงานไม่ได้', await as(U.off, () => n('jobs')) === 0)
ok('ผู้ควบคุมงานอ่านสินค้าได้ 41', await as(U.sup, () => n('product_types')) === 41)
ok('ผู้ควบคุมงานเห็นงาน', await as(U.sup, () => n('jobs')) === 1)
ok('ผู้ควบคุมงานเห็นแค่ profile ตัวเอง', await as(U.sup, () => n('profiles')) === 1)
ok('owner เห็น profile ทุกคน', await as(U.owner, () => n('profiles')) === 3)

await as(U.sup, () => db.exec(`update public.stations set name='x' where code='cut'`))
// update ที่ RLS กรองจะไม่ error แต่ไม่มีแถวเปลี่ยน → ตรวจผลจริง
const cutName = (await db.query(`select name from stations where code='cut'`)).rows[0].name
ok('ชื่อสถานีตัดไม่ถูกเปลี่ยนโดยผู้ควบคุมงาน', cutName === 'ตัดงาน', cutName)
await as(U.sup, () => expectError('ผู้ควบคุมงานสร้างงานตรงไม่ได้ (ต้องผ่าน RPC)',
  `insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date, route_code, confirmation_pdf_path)
   values ('SC-X','a','b','tshirt',1,'ตัว','2026-12-31','normal','x.pdf')`, /row-level security|permission denied for sequence job_queue_seq/))
await as(U.owner, async () => {
  await db.exec(`update public.stations set name='ตัดงาน (แก้)' where code='cut'`)
})
ok('owner แก้ข้อมูลตั้งค่าได้', (await db.query(`select name from stations where code='cut'`)).rows[0].name === 'ตัดงาน (แก้)')
await db.exec(`update public.stations set name='ตัดงาน' where code='cut'`)

// PDF ใบยืนยันว่างได้ (แนบทีหลัง) · ทดสอบใน workflow.mjs / storage.mjs
ok('ตาราง jobs ยอมให้ PDF ใบยืนยันว่าง (แนบทีหลังได้)', (await db.query(`select is_nullable from information_schema.columns
  where table_schema = 'public' and table_name = 'jobs' and column_name = 'confirmation_pdf_path'`)).rows[0]?.is_nullable === 'YES')
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

const { sopTests } = await import('./sop.mjs')
await sopTests({ db, ok })
const machines = (await db.query(`select code, machines, machine_pool from public.stations where machines is not null order by code`)).rows
const dtfPool = (await db.query(`select machine_pool from public.stations where code = 'dtf_press'`)).rows[0].machine_pool
ok('รีดฟิล์มไม่ใช้เครื่องรีดร้อนร่วมกับรีด', dtfPool === 'dtf_press', dtfPool)
ok('เครื่องจริงต่อสถานี: พิมพ์ 2 · รีด 1 · ตัด 2 · รีดฟิล์ม 2 (เครื่องของตัวเอง) · QC 1',
  JSON.stringify(machines.map(r => [r.code, r.machines, r.machine_pool])) === JSON.stringify([
    ['cut', 2, 'cut'], ['dtf_press', 2, 'dtf_press'], ['press', 1, 'heat_press'], ['print', 2, 'print'], ['qc_pack', 1, 'qc_pack']]), JSON.stringify(machines))
// ชุดทดสอบอื่นทิ้งงาน "กำลังทำ" ไว้หลายงานในฐานเดียวกัน จึงปิดการจำกัดเครื่อง · station-machines.mjs ทดสอบการจำกัดเอง
await db.exec('update public.stations set machines = null')
// ชุด workflow เดินงานแบบยังไม่มีจักร และ sewing.mjs ตั้งจักรสมมติเอง จึงล้างจักรจริงออกหลังตรวจข้อมูลแล้ว
await db.exec('delete from public.sewing_machines')

const { workflowTests } = await import('./workflow.mjs')
await workflowTests({ db, ok, as })

const { sectionTests } = await import('./sections.mjs')
await sectionTests({ db, ok, as })

const { productionTests } = await import('./production.mjs')
await productionTests({ db, ok, as })

const { teamTests } = await import('./e2e.mjs')
await teamTests({ db, ok, as })

const { sewingTests } = await import('./sewing.mjs')
await sewingTests({ db, ok, as })

const { storageTests } = await import('./storage.mjs')
await storageTests({ db, ok, as })
const { r2FileTests } = await import('./r2-files.mjs')
await r2FileTests({ db, ok, as })
const { r2EndToEndTests } = await import('./r2-e2e.mjs')
await r2EndToEndTests({ db, ok, as })

const { inboxTests } = await import('./inbox.mjs')
await inboxTests({ db, ok, as })

const { routeTests } = await import('./routes.mjs')
await routeTests({ db, ok, as })
const { settingsTests } = await import('./settings.mjs')
await settingsTests({ db, ok, as })

const { staffTests } = await import('./staff.mjs')
await staffTests({ db, ok, as })
const { staffRoleTests } = await import('./staff-role.mjs')
await staffRoleTests({ db, ok, as })
const { sewingPickTests } = await import('./sewing-pick.mjs')
await sewingPickTests({ db, ok, as })
const { stationMachineTests } = await import('./station-machines.mjs')
await stationMachineTests({ db, ok, as })
const { auditReviewTests } = await import('./audit-reviews.mjs')
await auditReviewTests({ db, ok, as })
const { historyTests } = await import('./history.mjs')
await historyTests({ db, ok, as })
const { confirmationTests } = await import('./confirmations.mjs')
await confirmationTests({ db, ok, as })
const { mockupTests } = await import('./mockups.mjs')
await mockupTests({ db, ok, as })
const { mockupSheetTests } = await import('./mockup-sheets.mjs')
await mockupSheetTests({ db, ok, as })
const { deliveryTests } = await import('./delivery.mjs')
await deliveryTests({ db, ok, as })
const { cancelJobTests } = await import('./cancel-job.mjs')
await cancelJobTests({ db, ok, as })
const { reviseSpecTests } = await import('./revise-spec.mjs')
await reviseSpecTests({ db, ok, as })
const { developTests } = await import('./develop.mjs')
await developTests({ db, ok, as })
const { queueTests } = await import('./queue.mjs')
await queueTests({ db, ok, as })
const { outsourcingTests } = await import('./outsourcing.mjs')
await outsourcingTests({ db, ok, as })
const { outsideRouteTests } = await import('./outside-route.mjs')
await outsideRouteTests({ db, ok, as })
const { sweepFixTests } = await import('./sweep-fixes.mjs')
await sweepFixTests({ db, ok, as })
const { stationPhotoTests } = await import('./station-photos.mjs')
await stationPhotoTests({ db, ok, as })
const { leadTimeTests } = await import('./lead-time.mjs')
await leadTimeTests({ db, ok })
const { ceYearTests } = await import('./ce-year.mjs')
await ceYearTests({ db, ok })
const { bugSweepTests } = await import('./bug-sweep.mjs')
await bugSweepTests({ db, ok })
const { sweepLeftoverTests } = await import('./sweep-leftovers.mjs')
await sweepLeftoverTests({ db, ok })
const { materialsCheckTests } = await import('./materials-check.mjs')
await materialsCheckTests({ db, ok })
const { serviceRouteTests } = await import('./service-routes.mjs')
await serviceRouteTests({ db, ok })
const { confirmationAckTests } = await import('./confirmation-ack.mjs')
await confirmationAckTests({ db, ok, as })
const { flowR5Tests } = await import('./flow-r5.mjs')
await flowR5Tests({ db, ok, as })

const { flowR6Tests } = await import('./flow-r6.mjs')
await flowR6Tests({ db, ok, as })

// ---- เดินงานครบทุกเส้นทางด้วยค่าตั้งค่าเดียวกับระบบจริง (ธุรกรรมเดียว · rollback ตอนจบ) ----
const { flowR8Tests } = await import('./flow-r8.mjs')
await flowR8Tests({ db, ok })
const { flowR9Tests } = await import('./flow-r9.mjs')
await flowR9Tests({ db, ok })
const { flowR11Tests } = await import('./flow-r11.mjs')
await flowR11Tests({ db, ok })
const { flowR12Tests } = await import('./flow-r12.mjs')
await flowR12Tests({ db, ok })
const { flowR13Tests } = await import('./flow-r13.mjs')
await flowR13Tests({ db, ok })
const { flowRouteTests } = await import('./flow-routes.mjs')
await flowRouteTests({ db, ok })

// ---- สคริปต์ล้างข้อมูลก่อนเปิดใช้ (ต้องอยู่ท้ายสุด: commit จริงและลบงาน TEST- ทั้งหมด) ----
const { goliveCleanupTests } = await import('./golive-cleanup.mjs')
await goliveCleanupTests({ db, ok })

console.log(`\nผ่าน ${pass} · ไม่ผ่าน ${fail}`)
process.exit(fail ? 1 : 0)
