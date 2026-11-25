// งานตัวอย่างหลายสถานีสำหรับจับภาพคู่มือ · ใช้กับระบบจำลองในเครื่องเท่านั้น · ล้างข้อมูลเดิมก่อน
import { readFile } from 'node:fs/promises'

const base = process.env.QA_ORIGIN ?? 'http://127.0.0.1:5214'
const filesBase = process.env.QA_FILES_ORIGIN ?? 'http://127.0.0.1:5215'
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(base)) throw new Error('ใช้ได้กับระบบจำลองในเครื่องเท่านั้น')

const sql = async (q, params = []) => {
  const r = await (await fetch(base + '/__qa/sql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql: q, params }) })).json()
  if (r.message) throw new Error(r.message)
  return r.rows
}
const as = (user, call, args = []) => sql(`with c as materialized (select set_config('request.jwt.claim.sub', $1, false) x) select ${call} from c`, [user, ...args])

await fetch(base + '/__qa/reset', { method: 'POST' })
const accounts = await (await fetch(base + '/__qa/accounts')).json()
const id = key => accounts.find(a => a.key === key).id
const admin = id('admin1'), prod = id('prod1'), qc = id('qc')

async function receive(no, customer, job, product, qty, days, route) {
  const [row] = await as(admin, `public.receive_job(p_confirmation_no => $2, p_customer_name => $3, p_job_name => $4, p_product_type_code => $5,
    p_qty => $6, p_unit => 'ตัว', p_due_date => (current_date + $7::int), p_route_code => $8, p_confirmation_pdf_path => null,
    p_spare_qty => 0, p_confirmation_rev => 0, p_spec => '{}'::jsonb, p_needs_sample => false) as id`, [no, customer, job, product, qty, days, route])
  return row.id
}
const start = (user, job) => as(user, 'public.start_in_queue(p_job => $2::uuid, p_reason => null)', [job])
  .catch(err => /คิวแรก/.test(err.message) ? as(user, "public.start_in_queue(p_job => $2::uuid, p_reason => 'งานด่วนลูกค้าเลื่อนวันส่ง')", [job]) : Promise.reject(err))
const finish = async (user, job) => {
  const [{ s }] = await sql('select rs.station_code s from public.jobs j join public.route_stations rs on rs.route_code = j.route_code and rs.seq = j.station_seq where j.id = $1', [job])
  await as(user, 'public.finish_station(p_job => $2::uuid, p_station => $3)', [job, s])
}
const pass = (user, job) => start(user, job).then(() => finish(user, job))

const f = await receive('SC69106', 'ชมรมวิ่งเช้า', 'เสื้อวิ่งมินิมาราธอน', 'running', 150, -1, 'normal')
const c = await receive('SC69103', 'บริษัท รุ่งเรืองการค้า', 'เสื้อโปโลพนักงาน', 'polo', 80, 3, 'normal')
const d = await receive('SC69104', 'คุณสมศรี', 'เสื้อยืดงานบุญ', 'tshirt', 50, 1, 'cut_only')
const e = await receive('SC69105', 'ร้านกาแฟดอยสูง', 'ผ้ากันเปื้อนร้าน', 'tshirt', 30, 4, 'cut_only')
const a = await receive('SC69101', 'ร้านเสื้อทีมสยาม', 'เสื้อกีฬาสีประจำปี', 'sport', 120, 6, 'normal')
const b = await receive('SC69102', 'โรงเรียนบ้านหนองบัว', 'เสื้อพละ ม.ต้น', 'pe', 200, 9, 'normal')
const g = await receive('SC69107', 'สมาคมศิษย์เก่า', 'เสื้อปักโลโก้', 'polo', 60, 12, 'emb')
await receive('SC69108', 'ร้านป้ายดีไซน์', 'เสื้อทีมฟุตซอล', 'sport', 40, 10, 'normal')

const sew = await receive('SC69111', 'สโมสรฟุตบอลบ้านโป่ง', 'เสื้อแข่งฤดูกาลใหม่', 'sport', 100, 5, 'normal')
await pass(prod, sew); await pass(prod, sew); await pass(prod, sew)
await as(prod, 'public.start_sewing(p_job => $2::uuid)', [sew])
const sewNext = await receive('SC69112', 'ทีมวอลเลย์บอลหญิง', 'เสื้อซ้อมทีม', 'sport', 60, 7, 'normal')
await pass(prod, sewNext); await pass(prod, sewNext); await pass(prod, sewNext)
const [spare] = await sql("select m.code from public.sewing_machines m where m.status = 'ready' and not exists (select 1 from public.machine_assignments x where x.machine_id = m.id and x.released_at is null) order by m.code desc limit 1")
await as(prod, "public.set_machine_status(p_machine_code => $2, p_status => 'broken', p_note => 'เข็มหัก รอช่างมาเปลี่ยน', p_repair_eta => now() + interval '1 day')", [spare.code])
await as(prod, "public.book_machines(p_job => $2::uuid, p_starts => date_trunc('day', now()) + interval '1 day 2 hours', p_ends => date_trunc('day', now()) + interval '1 day 6 hours')", [sewNext])

await pass(prod, f); await pass(prod, f); await start(prod, f)
await pass(prod, c); await start(prod, c)
await pass(prod, d)
await pass(prod, e); await start(qc, e)
await start(prod, a)
await start(prod, g)
await as(prod, "public.open_issue(p_job => $2::uuid, p_reason => 'ใบมีดทื่อ รอเปลี่ยนใบมีด')", [f])
void b

await as(admin, 'public.save_confirmation_draft(p_data => $2::jsonb)', [JSON.stringify({
  app: 'phappim-confirm', v: 1, product: 'tshirt',
  h: { doc_no: 'SC69120', customer: 'ร้านดอกไม้บานเย็น', job_name: 'เสื้อยืดพนักงานร้าน', due_date: '2026-12-12', issue_date: '2026-11-23', sample: 'ไม่ขึ้นตัวอย่าง', delivery: 'ลูกค้ารับเองที่โรงงาน' },
  p: { tshirt: { size_sets: ['ไซซ์ผู้ใหญ่'], sizes: [{ label: 'ชมพู', q: { M: 20, L: 15 } }], print_method: ['DTF (ฟิล์มรีดร้อน)'] } },
  summary: { qty: 35 },
})])

const tokenFor = async key => (await (await fetch(base + '/auth/v1/token?grant_type=refresh_token', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: 'r14-refresh-' + key }),
})).json()).access_token
async function upload(key, kind, path, body, type) {
  const r = await fetch(`${filesBase}/upload/${kind}/${path}`, { method: 'PUT', headers: { authorization: 'Bearer ' + await tokenFor(key), 'content-type': type }, body })
  if (!r.ok) throw new Error(`อัปโหลด ${path} ไม่ได้: ${await r.text()}`)
  return path
}
const demo = name => readFile(new URL('../qa-r14/demo-img/' + name, import.meta.url))
const folder = async job => (await sql('select private.mockup_folder(confirmation_no) f from public.jobs where id = $1', [job]))[0].f

const front = await demo('mockup-front.png')
for (const job of [a, c, f, g]) {
  const path = await upload('admin1', 'mockups', `${await folder(job)}/front01.png`, front, 'image/png')
  await as(admin, 'public.set_job_mockup(p_job => $2::uuid, p_path => $3)', [job, path])
}

const owner = id('owner')
const pdf = Buffer.from(['%PDF-1.4', '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj', 'trailer<</Root 1 0 R>>', '%%EOF', ''].join(String.fromCharCode(10)))
await as(admin, 'public.attach_confirmation_pdf(p_job => $2::uuid, p_path => $3)', [a, await upload('admin1', 'confirmations', `${await folder(a)}/signed01.pdf`, pdf, 'application/pdf')])
const sampled = (await as(admin, `public.receive_job(p_confirmation_no => 'SC69109', p_customer_name => 'ร้านชุดว่ายน้ำทะเลใส', p_job_name => 'เสื้อทีมว่ายน้ำ',
  p_product_type_code => 'tshirt', p_qty => 40, p_unit => 'ตัว', p_due_date => (current_date + 2), p_route_code => 'cut_only',
  p_confirmation_pdf_path => null, p_needs_sample => true) as id`))[0].id
await pass(prod, sampled); await pass(qc, sampled)
await as(admin, "public.record_sample_result(p_job => $2::uuid, p_pass => false, p_note => 'สีเข้มกว่าที่ลูกค้าต้องการ')", [sampled])
await pass(prod, sampled); await pass(qc, sampled)
await as(admin, 'public.record_sample_result(p_job => $2::uuid, p_pass => true, p_customer_confirmed_at => current_date)', [sampled])
await pass(prod, sampled)
await start(qc, sampled)
await as(qc, 'public.record_qc(p_job => $2::uuid, p_passed => 40)', [sampled])
await finish(qc, sampled)
const [wrong] = await sql("select id from public.events where job_id = $1 and type = 'station_start' order by id desc limit 1", [sampled])
await as(prod, "public.correct_event(p_job => $2::uuid, p_event_id => $3::bigint, p_reason => 'กดเริ่มผิดงาน กดซ้ำจากแท็บเล็ตอีกเครื่อง')", [sampled, wrong.id])

const vendor = (await as(admin, "public.add_vendor(p_name => 'บริษัท เย็บดีการ์เมนต์ จำกัด', p_stations => array['cut','sew']) as id"))[0].id
const outJob = await receive('SC69110', 'บริษัท ก้าวหน้าโลจิสติกส์', 'เสื้อแจ็กเก็ตพนักงาน', 'tshirt', 90, 8, 'cut_only')
await as(admin, `public.send_out(p_job => $2::uuid, p_vendor => $3::bigint, p_last_station => 'cut', p_arrive_at => now() + interval '1 day',
  p_lead_days => 3, p_back_at => now() + interval '5 days', p_note => 'ตัดตามแพทเทิร์นที่แนบ')`, [outJob, vendor])

await as(owner, 'public.set_station_photos_enabled(p_on => true)')
const photoJob = await receive('SC69113', 'ร้านเสื้อทีมสยาม', 'เสื้อกีฬาสีชุดที่ 2', 'sport', 80, 9, 'normal')
const path = await upload('admin1', 'mockups', `${await folder(photoJob)}/front01.png`, front, 'image/png')
await as(admin, 'public.set_job_mockup(p_job => $2::uuid, p_path => $3)', [photoJob, path])
await start(prod, photoJob)
const visit = (await sql('select visit from public.jobs where id = $1', [photoJob]))[0].visit
const photos = []
for (const [i, name] of ['mockup-back.jpg', 'mockup-front.png'].entries()) {
  const jpg = name.endsWith('.jpg') ? await demo(name) : await demo('mockup-back.jpg')
  photos.push(await upload('prod1', 'station_photos', `${await folder(photoJob)}/print/${visit}/first0${i + 1}.jpg`, jpg, 'image/jpeg'))
}
await as(prod, "public.submit_first_piece(p_job => $2::uuid, p_station => 'print', p_photos => $3::text[], p_note => 'สีแดงเข้มกว่าม็อคอัพนิดหน่อย')", [photoJob, photos])

const rows = await sql('select j.confirmation_no, rs.station_code, j.station_status from public.jobs j left join public.route_stations rs on rs.route_code = j.route_code and rs.seq = j.station_seq order by 1')
console.log(rows.map(r => `${r.confirmation_no} ${r.station_code} ${r.station_status}`).join('\n'))
