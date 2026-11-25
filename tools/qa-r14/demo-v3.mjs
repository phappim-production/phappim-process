// ระบบจำลองในเครื่อง + ข้อมูลตัวอย่างสำหรับดูหน้าตาแบบใหม่ · 127.0.0.1 เท่านั้น
import { readFile } from 'node:fs/promises'
const WT = new URL('./', import.meta.url).href
const IMG = new URL('./demo-img/', import.meta.url)
const { startLocalStack } = await import(WT + 'server.mjs')

const stack = await startLocalStack()
const sql = async (q, params = []) => {
  const r = await (await fetch(stack.origin + '/__qa/sql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql: q, params }) })).json()
  if (r.message) throw new Error(r.message)
  return r.rows
}
const as = (user, call, args = []) => sql(`with c as materialized (select set_config('request.jwt.claim.sub', $1, false) x) select ${call} from c`, [user, ...args])
const accounts = await (await fetch(stack.origin + '/__qa/accounts')).json()
const id = k => accounts.find(a => a.key === k).id

const shirt = new Uint8Array(await readFile(new URL('mockup-back.jpg', IMG)))
const front = new Uint8Array(await readFile(new URL('mockup-front.png', IMG)))
const detail = new Uint8Array(await readFile(new URL('mockup-detail.webp', IMG)))

await as(id('owner'), 'public.set_station_photos_enabled(true, 15)')

async function job(no, customer, route, qty, days) {
  const [row] = await as(id('admin1'), `public.receive_job(p_confirmation_no => $2, p_customer_name => $3, p_job_name => 'เสื้อทีม', p_product_type_code => 'tshirt',
    p_qty => $4, p_unit => 'ตัว', p_due_date => (current_date + $5::int), p_route_code => $6, p_confirmation_pdf_path => null,
    p_spare_qty => 0, p_confirmation_rev => 0, p_spec => '{}'::jsonb, p_needs_sample => false) as id`, [no, customer, qty, days, route])
  const [{ mockup_path: mp }] = await sql(`update public.jobs set mockup_path = private.mockup_folder(confirmation_no) || '/front1.png' where id = $1 returning mockup_path`, [row.id])
  stack.r2Store.set('mockups/' + mp, { bytes: front, type: 'image/png' })
  return row.id
}
async function photos(user, jobId, station, names) {
  const [f] = await as(user, `(select json_build_object('folder', ff.folder, 'visit', ff.visit) from public.station_photo_flags() ff where ff.job_id = $2::uuid and ff.station_code = $3) as f`, [jobId, station])
  const flag = f.f
  const paths = names.map((n, i) => `${flag.folder}/${station}/${flag.visit}/${n}${i}.jpg`)
  paths.forEach((p, i) => stack.r2Store.set('station_photos/' + p, { bytes: i % 2 ? detail : shirt, type: 'image/jpeg' }))
  for (const [i, p] of paths.entries()) await sql("insert into private.file_objects (kind, path, size, content_type, uploaded_by) values ('station_photos', $1, $2, 'image/jpeg', $3) on conflict do nothing", [p, (i % 2 ? detail : shirt).byteLength, user])
  return paths
}

const staffCut = id('staff_single'), staffMulti = id('staff_multi'), admin = id('admin1')

const a = await job('SC777001', 'บริษัท เอสเทติกส์ แอนด์ เวลเนส', 'cut_only', 150, 2)
await as(staffCut, 'public.start_in_queue(p_job => $2::uuid, p_reason => null)', [a])
const aPhotos = await photos(staffCut, a, 'cut', ['first', 'logo'])
await as(staffCut, "public.submit_first_piece(p_job => $2::uuid, p_station => 'cut', p_photos => $3::text[], p_note => 'สีเข้มกว่าม็อคอัพนิดหน่อย')", [a, aPhotos])

const b = await job('SC777002', 'ร้านกาแฟบ้านสวน', 'normal', 60, 1)
await as(staffMulti, 'public.start_in_queue(p_job => $2::uuid, p_reason => null)', [b])
const bPhotos = await photos(staffMulti, b, 'print', ['print'])
const [{ id: bCheck }] = await as(staffMulti, "public.submit_first_piece(p_job => $2::uuid, p_station => 'print', p_photos => $3::text[]) as id", [b, bPhotos])
await as(admin, "public.decide_first_piece(p_check => $2::bigint, p_approve => false, p_reason => 'สีเพี้ยน · โลโก้ต่ำไป 2 ซม.')", [bCheck])

const c = await job('SC777003', 'โรงเรียนวัดป่าเลไลย์', 'cut_only', 80, 6)
await as(staffCut, 'public.start_in_queue(p_job => $2::uuid, p_reason => null)', [c])
const cPhotos = await photos(staffCut, c, 'cut', ['ok'])
const [{ id: cCheck }] = await as(staffCut, "public.submit_first_piece(p_job => $2::uuid, p_station => 'cut', p_photos => $3::text[]) as id", [c, cPhotos])
await as(admin, 'public.decide_first_piece(p_check => $2::bigint, p_approve => true)', [cCheck])

await job('SC777004', 'ทีมฟุตบอลบางนา', 'cut_only', 25, 3)
await job('SC777005', 'บจก. ไทยรุ่งเรือง', 'normal', 120, 4)

console.log('พร้อมแล้ว ' + stack.origin + '/__qa/switch')
