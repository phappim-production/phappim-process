// ส่วน C: จำลองการใช้งานจริงทั้งโรงงาน (วันทำงาน จ.-ส. · เปิดขั้นรอผลิต · ใบงานบริการ 4 แบบ · 2 ทางเรียก · 2 คนพร้อมกัน · ตรวจส่วน B ทุกขั้น)
import { createInvariantState, checkInvariants } from '../checks/invariants.mjs'
import { createRng, shrinkTrace } from '../lib/rng.mjs'

const ROUTE_STATIONS = {
  normal: ['print', 'press', 'cut', 'sew', 'qc_pack'],
  dtf: ['cut', 'dtf_press', 'sew', 'qc_pack'],
  dtg: ['cut', 'dtf_press', 'sew', 'qc_pack'],
  screen: ['cut', 'dtf_press', 'sew', 'qc_pack'],
  print_emb: ['print', 'press', 'cut', 'emb', 'sew', 'qc_pack'],
  cut_only: ['cut', 'qc_pack'],
  outside: ['outside', 'qc_pack'],
  sew_only: ['sew', 'qc_pack'],
  print_only: ['print', 'qc_pack'],
  print_press_only: ['print', 'press', 'qc_pack'],
  press_only: ['press', 'qc_pack'],
  dtf_only: ['dtf_press', 'qc_pack'],
}

const PRODUCT_FOR_ROUTE = {
  sew_only: 'svc_sew',
  print_only: 'svc_print',
  print_press_only: 'svc_press',
  press_only: 'svc_press',
  dtf_only: 'svc_dtf',
}

export async function runSimulation(client, { seed = 1, days = 10, browser = null, recorder = null, quick = false } = {}) {
  const rng = createRng(seed)
  await client.reset(true)
  const invState = createInvariantState()
  const vendorRes = await client.rpc('admin1', 'add_vendor', { p_name: `บ.นอก-${seed}`, p_stations: ['print', 'cut', 'sew', 'outside'] })
  const vendorId = vendorRes.body

  const jobs = []
  let simDate = new Date('2026-11-26T09:00:00+07:00')
  let actionsCount = 0
  let negativeChecked = 0
  let concurrencyChecked = 0
  let browserChecked = 0
  const trace = []

  const execAction = async (entry, fn) => {
    actionsCount++
    trace.push(entry)
    if (recorder) await recorder.record(entry)
    const res = await fn()
    const errs = await checkInvariants(client, invState)
    if (errs.length) {
      const err = new Error(`Invariant failed after ${entry.action} (${entry.jobNo ?? ''}): ${errs.join(' | ')}`)
      err.trace = [...trace]
      throw err
    }
    return res
  }

  for (let d = 0; d < days; d++) {
    // ข้ามวันอาทิตย์ (วันทำงาน จ.-ส.)
    if (simDate.getUTCDay() === 0) simDate = new Date(simDate.getTime() + 86400_000)
    const dayStr = simDate.toISOString().slice(0, 10)
    const dueStr = new Date(simDate.getTime() + (rng.int(12, 28) * 86400_000)).toISOString().slice(0, 10)

    // สร้างงานใหม่เข้าโรงงานในแต่ละวัน (ครอบคลุมเส้นทางปกติ + ตัวอย่าง + Develop + ผลิตข้างนอก + ใบงานบริการ 4 แบบ)
    const newCount = quick ? 2 : rng.int(2, 4)
    for (let k = 0; k < newCount; k++) {
      const routePool = ['normal', 'dtf', 'cut_only', 'outside', 'sew_only', 'print_only', 'press_only', 'dtf_only']
      const route = rng.pick(routePool)
      const isService = Boolean(PRODUCT_FOR_ROUTE[route])
      const product = PRODUCT_FOR_ROUTE[route] ?? 'tshirt'
      const sample = !isService && rng.chance(0.25)
      const develop = sample && rng.chance(0.3)
      const no = `SIM-${seed}-D${d + 1}-${k + 1}`
      const qty = rng.pick([30, 120, 520])
      const spec = product === 'svc_sew' ? { product: 'svc_sew', h: { doc_no: no }, p: { svc_sew: { garment_code: 'tshirt' } } } : { product, h: { doc_no: no }, p: {} }

      await execAction({ day: dayStr, actor: 'admin1', action: 'receive_job', jobNo: no, route, sample, develop }, async () => {
        const r = await client.rpc('admin1', 'receive_job', {
          p_confirmation_no: no, p_customer_name: `ลูกค้า ${no}`, p_job_name: `งานจำลอง ${no}`,
          p_product_type_code: product === 'svc_sew' ? 'tshirt' : product,
          p_qty: qty, p_unit: 'ตัว', p_due_date: dueStr, p_route_code: route,
          p_confirmation_pdf_path: null, p_spare_qty: 0, p_confirmation_rev: 0,
          p_spec: spec, p_needs_sample: sample, p_develop: develop,
        })
        if (!r.ok) throw new Error(`receive_job ${no}: ${JSON.stringify(r.body)}`)
        jobs.push({ id: r.body, no, route, sample, develop, qty, rev: 0, isService })
      })

      // ทดสอบการกระทำที่ต้องถูกปฏิเสธ (เช่น ฝ่ายผลิตกด receive_job)
      if (negativeChecked < 5) {
        negativeChecked++
        await execAction({ day: dayStr, actor: 'prod1', action: 'negative_receive_job', jobNo: no }, async () => {
          const r = await client.rpc('prod1', 'receive_job', {
            p_confirmation_no: no + '-BAD', p_customer_name: 'X', p_job_name: 'X',
            p_product_type_code: 'tshirt', p_qty: 10, p_unit: 'ตัว', p_due_date: dueStr,
            p_route_code: 'cut_only', p_confirmation_pdf_path: null, p_needs_sample: false,
          })
          if (r.ok) throw new Error('prod1 เรียก receive_job สำเร็จ!')
        })
      }
    }

    // เดินงานที่ค้างอยู่ในระบบตามบทบาทจริง
    const liveRows = await client.sql('select id, confirmation_no, phase, current_station, station_status, needs_sample, develop, route_code, qty, dtf_film_received_at from public.job_live where phase not in (\'done\', \'cancelled\') order by queue_seq')
    for (const j of rng.shuffle(liveRows)) {
      if (j.phase === 'materials') {
        // กรณี PR 237: ส่งออกบริษัทภายนอกจากรอผลิตได้โดยไม่ต้องเช็ควัตถุดิบ
        if (j.route_code === 'outside' && rng.chance(0.5)) {
          await execAction({ day: dayStr, actor: 'admin1', action: 'send_out_from_materials', jobNo: j.confirmation_no }, async () => {
            const out = await client.rpc('admin1', 'send_out', {
              p_job: j.id, p_vendor: vendorId, p_last_station: 'outside',
              p_arrive_at: `${dayStr}T09:00:00+07:00`, p_lead_days: 2, p_back_at: `${dueStr}T17:00:00+07:00`, p_note: 'ส่งออกจากรอผลิต',
            })
            if (!out.ok) throw new Error(`send_out from materials failed: ${JSON.stringify(out.body)}`)
          })
          continue
        }

        // เพิ่มรายการวัตถุดิบพร้อม ETA (PR 238) + ถ่ายรูป + ปล่อยเข้าไลน์
        await execAction({ day: dayStr, actor: 'admin1', action: 'materials_and_release', jobNo: j.confirmation_no }, async () => {
          const items = ['ผ้าหลัก', 'ด้ายเย็บ']
          for (const it of items) {
            const add = await client.rpc('admin1', 'add_job_material', {
              p_job: j.id, p_name: it, p_eta: `${dayStr}T15:00:00+07:00`, p_have: false,
            })
            if (!add.ok && !/มี .* ในรายการแล้ว/.test(JSON.stringify(add.body))) {
              throw new Error(`add_job_material: ${JSON.stringify(add.body)}`)
            }
          }
          const mats = await client.sql('select id, checked_at from public.job_materials where job_id = $1', [j.id])
          for (const m of mats) {
            if (!m.checked_at) await client.rpc('admin1', 'check_material', { p_material_id: m.id, p_checked: true })
          }
          const existingP = await client.sql('select count(*)::int c from public.job_material_photos where job_id = $1', [j.id])
          if (existingP[0].c === 0) {
            const p = await client.seedMockJpg('mockups', j.confirmation_no, `${j.confirmation_no}-${d}`)
            const ap = await client.rpc('admin1', 'add_material_photos', { p_job: j.id, p_paths: [p] })
            if (!ap.ok) throw new Error(`add_material_photos: ${JSON.stringify(ap.body)}`)
          }
          // ทดสอบ 2 แอดมินกดปล่อยพร้อมกัน (Concurrency) 1 ครั้งต่อรอบ
          if (concurrencyChecked === 0) {
            concurrencyChecked++
            const [r1, r2] = await Promise.all([
              client.rpc('admin1', 'release_job', { p_job: j.id }),
              client.rpc('owner', 'release_job', { p_job: j.id }),
            ])
            if (r1.ok && r2.ok) throw new Error('2 คนกดปล่อยพร้อมกันสำเร็จทั้งคู่!')
            if (!r1.ok && !r2.ok) throw new Error(`ปล่อยไม่สำเร็จทั้งคู่: ${JSON.stringify([r1.body, r2.body])}`)
          } else {
            const rel = await client.rpc('admin1', 'release_job', { p_job: j.id })
            if (!rel.ok) throw new Error(`release_job: ${JSON.stringify(rel.body)}`)
          }
        })
        continue
      }

      if (j.phase === 'sample_review') {
        await execAction({ day: dayStr, actor: 'admin1', action: 'record_sample_result', jobNo: j.confirmation_no }, async () => {
          const pass = rng.chance(0.8)
          const r = await client.rpc('admin1', 'record_sample_result', {
            p_job: j.id, p_pass: pass, p_note: pass ? 'ผ่าน' : 'ปรับสี',
            p_customer_confirmed_at: pass ? `${dayStr}T12:00:00+07:00` : null,
          })
          if (!r.ok) throw new Error(`record_sample_result: ${JSON.stringify(r.body)}`)
        })
        continue
      }

      // เดินสถานี (production หรือ sample)
      if (j.station_status === 'out') {
        const [run] = await client.sql('select id from public.outsource_runs where job_id = $1 and closed_at is null limit 1', [j.id])
        if (run) {
          await execAction({ day: dayStr, actor: 'admin1', action: 'receive_back', jobNo: j.confirmation_no }, async () => {
            const r = await client.rpc('admin1', 'receive_back', { p_run: run.id, p_note: 'รับกลับครบ' })
            if (!r.ok) throw new Error(`receive_back: ${JSON.stringify(r.body)}`)
          })
        }
        continue
      }

      if (j.station_status === 'hold') {
        await execAction({ day: dayStr, actor: 'prod1', action: 'close_issue', jobNo: j.confirmation_no }, async () => {
          const r = j.current_station === 'sew'
            ? await client.rpc('prod1', 'resume_sewing', { p_job: j.id })
            : await client.rpc('prod1', 'close_issue', { p_job: j.id, p_note: 'แก้แล้ว' })
          // ถ้าเครื่องเต็มจะกลับเข้าคิว ไม่ถือว่า error
          if (!r.ok && !/เครื่องเต็ม|ไม่พบ/.test(JSON.stringify(r.body))) {
            throw new Error(`resume/close_issue: ${JSON.stringify(r.body)}`)
          }
        })
        continue
      }

      if (j.station_status === 'queued') {
        if (j.current_station === 'outside') {
          await execAction({ day: dayStr, actor: 'admin1', action: 'send_out', jobNo: j.confirmation_no }, async () => {
            const r = await client.rpc('admin1', 'send_out', {
              p_job: j.id, p_vendor: vendorId, p_last_station: 'outside',
              p_arrive_at: `${dayStr}T09:00:00+07:00`, p_lead_days: 2, p_back_at: `${dueStr}T17:00:00+07:00`, p_note: 'ส่งนอก',
            })
            if (!r.ok) throw new Error(`send_out: ${JSON.stringify(r.body)}`)
          })
          continue
        }
        if (j.current_station === 'dtf_press' && !j.dtf_film_received_at) {
          await execAction({ day: dayStr, actor: 'admin1', action: 'order_and_receive_film', jobNo: j.confirmation_no }, async () => {
            await client.rpc('admin1', 'order_film', { p_job: j.id, p_eta: dueStr })
            await client.rpc('admin1', 'receive_film', { p_job: j.id })
          })
        }
        await execAction({ day: dayStr, actor: 'prod1', action: `start_${j.current_station}`, jobNo: j.confirmation_no }, async () => {
          const actor = j.current_station === 'qc_pack' ? 'qc' : 'prod1'
          if (j.current_station === 'sew') {
            await client.rpc('prod1', 'note_queue_skip', { p_job: j.id, p_reason: 'จำลอง' })
            const r = await client.rpc('prod1', 'start_sewing', { p_job: j.id })
            if (!r.ok && !/ไม่ว่าง|ไม่พอ|เต็ม/.test(JSON.stringify(r.body))) throw new Error(`start_sewing: ${JSON.stringify(r.body)}`)
          } else {
            const r = await client.rpc(actor, 'start_in_queue', { p_job: j.id, p_reason: 'จำลอง' })
            if (!r.ok && !/เต็ม|ฟิล์ม/.test(JSON.stringify(r.body))) throw new Error(`start_in_queue (${j.current_station}): ${JSON.stringify(r.body)}`)
          }
        })
        continue
      }

      if (j.station_status === 'doing') {
        // ทดสอบคลิกจริงบนเบราว์เซอร์สุ่ม 1 งานในรอบ
        if (browser && browserChecked === 0 && j.current_station === 'cut') {
          browserChecked++
          await browser.goto('admin1', `#/board?job=${j.id}`, 1440)
          await browser.waitText(j.confirmation_no)
        }
        if (rng.chance(0.08) && j.current_station !== 'qc_pack') {
          await execAction({ day: dayStr, actor: 'prod1', action: 'open_issue', jobNo: j.confirmation_no }, async () => {
            if (j.current_station === 'sew') await client.rpc('prod1', 'report_sewing_issue', { p_job: j.id, p_reason: 'ด้ายขาด', p_pause: true })
            else await client.rpc('prod1', 'open_issue', { p_job: j.id, p_reason: 'รอตรวจสอบ' })
          })
          continue
        }
        await execAction({ day: dayStr, actor: 'prod1', action: `finish_${j.current_station}`, jobNo: j.confirmation_no }, async () => {
          const actor = j.current_station === 'qc_pack' ? 'qc' : 'prod1'
          if (j.current_station === 'qc_pack') {
            await client.rpc('qc', 'record_qc', { p_job: j.id, p_passed: Number(j.qty) })
          }
          const r = j.current_station === 'sew'
            ? await client.rpc('prod1', 'finish_sewing', { p_job: j.id })
            : await client.rpc(actor, 'finish_station', { p_job: j.id, p_station: j.current_station })
          if (!r.ok) {
            if (/เกินเวลาผลิต/.test(JSON.stringify(r.body))) {
              const codes = await client.sql('select code from public.reason_codes where active limit 1')
              await client.rpc('qc', 'submit_delay_report', { p_job: j.id, p_reasons: [codes[0].code], p_detail: 'จำลองเกินเวลา', p_new_eta: '2099-02-01T10:00:00Z' })
              const r2 = await client.rpc('qc', 'finish_station', { p_job: j.id, p_station: 'qc_pack' })
              if (!r2.ok) throw new Error(`finish qc after delay report: ${JSON.stringify(r2.body)}`)
            } else {
              throw new Error(`finish_${j.current_station}: ${JSON.stringify(r.body)}`)
            }
          }
        })
      }
    }

    // จัดส่งงานที่เสร็จแล้ว
    const doneJobs = await client.sql("select id, confirmation_no from public.jobs where phase = 'done' and delivered_at is null")
    for (const dj of doneJobs) {
      await execAction({ day: dayStr, actor: 'admin1', action: 'mark_delivered', jobNo: dj.confirmation_no }, async () => {
        const r = await client.rpc('admin1', 'mark_delivered', { p_job: dj.id, p_note: 'ส่งเรียบร้อย' })
        if (!r.ok) throw new Error(`mark_delivered: ${JSON.stringify(r.body)}`)
      })
    }

    // เลื่อนวัน + รัน inbox_scan
    await client.rpc('admin1', 'inbox_scan')
    simDate = new Date(simDate.getTime() + 86400_000)
  }

  const [{ doneCnt, totalCnt }] = await client.sql("select count(*) filter (where phase='done')::int \"doneCnt\", count(*)::int \"totalCnt\" from public.jobs")
  return {
    actionsCount,
    totalJobs: totalCnt,
    doneJobs: doneCnt,
    negativeChecked,
    concurrencyChecked,
    browserChecked,
  }
}

export { shrinkTrace }
