// รันท้ายสุดของ run.mjs เพราะสคริปต์ commit จริงและลบงาน TEST- ทุกงาน
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = readFileSync(join(here, '..', 'scripts', 'golive-cleanup.sql'), 'utf8')
const TESTER = '00000000-0000-0000-0000-0000000000a1'

export async function goliveCleanupTests({ db, ok }) {
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0]
  const job = no => val(`
    insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date, route_code, confirmation_pdf_path)
    values ($1, 'ลูกค้า', 'งาน', 'tshirt', 10, 'ตัว', '2026-12-31', 'normal', $2) returning id`, [no, no + '.pdf'])

  await db.exec(`
    insert into auth.users values ('${TESTER}', 'qc@pp142.test');
    insert into public.profiles (user_id, name, role, active) values ('${TESTER}', 'QC ทดสอบ', 'qc', true);
    insert into public.vendors (name) values ('บริษัทจริง ทดสอบล้าง');
  `)
  const vendor = await val(`select id from public.vendors where name = 'บริษัทจริง ทดสอบล้าง'`)
  const testA = await job('TEST-GL-1')
  const testSplit = await job('TEST-GL-1-2')
  const testB = await job('TEST-SIM-GL')
  const real = await job('SC699001')
  for (const id of [testA, testSplit, testB, real]) {
    await db.query(`insert into public.events (job_id, type, phase) values ($1, 'job_created', 'materials'), ($1, 'hold', 'production')`, [id])
    await db.query(`insert into public.issues (job_id, reason) values ($1, 'ผ้าไม่พอ')`, [id])
    await db.query(`insert into public.outsource_runs (job_id, vendor_id, from_seq, to_seq, stations, qty, arrive_at, lead_days, back_at)
                    values ($1, $2, 1, 1, '{print}', 10, now(), 1, now() + interval '1 day')`, [id, vendor])
    await db.query(`insert into public.inbox_messages (kind, job_id, dedupe_key, title, body, audience)
                    values ('due_soon', $1::uuid, 'golive-' || $1::text, 'ใกล้ครบ', 'ทดสอบ', '{owner}')`, [id])
  }
  await db.exec(`
    insert into public.confirmation_drafts (confirmation_no, data, status) values ('TEST-GL-9', '{}', 'draft'), ('SC699002', '{}', 'draft');
    insert into public.confirmation_drafts (confirmation_no, data, status, job_id) values ('SC699003', '{}', 'received', '${testB}');
    insert into public.confirmation_drafts (confirmation_no, data, status, job_id) values ('SC699001', '{}', 'received', '${real}');
    insert into private.rpc_requests (request_id, fn, result) values (gen_random_uuid(), 'record_qc', '');
  `)

  const realBefore = await val(`select count(*)::int from public.jobs where confirmation_no not like 'TEST-%'`)
  const realEvents = await val(`select count(*)::int from public.events where job_id = $1`, [real])
  const realQueue = (await db.query(`select id, queue_seq from public.jobs where confirmation_no not like 'TEST-%' order by id`)).rows.map(r => `${r.id}:${r.queue_seq}`).join()
  const vendorsBefore = await val(`select count(*)::int from public.vendors`)

  let results
  try { results = await db.exec(script); ok('สคริปต์ล้างข้อมูลรันจนจบ', true) }
  catch (e) { ok('สคริปต์ล้างข้อมูลรันจนจบ', false, e.message.split('\n')[0]); return }
  const summary = results.find(r => r.rows.length && 'รายการ' in r.rows[0])?.rows ?? []
  const get = item => summary.find(r => r.รายการ.startsWith(item))?.ผล

  ok('ไม่เหลืองาน TEST- (รวมงานแบ่ง -2)', await val(`select count(*)::int from public.jobs where confirmation_no like 'TEST-%'`) === 0)
  ok('งานจริงครบเท่าเดิม', await val(`select count(*)::int from public.jobs`) === realBefore)
  ok('งานจริงวันทดลองยังอยู่', await val(`select count(*)::int from public.jobs where id = $1`, [real]) === 1)
  ok('ประวัติ (events) งานจริงครบ', await val(`select count(*)::int from public.events where job_id = $1`, [real]) === realEvents)
  const orphan = await val(`
    select (select count(*) from public.events where job_id in ($1, $2, $3))
         + (select count(*) from public.issues where job_id in ($1, $2, $3))
         + (select count(*) from public.outsource_runs where job_id in ($1, $2, $3))
         + (select count(*) from public.inbox_messages where job_id in ($1, $2, $3))`, [testA, testSplit, testB])
  ok('ประวัติ/ปัญหา/ส่งออก/แจ้งเตือนของงานทดสอบหายหมด', Number(orphan) === 0, String(orphan))
  ok('ปัญหา + รอบส่งออกของงานจริงยังอยู่',
    await val(`select count(*)::int from public.issues where job_id = $1`, [real]) === 1 &&
    await val(`select count(*)::int from public.outsource_runs where job_id = $1`, [real]) === 1)
  const drafts = (await db.query(`select confirmation_no from public.confirmation_drafts where confirmation_no in ('TEST-GL-9','SC699001','SC699002','SC699003') order by 1`)).rows.map(r => r.confirmation_no)
  ok('ใบร่าง: ลบของงานทดสอบ (เลข TEST- หรือผูกงานทดสอบ) · เก็บของจริง', drafts.join(',') === 'SC699001,SC699002', drafts.join(','))
  ok('ล้างบันทึกกันคำขอซ้ำ', await val(`select count(*)::int from private.rpc_requests`) === 0)
  ok('บริษัทภายนอกไม่ถูกลบ', await val(`select count(*)::int from public.vendors`) === vendorsBefore)
  ok('ปิดบัญชี @pp142.test', await val(`select active from public.profiles where user_id = $1`, [TESTER]) === false)
  ok('บัญชีจริงยังเปิดอยู่', await val(`select active from public.profiles where user_id = '00000000-0000-0000-0000-000000000001'`) === true)
  ok('งานจริงเลขคิวเดิมทุกแถว',
    (await db.query(`select id, queue_seq from public.jobs order by id`)).rows.map(r => `${r.id}:${r.queue_seq}`).join() === realQueue)
  ok('ตารางผลสรุปบอกจำนวนงานที่ลบ', Number(get('ลบงานทดสอบ')) >= 3 && get('งานจริงที่เหลือ') === String(realBefore), JSON.stringify(summary))
  ok('ตารางผลสรุป: trigger กันลบประวัติเปิดคืนแล้ว', get('trigger') === 'เปิดอยู่ (ถูกต้อง)')
  try { await db.exec(`delete from public.events where job_id = '${real}'`); ok('หลังล้าง ลบ events ไม่ได้เหมือนเดิม', false) }
  catch (e) { ok('หลังล้าง ลบ events ไม่ได้เหมือนเดิม', /เพิ่มอย่างเดียว/.test(e.message)) }

  // รันซ้ำได้ ไม่พัง (เผื่อเจ้าของกดซ้ำ)
  try { const again = await db.exec(script); ok('รันซ้ำได้ ไม่ลบงานจริง',
    await val(`select count(*)::int from public.jobs`) === realBefore &&
    again.some(r => r.rows.some(x => x.รายการ?.startsWith('ลบงานทดสอบ') && x.ผล === '0'))) }
  catch (e) { ok('รันซ้ำได้ ไม่ลบงานจริง', false, e.message.split('\n')[0]) }
}
