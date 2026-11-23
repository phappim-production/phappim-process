// งานตัวอย่างหลายสถานีสำหรับจับภาพคู่มือ · ใช้กับระบบจำลองในเครื่องเท่านั้น · ล้างข้อมูลเดิมก่อน
const base = process.env.QA_ORIGIN ?? 'http://127.0.0.1:5214'
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

const rows = await sql('select j.confirmation_no, rs.station_code, j.station_status from public.jobs j left join public.route_stations rs on rs.route_code = j.route_code and rs.seq = j.station_seq order by 1')
console.log(rows.map(r => `${r.confirmation_no} ${r.station_code} ${r.station_status}`).join('\n'))
