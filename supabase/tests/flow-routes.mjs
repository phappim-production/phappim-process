// ชุดก่อนหน้าแก้สูตรจักรสมมติไว้ → คืนเป็นค่าจริงในธุรกรรมนี้ แล้ว rollback ตอนจบ
import { requiredSteps, substepSql } from './steps.mjs'

const U = {
  admin: '00000000-0000-0000-0000-000000000011', qc: '00000000-0000-0000-0000-000000000012',
  prod: '00000000-0000-0000-0000-000000000013', manager: '00000000-0000-0000-0000-000000000014',
}
const ROUTES = ['normal', 'plain', 'dtf', 'dtg', 'screen', 'emb', 'print_emb', 'cut_only']

export async function flowRouteTests({ db, ok }) {
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  // ทุกคำสั่งใน savepoint: คำสั่งที่ถูกปฏิเสธต้องไม่ทำให้ธุรกรรมทั้งชุดใช้ไม่ได้
  let sp = 0
  const call = async (uid, sql) => {
    const name = 'fr' + (++sp)
    await db.exec(`savepoint ${name}; set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true)`)
    try {
      const r = await db.query(`select ${sql} as r`)
      await db.exec(`reset role; release savepoint ${name}`)
      return r.rows[0]?.r
    } catch (e) {
      await db.exec(`rollback to savepoint ${name}; reset role`)
      throw e
    }
  }
  const live = id => one(`select * from public.job_live where id = $1`, [id])
  const stationsOf = async code => (await db.query(`select station_code from public.route_stations where route_code = $1 order by seq`, [code])).rows.map(r => r.station_code)

  await db.exec('begin')
  try {
    // ค่าจริง: ลบสูตรสมมติที่ชุดทดสอบจักรเพิ่มไว้ · จักรว่างทุกตัว
    await db.exec(`
      update public.machine_types set shared = code in ('cover', 'button', 'buttonhole', 'ovl4');
      delete from public.product_machine_needs where (product_type_code, type_code) in (('tshirt', 'flat'), ('apron', 'binding'));
      update public.outsource_runs set closed_at = now() where closed_at is null;
      update public.machine_assignments set released_at = now() where released_at is null;
      update public.machine_bookings set cancelled_at = now() where cancelled_at is null;
      -- งานของชุดทดสอบก่อนหน้าปิดเป็นเสร็จ ให้คิวว่าง (กันข้ามคิว) · งานที่ค้างอยู่ข้างนอกถูก trigger กันไว้ จึงปิด trigger ในธุรกรรมนี้
      alter table public.jobs disable trigger jobs_guard_outsourced;
      update public.jobs set station_status = null, station_seq = null, phase = 'done', finished_at = coalesce(finished_at, now())
        where phase not in ('done', 'cancelled');
      alter table public.jobs enable trigger jobs_guard_outsourced;
    `)
    const pmn = (await one(`select md5(string_agg(product_type_code||type_code||qty, '|' order by product_type_code, type_code)) m from public.product_machine_needs`)).m
    ok('สูตรจักรในชุดนี้ตรงกับฐานจริง (19 พ.ย.)', pmn === '6522a755a7ef263d90b9d2a8fee28352', pmn)
    for (const [code, type] of [['SN-901', 'single'], ['SN-902', 'single'], ['SN-903', 'single'], ['OL4-901', 'ovl4'], ['OL4-902', 'ovl4'], ['CV-901', 'cover'], ['BT-901', 'button'], ['BH-901', 'buttonhole']]) {
      await db.query(`insert into public.sewing_machines (code, type_code) values ($1, $2) on conflict (code) do nothing`, [code, type])
    }

    let n = 0
    const walkStation = async (id, s, phase) => {
      const j = await live(id)
      const qty = j.qty
      const who = s === 'qc_pack' ? U.qc : U.prod
      if (s === 'sew') {
        await call(U.prod, `public.start_sewing('${id}')`)
        // งานใหญ่ใส่จักรเพิ่ม (ปุ่ม +) แล้วต้องเดินต่อได้ปกติ
        await call(U.prod, `public.set_job_machines('${id}', 'single', 2)`)
        if (phase === 'production') {
          await call(U.prod, substepSql(id, 'first_piece'))
          await call(U.prod, `public.update_sew_count('${id}', ${qty})`)
        }
        await call(U.prod, `public.finish_sewing('${id}')`)
        const left = (await one(`select count(*)::int c from public.machine_assignments where job_id = $1 and released_at is null`, [id])).c
        if (left !== 0) throw new Error(`เย็บเสร็จแล้วยังถือจักร ${left} ตัว`)
        return
      }
      await call(who, `public.start_station('${id}')`)
      if (s === 'qc_pack' && phase === 'production') await call(U.qc, `public.record_qc('${id}', ${qty})`)
      for (const [k, v] of await requiredSteps(db, s, phase)) await call(who, substepSql(id, k, v))
      await call(who, `public.finish_station('${id}', '${s}')`)
    }
    const walk = async (route, sample, product = 'tshirt') => {
      const no = `FLOW-${route}-${sample ? 'S' : 'N'}-${product}-${++n}`
      let where = 'รับงาน'
      try {
        const id = await call(U.admin, `public.receive_job('${no}', 'ลูกค้าทดสอบเส้นทาง', 'งานทดสอบ', '${product}', 10, 'ตัว', '2026-12-31', '${route}', null, 0, 0, '{}'::jsonb, ${sample})`)
        where = 'วัตถุดิบ'
        const mats = (await db.query(`select id, dept, key from public.job_materials where job_id = $1 order by id`, [id])).rows
        // งานที่ต้องสั่งฟิล์ม: แอดมินกด "บันทึกการสั่ง" + "ได้รับแล้ว" ในรายละเอียดงาน (ไม่ใช่รายการวัตถุดิบ)
        if (['dtf', 'dtg', 'screen'].includes(route)) {
          await call(U.admin, `public.order_film('${id}', (current_date + 2))`)
          await call(U.admin, `public.receive_film('${id}')`)
        }
        for (const m of mats) {
          if (m.key && /_film$/.test(m.key)) continue
          await call({ admin: U.admin, qc: U.qc, production: U.prod }[m.dept], `public.check_material(${m.id})`)
        }
        const stations = await stationsOf(route)
        if (sample) {
          for (const s of stations) { where = `ตัวอย่าง ${s}`; await walkStation(id, s, 'sample') }
          where = 'ผลตัวอย่าง'
          await call(U.admin, `public.record_sample_result('${id}', true)`)
        }
        for (const s of stations) { where = `ผลิตจริง ${s}`; await walkStation(id, s, 'production') }
        const j = await live(id)
        if (j.phase !== 'done') throw new Error(`จบที่ ${j.phase} / ${j.current_station}`)
        const noBy = (await one(`select count(*)::int c from public.events where job_id = $1 and by is null`, [id])).c
        if (noBy) throw new Error(`event ไม่มีชื่อผู้กด ${noBy} แถว`)
        return { ok: true }
      } catch (e) {
        return { ok: false, why: `ติดที่ ${where}: ${e.message.split('\n')[0]}` }
      }
    }

    for (const route of ROUTES) {
      for (const sample of [false, true]) {
        const r = await walk(route, sample)
        ok(`เส้นทาง ${route} ${sample ? 'ขึ้นตัวอย่าง' : 'ไม่ขึ้นตัวอย่าง'}: รับงาน → เสร็จ`, r.ok, r.why)
      }
    }

    const sewn = (await db.query(`select distinct product_type_code c from public.product_machine_needs order by 1`)).rows.map(r => r.c)
    const stuck = []
    for (const p of sewn) {
      const r = await walk('plain', false, p)
      if (!r.ok) stuck.push(`${p} (${r.why})`)
    }
    ok(`สินค้าที่มีสูตรจักร ${sewn.length} ชนิด เดินถึงเสร็จได้ทุกชนิด`, stuck.length === 0, stuck.join(' · '))

    const noRecipe = (await db.query(`select code from public.product_types p where active
      and not exists (select 1 from public.product_machine_needs n where n.product_type_code = p.code) order by code`)).rows.map(r => r.code)
    for (const p of noRecipe) {
      const r = await walk('cut_only', false, p)
      ok(`สินค้าไม่ผ่านเย็บ ${p}: เส้นทางตัดงานลูกค้า เดินถึงเสร็จ`, r.ok, r.why)
    }
  } finally {
    await db.exec('rollback')
  }
}
