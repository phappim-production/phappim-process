// งานตัวอย่างที่สถานีตัด (4 งาน · 1 พักงาน · 1 กำลังทำ) สำหรับดูหน้าจอพนักงานในระบบจำลอง · ล้างข้อมูลเดิมก่อน
// ใช้กับ server.mjs ที่รันอยู่บน 127.0.0.1 เท่านั้น
const base = process.env.QA_ORIGIN ?? 'http://127.0.0.1:5214'
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(base)) throw new Error('ใช้ได้กับระบบจำลองในเครื่องเท่านั้น')

const sql = async (q, params = []) => {
  const r = await (await fetch(base + '/__qa/sql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql: q, params }) })).json()
  if (r.message) throw new Error(r.message)
  return r.rows
}
const as = (user, call, args) => sql(`with c as materialized (select set_config('request.jwt.claim.sub', $1, false) x) select ${call} from c`, [user, ...args])

await fetch(base + '/__qa/reset', { method: 'POST' })
const accounts = await (await fetch(base + '/__qa/accounts')).json()
const admin = accounts.find(a => a.key === 'admin1').id
const staff = accounts.find(a => a.key === 'staff_single').id

const ids = []
for (const [i, customer, days] of [[1, 'ร้านเสื้อทีมสยาม', -1], [2, 'โรงเรียนบ้านหนองบัว', 2], [3, 'บริษัท รุ่งเรืองการค้า', 5], [4, 'คุณสมศรี', 8]]) {
  const [row] = await as(admin, `public.receive_job(p_confirmation_no => $2, p_customer_name => $3, p_job_name => $4, p_product_type_code => 'tshirt',
    p_qty => $5, p_unit => 'ตัว', p_due_date => (current_date + $6::int), p_route_code => 'cut_only', p_confirmation_pdf_path => null,
    p_spare_qty => 0, p_confirmation_rev => 0, p_spec => '{}'::jsonb, p_needs_sample => false) as id`,
  [`SC6900${i}`, customer, `เสื้อทีม ${i}`, 50 * i, days])
  ids.push(row.id)
}
await as(staff, 'public.start_in_queue(p_job => $2::uuid, p_reason => null)', [ids[0]])
await as(staff, "public.open_issue(p_job => $2::uuid, p_reason => 'ใบมีดทื่อ')", [ids[0]])
await as(staff, 'public.start_in_queue(p_job => $2::uuid, p_reason => null)', [ids[1]])
console.log('พร้อมแล้ว · เข้าสู่ระบบ staff-single@r14.invalid แล้วเปิด #/board → สถานี 3 ตัด')
