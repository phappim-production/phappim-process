// เส้นทางพิมพ์ + DTF: เดินครบทุกสถานี · ฟิล์มยังไม่มาเริ่มรีดฟิล์มไม่ได้ · ส่งเย็บข้างนอกแล้วรับกลับเข้า QC
import { readFileSync } from 'node:fs'
import { requiredSteps, substepSql } from './steps.mjs'

export async function printDtfRouteTests({ db, ok }) {
  const file = '20261220000000_print_dtf_route.sql'
  try { await db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8')); ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, true) }
  catch (e) { ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, false, e.message.split('\n')[0]) }
  const U = { admin: '00000000-0000-0000-0000-0000000d7f01', prod: '00000000-0000-0000-0000-0000000d7f02' }
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  let sp = 0
  const call = async (uid, sql) => {
    const name = 'pd' + (++sp)
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
  const pass = async (name, uid, sql) => { try { const v = await call(uid, sql); ok(name, true); return v } catch (e) { ok(name, false, e.message.split('\n')[0]); return null } }
  const reject = async (name, uid, sql, re) => {
    try { await call(uid, sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') } catch (e) { ok(name, re.test(e.message), e.message.split('\n')[0]) }
  }
  const live = id => one(`select phase, current_station, station_status from public.job_live where id = $1`, [id])
  const station = async (id, s) => {
    await call(U.prod, `public.start_station('${id}')`)
    for (const [k, v] of await requiredSteps(db, s, 'production')) await call(U.prod, substepSql(id, k, v))
    await call(U.prod, `public.finish_station('${id}', '${s}')`)
  }

  await db.exec('begin')
  try {
    await db.exec(`
      insert into auth.users values ('${U.admin}','pd-admin@test'),('${U.prod}','pd-prod@test');
      insert into public.profiles (user_id,name,role,active) values ('${U.admin}','แอดมิน พิมพ์DTF','admin',true),('${U.prod}','ฝ่ายผลิต พิมพ์DTF','production',true);
      update public.production_settings set materials_check = false;
      update public.outsource_runs set closed_at = now() where closed_at is null;
      alter table public.jobs disable trigger jobs_guard_outsourced;
      update public.jobs set station_status = null, station_seq = null, phase = 'done', finished_at = coalesce(finished_at, now())
        where phase not in ('done', 'cancelled');
      alter table public.jobs enable trigger jobs_guard_outsourced;
    `)
    const path = (await one(`select string_agg(station_code, ' → ' order by seq) p from public.route_stations where route_code = 'print_dtf'`)).p
    ok('เส้นทาง: พิมพ์ + DTF = พิมพ์ → รีด → ตัด → รีดฟิล์ม → เย็บ → QC', path === 'print → press → cut → dtf_press → sew → qc_pack', path)
    ok('พิมพ์ + DTF ต้องสั่งฟิล์ม (uses_film)', (await one(`select private.uses_film('print_dtf') v`)).v === true)
    ok('เส้นทางเดิมยังต้องสั่งฟิล์มเหมือนเดิม', (await one(`select private.uses_film('dtf') and private.uses_film('dtg') and private.uses_film('screen')
      and private.uses_film('dtf_only') and not private.uses_film('normal') and not private.uses_film('print_emb') v`)).v === true)

    const receive = no => `public.receive_job('${no}', 'ลูกค้าพิมพ์DTF', 'เสื้อทีม', 'tshirt', 10, 'ตัว', '2026-12-31', 'print_dtf', null, 0, 0, '{}'::jsonb, false)`
    await reject('ฝ่ายผลิตรับงานเส้นทางพิมพ์ + DTF ไม่ได้', U.prod, receive('SC-PD-NO'), /./)
    const id = await pass('แอดมินรับงานเส้นทางพิมพ์ + DTF', U.admin, receive('SC-PD-1'))
    const first = id && await live(id)
    ok('รับงานแล้วเริ่มที่พิมพ์', first?.phase === 'production' && first?.current_station === 'print', JSON.stringify(first))

    for (const s of ['print', 'press', 'cut']) {
      try { await station(id, s); ok(`${s}: เริ่ม → เสร็จ`, true) } catch (e) { ok(`${s}: เริ่ม → เสร็จ`, false, e.message.split('\n')[0]) }
    }
    ok('ตัดเสร็จแล้วไปรอรีดฟิล์ม', (await live(id))?.current_station === 'dtf_press')
    await reject('ยังไม่ได้รับฟิล์ม DTF เริ่มรีดฟิล์มไม่ได้', U.prod, `public.start_station('${id}')`, /ยังไม่ได้รับฟิล์ม DTF เริ่มรีดฟิล์มไม่ได้/)
    await pass('แอดมินบันทึกสั่งฟิล์ม', U.admin, `public.order_film('${id}', current_date + 2)`)
    await reject('สั่งแล้วแต่ยังไม่ได้รับ ยังเริ่มไม่ได้', U.prod, `public.start_station('${id}')`, /ยังไม่ได้รับฟิล์ม DTF/)
    await pass('แอดมินบันทึกได้รับฟิล์ม', U.admin, `public.receive_film('${id}')`)
    try { await station(id, 'dtf_press'); ok('รีดฟิล์ม: เริ่ม → เสร็จ หลังได้รับฟิล์ม', true) } catch (e) { ok('รีดฟิล์ม: เริ่ม → เสร็จ หลังได้รับฟิล์ม', false, e.message.split('\n')[0]) }
    ok('รีดฟิล์มเสร็จแล้วไปรอเย็บ', (await live(id))?.current_station === 'sew')

    const vendor = (await one(`insert into public.vendors (name, stations) values ('ร้านเย็บพิมพ์DTF', '{sew}') returning id`)).id
    const run = await pass('แอดมินส่งเย็บข้างนอกจากสถานีเย็บ', U.admin,
      `public.send_out('${id}', ${vendor}, 'sew', '2099-01-02T03:00:00Z', 7, '2099-01-09T03:00:00Z')`)
    ok('ส่งออกแล้วงานอยู่ข้างนอก', (await live(id))?.station_status === 'out')
    await reject('ส่งออกอยู่ ฝ่ายผลิตกดเริ่มเย็บที่โรงงานไม่ได้', U.prod, `public.start_sewing('${id}')`, /./)
    if (run) await pass('แอดมินรับของกลับ', U.admin, `public.receive_back(${run})`)
    const back = await live(id)
    ok('รับกลับแล้วไปรอ QC + Packing', back?.current_station === 'qc_pack' && back?.station_status === 'queued', JSON.stringify(back))
  } finally {
    await db.exec('rollback')
  }
}
