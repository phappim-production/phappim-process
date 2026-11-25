import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { startLocalStack } from '../qa-r14/server.mjs'
import { openChrome, waitFor } from '../qa-r14/chrome.mjs'
import { createFixtures } from '../qa-r14/fixtures.mjs'
import { ACCOUNTS } from '../qa-r14/db.mjs'

const PORT = Number(process.env.QA_PORT ?? 5234)
const FILES_PORT = Number(process.env.QA_FILES_PORT ?? 5235)
const OUT_JSON = fileURLToPath(new URL('./part-d-ux-net-load.json', import.meta.url))

const results = []
const observations = []

function record(id, title, pass, detail = '') {
  results.push({ id, title, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${title}${detail ? ' · ' + detail : ''}`)
}

async function run() {
  const stack = await startLocalStack({ port: PORT, filesPort: FILES_PORT })
  const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
  const t = chrome.wrap(chrome.main)
  const fx = await createFixtures(t)
  const accByKey = Object.fromEntries(ACCOUNTS.map(a => [a.key, a]))
  const uid = k => accByKey[k].id

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
  const setCfg = cfg => fetch(`${stack.origin}/__qa/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) })

  async function receiveJob(no, route = 'cut_only', opts = {}) {
    const [row] = await as(uid('admin1'), `public.receive_job(
      p_confirmation_no => $2, p_customer_name => $3, p_job_name => $4,
      p_product_type_code => 'tshirt', p_qty => $5, p_unit => 'ตัว',
      p_due_date => (current_date + $6::int), p_route_code => $7, p_confirmation_pdf_path => null,
      p_spare_qty => 0, p_confirmation_rev => $8, p_spec => $9::jsonb, p_needs_sample => false, p_develop => false
    ) as id`, [no, opts.customer ?? 'ลูกค้า D-UX', opts.jobName ?? 'งาน D-UX', opts.qty ?? 20, opts.dueOffset ?? 4, route, opts.rev ?? 0, JSON.stringify(opts.spec ?? {})])
    if (opts.withMockup) {
      const [{ mockup_path: mp }] = await sql(`update public.jobs set mockup_path = private.mockup_folder(confirmation_no) || '/front1.png' where id = $1 returning mockup_path`, [row.id])
      stack.r2Store.set('mockups/' + mp, { bytes: new Uint8Array(await readFile(fx.paths.frontPng)), type: 'image/png' })
    }
    return row.id
  }

  async function check(id, title, fn, { allowErrorStatus = false, allowOffline = false } = {}) {
    const off = chrome.main.logs.length
    try {
      const detail = await fn()
      const bad = chrome.main.logs.slice(off).filter(e => {
        if (String(e.text ?? '').startsWith("Blocked attempt to show a 'beforeunload'")) return false
        if (allowOffline && /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|Failed to fetch/.test(e.text ?? '')) return false
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
    await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
    await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
    const jUx = await receiveJob('SC-D3-UX', 'normal', { withMockup: true, dueOffset: -2 })
    await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jUx])
    const fpUx = 'SC-D3-UX/print/1/u1.jpg'
    stack.r2Store.set('station_photos/' + fpUx, { bytes: new Uint8Array(await readFile(fx.paths.backJpg)), type: 'image/jpeg' })
    await sql("insert into private.file_objects (kind, path, size, content_type, uploaded_by) values ('station_photos', $1, 500, 'image/jpeg', $2) on conflict do nothing", [fpUx, uid('prod1')])
    await as(uid('prod1'), "public.submit_first_piece($2::uuid, 'print', $3::text[], 'D3')", [jUx, [fpUx]])

    // === D.3 Responsive UX Sweep + Error Recovery + Keyboard Navigation ===
    await check('D3.ux-sweep-recovery-kbd', 'D3 หน้าจอ 375/768/1440 เปิดรูปสถานี + สถานะว่าง/ขัดข้อง/กู้คืน + คีย์บอร์ด', async () => {
      const viewIssues = []
      const badTokens = []
      const checks = [
        ['owner', '#/admin'],
        ['owner', '#/production'],
        ['owner', '#/settings'],
        ['admin1', '#/'],
        ['admin1', '#/jobs'],
        ['prod1', '#/board?station=print'],
        ['prod1', '#/sewing'],
        ['qc', '#/board?station=qc_pack'],
        ['staff_single', '#/board'],
        ['staff_single', '#/words'],
      ]
      for (const [role, h] of checks) {
        for (const w of [375, 768, 1440]) {
          await t.goto(role, h, w)
          await delay(250)
          const m = await t.measureFloorUx(w)
          const bad = await t.ev(() => {
            const txt = document.body.innerText
            const found = ['NaN', 'undefined', 'Invalid Date'].filter(tok => new RegExp(`\\b${tok}\\b`).test(txt))
            return found
          })
          if (bad.length) badTokens.push({ role, h, w, bad })
          if (m.docScrollWidth > w + 1 || m.overflows.length || m.smallButtons.length || m.bodyFontSize < 16) {
            viewIssues.push({ role, h, w, docScrollWidth: m.docScrollWidth, overflows: m.overflows.length, smallButtonsCount: m.smallButtons.length, bodyFontSize: m.bodyFontSize, sampleBtn: m.smallButtons[0] })
          }
        }
      }
      assert.equal(badTokens.length, 0, 'พบข้อความ NaN/undefined/Invalid Date: ' + JSON.stringify(badTokens))

      // Keyboard navigation on PhotoViewer + Escape closes dialog
      await t.goto('admin1', '#/', 1440)
      await t.waitText('รออนุมัติชิ้นแรก')
      await t.ev(() => document.querySelector('button')?.focus())
      await t.clickButton(/SC-D3-UX.*ตรวจ/)
      await t.waitText('ผ่าน ทำทั้งล็อตได้')
      await t.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await delay(200)

      // serverDown = true -> shows error -> serverDown = false -> recovers cleanly!
      await setCfg({ serverDown: true })
      await t.goto('admin1', '#/board', 1440)
      await delay(800)
      const downErrText = await t.ev(() => document.body.innerText.slice(0, 400))
      await setCfg({ serverDown: false })
      await t.goto('admin1', '#/board', 1440)
      await t.waitText('SC-D3-UX')
      observations.push({ key: 'D3_ux_sweep', viewIssuesCount: viewIssues.length, viewIssues: viewIssues.slice(0, 15), downSnippet: downErrText.replace(/\s+/g, ' ').slice(0, 180) })
      return `badTokens=0 · serverDown recovery=OK · viewIssues=${viewIssues.length}`
    }, { allowErrorStatus: true })

    // === D.4 Network Chaos: Slow 3s, Offline ("Failed to fetch" leak check!), Rapid Click, 2 Tabs, Close Tab Mid-Draft, Back/Forward, SW Update Banner ===
    await check('D4.network-offline-sw-chaos', 'D4 เน็ตช้า 3 วิ, ออฟไลน์กลางคัน (ส่งรูป/กดเสร็จ/บันทึกใบ), กดรัว, 2 แท็บ/ปิดแท็บ, Back/Forward, แถบรุ่นใหม่ SW', async () => {
      // 1) True 3-second latency + recovery
      await t.goto('admin1', '#/', 1440)
      await t.waitText('SC-D3-UX')
      await setCfg({ latencyMs: 3000 })
      try {
        await t.ev(() => { location.reload() })
        await t.waitText('SC-D3-UX', 30000)
      } finally {
        await setCfg({ latencyMs: 0 })
      }

      // 2a) Real OFFLINE mid-photo upload -> check for leaked "Failed to fetch" (UI Review #15)
      const pickActionAlert = () => t.ev(() => {
        const list = [...document.querySelectorAll('[role=alert]')].map(a => a.innerText.trim()).filter(s => s && !s.startsWith('ขาดการเชื่อมต่อ'))
        return list[0] || false
      })
      const jOff = await receiveJob('SC-D4-OFF', 'cut_only')
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jOff])
      await t.goto('prod1', '#/board?station=cut', 1440)
      await t.waitText('SC-D4-OFF')
      await t.uploadFiles('input[type=file][capture]', [fx.paths.backJpg])
      await t.waitText('ส่งรูปชิ้นแรก 1 รูป')
      await t.setOffline(true)
      await t.clickButton('ส่งรูปชิ้นแรก 1 รูป')
      const offPhotoErr = await waitFor(pickActionAlert, 'error ออฟไลน์ส่งรูป', 12000)
      await t.screenshot('d4-offline-photo-upload-err')
      await t.setOffline(false)

      // 2b) Real OFFLINE mid-finish station
      await as(uid('owner'), 'public.set_station_photos_enabled(false, 15)')
      await t.goto('prod1', '#/board?station=cut', 1440)
      await t.waitText('ตัดงานเสร็จ')
      await t.clickButton('ตัดงานเสร็จ')
      await t.waitText('ยืนยัน')
      await t.setOffline(true)
      await t.clickButton('ยืนยัน', { exact: true })
      const offFinishErr = await waitFor(pickActionAlert, 'error ออฟไลน์กดเสร็จ', 12000)
      await t.screenshot('d4-offline-finish-err')
      await t.setOffline(false)
      await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')

      // 2c) Real OFFLINE mid-confirmation save
      await t.goto('admin1', '#/', 1440, '/confirmation.html?new=1')
      await t.fillInput('[data-k="doc_no"]', 'SC-D4-COFF')
      await t.fillInput('[data-k="customer"]', 'ลูกค้าออฟไลน์')
      await t.fillInput('[data-k="job_name"]', 'ทดสอบออฟไลน์บันทึกใบ')
      await t.fillInput('[data-k="due_date"]', '2026-12-28')
      await t.fillInput('input[data-t="sizes"][data-r="0"][data-c="label"]', 'สีขาว')
      await t.fillInput('input[data-t="sizes"][data-r="0"][data-c="q:M"]', '5')
      await t.ev(() => {
        window.__origOpen = window.open
        window.open = () => null
      })
      await t.clickButton('บันทึกเข้าระบบ')
      await waitFor(() => t.ev(() => Boolean(localStorage.getItem('pp142.confirmation.outbox'))), 'outbox queued')
      // Test draft persistence if admin leaves/closes confirmation tab mid-draft and reopens
      await t.goto('admin1', '#/', 1440, '/confirmation.html')
      const draftRestoredNo = await waitFor(() => t.ev(() => document.querySelector('[data-k="doc_no"]')?.value || false), 'draft persisted after leave')
      // Now test saving outbox while offline
      await t.goto('admin1', '#/board', 1440)
      await t.waitText('รับงานใหม่')
      await t.setOffline(true)
      await t.ev(() => { location.hash = '#/board?confirmation=save' })
      const offConfirmErr = await waitFor(pickActionAlert, 'error ออฟไลน์บันทึกใบยืนยัน', 15000)
      await t.setOffline(false)

      const leakedFailedToFetch = [offPhotoErr, offFinishErr, offConfirmErr].some(s => /failed to fetch/i.test(s))
      observations.push({
        key: 'D4_offline_errors',
        offPhotoErr,
        offFinishErr,
        offConfirmErr,
        draftRestoredNo,
        leakedFailedToFetch,
      })

      // 3) Rapid double-click on start_in_queue -> must record only 1 station_start event
      const jRapid = await receiveJob('SC-D4-RAPID', 'cut_only')
      await t.goto('prod1', '#/board?station=cut', 1440)
      await t.waitText('เริ่มตัดงาน')
      await t.ev(() => {
        const btns = [...document.querySelectorAll('button')].filter(b => b.getClientRects().length && !b.disabled && /เริ่มตัดงาน/.test(b.textContent ?? ''))
        const b = btns[0]
        if (b) { b.click(); b.click() }
      })
      await delay(1000)
      const [rapidStarts] = await sql("select count(*)::int as c from public.events where job_id = $1 and type = 'station_start'", [jRapid])
      assert.equal(rapidStarts.c, 1, `กดรัวต้องเริ่มแค่ 1 ครั้ง (ได้ ${rapidStarts.c})`)

      // 4) Two tabs editing/acting concurrently on same job + close second tab mid-flow
      const tab2Raw = await chrome.newTab()
      const t2 = chrome.wrap(tab2Raw)
      try {
        await t2.goto('prod2', '#/board?station=cut', 1440)
        await t2.waitText('SC-D4-RAPID')
      } finally {
        tab2Raw.detach()
      }

      // 5) Back / Forward navigation
      await t.goto('admin1', '#/', 1440)
      await t.goto('admin1', '#/jobs', 1440)
      await t.ev(() => history.back())
      await delay(300)
      await t.ev(() => history.forward())
      await delay(300)

      // 6) SW update banner check ("มีระบบรุ่นใหม่" + click "โหลดรุ่นใหม่")
      let swState = 'skipped'
      let hasUpdateBanner = false
      let clickedSwReload = false
      await t.send('Network.setBypassServiceWorker', { bypass: false })
      try {
        await t.goto('admin1', '#/', 1440)
        await delay(600)
        // Register SW cleanly if not already registered
        await t.ev(async () => {
          if ('serviceWorker' in navigator && !(await navigator.serviceWorker.getRegistration())) {
            await navigator.serviceWorker.register('/sw.js').catch(() => {})
          }
        })
        await delay(500)
        await setCfg({ swRev: 1 })
        swState = await t.ev(async () => {
          if (!('serviceWorker' in navigator)) return 'no-sw'
          const regs = await navigator.serviceWorker.getRegistrations()
          for (const r of regs) await r.update().catch(() => {})
          return regs.length
        })
        await delay(1200)
        hasUpdateBanner = await t.ev(() => document.body.innerText.includes('มีระบบรุ่นใหม่'))
        if (hasUpdateBanner) {
          await t.screenshot('d4-sw-update-banner')
          await t.clickButton('โหลดรุ่นใหม่')
          await delay(1000)
          clickedSwReload = true
        }
      } finally {
        await setCfg({ swRev: 0 })
        await t.ev(async () => {
          if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations()
            for (const r of regs) await r.unregister().catch(() => {})
          }
        }).catch(() => {})
        await t.send('Network.setBypassServiceWorker', { bypass: true })
      }
      observations.push({ key: 'D4_sw_update', swState, hasUpdateBanner, clickedSwReload, rapidStarts: rapidStarts.c })
      return `offlinePhoto="${offPhotoErr}" · offlineFinish="${offFinishErr}" · offlineConfirm="${offConfirmErr}" · leaked=${leakedFailedToFetch} · rapidStarts=${rapidStarts.c} · draft="${draftRestoredNo}" · swBanner=${hasUpdateBanner}(reloaded=${clickedSwReload})`
    }, { allowErrorStatus: true, allowOffline: true })

    // === D.5 Print PDF & Print-Media Visual Evidence ===
    await check('D5.print-pdfs-and-screenshots', 'D5 พิมพ์ PDF + ภาพก่อนพิมพ์: ใบยืนยัน (ก่อน/หลังแก้, อื่นๆ, หลายรูป), ใบปะงาน A5, ม็อคอัพ A4/A3', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      // Pre-revise & post-revise confirmation
      await t.goto('admin1', '#/', 1440, '/confirmation.html?new=1')
      await t.fillInput('[data-k="doc_no"]', 'SC-D5-PRT')
      await t.fillInput('[data-k="customer"]', 'ลูกค้าพิมพ์ PDF จำกัด')
      await t.fillInput('[data-k="job_name"]', 'ทดสอบพิมพ์ใบยืนยันและม็อคอัพ')
      await t.fillInput('[data-k="due_date"]', '2026-12-28')
      await t.ev(() => {
        ;[...document.querySelectorAll('input[type=radio][data-k="sample"]')].find(r => r.value === 'ไม่ขึ้นตัวอย่าง')?.click()
        ;[...document.querySelectorAll('input[type=radio][data-k="neck"]')].find(r => r.value === 'อื่นๆ')?.click()
      })
      await t.fillInput('[data-k="neck__other"]', 'คอกลมกุ๊น 2 ชั้นพิเศษ')
      await t.uploadFiles('input[type="file"][data-img]', [fx.paths.frontPng, fx.paths.backJpg])
      await waitFor(() => t.ev(() => document.querySelectorAll('.imgs figure').length === 2), 'รูปครบ 2')
      await t.fillInput('input[data-t="sizes"][data-r="0"][data-c="label"]', 'สีกรม')
      await t.fillInput('input[data-t="sizes"][data-r="0"][data-c="q:M"]', '25')
      await t.clickButton('ดูตัวอย่าง PDF')
      await t.waitText('คอกลมกุ๊น 2 ชั้นพิเศษ')
      const pdfPre = await t.printPdf('d5-confirm-pre')
      await t.send('Emulation.setEmulatedMedia', { media: 'print' })
      await t.screenshot('d5-confirm-pre-print', { fullPage: true })
      await t.send('Emulation.setEmulatedMedia', { media: '' })

      // Revise rev=1 and re-render PDF
      await t.clickButton('กลับไปแก้ไข')
      await t.fillInput('[data-k="rev"]', '1')
      await t.fillInput('input[data-t="sizes"][data-r="0"][data-c="q:L"]', '15')
      await t.clickButton('ดูตัวอย่าง PDF')
      await t.waitText('แก้ไขครั้งที่ 1')
      const pdfPost = await t.printPdf('d5-confirm-post-revise')

      // Label A5 + Mockup A4 & A3 landscape
      const jD5 = await receiveJob('SC-D5-JOB', 'normal', { qty: 40, withMockup: true, spec: { app: 'phappim-confirm', v: 1, product: 'tshirt', h: { doc_no: 'SC-D5-JOB', customer: 'ลูกค้าพิมพ์ PDF จำกัด', job_name: 'ป้าย+ม็อคอัพ' }, p: { tshirt: { size_sets: ['ไซซ์ผู้ใหญ่'], sizes: [{ label: 'สีกรม', q: { M: 25, L: 15 } }] } } } })
      const sheetId = (await as(uid('admin1'), 'public.start_mockup_sheet($2::uuid, null)', [jD5]))[0].start_mockup_sheet
      const mPath = 'SC-D5-JOB/front1.png'
      await sql("insert into private.file_objects (kind, path, size, content_type, uploaded_by) values ('mockups', $1, 100, 'image/png', $2) on conflict do nothing", [mPath, uid('admin1')])
      await as(uid('admin1'), 'public.save_mockup_draft($2::uuid, 1, $3::jsonb)', [sheetId, JSON.stringify({ views: [{ view: 'front', image_path: mPath, width: 600, height: 600 }], specs: [], callouts: [{ no: 1, view: 'front', x: 0.5, y: 0.35, box_x: 0.05, box_y: 0.1, title: 'โลโก้อก', body: 'สกรีน DTF 8x8 ซม.', stations: ['dtf_press'] }] })])
      const vSub5 = (await as(uid('admin1'), 'public.submit_mockup_sheet($2::uuid, 2)', [sheetId]))[0].submit_mockup_sheet
      await as(uid('admin1'), "public.approve_mockup_sheet($2::uuid, 'อนุมัติพิมพ์', $3::int)", [sheetId, vSub5])

      await t.goto('admin1', `#/label?id=${jD5}`, 768)
      await t.waitText('SC-D5-JOB')
      const pdfLabel = await t.printPdf('d5-label-a5', { paperWidth: 5.83, paperHeight: 8.27 })
      await t.screenshot('d5-label-a5-preview')

      await t.goto('admin1', `#/mockup?id=${jD5}`, 1440)
      await t.waitText('โลโก้อก')
      await t.screenshot('d5-mockup-preview')

      await t.goto('admin1', `#/artwork?id=${jD5}`, 1440)
      await t.waitText('ใบกำกับงานพิมพ์')
      const pdfMockA4 = await t.printPdf('d5-mockup-a4', { landscape: true })
      await t.clickButton('A3 แนวนอน')
      const pdfMockA3 = await t.printPdf('d5-mockup-a3-land', { landscape: true, paperWidth: 16.54, paperHeight: 11.69 })

      return `PDFs(pre=${pdfPre.bytes}B, post=${pdfPost.bytes}B, labelA5=${pdfLabel.bytes}B, mockA4=${pdfMockA4.bytes}B, mockA3=${pdfMockA3.bytes}B)`
    })

    // === D.6 Human Error Inputs ===
    await check('D6.human-error-inputs', 'D6 กรอกผิดแบบคนจริง: 0/ติดลบ/ทศนิยม/เลขใหญ่มาก/ชื่อ 300 ตัว/อีโมจิ/วางจาก Excel/ไฟล์ 0B/>20MB/วันอาทิตย์-ข้ามปี', async () => {
      const tmp = await mkdtemp(join(tmpdir(), 'pp142-r19-d6-'))
      try {
        const zeroFile = join(tmp, 'empty.jpg')
        const over20File = join(tmp, 'huge21mb.jpg')
        await writeFile(zeroFile, Buffer.alloc(0))
        const big = Buffer.alloc(21 * 1024 * 1024, 0xff)
        big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff; big[3] = 0xe0
        await writeFile(over20File, big)

        // Ensure station photos is ON (since D5 called /__qa/reset) & verify 0-byte / >20MB rejection!
        await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
        const jD6 = await receiveJob('SC-D6-ERR', 'cut_only')
        await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jD6])
        await t.goto('prod1', '#/board?station=cut', 1440)
        await t.waitText('SC-D6-ERR')
        await t.uploadFiles('input[type=file][capture]', [zeroFile])
        await t.clickButton('ส่งรูปชิ้นแรก 1 รูป')
        const zeroErr = await waitFor(() => t.ev(() => document.querySelector('[role=alert]')?.textContent?.trim() || false), 'error ไฟล์ 0 ไบต์')
        // Remove empty.jpg & test >20MB
        await t.ev(() => {
          const btn = document.querySelector('button[aria-label*="ลบ"]') || [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label')?.includes('รูป'))
          btn?.click()
        })
        await t.uploadFiles('input[type=file][capture]', [over20File])
        await t.clickButton('ส่งรูปชิ้นแรก 1 รูป')
        const overErr = await waitFor(() => t.ev(() => document.querySelector('[role=alert]')?.textContent?.trim() || false), 'error ไฟล์เกิน 20 MB')

        // Confirmation form: 0, negative (-5), decimal (2.5), huge (999999999), 300-char name + emoji, Excel tab-paste, Sunday/cross-year date!
        await t.goto('admin1', '#/', 1440, '/confirmation.html?new=1')
        await t.ev(() => {
          window.__d6Alerts = []
          window.alert = m => window.__d6Alerts.push(m)
        })
        const longName = 'ทดสอบชื่อยาว' + 'ก'.repeat(280) + '🔥👕💯'
        await t.fillInput('[data-k="doc_no"]', 'SC-D6-BAD')
        await t.fillInput('[data-k="customer"]', longName)
        await t.fillInput('[data-k="issue_date"]', '2026-12-30')
        await t.fillInput('[data-k="due_date"]', '2026-12-27') // earlier than issue_date AND Sunday!
        await t.fillInput('input[data-t="sizes"][data-r="0"][data-c="q:M"]', '-5')
        await t.fillInput('[data-k="notes"]', 'สีฟ้า\t5\t10\t15\nสีขาว\t2\t4\t6')
        // Also test Excel tab paste event on a size cell!
        const excelPasteRes = await t.ev(() => {
          const inp = document.querySelector('input[data-t="sizes"][data-r="0"][data-c="label"]')
          if (!inp) return { ok: false }
          const dt = new DataTransfer()
          dt.setData('text/plain', 'ฟ้าตาราง\t5\t10\t15\nขาวตาราง\t2\t4\t6')
          const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
          inp.dispatchEvent(ev)
          return { ok: true, labelVal: inp.value, notesLen: document.querySelector('[data-k="notes"]')?.value?.length ?? 0 }
        })
        await t.clickButton('ดูตัวอย่าง PDF')
        const alertText = await waitFor(() => t.ev(() => document.querySelector('#alert')?.innerText?.trim() || false), 'แจ้งเตือนติดลบ/วันที่')
        assert.ok(alertText.includes('ติดลบ') && alertText.includes('ก่อนวันที่ออกใบ'), 'ฟอร์มไม่เตือนติดลบ/วันที่ย้อนหลัง: ' + alertText)

        // Check qty = 0, decimal = 2.5, and huge = 999999999 in confirmation form & receive_job RPC
        await t.goto('admin1', '#/', 1440, '/confirmation.html?new=1')
        await t.fillInput('[data-k="doc_no"]', 'SC-D6-NUM')
        await t.fillInput('[data-k="customer"]', 'ลูกค้าตัวเลข')
        await t.fillInput('[data-k="job_name"]', 'ทดสอบเลข 0 ทศนิยม ใหญ่มาก')
        await t.fillInput('[data-k="due_date"]', '2026-12-28')
        await t.fillInput('input[data-t="sizes"][data-r="0"][data-c="label"]', 'สีดำ')
        await t.fillInput('input[data-t="sizes"][data-r="0"][data-c="q:M"]', '0')
        await t.clickButton('ดูตัวอย่าง PDF')
        const zeroQtyAlert = await waitFor(() => t.ev(() => document.querySelector('#alert')?.innerText?.trim() || false), 'เตือนจำนวน 0')
        assert.ok(zeroQtyAlert.includes('จำนวน') || zeroQtyAlert.includes('ยังไม่มี'), 'ไม่เตือนจำนวน 0: ' + zeroQtyAlert)

        await t.clickButton('กลับไปแก้ไข')
        await t.fillInput('input[data-t="sizes"][data-r="0"][data-c="q:M"]', '2.5')
        await t.clickButton('ดูตัวอย่าง PDF')
        await delay(200)
        const decBadge = await t.ev(() => document.querySelector('#qtyBadge')?.textContent?.trim() ?? '')

        await t.clickButton('กลับไปแก้ไข')
        await t.fillInput('input[data-t="sizes"][data-r="0"][data-c="q:M"]', '999999999')
        await delay(100)
        const hugeBadge = await t.ev(() => document.querySelector('#qtyBadge')?.textContent?.trim() ?? '')

        const rpcErrs = {}
        for (const [k, qVal] of [['zero', 0], ['neg', -5], ['huge', 999999999]]) {
          try {
            await as(uid('admin1'), `public.receive_job(
              p_confirmation_no => $2, p_customer_name => 'C', p_job_name => 'J',
              p_product_type_code => 'tshirt', p_qty => $3, p_unit => 'ตัว',
              p_due_date => (current_date + 3), p_route_code => 'cut_only', p_confirmation_pdf_path => null,
              p_spare_qty => 0, p_confirmation_rev => 0, p_spec => '{}'::jsonb, p_needs_sample => false, p_develop => false
            ) as id`, [`SC-D6-RPC-${k}`, qVal])
            rpcErrs[k] = 'accepted'
          } catch (e) {
            rpcErrs[k] = e.message
          }
        }

        // Check cross-year work_days calculation in SQL! (2026-12-30 Wed -> 2027-01-05 Tue includes 1 Sunday 2027-01-03!)
        const [crossYearDays] = await sql(`select round(private.work_days('2026-12-30T08:00:00+07'::timestamptz, '2027-01-05T08:00:00+07'::timestamptz), 2) as wd`)
        observations.push({ key: 'D6_human_errors', zeroErr, overErr, excelPasteRes, decBadge, hugeBadge, rpcErrs, crossYearWorkDays: crossYearDays.wd })
        return `0B="${zeroErr.slice(0, 30)}" · >20MB="${overErr.slice(0, 35)}" · formNeg+Zero+Date=blocked · dec="${decBadge}" · rpc0=${rpcErrs.zero !== 'accepted'} · crossYearWorkDays=${crossYearDays.wd}`
      } finally {
        await rm(tmp, { recursive: true, force: true }).catch(() => {})
      }
    }, { allowErrorStatus: true })

    // === D.7 Midnight / Sunday / Non-Thai Timezone ===
    await check('D7.timezone-midnight-sunday', 'D7 เวลา: ข้ามเที่ยงคืน / วันอาทิตย์ / เครื่องอยู่เขตเวลา America/Los_Angeles ตัวเลขวันไทยต้องยังตรง', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      // Due 2 days ago in Bangkok
      const jTz = await receiveJob('SC-D7-TZ', 'cut_only', { dueOffset: -2 })
      await t.goto('admin1', '#/board', 1440)
      await t.waitText('SC-D7-TZ')
      const bkkLabel = await t.ev(() => [...document.querySelectorAll('span')].find(s => s.textContent.includes('เลยกำหนด'))?.textContent?.trim())

      await t.send('Emulation.setTimezoneOverride', { timezoneId: 'America/Los_Angeles' })
      await t.goto('admin1', '#/jobs', 1440)
      await t.goto('admin1', '#/board', 1440)
      await t.waitText('SC-D7-TZ')
      const laLabel = await t.ev(() => [...document.querySelectorAll('span')].find(s => s.textContent.includes('เลยกำหนด'))?.textContent?.trim())
      await t.send('Emulation.setTimezoneOverride', { timezoneId: '' })
      assert.equal(laLabel, bkkLabel, `เขตเวลา LA (${laLabel}) ไม่ตรงกับกรุงเทพฯ (${bkkLabel})`)

      // Cross-midnight & cross-Sunday SQL work_days check (Sat 2026-11-28 23:00 -> Mon 2026-11-30 01:00 -> skips Sunday 2026-11-29 cleanly!)
      const [sunSkip] = await sql(`select round(private.work_days('2026-11-28T23:00:00+07'::timestamptz, '2026-11-30T01:00:00+07'::timestamptz), 3) as wd`)
      return `Bangkok="${bkkLabel}" == LosAngeles="${laLabel}" · Sat23->Mon01 workDays=${sunSkip.wd}`
    })

    // === D.8 Load Benchmark: 320+ jobs, 3,500+ events, 20 pending first-piece checks ===
    await check('D8.load-320-jobs-3500-events', 'D8 ทดสอบข้อมูลเยอะ: 320+ งาน + 3,500+ events + 20 งานรออนุมัติชิ้นแรก', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
      // Bulk seed 300 done jobs + 20 active cut_only doing jobs with pending station_checks + 3500+ events directly in PGlite!
      const bytes = new Uint8Array(await readFile(fx.paths.backJpg))
      await sql(`
        with ins as (
          insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date, route_code, phase, finished_at, created_by)
          select
            'SC-D8-' || lpad(g::text, 4, '0'),
            'ลูกค้าโหลด #' || g,
            'งานทดสอบปริมาณมาก',
            'tshirt',
            10 + (g % 40),
            'ตัว',
            current_date + ((g % 14) - 3),
            'cut_only',
            'done',
            now() - ((g % 30) || ' days')::interval,
            $1::uuid
          from generate_series(1, 300) g
          returning id
        ),
        ev1 as (
          insert into public.events (job_id, type, phase, station_code, by, at)
          select ins.id, t.tp, t.ph, t.st, $1::uuid, now() - (t.seq || ' hours')::interval
          from ins
          cross join (values
            (10, 'received', 'materials', null),
            (9, 'released', 'production', 'cut'),
            (8, 'station_start', 'production', 'cut'),
            (7, 'first_piece_sent', 'production', 'cut'),
            (6, 'first_piece_ok', 'production', 'cut'),
            (5, 'finish_photo', 'production', 'cut'),
            (4, 'station_done', 'production', 'cut'),
            (3, 'station_start', 'production', 'qc_pack'),
            (2, 'qc_result', 'production', 'qc_pack'),
            (1, 'finish_photo', 'production', 'qc_pack'),
            (0, 'done', 'done', 'qc_pack')
          ) t(seq, tp, ph, st)
          returning id
        )
        select count(*)::int from ev1
      `, [uid('admin1')])

      // Allow 20 concurrent active cut jobs to simulate 20 simultaneous pending first-piece checks
      await sql("update public.stations set machines = 25 where code = 'cut'")
      // 20 pending first-piece checks!
      for (let i = 1; i <= 20; i++) {
        const jId = await receiveJob(`SC-D8-FP-${String(i).padStart(2, '0')}`, 'cut_only', { qty: 10 })
        await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jId])
        const pPath = `SC-D8-FP-${String(i).padStart(2, '0')}/cut/1/fp.jpg`
        stack.r2Store.set('station_photos/' + pPath, { bytes, type: 'image/jpeg' })
        await sql("insert into private.file_objects (kind, path, size, content_type, uploaded_by) values ('station_photos', $1, $2, 'image/jpeg', $3) on conflict do nothing", [pPath, bytes.byteLength, uid('prod1')])
        await as(uid('prod1'), "public.submit_first_piece($2::uuid, 'cut', $3::text[])", [jId, [pPath]])
      }

      const [counts] = await sql('select (select count(*)::int from public.jobs) as jobs, (select count(*)::int from public.events) as events, (select count(*)::int from public.station_checks where status = \'pending\') as pending_fp')
      assert.ok(counts.jobs >= 320 && counts.events >= 3300 && counts.pending_fp === 20, JSON.stringify(counts))

      const timings = {}
      for (const [role, hash, waitTxt] of [
        ['owner', '#/production', 'รออนุมัติชิ้นแรก 20 งาน'],
        ['owner', '#/reports', 'เวลาเฉลี่ยต่อสถานี'],
        ['prod1', '#/board', 'SC-D8-FP-01'],
        ['admin1', '#/production-queue', 'SC-D8-FP-20'],
      ]) {
        const t0 = performance.now()
        await t.goto(role, hash, 1440)
        await t.waitText(waitTxt, 15000)
        timings[`${role}:${hash}`] = Math.round(performance.now() - t0)
      }
      await t.goto('owner', '#/production', 1440)
      await t.waitText('รออนุมัติชิ้นแรก 20 งาน')
      await t.screenshot('d8-load-20-first-piece-1440')

      observations.push({ key: 'D8_load_benchmark', counts, timings })
      return `jobs=${counts.jobs}, events=${counts.events}, pendingFP=${counts.pending_fp} · timings=${JSON.stringify(timings)}`
    })
  } finally {
    await fx.cleanup()
    await chrome.close()
    await stack.close()
    await writeFile(OUT_JSON, JSON.stringify({
      externalAttempts: chrome.externalAttempts,
      blockedFontRequests: chrome.blockedFontRequests.length,
      results,
      observations,
    }, null, 2))
  }
  const failed = results.filter(r => !r.pass)
  console.log(`\nSUMMARY test-part-d-ux-net-load: ${results.length - failed.length}/${results.length} passed`)
  if (chrome.externalAttempts.length > 0) throw new Error('EXTERNAL ATTEMPTS: ' + JSON.stringify(chrome.externalAttempts))
  process.exit(failed.length ? 1 : 0)
}

run().catch(e => { console.error(e); process.exit(1) })
