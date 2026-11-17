// เส้นทางผลิตตามงานจริง (DTG · สกรีน · ปัก · พิมพ์+ปัก · ตัดงานลูกค้า) + ขึ้นตัวอย่างเฉพาะงานที่ลูกค้าจ่าย
// ใช้บัญชีทีมจริงจาก e2e.mjs · ไม่เดินสถานีเย็บ (sewing.mjs ใส่จักรสมมติไว้แล้ว ไม่เกี่ยวกับเส้นทาง)

import { requiredSteps, substepSql as sub } from './steps.mjs'

export async function routeTests({ db, ok, as }) {
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
  const live = async id => (await db.query(`select * from public.job_live where id = $1`, [id])).rows[0]
  const job = async id => (await db.query(`select * from public.jobs where id = $1`, [id])).rows[0]
  // sample: true / false / undefined (ไม่ส่งค่า = ค่าเริ่มต้นของฟังก์ชัน)
  const receive = async (no, route, sample) => (await call(U.prod,
    `public.receive_job('${no}', 'ลูกค้าเส้นทาง', 'งานเส้นทาง', 'tshirt', 10, 'ตัว', '2026-12-31', '${route}', 'confirmations/${no}.pdf'` +
    (sample === undefined ? '' : `, p_needs_sample => ${sample}`) + `) as id`)).rows[0].id
  const tickMaterials = async id => {
    const rows = (await db.query(`select id, dept, key from public.job_materials where job_id = $1 order by id`, [id])).rows
    let all = true
    for (const m of rows) {
      if (m.key?.endsWith('_film')) continue
      all = await step('ติ๊กวัตถุดิบ', { admin: U.admin, qc: U.qc, production: U.prod }[m.dept], `public.check_material(${m.id})`) && all
    }
    return all
  }
  const doStation = async (id, s, phase) => {
    if (!await step(`${s}: เริ่ม`, U.prod, `public.start_station('${id}')`)) return false
    if (s === 'qc_pack' && phase === 'production' && !await step('QC: บันทึกผ่าน', U.prod, `public.record_qc('${id}', 10)`)) return false
    for (const [k, v] of await requiredSteps(db, s, phase)) if (!await step(`${s}: ${k}`, U.prod, sub(id, k, v))) return false
    return step(`${s}: เสร็จ`, U.prod, `public.finish_station('${id}')`)
  }
  const path = async code => (await db.query(
    `select string_agg(station_code, ' → ' order by seq) p from public.route_stations where route_code = $1`, [code])).rows[0].p

  // ---------- 1. ลำดับสถานีของแต่ละเส้นทาง ----------
  ok('เส้นทาง: DTG = ตัด → รีดฟิล์ม → เย็บ → QC', await path('dtg') === 'cut → dtf_press → sew → qc_pack')
  ok('เส้นทาง: สกรีน = ตัด → รีดฟิล์ม → เย็บ → QC', await path('screen') === 'cut → dtf_press → sew → qc_pack')
  ok('เส้นทาง: ปัก = ตัด → ส่งปัก → เย็บ → QC', await path('emb') === 'cut → emb → sew → qc_pack')
  ok('เส้นทาง: พิมพ์ + ปัก = พิมพ์ → รีด → ตัด → ส่งปัก → เย็บ → QC',
    await path('print_emb') === 'print → press → cut → emb → sew → qc_pack')
  ok('เส้นทาง: ตัดงานลูกค้า = ตัด → QC', await path('cut_only') === 'cut → qc_pack')
  const seg = (await db.query(`select from_station, to_station, sla_days from public.sla_segments where code = 'subli_ppc_emb'`)).rows[0]
  ok('เส้นทาง: พิมพ์ + ปัก ใช้เวลามาตรฐาน พิมพ์ + รีด + ตัด เดียวกับปกติ',
    seg?.from_station === 'print' && seg?.to_station === 'cut' && Number(seg?.sla_days) === 3)

  // ---------- 2. ขึ้นตัวอย่างเฉพาะงานที่ตกลงกับลูกค้า ----------
  const D = await receive('SC-RT-DEFAULT', 'plain')
  ok('ตัวอย่าง: ไม่ระบุ = ขึ้นตัวอย่าง (ค่าเดิม)', (await job(D)).needs_sample === true)
  await tickMaterials(D)
  ok('ตัวอย่าง: ขึ้นตัวอย่าง → วัตถุดิบครบแล้วไปขึ้นตัวอย่าง', (await live(D)).phase === 'sample')

  const C = await receive('SC-RT-CUT', 'cut_only', false)
  ok('ตัวอย่าง: รับงานแบบไม่ขึ้นตัวอย่างได้ · บอร์ด (job_live) เห็นค่านี้',
    (await job(C)).needs_sample === false && (await live(C)).needs_sample === false && (await live(C)).phase === 'materials')
  await reject('ตัวอย่าง: วัตถุดิบยังไม่ครบ เริ่มตัดไม่ได้', U.prod, `public.start_station('${C}')`)
  await tickMaterials(C)
  const c1 = await live(C)
  ok('ตัวอย่าง: ไม่ขึ้นตัวอย่าง → วัตถุดิบครบแล้วเข้าผลิตจริงที่สถานีตัด',
    c1.phase === 'production' && c1.current_station === 'cut', `${c1.phase} ${c1.current_station}`)
  const rel = (await db.query(`select phase, payload from public.events where job_id = $1 and type = 'released'`, [C])).rows
  ok('ตัวอย่าง: บันทึกเหตุการณ์ปล่อยงานเข้าผลิต 1 แถว', rel.length === 1 && rel[0].phase === 'production' && rel[0].payload.sample === false)
  await reject('ตัวอย่าง: งานไม่ขึ้นตัวอย่าง บันทึกผลตัวอย่างไม่ได้', U.admin, `public.record_sample_result('${C}', true)`, /ไม่ได้รอผลตัวอย่าง/)
  await reject('ตัวอย่าง: ส่ง null ไม่ได้ ต้องเลือก', U.prod,
    `public.receive_job('SC-RT-NULL', 'ลูกค้า', 'งาน', 'tshirt', 10, 'ตัว', '2026-12-31', 'plain', 'confirmations/SC-RT-NULL.pdf', p_needs_sample => null)`,
    /ต้องเลือกว่างานนี้ขึ้นตัวอย่างหรือไม่/)

  // ---------- 3. ตัดงานลูกค้า: ตัด → QC + แพ็ค → เสร็จ ----------
  let walked = await doStation(C, 'cut', 'production')
  ok('ตัดงานลูกค้า: ตัดเสร็จ → QC + Packing (ไม่ผ่านเย็บ)', walked && (await live(C)).current_station === 'qc_pack')
  walked = await doStation(C, 'qc_pack', 'production')
  const c2 = await live(C)
  ok('ตัดงานลูกค้า: QC + แพ็คเสร็จ → งานเสร็จ', walked && c2.phase === 'done' && c2.qc_passed === 10, `${c2.phase}`)
  const sampleEvents = (await db.query(`select count(*)::int n from public.events where job_id = $1 and phase in ('sample', 'sample_review')`, [C])).rows[0].n
  ok('ตัดงานลูกค้า: ไม่มีขั้นตัวอย่างเลยทั้งงาน', sampleEvents === 0, `${sampleEvents} แถว`)

  // ---------- 4. ส่งปัก: นับชิ้นส่ง/รับกลับ + ตรวจ ก่อนไปเย็บ ----------
  const E = await receive('SC-RT-EMB', 'emb', false)
  await tickMaterials(E)
  await doStation(E, 'cut', 'production')
  ok('ปัก: ตัดเสร็จ → ส่งปัก', (await live(E)).current_station === 'emb')
  await step('ปัก: เริ่ม', U.prod, `public.start_station('${E}')`)
  await step('ปัก: ส่งชิ้นผ้า', U.prod, sub(E, 'send_out', 10))
  await reject('ปัก: ยังไม่รับงานปักกลับ กดเสร็จไม่ได้', U.prod, `public.finish_station('${E}')`, /รับงานปักกลับ/)
  await reject('ปัก: จำนวนชิ้นที่รับกลับต้องเป็นตัวเลข', U.prod, sub(E, 'receive_back'), /ต้องกรอกตัวเลข/)
  ok('ปัก: รับกลับ + ตรวจแล้วกดเสร็จ → เย็บ',
    await step('ปัก: รับกลับ', U.prod, sub(E, 'receive_back', 10)) && await step('ปัก: ตรวจ', U.prod, sub(E, 'check_emb')) &&
    await step('ปัก: เสร็จ', U.prod, `public.finish_station('${E}')`) && (await live(E)).current_station === 'sew')
  await reject('ปัก: แอดมินสั่งฟิล์มให้งานปักไม่ได้', U.admin, `public.order_film('${E}', '2026-12-01')`, /ไม่ต้องสั่งฟิล์ม/)

  // ---------- 5. DTG / สกรีน: สั่งเข้า → รอรับ → รีดฟิล์ม ----------
  const G = await receive('SC-RT-DTG', 'dtg', false)
  const gFilm = (await db.query(`select id, name from public.job_materials where job_id = $1 and key = 'dtg_film'`, [G])).rows[0]
  ok('DTG: มีรายการวัตถุดิบ "สั่งงาน DTG" ของแอดมิน', !!gFilm, gFilm?.name)
  await reject('DTG: ติ๊กรายการสั่งงาน DTG เองไม่ได้ (ติ๊กอัตโนมัติ)', U.admin, `public.check_material(${gFilm?.id})`, /ติ๊กให้อัตโนมัติ/)
  ok('DTG: แอดมินสั่งงาน DTG → ติ๊กให้อัตโนมัติ',
    await step('สั่ง DTG', U.admin, `public.order_film('${G}', '2026-12-01')`) && await tickMaterials(G) &&
    (await live(G)).phase === 'production')
  await doStation(G, 'cut', 'production')
  await reject('DTG: ยังไม่ได้รับงาน DTG เริ่มรีดฟิล์มไม่ได้', U.prod, `public.start_station('${G}')`, /ยังไม่ได้รับงาน DTG/)
  ok('DTG: รับงาน DTG แล้วเริ่มรีดฟิล์มได้',
    await step('รับ DTG', U.admin, `public.receive_film('${G}')`) && await step('เริ่มรีด', U.prod, `public.start_station('${G}')`))

  const S = await receive('SC-RT-SCREEN', 'screen', false)
  ok('สกรีน: มีรายการวัตถุดิบ "สั่งงานสกรีน"',
    (await db.query(`select count(*)::int n from public.job_materials where job_id = $1 and key = 'screen_film'`, [S])).rows[0].n === 1)
  await reject('สกรีน: ยังไม่ได้สั่ง บันทึกรับไม่ได้', U.admin, `public.receive_film('${S}')`, /ยังไม่ได้บันทึกการสั่งงานสกรีน/)
  // นัดรับเมื่อวาน (เวลาไทย) → ตรวจตามรอบต้องแจ้งเตือนเลยกำหนด
  await step('สั่งสกรีน', U.admin, `public.order_film('${S}', ((now() at time zone 'Asia/Bangkok')::date - 1))`)
  await call(U.prod, 'public.inbox_scan()')
  const late = (await db.query(`select title from public.inbox_messages where job_id = $1 and kind = 'film_late'`, [S])).rows
  ok('สกรีน: งานสกรีนเลยกำหนดรับ → แจ้งเตือนในกล่องจดหมาย', late.length === 1 && /^งานสกรีน เลยกำหนด/.test(late[0].title), late[0]?.title)

  const N = await receive('SC-RT-NORMAL', 'normal', false)
  await reject('ปกติ: งานไม่ใช้ฟิล์ม สั่งฟิล์มไม่ได้', U.admin, `public.order_film('${N}', '2026-12-01')`, /ไม่ต้องสั่งฟิล์ม/)
  ok('ปกติ: ไม่มีรายการสั่งฟิล์มในวัตถุดิบ',
    (await db.query(`select count(*)::int n from public.job_materials where job_id = $1 and key like '%_film'`, [N])).rows[0].n === 0)
}
