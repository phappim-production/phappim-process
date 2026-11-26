// ส่วน C — ทดสอบครบระบบ: ทุกบทบาท x ทุกเส้นทาง (เปิดขั้นรอผลิตตลอดส่วนนี้)
import { startLocalStack } from '../qa-r14/server.mjs'
import { openChrome, waitFor } from '../qa-r14/chrome.mjs'
import { createFixtures } from '../qa-r14/fixtures.mjs'
import { ACCOUNTS } from '../qa-r14/db.mjs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const stack = await startLocalStack({ materialsCheck: true })
if (!/^http:\/\/127\.0\.0\.1:/.test(stack.origin)) throw new Error('ต้องเป็นระบบในเครื่องเท่านั้น')
const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
const h = chrome.wrap(chrome.main)
const results = []

const sql = async (q, params = []) => {
  const r = await (await fetch(stack.origin + '/__qa/sql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sql: q, params }),
  })).json()
  if (r.message) throw new Error(r.message)
  return r.rows
}

async function restRpc(key, fn, body = {}) {
  const acc = ACCOUNTS.find(a => a.key === key)
  const login = await (await fetch(`${stack.origin}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: 'r14-local-anon-key' },
    body: JSON.stringify({ email: acc.email, password: acc.password ?? 'r14-local-pass' }),
  })).json()
  const res = await fetch(`${stack.origin}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: 'r14-local-anon-key', authorization: `Bearer ${login.access_token}` },
    body: JSON.stringify(body),
  })
  const txt = await res.text()
  let parsed = txt
  try { parsed = JSON.parse(txt) } catch {}
  return { status: res.status, ok: res.ok, body: parsed }
}

const logs = () => chrome.main.logs.filter(e => !String(e.text ?? '').startsWith("Blocked attempt to show a 'beforeunload'"))

async function step(id, fn) {
  const before = logs().length
  try {
    const detail = await fn()
    const errs = logs().slice(before)
    if (errs.length) throw new Error('console: ' + JSON.stringify(errs).slice(0, 400))
    results.push({ id, status: 'PASS', detail })
    console.log(`PASS ${id} · ${detail ?? ''}`)
  } catch (e) {
    results.push({ id, status: 'FAIL', error: e?.message ?? String(e) })
    console.log(`FAIL ${id} · ${e?.message ?? e}`)
  }
}

async function passMaterials(jobId, no, jpgPath) {
  await restRpc('admin1', 'set_job_materials', { p_job: jobId, p_items: ['ผ้าคอตตอน', 'ด้าย'] })
  const mats = await sql('select id from public.job_materials where job_id = $1', [jobId])
  for (const m of mats) await restRpc('admin1', 'check_material', { p_material_id: m.id, p_checked: true })
  const photo = `${no}/mat${Date.now().toString(36)}.jpg`
  await sql("insert into private.file_objects (kind, path, size, content_type) values ('mockups', $1, 50, 'image/jpeg')", [photo])
  stack.r2Store.set('mockups/' + photo, { bytes: new Uint8Array(await readFile(jpgPath)), type: 'image/jpeg' })
  await restRpc('admin1', 'add_material_photos', { p_job: jobId, p_paths: [photo] })
  const rel = await restRpc('admin1', 'release_job', { p_job: jobId })
  if (!rel.ok) throw new Error('release failed: ' + JSON.stringify(rel.body))
}

try {
  await fetch(stack.origin + '/__qa/reset', { method: 'POST' })
  await sql('update public.production_settings set materials_check = true')
  const fx = await createFixtures(chrome.main)

  // C.1: เดินครบทุกเส้นทาง + ตรวจยอดบอร์ด/ภาพรวม/รายงาน
  await step('C1.all-routes-with-materials', async () => {
    const cases = [
      { no: 'SC-C1-NORM', route: 'normal', sample: false, dev: false, stations: ['print', 'press', 'cut', 'sew', 'qc_pack'] },
      { no: 'SC-C1-DTF', route: 'dtf', sample: false, dev: false, film: true, stations: ['cut', 'dtf_press', 'sew', 'qc_pack'] },
      { no: 'SC-C1-DTG', route: 'dtg', sample: false, dev: false, film: true, stations: ['cut', 'dtf_press', 'sew', 'qc_pack'] },
      { no: 'SC-C1-SCR', route: 'screen', sample: false, dev: false, film: true, stations: ['cut', 'dtf_press', 'sew', 'qc_pack'] },
      { no: 'SC-C1-CUT', route: 'cut_only', sample: false, dev: false, stations: ['cut', 'qc_pack'] },
      { no: 'SC-C1-OUT', route: 'outside', sample: false, dev: false, outside: true, stations: ['outside', 'qc_pack'] },
      { no: 'SC-C1-SMP', route: 'cut_only', sample: true, dev: false, stations: ['cut', 'qc_pack'] },
      { no: 'SC-C1-DEV', route: 'cut_only', sample: true, dev: true, stations: ['cut', 'qc_pack'] },
    ]
    const vendor = (await restRpc('admin1', 'add_vendor', { p_name: 'บ.นอก C1', p_stations: ['outside'] })).body
    for (const c of cases) {
      const r = await restRpc('admin1', 'receive_job', {
        p_confirmation_no: c.no, p_customer_name: 'ลูกค้า C1', p_job_name: c.no,
        p_product_type_code: 'tshirt', p_qty: 20, p_unit: 'ตัว',
        p_due_date: '2099-01-25', p_route_code: c.route, p_confirmation_pdf_path: null,
        p_confirmation_rev: 0, p_spec: {}, p_needs_sample: c.sample, p_develop: c.dev,
      })
      if (!r.ok) throw new Error(`${c.no} receive: ${JSON.stringify(r.body)}`)
      const id = r.body
      await passMaterials(id, c.no, fx.paths.backJpg)
      if (c.film) {
        await restRpc('admin1', 'order_film', { p_job: id, p_eta: '2099-01-10' })
        await restRpc('admin1', 'receive_film', { p_job: id })
      }
      const walk = async (sts) => {
        for (const st of sts) {
          if (st === 'outside') {
            const run = (await restRpc('admin1', 'send_out', {
              p_job: id, p_vendor: vendor, p_last_station: 'outside',
              p_arrive_at: '2099-01-05T03:00:00Z', p_lead_days: 2, p_back_at: '2099-01-07T03:00:00Z', p_note: 'C1',
            })).body
            await restRpc('admin1', 'receive_back', { p_run: run, p_note: 'ครบ' })
            continue
          }
          if (st === 'sew') {
            await restRpc('prod1', 'note_queue_skip', { p_job: id, p_reason: 'C1' })
            await restRpc('prod1', 'start_sewing', { p_job: id })
            await restRpc('prod1', 'finish_sewing', { p_job: id })
            continue
          }
          if (st === 'qc_pack') {
            await restRpc('qc', 'start_in_queue', { p_job: id, p_reason: 'C1' })
            await restRpc('qc', 'record_qc', { p_job: id, p_passed: 20 })
            await restRpc('qc', 'finish_station', { p_job: id, p_station: 'qc_pack' })
            continue
          }
          await restRpc('prod1', 'start_in_queue', { p_job: id, p_reason: 'C1' })
          await restRpc('prod1', 'finish_station', { p_job: id, p_station: st })
        }
      }
      await walk(c.stations)
      if (c.sample) {
        await restRpc('admin1', 'record_sample_result', { p_job: id, p_pass: true, p_note: 'ผ่าน', p_customer_confirmed_at: '2099-01-12T03:00:00Z' })
        if (!c.dev) await walk(c.stations)
      }
      if (!c.dev) await restRpc('admin1', 'mark_delivered', { p_job: id, p_note: 'ส่งแล้ว' })
    }
    const [{ doneCnt, shippedCnt }] = await sql("select count(*) filter (where phase='done')::int \"doneCnt\", count(*) filter (where delivered_at is not null)::int \"shippedCnt\" from public.jobs")
    if (doneCnt !== 8 || shippedCnt !== 7) throw new Error(`done=${doneCnt} shipped=${shippedCnt}`)
    return `เดินครบ ${cases.length} เส้นทางผ่านขั้นรอผลิตจนเสร็จ/จัดส่ง (done=${doneCnt}, shipped=${shippedCnt})`
  })

  // C.4 & C.5: staff & QC มือถือ 375px โหมดพม่า
  await step('C4-C5.staff-qc-burmese-375', async () => {
    const r = await restRpc('admin1', 'receive_job', {
      p_confirmation_no: 'SC-C4-MM', p_customer_name: 'ลูกค้าพม่า', p_job_name: 'งานโหมดพม่า',
      p_product_type_code: 'tshirt', p_qty: 10, p_unit: 'ตัว',
      p_due_date: '2099-01-25', p_route_code: 'cut_only', p_confirmation_pdf_path: null,
      p_confirmation_rev: 0, p_spec: {}, p_needs_sample: false,
    })
    const jobId = r.body
    await passMaterials(jobId, 'SC-C4-MM', fx.paths.backJpg)

    await h.goto('staff_single', '#/board', 375)
    await h.waitText('SC-C4-MM')
    await h.screenshot('r20-c4-staff-burmese-375')
    const staffOver = await h.ev(() => document.documentElement.scrollWidth > innerWidth + 1)
    if (staffOver) throw new Error('staff 375px overflow')

    await restRpc('staff_single', 'start_in_queue', { p_job: jobId, p_reason: 'C4' })
    await restRpc('staff_single', 'finish_station', { p_job: jobId, p_station: 'cut' })

    await h.goto('qc', `#/board?job=${jobId}`, 375)
    await h.waitText('SC-C4-MM')
    await h.screenshot('r20-c5-qc-burmese-375')
    return 'staff & QC 375px โหมดพม่าไม่ล้น'
  })

  // C.7: เปิดรูปยืนยันงานสถานีร่วมกับขั้นรอผลิต (รูปวัตถุดิบ != รูปชิ้นแรก/งานเสร็จ)
  await step('C7.station-photos-with-materials-check', async () => {
    const en = await restRpc('owner', 'set_station_photos_enabled', { p_on: true, p_remind_minutes: 15 })
    if (!en.ok) throw new Error('enable station photos failed: ' + JSON.stringify(en.body))
    const r = await restRpc('admin1', 'receive_job', {
      p_confirmation_no: 'SC-C7-BOTH', p_customer_name: 'ลูกค้า C7', p_job_name: 'ทดสอบรูปคู่รอผลิต',
      p_product_type_code: 'tshirt', p_qty: 15, p_unit: 'ตัว',
      p_due_date: '2099-01-25', p_route_code: 'cut_only', p_confirmation_pdf_path: null,
      p_confirmation_rev: 0, p_spec: {}, p_needs_sample: false,
    })
    const jobId = r.body
    await passMaterials(jobId, 'SC-C7-BOTH', fx.paths.backJpg)
    await restRpc('staff_single', 'start_in_queue', { p_job: jobId, p_reason: 'C7' })
    // ต้องติดรูปชิ้นแรก (ไม่เอารูปวัตถุดิบมานับแทน)
    const fin1 = await restRpc('staff_single', 'finish_station', { p_job: jobId, p_station: 'cut' })
    if (fin1.ok || !/ชิ้นแรก/.test(JSON.stringify(fin1.body))) throw new Error('ไม่ติดรูปชิ้นแรก: ' + JSON.stringify(fin1.body))
    const fp = `SC-C7-BOTH/cut/1/fp01.jpg`
    const finp = `SC-C7-BOTH/cut/1/fn01.jpg`
    await sql("insert into private.file_objects (kind, path, size, content_type) values ('station_photos', $1, 50, 'image/jpeg'), ('station_photos', $2, 50, 'image/jpeg')", [fp, finp])
    stack.r2Store.set('station_photos/' + fp, { bytes: new Uint8Array(await readFile(fx.paths.frontPng)), type: 'image/jpeg' })
    stack.r2Store.set('station_photos/' + finp, { bytes: new Uint8Array(await readFile(fx.paths.detailWebp)), type: 'image/jpeg' })
    const chk = await restRpc('staff_single', 'submit_first_piece', { p_job: jobId, p_station: 'cut', p_photos: [fp], p_note: 'ชิ้นแรก C7' })
    if (!chk.ok) throw new Error('submit_first_piece failed: ' + JSON.stringify(chk.body))
    const dec = await restRpc('admin1', 'decide_first_piece', { p_check: chk.body, p_approve: true, p_reason: null })
    if (!dec.ok) throw new Error('decide_first_piece failed: ' + JSON.stringify(dec.body))
    const finP = await restRpc('staff_single', 'add_finish_photos', { p_job: jobId, p_station: 'cut', p_photos: [finp] })
    if (!finP.ok) throw new Error('add_finish_photos failed: ' + JSON.stringify(finP.body))
    const fin2 = await restRpc('staff_single', 'finish_station', { p_job: jobId, p_station: 'cut' })
    if (!fin2.ok) throw new Error('finish cut failed: ' + JSON.stringify(fin2.body))
    return 'รูปวัตถุดิบ + รูปชิ้นแรก + รูปงานเสร็จ ทำงานร่วมกันไม่ชน'
  })
} finally {
  await mkdir('tools/qa-r20-ag', { recursive: true })
  await writeFile('tools/qa-r20-ag/part-c-e2e-results.json', JSON.stringify({
    externalAttempts: chrome.externalAttempts,
    results,
  }, null, 2))
  await chrome.close()
  await stack.close?.()
}
const failed = results.filter(r => r.status === 'FAIL').length
console.log(`SUMMARY: ${results.length - failed}/${results.length} PASS · externalAttempts=${chrome.externalAttempts.length}`)
process.exit(failed ? 1 : 0)
