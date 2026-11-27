// ส่วน C: จำลองโรงงานหลายวัน (เลื่อนวันจริงด้วย clock) · ขั้นรอผลิต · ใบงานบริการ · ส่งออก · แบ่งงาน · ตรวจส่วน B ทุกขั้น
import { createInvariantState, checkInvariants } from '../checks/invariants.mjs'
import { createRng } from '../lib/rng.mjs'
import { createClock, thaiToday, addDaysIso } from '../lib/clock.mjs'

const SERVICE = {
  sew_only: { product: 'tshirt', spec: no => ({ product: 'svc_sew', h: { doc_no: no }, p: { svc_sew: { garment_code: 'tshirt' } } }) },
  print_only: { product: 'svc_print', spec: no => ({ product: 'svc_print', h: { doc_no: no }, p: { svc_print: { print_output: 'ส่งกระดาษ' } } }) },
  print_press_only: { product: 'svc_print', spec: no => ({ product: 'svc_print', h: { doc_no: no }, p: { svc_print: { print_output: 'พิมพ์แล้วรีดลงผ้าของลูกค้า' } } }) },
  press_only: { product: 'svc_press', spec: no => ({ product: 'svc_press', h: { doc_no: no }, p: {} }) },
  dtf_only: { product: 'svc_dtf', spec: no => ({ product: 'svc_dtf', h: { doc_no: no }, p: { svc_dtf: { film_source: 'โรงงานทำฟิล์ม' } } }) },
}
const ROUTES = ['normal', 'normal', 'dtf', 'print_emb', 'cut_only', 'outside', 'sew_only', 'print_only', 'print_press_only', 'press_only', 'dtf_only']
// คำตอบที่ถูกต้องตามกฎ (ไม่ใช่บั๊ก): เครื่อง/จักรเต็ม ต้องรอคิว
const BUSY = /เต็ม|ไม่ว่าง|ไม่พอ|กำลังทำครบ|รอคิว/

export async function runSimulation(client, { seed = 1, days = 10, browser = null, recorder = null, quick = false } = {}) {
  const rng = createRng(seed)
  await client.reset(true)
  const clock = createClock(client)
  const inv = createInvariantState()
  const trace = []
  const stats = { actions: 0, rejectedOk: 0, busy: 0, splits: 0, delayReports: 0, outsourcedFromMaterials: 0, lateMaterials: 0, concurrency: 0, browser: 0 }

  const fail = (msg, extra) => {
    const err = new Error(msg + (extra ? `: ${JSON.stringify(extra).slice(0, 300)}` : ''))
    err.trace = [...trace]
    return err
  }
  const must = (r, label) => { if (!r.ok) throw fail(label, r.body); return r.body }
  const step = async (entry, fn) => {
    stats.actions++
    const row = { day: thaiToday(), shifted: clock.shiftedDays, ...entry }
    trace.push(row)
    if (recorder) await recorder.record(row)
    await fn()
    const errs = await checkInvariants(client, inv, { afterScan: entry.action === 'inbox_scan' })
    if (errs.length) throw fail(`ข้อตรวจข้อมูลล้มหลัง ${entry.action} ${entry.jobNo ?? ''}: ${errs.join(' | ')}`)
  }
  const rejected = async (label, call, pattern) => {
    const r = await call()
    if (r.ok) throw fail(`${label} ควรถูกปฏิเสธแต่สำเร็จ`)
    if (pattern && !pattern.test(String(r.body?.message ?? ''))) throw fail(`${label} ถูกปฏิเสธด้วยข้อความไม่ตรง`, r.body)
    stats.rejectedOk++
  }

  const vendorId = must(await client.rpc('admin1', 'add_vendor', { p_name: `บ.นอก-${seed}`, p_stations: ['print', 'cut', 'sew', 'outside'] }), 'add_vendor')
  const [reason] = await client.sql('select code from public.reason_codes where active order by code limit 1')
  const plan = new Map()

  for (let d = 0; d < days; d++) {
    const today = thaiToday()
    const isSunday = new Date(`${today}T12:00:00+07:00`).getUTCDay() === 0

    if (!isSunday) {
      const count = quick ? 2 : rng.int(2, 4)
      for (let k = 0; k < count; k++) {
        const route = d === 0 && k === 0 ? 'outside' : rng.pick(ROUTES)
        const svc = SERVICE[route]
        const sample = !svc && rng.chance(0.2)
        const develop = sample && rng.chance(0.3)
        const no = `SIM-${seed}-${d + 1}-${k + 1}`
        const qty = d === 0 && k < 2 ? [520, 1000][k] : rng.pick([30, 120, 499, 520, 1000])
        await step({ actor: 'admin1', action: 'receive_job', jobNo: no, route, qty }, async () => {
          must(await client.rpc('admin1', 'receive_job', {
            p_confirmation_no: no, p_customer_name: `ลูกค้า ${no}`, p_job_name: `งาน ${no}`,
            p_product_type_code: svc?.product ?? 'tshirt', p_qty: qty, p_unit: 'ตัว',
            p_due_date: addDaysIso(today, rng.int(10, 30)), p_route_code: route,
            p_confirmation_pdf_path: null, p_spare_qty: 0, p_confirmation_rev: 0,
            p_spec: svc ? svc.spec(no) : { product: 'tshirt', h: { doc_no: no }, p: {} },
            p_needs_sample: sample, p_develop: develop,
          }), `receive_job ${no}`)
          plan.set(no, { stallDays: d > 0 && rng.chance(0.2) ? rng.int(3, 5) : 0, sendOutEarly: d === 0 && k === 0 })
        })
        if (d === 0 && k === 0) {
          await rejected('ฝ่ายผลิตรับงาน', () => client.rpc('prod1', 'receive_job', {
            p_confirmation_no: `${no}-BAD`, p_customer_name: 'X', p_job_name: 'X', p_product_type_code: 'tshirt',
            p_qty: 10, p_unit: 'ตัว', p_due_date: addDaysIso(today, 10), p_route_code: 'cut_only',
            p_confirmation_pdf_path: null, p_needs_sample: false,
          }), /แอดมิน/)
          await rejected('ใบงานบริการใช้เส้นทางผิด', () => client.rpc('admin1', 'receive_job', {
            p_confirmation_no: `${no}-SVC`, p_customer_name: 'X', p_job_name: 'X', p_product_type_code: 'svc_press',
            p_qty: 10, p_unit: 'ชิ้น', p_due_date: addDaysIso(today, 10), p_route_code: 'normal',
            p_confirmation_pdf_path: null, p_spec: SERVICE.press_only.spec(`${no}-SVC`), p_needs_sample: false,
          }), /เส้นทาง/)
          await rejected('สินค้าปกติใช้เส้นทางบริการ', () => client.rpc('admin1', 'receive_job', {
            p_confirmation_no: `${no}-SVC2`, p_customer_name: 'X', p_job_name: 'X', p_product_type_code: 'tshirt',
            p_qty: 10, p_unit: 'ตัว', p_due_date: addDaysIso(today, 10), p_route_code: 'press_only',
            p_confirmation_pdf_path: null, p_spec: { product: 'tshirt', h: { doc_no: `${no}-SVC2` }, p: {} }, p_needs_sample: false,
          }), /งานบริการ/)
        }
      }

      const live = await client.sql(`
        select l.id, l.confirmation_no, l.phase, l.current_station, l.station_status, l.route_code, l.qty, l.dtf_film_received_at, j.stage_entered_at
        from public.job_live l join public.jobs j on j.id = l.id
        where l.phase not in ('done', 'cancelled') order by l.queue_seq`)
      for (const j of rng.shuffle(live)) await advanceJob(j)

      const doneJobs = await client.sql("select id, confirmation_no from public.jobs where phase = 'done' and delivered_at is null")
      for (const dj of doneJobs) {
        await step({ actor: 'admin1', action: 'mark_delivered', jobNo: dj.confirmation_no }, async () => {
          must(await client.rpc('admin1', 'mark_delivered', { p_job: dj.id, p_note: 'ส่งแล้ว' }), 'mark_delivered')
        })
      }
    }

    await step({ actor: 'admin1', action: 'inbox_scan' }, async () => { must(await client.rpc('admin1', 'inbox_scan'), 'inbox_scan') })
    await clock.advanceDays(1)
  }

  async function advanceJob(j) {
    const no = j.confirmation_no
    const p = plan.get(no) ?? { stallDays: 0 }

    if (j.phase === 'materials') {
      if (p.stallDays > 0) { p.stallDays--; stats.lateMaterials++; return }
      if (j.route_code === 'outside' && (p.sendOutEarly || rng.chance(0.5))) {
        await step({ actor: 'admin1', action: 'send_out_from_materials', jobNo: no }, async () => {
          must(await client.rpc('admin1', 'send_out', {
            p_job: j.id, p_vendor: vendorId, p_last_station: 'outside', p_arrive_at: new Date().toISOString(),
            p_lead_days: 2, p_back_at: new Date(Date.now() + 3 * 86400_000).toISOString(), p_note: 'ส่งจากรอผลิต',
          }), 'send_out จากรอผลิต')
          stats.outsourcedFromMaterials++
        })
        return
      }
      const mats = await client.sql('select id, name, eta, checked_at from public.job_materials where job_id = $1', [j.id])
      if (!mats.length) {
        await step({ actor: 'admin1', action: 'add_materials', jobNo: no }, async () => {
          await rejected('เพิ่มวัตถุดิบไม่มีวันที่', () => client.rpc('admin1', 'add_job_material', { p_job: j.id, p_name: 'ไม่มีวัน', p_eta: null, p_have: false }))
          must(await client.rpc('admin1', 'add_job_material', { p_job: j.id, p_name: 'ผ้าหลัก 40 หลา', p_eta: new Date(Date.now() + rng.int(0, 2) * 86400_000).toISOString(), p_have: false }), 'add_job_material')
          must(await client.rpc('admin1', 'add_job_material', { p_job: j.id, p_name: 'ด้ายเย็บ', p_eta: null, p_have: true }), 'add_job_material มีของแล้ว')
          await rejected('เพิ่มวัตถุดิบชื่อซ้ำ', () => client.rpc('admin1', 'add_job_material', { p_job: j.id, p_name: 'ผ้าหลัก 40 หลา', p_eta: null, p_have: true }))
          await rejected('ปล่อยก่อนเช็คครบ', () => client.rpc('admin1', 'release_job', { p_job: j.id }))
        })
        return
      }
      const due = mats.filter(m => !m.checked_at && new Date(m.eta) <= new Date())
      const waiting = mats.filter(m => !m.checked_at && new Date(m.eta) > new Date())
      if (waiting.length && rng.chance(0.3)) {
        await step({ actor: 'admin1', action: 'set_material_eta', jobNo: no }, async () => {
          must(await client.rpc('admin1', 'set_material_eta', { p_material_id: waiting[0].id, p_eta: new Date(Date.now() + 86400_000).toISOString() }), 'set_material_eta')
        })
      }
      if (due.length) {
        await step({ actor: 'admin1', action: 'check_material', jobNo: no }, async () => {
          for (const m of due) must(await client.rpc('admin1', 'check_material', { p_material_id: m.id, p_checked: true }), 'check_material')
        })
      }
      const left = (await client.sql('select count(*)::int c from public.job_materials where job_id = $1 and checked_at is null', [j.id]))[0].c
      if (left) return
      const photos = (await client.sql('select count(*)::int c from public.job_material_photos where job_id = $1', [j.id]))[0].c
      if (!photos) {
        await step({ actor: 'admin1', action: 'add_material_photos', jobNo: no }, async () => {
          await rejected('ปล่อยก่อนมีรูป', () => client.rpc('admin1', 'release_job', { p_job: j.id }))
          const path = await client.seedMockJpg('mockups', no, `${no}-mat`)
          must(await client.rpc('admin1', 'add_material_photos', { p_job: j.id, p_paths: [path] }), 'add_material_photos')
        })
      }
      await step({ actor: 'admin1', action: 'release_job', jobNo: no }, async () => {
        if (!stats.concurrency) {
          stats.concurrency++
          const [a, b] = await Promise.all([
            client.rpc('admin1', 'release_job', { p_job: j.id }),
            client.rpc('owner', 'release_job', { p_job: j.id }),
          ])
          if (a.ok === b.ok) throw fail('2 คนกดปล่อยพร้อมกัน ต้องสำเร็จ 1 ครั้งพอดี', [a.body, b.body])
          const released = await client.sql(`select count(*)::int c from public.events where job_id = $1 and type = 'released'`, [j.id])
          if (released[0].c !== 1) throw fail(`กดปล่อยพร้อมกันได้ event released ${released[0].c} แถว`)
        } else {
          must(await client.rpc('admin1', 'release_job', { p_job: j.id }), 'release_job')
        }
      })
      return
    }

    if (j.phase === 'sample_review') {
      await step({ actor: 'admin1', action: 'record_sample_result', jobNo: no }, async () => {
        const pass = rng.chance(0.8)
        must(await client.rpc('admin1', 'record_sample_result', {
          p_job: j.id, p_pass: pass, p_note: pass ? 'ผ่าน' : 'ปรับสี',
          p_customer_confirmed_at: pass ? thaiToday() : null,
        }), 'record_sample_result')
      })
      return
    }

    if (j.station_status === 'out') {
      const [run] = await client.sql('select id, back_at from public.outsource_runs where job_id = $1 and closed_at is null limit 1', [j.id])
      if (!run) throw fail(`งาน ${no} ส่งออกอยู่แต่ไม่มีรอบส่งออกที่เปิด`)
      if (rng.chance(0.6)) {
        await step({ actor: 'admin1', action: 'receive_back', jobNo: no }, async () => {
          must(await client.rpc('admin1', 'receive_back', { p_run: run.id, p_note: 'รับกลับครบ' }), 'receive_back')
        })
      }
      return
    }

    if (j.station_status === 'hold') {
      await step({ actor: 'prod1', action: 'resolve_hold', jobNo: no }, async () => {
        const r = j.current_station === 'sew'
          ? await client.rpc('prod1', 'resume_sewing', { p_job: j.id })
          : await client.rpc('prod1', 'close_issue', { p_job: j.id, p_note: 'แก้แล้ว' })
        if (!r.ok && !BUSY.test(String(r.body?.message))) throw fail('ปิดปัญหา/เย็บต่อ', r.body)
      })
      return
    }

    if (j.station_status === 'queued') {
      if (j.current_station === 'outside') {
        await step({ actor: 'admin1', action: 'send_out', jobNo: no }, async () => {
          must(await client.rpc('admin1', 'send_out', {
            p_job: j.id, p_vendor: vendorId, p_last_station: 'outside', p_arrive_at: new Date().toISOString(),
            p_lead_days: 2, p_back_at: new Date(Date.now() + 2 * 86400_000).toISOString(), p_note: 'ส่งนอก',
          }), 'send_out')
        })
        return
      }
      if (j.current_station === 'dtf_press' && !j.dtf_film_received_at) {
        await step({ actor: 'admin1', action: 'film', jobNo: no }, async () => {
          const [film] = await client.sql('select dtf_film_ordered_at from public.jobs where id = $1', [j.id])
          if (!film.dtf_film_ordered_at) must(await client.rpc('admin1', 'order_film', { p_job: j.id, p_eta: addDaysIso(thaiToday(), 1) }), 'order_film')
          else must(await client.rpc('admin1', 'receive_film', { p_job: j.id }), 'receive_film')
        })
        return
      }
      if (!stats.splits && Number(j.qty) >= 120 && j.current_station !== 'qc_pack' && j.current_station !== 'sew') {
        await step({ actor: 'admin1', action: 'split_job', jobNo: no }, async () => {
          must(await client.rpc('admin1', 'split_job', { p_job: j.id, p_qty: Math.floor(Number(j.qty) / 3) }), 'split_job')
          stats.splits++
        })
        return
      }
      const actor = j.current_station === 'qc_pack' ? 'qc' : 'prod1'
      await step({ actor, action: `start_${j.current_station}`, jobNo: no }, async () => {
        let r
        if (j.current_station === 'sew') {
          r = await client.rpc('prod1', 'start_sewing', { p_job: j.id })
          if (!r.ok && /ไม่ใช่คิวแรก/.test(String(r.body?.message))) {
            must(await client.rpc('prod1', 'note_queue_skip', { p_job: j.id, p_reason: 'จำลอง: จักรว่างพอดี' }), 'note_queue_skip')
            r = await client.rpc('prod1', 'start_sewing', { p_job: j.id })
          }
        } else {
          r = await client.rpc(actor, 'start_in_queue', { p_job: j.id, p_reason: 'จำลอง' })
        }
        if (!r.ok) {
          if (!BUSY.test(String(r.body?.message))) throw fail(`เริ่ม ${j.current_station}`, r.body)
          stats.busy++
        }
      })
      return
    }

    if (j.station_status === 'doing') {
      if (browser && !stats.browser && j.current_station === 'cut') {
        stats.browser++
        await browser.goto('admin1', `#/board?job=${j.id}`, 1440)
        await browser.waitText(no)
      }
      if (rng.chance(0.08) && j.current_station !== 'qc_pack') {
        await step({ actor: 'prod1', action: 'open_issue', jobNo: no }, async () => {
          const r = j.current_station === 'sew'
            ? await client.rpc('prod1', 'report_sewing_issue', { p_job: j.id, p_reason: 'ด้ายขาด', p_pause: true })
            : await client.rpc('prod1', 'open_issue', { p_job: j.id, p_reason: 'รอตรวจสอบ' })
          must(r, 'เปิดปัญหา')
        })
        return
      }
      const actor = j.current_station === 'qc_pack' ? 'qc' : 'prod1'
      await step({ actor, action: `finish_${j.current_station}`, jobNo: no }, async () => {
        if (j.current_station === 'qc_pack' && j.phase === 'production') {
          const [{ done }] = await client.sql('select coalesce(sum(passed), 0)::int done from public.qc_results where job_id = $1', [j.id])
          if (done < Number(j.qty)) must(await client.rpc('qc', 'record_qc', { p_job: j.id, p_passed: Number(j.qty) - done }), 'record_qc')
        }
        const finish = () => j.current_station === 'sew'
          ? client.rpc('prod1', 'finish_sewing', { p_job: j.id })
          : client.rpc(actor, 'finish_station', { p_job: j.id, p_station: j.current_station })
        let r = await finish()
        if (!r.ok && /รายงานสาเหตุ|เกินเวลาผลิต/.test(String(r.body?.message))) {
          const [flag] = (await client.rpc('admin1', 'job_sla_flags')).body.filter(f => f.job_id === j.id)
          if (!flag?.need_report) throw fail(`${no} ถูกบังคับรายงานสาเหตุทั้งที่ไม่เกินเวลาผลิต`, r.body)
          must(await client.rpc(actor, 'submit_delay_report', {
            p_job: j.id, p_reasons: [reason.code], p_detail: 'จำลอง: ของมาช้า',
            p_new_eta: new Date(Date.now() + 86400_000).toISOString(),
          }), 'submit_delay_report')
          stats.delayReports++
          r = await finish()
        }
        must(r, `เสร็จ ${j.current_station}`)
      })
    }
  }

  const [{ done, total, sla_over: over }] = await client.sql(`
    select count(*) filter (where phase = 'done')::int done, count(*)::int total,
      (select count(*)::int from public.inbox_messages where kind = 'sla_over') sla_over
    from public.jobs`)
  const result = { ...stats, totalJobs: total, doneJobs: done, slaOverMessages: over, shiftedDays: clock.shiftedDays }
  if (!quick && days >= 15) {
    if (!done) throw fail('จำลองครบแล้วไม่มีงานเสร็จเลย', result)
    if (!stats.outsourcedFromMaterials) throw fail('ไม่ได้ลองส่งออกจากรอผลิต', result)
  }
  return result
}
