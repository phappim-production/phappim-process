import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { startLocalStack, sessionFor } from '../qa-r14/server.mjs'
import { openChrome, waitFor } from '../qa-r14/chrome.mjs'
import { createFixtures } from '../qa-r14/fixtures.mjs'
import { ACCOUNTS } from '../qa-r14/db.mjs'

const PORT = Number(process.env.QA_PORT ?? 5234)
const FILES_PORT = Number(process.env.QA_FILES_PORT ?? 5235)
const OUT_JSON = fileURLToPath(new URL('./part-c-e2e-results.json', import.meta.url))

const results = []
const observations = []

function record(id, title, pass, detail = '') {
  results.push({ id, title, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${title}${detail ? ' · ' + detail : ''}`)
}

async function reloadClean(tab, mustHaveText) {
  await tab.ev(() => { window.__preReloadMarker = 1; location.reload() })
  await waitFor(() => tab.ev(() => !window.__preReloadMarker && document.readyState === 'complete').catch(() => false), 'รอโหลดหน้าใหม่', 12000)
  if (mustHaveText) await tab.waitText(mustHaveText, 12000)
}

async function run() {
  const stack = await startLocalStack({ port: PORT, filesPort: FILES_PORT })
  const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
  const t = chrome.wrap(chrome.main)
  const fx = await createFixtures(t)
  const accByKey = Object.fromEntries(ACCOUNTS.map(a => [a.key, a]))
  const uid = k => accByKey[k].id
  const tokenOf = k => sessionFor(accByKey[k]).access_token

  const sql = async (q, params = []) => {
    const r = await fetch(`${stack.origin}/__qa/sql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: q, params }),
    })
    const j = await r.json()
    if (!r.ok || j.message) throw new Error(j.message ?? `SQL HTTP ${r.status}`)
    return j.rows
  }
  const as = (userId, call, args = []) => sql(`with c as materialized (select set_config('request.jwt.claim.sub', $1, false) x) select ${call} from c`, [userId, ...args])
  const callRpcHttp = async (actorKey, fn, bodyObj = {}) => {
    const res = await fetch(`${stack.origin}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: 'r14-local-anon-key', 'Content-Type': 'application/json', Authorization: `Bearer ${tokenOf(actorKey)}` },
      body: JSON.stringify(bodyObj),
    })
    const text = await res.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    return { ok: res.ok, status: res.status, data }
  }

  const rand = () => Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(0, 6) || '1a'

  async function seedJpg(userId, jobId, station, tag) {
    const [r] = await sql('select private.mockup_folder(confirmation_no) as f, visit from public.jobs where id = $1', [jobId])
    const cleanTag = String(tag).replace(/[^A-Za-z0-9]/g, '')
    const path = `${r.f}/${station}/${r.visit}/${cleanTag}.jpg`
    const bytes = new Uint8Array(await readFile(fx.paths.backJpg))
    stack.r2Store.set('station_photos/' + path, { bytes, type: 'image/jpeg' })
    await sql("insert into private.file_objects (kind, path, size, content_type, uploaded_by) values ('station_photos', $1, $2, 'image/jpeg', $3) on conflict do nothing", [path, bytes.byteLength, userId])
    return path
  }

  async function completeStationWithPhotos(actorUid, jobId, station, qty = 20, firstPieceRequired = true, skipReason = null) {
    if (station === 'sew') {
      await as(actorUid, 'public.start_in_queue($2::uuid, $3::text)', [jobId, skipReason])
      const fin = await seedJpg(actorUid, jobId, 'sew', `fn${rand()}`)
      await as(actorUid, "public.add_finish_photos($2::uuid, 'sew', $3::text[])", [jobId, [fin]])
      await as(actorUid, 'public.finish_sewing($2::uuid)', [jobId])
      return
    }
    if (station === 'qc_pack') {
      const [jRow] = await sql('select phase from public.jobs where id = $1', [jobId])
      await as(uid('qc'), 'public.start_in_queue($2::uuid, $3::text)', [jobId, skipReason])
      if (jRow?.phase === 'production') {
        await as(uid('qc'), 'public.record_qc($2::uuid, $3::int)', [jobId, qty])
      }
      const fin = await seedJpg(uid('qc'), jobId, 'qc_pack', `qfn${rand()}`)
      await as(uid('qc'), "public.add_finish_photos($2::uuid, 'qc_pack', $3::text[])", [jobId, [fin]])
      await as(uid('qc'), "public.finish_station($2::uuid, 'qc_pack')", [jobId])
      return
    }
    await as(actorUid, 'public.start_in_queue($2::uuid, $3::text)', [jobId, skipReason])
    if (firstPieceRequired) {
      const fp = await seedJpg(actorUid, jobId, station, `fp${rand()}`)
      const cid = (await as(actorUid, `public.submit_first_piece($2::uuid, '${station}', $3::text[]) as id`, [jobId, [fp]]))[0].id
      await as(uid('admin1'), 'public.decide_first_piece($2::bigint, true)', [cid])
    }
    const fn = await seedJpg(actorUid, jobId, station, `fn${rand()}`)
    await as(actorUid, `public.add_finish_photos($2::uuid, '${station}', $3::text[])`, [jobId, [fn]])
    await as(actorUid, `public.finish_station($2::uuid, '${station}')`, [jobId])
  }

  async function receiveJob(no, route = 'cut_only', opts = {}) {
    const [row] = await as(uid('admin1'), `public.receive_job(
      p_confirmation_no => $2, p_customer_name => $3, p_job_name => $4,
      p_product_type_code => $5, p_qty => $6, p_unit => $7,
      p_due_date => (current_date + $8::int), p_route_code => $9, p_confirmation_pdf_path => null,
      p_spare_qty => 0, p_confirmation_rev => 0, p_spec => $10::jsonb, p_needs_sample => $11, p_develop => $12
    ) as id`, [no, opts.customer ?? 'ลูกค้า C', opts.jobName ?? 'งาน E2E', opts.product ?? 'tshirt', opts.qty ?? 10, opts.unit ?? 'ตัว', opts.dueOffset ?? 5, route, JSON.stringify(opts.spec ?? {}), opts.needsSample ?? false, opts.develop ?? false])
    return row.id
  }

  async function check(id, title, fn, { allowErrorStatus = false, tabs = [chrome.main] } = {}) {
    const offsets = tabs.map(tb => tb.logs.length)
    try {
      const detail = await fn()
      const bad = tabs.flatMap((tb, i) => tb.logs.slice(offsets[i])).filter(e => {
        if (String(e.text ?? '').startsWith("Blocked attempt to show a 'beforeunload'")) return false
        if (allowErrorStatus && /400|403|404|409|413|415|422|500|503/.test(e.text ?? '')) return false
        return true
      })
      if (bad.length) throw new Error('console error: ' + JSON.stringify(bad).slice(0, 400))
      record(id, title, true, detail ?? '')
    } catch (e) {
      record(id, title, false, e?.stack ?? e?.message ?? String(e))
    }
  }

  try {
    // Keep station photos ON throughout entire Part C!
    // === C.1 All Routes + Sample + Develop + Export E2E & Cross-View Sync ===
    await check('C1.all-routes-photos-on', 'C1 เดินครบทุกเส้นทาง + ตัวอย่าง + Develop + ส่งออกต่างประเทศ (เปิดรูปยืนยันตลอดส่วน C)', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
      const [vendor] = await sql("select id from public.vendors where active limit 1")

      const routePlans = [
        { no: 'SC-C1-NRM', route: 'normal', stations: ['print', 'press', 'cut', 'sew', 'qc_pack'] },
        { no: 'SC-C1-DTF', route: 'dtf', film: true, stations: ['cut', 'dtf_press', 'sew', 'qc_pack'] },
        { no: 'SC-C1-DTG', route: 'dtg', film: true, stations: ['cut', 'dtf_press', 'sew', 'qc_pack'] },
        { no: 'SC-C1-SCR', route: 'screen', film: true, stations: ['cut', 'dtf_press', 'sew', 'qc_pack'] },
        { no: 'SC-C1-PEB', route: 'print_emb', stations: ['print', 'press', 'cut', 'emb', 'sew', 'qc_pack'] },
        { no: 'SC-C1-CUT', route: 'cut_only', stations: ['cut', 'qc_pack'] },
        { no: 'SC-C1-EXP', route: 'cut_only', stations: ['cut', 'qc_pack'], customer: 'Export Japan Co., Ltd.', delivery: 'ส่งออกต่างประเทศ / DHL' },
      ]
      for (const rp of routePlans) {
        const jId = await receiveJob(rp.no, rp.route, { qty: 10, customer: rp.customer, spec: rp.delivery ? { h: { doc_no: rp.no, delivery: rp.delivery } } : {} })
        if (rp.film) {
          await as(uid('admin1'), 'public.order_film($2::uuid, current_date + 1)', [jId])
          await as(uid('admin1'), 'public.receive_film($2::uuid)', [jId])
        }
        for (const st of rp.stations) {
          await completeStationWithPhotos(uid('prod1'), jId, st, 10)
        }
        await as(uid('admin1'), "public.mark_delivered($2::uuid, 'จัดส่งเรียบร้อย')", [jId])
      }

      // Outside route
      let [outVendor] = await sql("select id from public.vendors where active and 'outside' = any(stations) limit 1")
      if (!outVendor) {
        outVendor = { id: (await as(uid('admin1'), "public.add_vendor('ร้านผลิตข้างนอก', array['outside']) as id"))[0].id }
      }
      const jOut = await receiveJob('SC-C1-OUT', 'outside', { qty: 15 })
      const runOut = (await as(uid('admin1'), "public.send_out($2::uuid, $3::bigint, 'outside', now() + interval '1 hour', 1, now() + interval '1 day', null) as id", [jOut, outVendor.id]))[0].id
      await as(uid('admin1'), 'public.receive_back($2::bigint, null)', [runOut])
      await completeStationWithPhotos(uid('qc'), jOut, 'qc_pack', 15)
      await as(uid('admin1'), 'public.mark_delivered($2::uuid, null)', [jOut])

      // Sample job: round 1 fail -> round 2 pass -> production -> done -> shipped
      const jSmpl = await receiveJob('SC-C1-SMP', 'cut_only', { qty: 10, needsSample: true, develop: false })
      await completeStationWithPhotos(uid('prod1'), jSmpl, 'cut', 10)
      await completeStationWithPhotos(uid('qc'), jSmpl, 'qc_pack', 10)
      await as(uid('admin1'), "public.record_sample_result($2::uuid, false, 'ปรับสีหน่อย')", [jSmpl])
      await completeStationWithPhotos(uid('prod1'), jSmpl, 'cut', 10)
      await completeStationWithPhotos(uid('qc'), jSmpl, 'qc_pack', 10)
      await as(uid('admin1'), 'public.record_sample_result($2::uuid, true, null, current_date)', [jSmpl])
      await completeStationWithPhotos(uid('prod1'), jSmpl, 'cut', 10)
      await completeStationWithPhotos(uid('qc'), jSmpl, 'qc_pack', 10)
      await as(uid('admin1'), 'public.mark_delivered($2::uuid, null)', [jSmpl])

      // Develop job: sample pass -> straight to done!
      const jDev = await receiveJob('SC-C1-DEV', 'cut_only', { qty: 3, needsSample: true, develop: true })
      await completeStationWithPhotos(uid('prod1'), jDev, 'cut', 3)
      await completeStationWithPhotos(uid('qc'), jDev, 'qc_pack', 3)
      await as(uid('admin1'), "public.record_sample_result($2::uuid, true, 'Develop ผ่าน', current_date)", [jDev])

      // Check UI consistency across Board, Overview, All Jobs, Production Queue, Reports, History
      for (const [role, hash, waitTxt] of [
        ['owner', '#/production', 'เสร็จวันนี้'],
        ['manager', '#/reports', 'งาน Develop'],
        ['admin1', '#/board', 'SC-C1-DEV'],
        ['admin1', '#/production-queue', 'คิวการผลิต'],
        ['prod1', '#/history', 'SC-C1-NRM'],
      ]) {
        await t.goto(role, hash, 1440)
        await t.waitText(waitTxt)
      }
      const counts = await sql(`select count(*)::int as total, count(*) filter (where phase='done')::int as done_cnt, count(*) filter (where delivered_at is not null)::int as shipped_cnt from public.jobs`)
      assert.equal(counts[0].done_cnt, 10, 'ทั้ง 10 งานต้องจบ done: ' + JSON.stringify(counts[0]))
      return `10 routes/flows done + photos ON + cross-view consistent (${JSON.stringify(counts[0])})`
    })

    // === C.2 Admin UI 8 product groups + Full Admin Lifecycle ===
    await check('C2.admin-8-groups-and-lifecycle', 'C2 แอดมิน: ฟอร์ม 8 กลุ่มสินค้า + PDF + ฟิล์ม + ส่งออก/รับกลับ + แบ่งงาน + แก้ใบ + จัดส่ง + ม็อคอัพ + อนุมัติรูป', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
      // 1 representative product per category/type (8 groups) saved via confirmation.html UI!
      const prodSamples = [
        ['tshirt', 'SC-C2-GRP1', { k: '[data-t="sizes"][data-r="0"][data-c="q:M"]', v: '10', label: '[data-t="sizes"][data-r="0"][data-c="label"]' }],
        ['polo', 'SC-C2-GRP2', { k: '[data-t="sizes"][data-r="0"][data-c="q:L"]', v: '12', label: '[data-t="sizes"][data-r="0"][data-c="label"]' }],
        ['jacket', 'SC-C2-GRP3', { k: '[data-t="sizes"][data-r="0"][data-c="q:M"]', v: '8', label: '[data-t="sizes"][data-r="0"][data-c="label"]' }],
        ['bag', 'SC-C2-GRP4', { k: 'input[data-t="items"][data-r="0"][data-c="qty"]', v: '20', label: 'input[data-t="items"][data-r="0"][data-c="name"]' }],
        ['scarf', 'SC-C2-GRP5', { k: 'input[data-t="items"][data-r="0"][data-c="qty"]', v: '15', label: 'input[data-t="items"][data-r="0"][data-c="name"]' }],
        ['hat', 'SC-C2-GRP6', { k: 'input[data-t="items"][data-r="0"][data-c="qty"]', v: '25', label: 'input[data-t="items"][data-r="0"][data-c="name"]' }],
        ['pillow', 'SC-C2-GRP7', { k: 'input[data-t="items"][data-r="0"][data-c="qty"]', v: '10', label: 'input[data-t="items"][data-r="0"][data-c="name"]' }],
        ['premium', 'SC-C2-GRP8', { k: 'input[data-t="items"][data-r="0"][data-c="qty"]', v: '30', label: 'input[data-t="items"][data-r="0"][data-c="name"]' }],
      ]
      for (const [pCode, docNo, qtyField] of prodSamples) {
        await t.goto('admin1', '#/', 1440, '/confirmation.html?new=1')
        await t.ev(p => {
          document.querySelector('[data-act="pick"]')?.click()
          document.querySelector(`input[data-product][value="${p}"]`)?.click()
        }, pCode)
        await delay(250)
        await t.fillInput('[data-k="doc_no"]', docNo)
        await t.fillInput('[data-k="customer"]', `ลูกค้ากลุ่ม ${pCode}`)
        await t.fillInput('[data-k="due_date"]', '2026-12-22')
        await t.ev(() => { [...document.querySelectorAll('input[type=radio][data-k="sample"]')].find(r => r.value === 'ไม่ขึ้นตัวอย่าง')?.click() })
        await t.fillInput(qtyField.label, `สีทดสอบ-${pCode}`)
        await t.fillInput(qtyField.k, qtyField.v)
        await t.uploadFiles('input[type="file"][data-img]', [fx.paths.frontPng])
        await waitFor(() => t.ev(() => document.querySelectorAll('.imgs figure').length === 1), 'แนบรูป')
        await t.ev(() => { window.open = () => null })
        await t.clickButton('บันทึกเข้าระบบ')
        await delay(200)
        await t.goto('admin1', '#/board?confirmation=save', 1440)
        await t.waitText(docNo)
      }
      const drafts = await sql('select count(*)::int as c from public.confirmation_drafts')
      assert.equal(drafts[0].c, 8, 'ต้องบันทึกใบร่างครบ 8 กลุ่มสินค้า')

      // Full admin lifecycle on a job: receive -> attach PDF -> film -> mockup approve -> split -> unship/ship -> first piece approve
      const jAdm = await receiveJob('SC-C2-LIFE', 'dtf', { qty: 30, withMockup: false })
      await t.goto('admin1', `#/board?job=${jAdm}`, 1440)
      await t.waitText('SC-C2-LIFE')
      await t.uploadFiles('[role=dialog] input[type="file"][accept*="pdf"]', [fx.paths.pdf])
      await t.clickButton('แนบ PDF ใบยืนยัน', { exact: true, inside: '[role=dialog]' })
      await t.waitText('เปิด PDF ใบยืนยัน')
      await t.fillInput('[role=dialog] input[type="date"]', '2026-12-10')
      await t.clickButton(/บันทึกสั่งฟิล์ม/, { inside: '[role=dialog]' })
      await t.waitText(/ได้รับ.*ฟิล์ม.*แล้ว/)
      await t.clickButton(/ได้รับ.*ฟิล์ม.*แล้ว/, { inside: '[role=dialog]' })
      await delay(300)
      // Create & approve mockup sheet
      const sheetId = (await as(uid('admin1'), 'public.start_mockup_sheet($2::uuid, null)', [jAdm]))[0].start_mockup_sheet
      const mPath = 'SC-C2-LIFE/m1.png'
      stack.r2Store.set('mockups/' + mPath, { bytes: new Uint8Array(await readFile(fx.paths.frontPng)), type: 'image/png' })
      await sql("insert into private.file_objects (kind, path, size, content_type, uploaded_by) values ('mockups', $1, 100, 'image/png', $2) on conflict do nothing", [mPath, uid('admin1')])
      await as(uid('admin1'), 'public.save_mockup_draft($2::uuid, 1, $3::jsonb)', [sheetId, JSON.stringify({ views: [{ view: 'front', image_path: mPath, width: 600, height: 600 }], specs: [], callouts: [{ no: 1, view: 'front', x: 0.5, y: 0.5, box_x: 0.2, box_y: 0.2, title: 'โลโก้', body: 'กลางอก', stations: ['dtf_press'] }] })])
      const vSub2 = (await as(uid('admin1'), 'public.submit_mockup_sheet($2::uuid, 2)', [sheetId]))[0].submit_mockup_sheet
      await as(uid('admin1'), "public.approve_mockup_sheet($2::uuid, 'อนุมัติม็อคอัพ C2', $3::int)", [sheetId, vSub2])

      // Walk job through cut with photo approval via Admin UI!
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jAdm])
      const fpPath = await seedJpg(uid('prod1'), jAdm, 'cut', 'fpadm')
      await as(uid('prod1'), "public.submit_first_piece($2::uuid, 'cut', $3::text[])", [jAdm, [fpPath]])
      await t.goto('admin1', '#/', 1440)
      await t.waitText('SC-C2-LIFE')
      await t.clickButton(/SC-C2-LIFE.*ตรวจ/)
      await waitFor(() => t.ev(() => {
        const b = [...document.querySelectorAll('[role=dialog] button')].find(x => x.textContent.includes('ผ่าน ทำทั้งล็อตได้'))
        return b && !b.disabled
      }), 'โหลดรูปชิ้นแรก C2')
      await t.clickButton('ผ่าน ทำทั้งล็อตได้')
      await t.waitGone('ผ่าน ทำทั้งล็อตได้')

      // Split remaining qty & finish child + ship + undo delivery!
      await as(uid('prod1'), "public.add_finish_photos($2::uuid, 'cut', $3::text[])", [jAdm, [await seedJpg(uid('prod1'), jAdm, 'cut', 'fn1')]])
      await as(uid('prod1'), "public.finish_station($2::uuid, 'cut')", [jAdm])
      const jChild = (await as(uid('admin1'), 'public.split_job($2::uuid, 10) as id', [jAdm]))[0].id
      await completeStationWithPhotos(uid('prod1'), jChild, 'dtf_press', 10, true, 'ทดสอบ C2')
      await completeStationWithPhotos(uid('prod1'), jChild, 'sew', 10)
      await completeStationWithPhotos(uid('qc'), jChild, 'qc_pack', 10)
      await as(uid('admin1'), "public.mark_delivered($2::uuid, 'ส่งรอบแรก')", [jChild])
      await as(uid('admin1'), "public.undo_delivery($2::uuid, 'ขอตรวจกล่องซ้ำ')", [jChild])
      await as(uid('admin1'), "public.mark_delivered($2::uuid, 'ส่งใหม่ครบ')", [jChild])
      return '8 product confirmation groups + PDF + film + mockup + split + first-piece UI approve + ship/unship OK'
    })

    // === C.3 Two concurrent production users (prod1 + prod2) ===
    await check('C3.concurrent-prod1-prod2', 'C3 ฝ่ายผลิต 2 คนพร้อมกัน: เริ่ม/พัก/แทรกคิว/จักร (เลือก/เสีย/คืน)/รายงานเกินเวลา/รูปงานเสร็จเย็บ', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
      const t2 = chrome.wrap(await chrome.newTab({ isolated: true }))
      // Complete jSew through print -> press -> cut FIRST so cut_only jobs don't block it
      const jSew = await receiveJob('SC-C3-SEW', 'normal', { qty: 10 })
      for (const st of ['print', 'press', 'cut']) await completeStationWithPhotos(uid('prod1'), jSew, st, 10)

      const jP1 = await receiveJob('SC-C3-P1', 'cut_only', { qty: 10 })
      const jP2 = await receiveJob('SC-C3-P2', 'cut_only', { qty: 10 })
      const jP3 = await receiveJob('SC-C3-P3', 'cut_only', { qty: 10 })
      const jUrg = await receiveJob('SC-C3-URG', 'cut_only', { qty: 10 })

      await t.goto('prod1', '#/board?station=cut', 1440)
      await t2.goto('prod2', '#/board?station=cut', 1440)
      await t.waitText('SC-C3-P1')
      await t2.waitText('SC-C3-P1')

      // prod1 starts SC-C3-P1 (Q1) concurrently while prod2 starts SC-C3-P3 with queue skip (ahead is P2)!
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jP1])
      await as(uid('prod2'), "public.start_in_queue($2::uuid, 'ลูกค้าเร่งด่วนกว่า')", [jP3])
      // prod1 holds SC-C3-P1; prod2 moves SC-C3-URG ahead of queued SC-C3-P2
      await as(uid('prod1'), "public.open_issue($2::uuid, 'มีดทื่อ')", [jP1])
      await as(uid('prod2'), "public.move_job_ahead($2::uuid, $3::uuid, 'แทรกงานด่วน')", [jUrg, jP2])

      // Sewing tab: prod1 starts sewing, marks 1 machine broken, repairs it, submits overdue SLA report, uploads sew finish photo & finishes!
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jSew])
      const [mCode] = await sql("select m.code from public.machine_assignments a join public.sewing_machines m on m.id = a.machine_id where a.job_id = $1 and a.released_at is null limit 1", [jSew])
      await as(uid('prod1'), "public.set_machine_status($2::text, 'broken', 'เข็มหัก', now() + interval '2 hours')", [mCode.code])
      await as(uid('prod1'), "public.set_machine_status($2::text, 'ready', 'ซ่อมแล้ว', null)", [mCode.code])
      const [sewSt] = await sql('select station_status from public.jobs where id = $1', [jSew])
      if (sewSt?.station_status === 'hold') {
        await as(uid('prod1'), 'public.resume_sewing($2::uuid)', [jSew])
      }
      // Backdate enabled_at BEFORE backdating station_started_at so photo_gate_on stays ON while overdue SLA triggers!
      await sql("update public.station_photo_settings set enabled_at = now() - interval '12 days'")
      await sql("update public.jobs set station_started_at = now() - interval '10 days' where id = $1", [jSew])
      const rFinNoPhoto = await callRpcHttp('prod1', 'finish_sewing', { p_job: jSew })
      assert.ok(!rFinNoPhoto.ok && /ถ่ายรูปงานเสร็จ/.test(rFinNoPhoto.data?.message ?? ''), 'เย็บเสร็จต้องบังคับส่งรูปก่อน: ' + JSON.stringify(rFinNoPhoto))
      await as(uid('prod1'), "public.add_finish_photos($2::uuid, 'sew', $3::text[])", [jSew, [await seedJpg(uid('prod1'), jSew, 'sew', 'c3sew')]])
      const rFinOverdue = await callRpcHttp('prod1', 'finish_sewing', { p_job: jSew })
      assert.ok(!rFinOverdue.ok && /รายงานปัญหา/.test(rFinOverdue.data?.message ?? ''), 'เกิน SLA ต้องบังคับรายงานปัญหาก่อน: ' + JSON.stringify(rFinOverdue))
      const [delayCode] = await sql('select code from public.reason_codes where active order by sort limit 1')
      await as(uid('prod1'), 'public.submit_delay_report($2::uuid, array[$3::text], \'งานเข้าซ้อน\', now() + interval \'1 day\', null)', [jSew, delayCode.code])
      await as(uid('prod1'), 'public.finish_sewing($2::uuid)', [jSew])
      return `prod1+prod2 concurrent OK · move_ahead + broken/repair(${mCode.code}) + overdue report + sew finish photo gates OK`
    }, { allowErrorStatus: true })

    // === C.4 Staff 375px Burmese usability ===
    await check('C4.staff-375-burmese', 'C4 พนักงานมือถือ 375 px โหมดพม่า (สถานีเดียว / หลายสถานี / ยังไม่จับคู่)', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
      const jStaff = await receiveJob('SC-C4-STF', 'normal', { qty: 12 })
      const sheetId = (await as(uid('admin1'), 'public.start_mockup_sheet($2::uuid, null)', [jStaff]))[0].start_mockup_sheet
      const mPath = 'SC-C4-STF/m1.png'
      stack.r2Store.set('mockups/' + mPath, { bytes: new Uint8Array(await readFile(fx.paths.frontPng)), type: 'image/png' })
      await sql("insert into private.file_objects (kind, path, size, content_type, uploaded_by) values ('mockups', $1, 100, 'image/png', $2) on conflict do nothing", [mPath, uid('admin1')])
      await as(uid('admin1'), 'public.save_mockup_draft($2::uuid, 1, $3::jsonb)', [sheetId, JSON.stringify({ views: [{ view: 'front', image_path: mPath, width: 600, height: 600 }], specs: [], callouts: [{ no: 1, view: 'front', x: 0.4, y: 0.4, box_x: 0.1, box_y: 0.1, title: 'โลโก้', body: 'สีขาว', stations: ['print'] }] })])
      const vSub4 = (await as(uid('admin1'), 'public.submit_mockup_sheet($2::uuid, 2)', [sheetId]))[0].submit_mockup_sheet
      await as(uid('admin1'), "public.approve_mockup_sheet($2::uuid, 'ok', $3::int)", [sheetId, vSub4])

      await t.goto('staff_multi', '#/board', 375)
      await t.ev(() => localStorage.setItem('pp142-lang', 'my'))
      await reloadClean(t, 'SC-C4-STF')
      await t.screenshot('c4-staff-multi-my-375')
      // View mockup & ack spec
      await t.goto('staff_multi', `#/mockup?id=${jStaff}`, 375)
      await waitFor(() => t.ev(() => document.body.innerText.includes('SC-C4-STF') && document.querySelectorAll('img').length > 0), 'staff ดูม็อคอัพ 375px')
      await t.screenshot('c4-staff-mockup-my-375')
      await as(uid('staff_multi'), "public.ack_mockup_sheet($2::uuid, 'print')", [sheetId])
      // Report issue UI at 375px in Burmese
      await t.goto('staff_multi', '#/report', 375)
      await t.waitText('SC-C4-STF')
      await t.screenshot('c4-staff-issue-my-375')
      // Check staff_empty 375px in Burmese
      await t.goto('staff_empty', '#/board', 375)
      await delay(300)
      const emptyTxt = await t.ev(() => document.body.innerText)
      await t.ev(() => localStorage.removeItem('pp142-lang'))
      observations.push({ key: 'C4_staff_empty_my_375', emptySnippet: emptyTxt.slice(0, 200) })
      return 'staff_multi 5 stations + mockup view + report + staff_empty at 375px Burmese OK'
    })

    // === C.5 QC + Packing Burmese + Rework to every upstream station + outsource ===
    await check('C5.qc-burmese-and-rework', 'C5 ฝ่าย QC โหมดพม่า: ตรวจไม่ครบ/ไม่ถ่ายรูป/ส่งแก้ทุกสถานี+ส่งนอก/error เป็นพม่า', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
      const [vendor] = await sql("select id from public.vendors where active and 'cut' = any(stations) limit 1")
      const jQc = await receiveJob('SC-C5-QC', 'normal', { qty: 10 })
      for (const st of ['print', 'press', 'cut', 'sew']) await completeStationWithPhotos(uid('prod1'), jQc, st, 10)
      await as(uid('qc'), 'public.start_in_queue($2::uuid, null)', [jQc])

      await t.goto('qc', '#/board?station=qc_pack', 375)
      await t.ev(() => localStorage.setItem('pp142-lang', 'my'))
      await reloadClean(t, 'SC-C5-QC')
      await t.screenshot('c5-qc-my-375')
      // Test over-qty error in Burmese!
      await t.clickButton('QC / ပက်ကင် ရလဒ် သိမ်းမယ်')
      await t.fillInput('[role=dialog] input[type=number]', '99')
      await t.clickButton('အောင်တာ သိမ်းမယ်', { inside: '[role=dialog]' })
      const qcErr = await waitFor(() => t.ev(() => document.querySelector('[role=dialog] [role=alert]')?.textContent?.trim() || false), 'error ตรวจเกินจำนวน')
      await t.screenshot('c5-qc-error-my-375')
      await t.ev(() => localStorage.removeItem('pp142-lang'))

      // Rework back to print, press, cut, sew (each returns directly to qc_pack), AND outsourced rework!
      for (const target of ['print', 'press', 'cut', 'sew']) {
        await as(uid('qc'), `public.send_rework($2::uuid, 2, 'แก้ที่ ${target}', '${target}')`, [jQc])
        await completeStationWithPhotos(uid('prod1'), jQc, target, 2)
        await as(uid('qc'), 'public.start_in_queue($2::uuid, null)', [jQc])
      }
      // Also rework sent out via send_out -> receive_back!
      await as(uid('qc'), "public.send_rework($2::uuid, 2, 'แก้ซ่อมข้างนอก', 'cut')", [jQc])
      const rwRun = (await as(uid('admin1'), "public.send_out($2::uuid, $3::bigint, 'cut', now() + interval '1 hour', 1, now() + interval '1 day', null) as id", [jQc, vendor.id]))[0].id
      await as(uid('admin1'), 'public.receive_back($2::bigint, null)', [rwRun])
      await as(uid('qc'), 'public.start_in_queue($2::uuid, null)', [jQc])
      await as(uid('qc'), 'public.record_qc($2::uuid, 10)', [jQc])
      await as(uid('qc'), "public.add_finish_photos($2::uuid, 'qc_pack', $3::text[])", [jQc, [await seedJpg(uid('qc'), jQc, 'qc_pack', 'c5fin')]])
      await as(uid('qc'), "public.finish_station($2::uuid, 'qc_pack')", [jQc])

      observations.push({ key: 'C5_qc_burmese_err', qcErr })
      return `QC Burmese err="${qcErr}" · rework back to print/press/cut/sew + outsource rework OK`
    }, { allowErrorStatus: true })

    // === C.6 Owner / Manager / Sup1 / Sup2 ===
    await check('C6.owner-manager-supervisors', 'C6 เจ้าของ / ผู้จัดการ / หัวหน้าเฟส: ยกเลิกทุกสถานะ, ตรวจย้อนหลัง, ตั้งค่า 6 แท็บ, ปิดบัญชี, มอบหมายสถานี', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
      // Seed and complete jDone FIRST before queued cut_only jobs
      const jDone = await receiveJob('SC-C6-DONE', 'cut_only', { qty: 5 })
      await completeStationWithPhotos(uid('prod1'), jDone, 'cut', 5)
      await completeStationWithPhotos(uid('qc'), jDone, 'qc_pack', 5)
      // Seed cancel targets in different phases: materials, film, sample, queued, doing, hold
      const jMat = await receiveJob('SC-C6-MAT', 'cut_only', { qty: 5 })
      const jFlm = await receiveJob('SC-C6-FLM', 'dtf', { qty: 5 })
      const jSmp = await receiveJob('SC-C6-SMP', 'cut_only', { qty: 5, needsSample: true })
      const jDo = await receiveJob('SC-C6-DO', 'cut_only', { qty: 5 })
      await as(uid('prod1'), "public.start_in_queue($2::uuid, 'ทดสอบ C6')", [jDo])
      const jHd = await receiveJob('SC-C6-HD', 'cut_only', { qty: 5 })
      await as(uid('prod1'), "public.start_in_queue($2::uuid, 'ทดสอบ C6')", [jHd])
      await as(uid('prod1'), "public.open_issue($2::uuid, 'ติดปัญหา')", [jHd])

      for (const j of [jMat, jFlm, jSmp, jDo, jHd]) {
        await as(uid('manager'), "public.cancel_job($2::uuid, 'ยกเลิกทดสอบ C6')", [j])
      }
      const rCanDone = await callRpcHttp('owner', 'cancel_job', { p_job: jDone, p_reason: 'ไม่ควรยกเลิก' })
      assert.ok(!rCanDone.ok, 'done ไม่ควรยกเลิกได้')

      // Check reviews ack by manager, settings 6 tabs by owner, sup1/sup2 queues
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [await receiveJob('SC-C6-REV', 'cut_only')])
      await t.goto('manager', '#/reviews', 1440)
      await t.waitText('รายการรออนุมัติ')
      await t.goto('sup1', '#/board', 1440)
      await t.waitText('คิวงาน')
      await t.goto('sup2', '#/board', 1440)
      await t.waitText('เย็บ')
      await t.goto('owner', '#/settings', 1440)
      await t.waitText('สถานีและขั้นย่อย')
      const settingsTabs = await t.ev(() => [...document.querySelectorAll('[role=group] button')].map(b => b.textContent.trim()))
      observations.push({ key: 'C6_settings_tabs', settingsTabs })
      assert.equal(settingsTabs.length, 6)

      // Disable admin2 and verify admin2 is locked out of UI AND REST reads!
      await sql('update public.profiles set active = false where user_id = $1', [uid('admin2')])
      await t.goto('admin2', '#/', 1440)
      await t.waitText('บัญชีนี้ถูกปิดใช้งาน')
      const restDisabled = await fetch(`${stack.origin}/rest/v1/job_live?select=id`, {
        headers: { apikey: 'r14-local-anon-key', Authorization: `Bearer ${tokenOf('admin2')}` },
      })
      const rowsDisabled = await restDisabled.json()
      assert.equal(Array.isArray(rowsDisabled) ? rowsDisabled.length : 0, 0, 'บัญชีที่ปิดต้องอ่าน job_live ไม่ได้')
      await sql('update public.profiles set active = true where user_id = $1', [uid('admin2')])

      return `cancels across phases + done blocked + 6 settings tabs + disabled lockouts OK`
    }, { allowErrorStatus: true })
  } finally {
    await fx.cleanup()
    await chrome.close()
    await stack.close()
    await writeFile(OUT_JSON, JSON.stringify({
      externalAttempts: chrome.externalAttempts,
      results,
      observations,
    }, null, 2))
  }
  const failed = results.filter(r => !r.pass)
  console.log(`\nSUMMARY test-part-c-e2e: ${results.length - failed.length}/${results.length} passed`)
  if (chrome.externalAttempts.length > 0) throw new Error('EXTERNAL ATTEMPTS: ' + JSON.stringify(chrome.externalAttempts))
  process.exit(failed.length ? 1 : 0)
}

run().catch(e => { console.error(e); process.exit(1) })
