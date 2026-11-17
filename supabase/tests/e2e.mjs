// เดินงานแบบทีมจริงหลังเลิกใช้ผู้ควบคุมงาน: ฝ่ายผลิต + แอดมิน + QC เท่านั้น (ไม่มีบัญชี supervisor)
// ตามรายการตรวจทั้งระบบ docs/แผน-1-สัปดาห์.md หัวข้อ 4.3 · เรียกจาก run.mjs ก่อน sewing.mjs (ยังไม่มีจักร)

import { requiredSteps, substepSql } from './steps.mjs'

export async function teamTests({ db, ok, as }) {
  const U = {
    admin: '00000000-0000-0000-0000-000000000011', qc: '00000000-0000-0000-0000-000000000012',
    prod: '00000000-0000-0000-0000-000000000013',
  }
  const call = (uid, sql) => as(uid, () => db.query(`select ${sql}`))
  const step = async (name, uid, sql) => {
    try { await call(uid, sql); return true } catch (e) { ok(`${name} (ติดที่: ${sql.split('(')[0]})`, false, e.message.split('\n')[0]); return false }
  }
  const reject = async (name, uid, sql, re) => {
    try { await call(uid, sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') }
    catch (e) { ok(name, re ? re.test(e.message) : true, e.message.split('\n')[0]) }
  }
  const live = async id => (await db.query(`select * from public.job_live where id = '${id}'`)).rows[0]
  const receive = async (no, route) => (await call(U.prod, `public.receive_job('${no}', 'ลูกค้าทีมจริง', 'งานทีมจริง', 'tshirt', 10, 'ตัว', '2026-12-31', '${route}', 'confirmations/${no}.pdf') as id`)).rows[0].id
  const tickMaterials = async id => {
    const rows = (await db.query(`select id, dept, key from public.job_materials where job_id = '${id}' order by id`)).rows
    let all = true
    for (const m of rows) {
      if (m.key === 'dtf_film') continue
      all = await step('ติ๊กวัตถุดิบ', { admin: U.admin, qc: U.qc, production: U.prod }[m.dept], `public.check_material(${m.id})`) && all
    }
    return all
  }
  // ขั้นที่ต้องทำในแต่ละสถานี อ่านจากขั้นย่อยจริงในตาราง (ตัวอย่าง = เฉพาะ req · ผลิตจริง = ครบทุกขั้นบังคับ)
  const sub = substepSql
  const route = async code => (await db.query(`select station_code from public.route_stations where route_code = '${code}' order by seq`)).rows.map(r => r.station_code)

  // สถานีหนึ่งตามที่คนหน้างานกดจริง · เย็บ = เริ่ม → (ผลิตจริง: ตัวแรก + ยอดเย็บ) → เย็บเสร็จ · QC = บันทึกผ่าน + นับ + ลงลัง
  const doStation = async (id, s, phase, who = U.prod) => {
    if (!await step(`${s}: เริ่ม`, who, `public.start_station('${id}')`)) return false
    if (s === 'sew') {
      if (phase === 'production') {
        if (!await step('เย็บ: ตัวแรก', who, sub(id, 'first_piece'))) return false
        if (!await step('เย็บ: ยอดเย็บ', who, `public.update_sew_count('${id}', 10)`)) return false
      }
      return step('เย็บ: เย็บเสร็จ', who, `public.finish_sewing('${id}')`)
    }
    if (s === 'qc_pack' && phase === 'production' && !await step('QC: บันทึกผ่าน', who, `public.record_qc('${id}', 10)`)) return false
    for (const [k, v] of await requiredSteps(db, s, phase)) if (!await step(`${s}: ${k}`, who, sub(id, k, v))) return false
    return step(`${s}: เสร็จ`, who, `public.finish_station('${id}')`)
  }

  // ---------- 1. งานปกติ ตั้งแต่รับงานจนเสร็จ (ตัวอย่างไม่ผ่าน 1 รอบ) ----------
  const A = await receive('SC-TEAM-A', 'normal')
  ok('ทีมจริง: ฝ่ายผลิตรับงานได้ → รอวัตถุดิบ', (await live(A)).phase === 'materials')
  await reject('ทีมจริง: ยังติ๊กวัตถุดิบไม่ครบ ขึ้นตัวอย่างไม่ได้', U.prod, `public.start_station('${A}')`)
  ok('ทีมจริง: ทุกฝ่ายติ๊กวัตถุดิบของตัวเองได้', await tickMaterials(A))
  ok('ทีมจริง: วัตถุดิบครบ → ขึ้นตัวอย่างอัตโนมัติ', (await live(A)).phase === 'sample')
  let walked = true
  for (const s of await route('normal')) walked = walked && await doStation(A, s, 'sample')
  ok('ทีมจริง: ฝ่ายผลิตเดินตัวอย่างครบทุกสถานี (พิมพ์ถึง QC)', walked && (await live(A)).phase === 'sample_review')
  await reject('ทีมจริง: ฝ่ายผลิตบันทึกผลตัวอย่างไม่ได้ (แอดมินเท่านั้น)', U.prod, `public.record_sample_result('${A}', true)`, /ทำขั้นนี้ไม่ได้/)
  ok('ทีมจริง: แอดมินบันทึกตัวอย่างไม่ผ่าน → รอบ 2', await step('ผลตัวอย่าง', U.admin, `public.record_sample_result('${A}', false, 'สีเพี้ยน')`) && (await live(A)).sample_round === 2)
  walked = true
  for (const s of await route('normal')) walked = walked && await doStation(A, s, 'sample')
  ok('ทีมจริง: ตัวอย่างรอบ 2 ผ่าน → ผลิตจริงที่สถานีพิมพ์',
    walked && await step('ผลตัวอย่าง', U.admin, `public.record_sample_result('${A}', true)`) && (await live(A)).current_station === 'print')
  walked = true
  for (const s of await route('normal')) {
    walked = walked && await doStation(A, s, 'production')
    if (s === 'sew') ok('ทีมจริง: เย็บเสร็จ → QC + Packing', (await live(A)).current_station === 'qc_pack')
  }
  const a = await live(A)
  ok('ทีมจริง: ฝ่ายผลิตเดินผลิตจริงจนงานเสร็จ', walked && a.phase === 'done' && a.qc_passed === 10, `${a.phase} ${a.current_station}`)
  const noBy = (await db.query(`select count(*)::int n from public.events where job_id = '${A}' and by is null`)).rows[0].n
  ok('ทีมจริง: ทุกการกดบันทึกชื่อผู้กด', noBy === 0, `ไม่มีชื่อ ${noBy} แถว`)

  // ---------- 2. DTF: ฟิล์ม + QC เป็นคนกด QC ----------
  const B = await receive('SC-TEAM-B', 'dtf')
  ok('ทีมจริง DTF: แอดมินสั่งฟิล์ม + ทุกฝ่ายติ๊กวัตถุดิบ',
    await step('สั่งฟิล์ม', U.admin, `public.order_film('${B}', (now() + interval '2 days')::date)`) && await tickMaterials(B) && (await live(B)).phase === 'sample')
  await doStation(B, 'cut', 'sample')
  await reject('ทีมจริง DTF: ยังไม่ได้รับฟิล์ม ฝ่ายผลิตเริ่มรีด DTF ไม่ได้', U.prod, `public.start_station('${B}')`, /ยังไม่ได้รับฟิล์ม/)
  await step('รับฟิล์ม', U.admin, `public.receive_film('${B}')`)
  ok('ทีมจริง DTF: ได้ฟิล์มแล้วเดินตัวอย่างต่อจนรอผล',
    await doStation(B, 'dtf_press', 'sample') && await doStation(B, 'sew', 'sample') && await doStation(B, 'qc_pack', 'sample', U.qc)
    && (await live(B)).phase === 'sample_review')

  // ---------- 3. กดพร้อมกัน 2 เครื่อง (กฎ 11) · พักงาน (กฎ 9) ----------
  const C = await receive('SC-TEAM-C', 'plain')
  await tickMaterials(C)
  await step('เริ่มตัด', U.prod, `public.start_station('${C}')`)
  await reject('ทีมจริง: แท็บเล็ตเครื่องที่ 2 กดเริ่มซ้ำ → สถานะเปลี่ยนแล้ว', U.prod, `public.start_station('${C}')`, /สถานะ/)
  ok('ทีมจริง: ฝ่ายผลิตพักงาน (มีสาเหตุ) และกดแก้แล้วได้',
    await step('พัก', U.prod, `public.open_issue('${C}', 'ผ้าไม่พอ')`) && (await live(C)).station_status === 'hold'
    && await step('แก้แล้ว', U.prod, `public.close_issue('${C}')`) && (await live(C)).station_status === 'doing')
  await reject('ทีมจริง: แอดมินกดเสร็จสถานีไม่ได้', U.admin, `public.finish_station('${C}')`, /บทบาท/)
}
