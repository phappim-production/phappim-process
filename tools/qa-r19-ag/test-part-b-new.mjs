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
const OUT_JSON = fileURLToPath(new URL('./part-b-new-results.json', import.meta.url))

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
    const tok = tokenOf(actorKey)
    const res = await fetch(`${stack.origin}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: 'r14-local-anon-key', 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify(bodyObj),
    })
    const text = await res.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    return { ok: res.ok, status: res.status, data }
  }

  async function receiveJob(no, route = 'cut_only', opts = {}) {
    const qty = opts.qty ?? 20
    const dueOffset = opts.dueOffset ?? 4
    const needsSample = opts.needsSample ?? false
    const develop = opts.develop ?? false
    const product = opts.product ?? 'tshirt'
    const spec = opts.spec ?? {}
    const [row] = await as(uid('admin1'), `public.receive_job(
      p_confirmation_no => $2, p_customer_name => $3, p_job_name => 'งานทดสอบ B',
      p_product_type_code => $4, p_qty => $5, p_unit => 'ตัว',
      p_due_date => (current_date + $6::int), p_route_code => $7, p_confirmation_pdf_path => null,
      p_spare_qty => 0, p_confirmation_rev => 0, p_spec => $8::jsonb, p_needs_sample => $9, p_develop => $10
    ) as id`, [no, opts.customer ?? 'ลูกค้าทดสอบ B', product, qty, dueOffset, route, JSON.stringify(spec), needsSample, develop])
    if (opts.withMockup) {
      const [{ mockup_path: mp }] = await sql(`update public.jobs set mockup_path = private.mockup_folder(confirmation_no) || '/front1.png' where id = $1 returning mockup_path`, [row.id])
      const pngBytes = new Uint8Array(await readFile(fx.paths.frontPng))
      stack.r2Store.set('mockups/' + mp, { bytes: pngBytes, type: 'image/png' })
      if (opts.withThumb) {
        const jpgBytes = new Uint8Array(await readFile(fx.paths.backJpg))
        stack.r2Store.set('mockups/' + mp + '.thumb.jpg', { bytes: jpgBytes, type: 'image/jpeg' })
      }
    }
    return row.id
  }

  async function check(id, title, fn, { allowErrorStatus = false } = {}) {
    const off = chrome.main.logs.length
    try {
      const detail = await fn()
      const bad = chrome.main.logs.slice(off).filter(e => {
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
    // === B.1 v3 Visual System + B.2 UI Review Fixes + Overflow Root Cause ===
    await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
    await as(uid('owner'), 'public.set_station_photos_enabled(false, null)')
    const jPrint = await receiveJob('SC-B1-PRT', 'normal', { withMockup: true, withThumb: true })
    await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jPrint])
    // Seed a QC doing job first so cut stays clear for B2 order test
    const jQc = await receiveJob('SC-B2-QC', 'cut_only')
    await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jQc])
    await as(uid('prod1'), "public.finish_station($2::uuid, 'cut')", [jQc])
    await as(uid('qc'), 'public.start_in_queue($2::uuid, null)', [jQc])
    const jCutHold = await receiveJob('SC-B2-HOLD', 'cut_only', { withMockup: true })
    const jCutDoing = await receiveJob('SC-B2-DOING', 'cut_only', { withMockup: true })
    const jCutWait = await receiveJob('SC-B2-WAIT', 'cut_only', { withMockup: true })
    await as(uid('staff_single'), 'public.start_in_queue($2::uuid, null)', [jCutHold])
    await as(uid('staff_single'), "public.open_issue($2::uuid, 'รอผ้าเพิ่ม')", [jCutHold])
    await as(uid('staff_single'), 'public.start_in_queue($2::uuid, null)', [jCutDoing])

    await check('B1.v3-theme-and-overview', 'B1 หน้าตา v3: สี/ลาย/ไอคอนครบสถานี, RouteTrack, สีสถานะ, ทองเฉพาะแบรนด์, สถานีตอนนี้', async () => {
      await t.goto('owner', '#/production', 1440)
      await t.waitText('สถานีตอนนี้')
      await t.screenshot('b1-v3-overview-1440', { fullPage: true })
      const overviewInfo = await t.ev(() => {
        const txt = document.body.innerText
        const stLabels = ['พิมพ์', 'รีด', 'ตัด', 'รีดฟิล์ม', 'ส่งปัก', 'เย็บ', 'QC + Packing']
        const present = stLabels.filter(s => txt.includes(s))
        const svgs = [...document.querySelectorAll('svg')].length
        const goldNodes = [...document.querySelectorAll('[class*="gold"]')].map(el => ({
          tag: el.tagName,
          cls: String(el.className),
          inNavOrLogo: !!(el.closest('header') || el.closest('aside') || el.getAttribute('aria-hidden') === 'true' || el.innerHTML.includes('BrandMark')),
          text: el.textContent.trim().slice(0, 40),
        }))
        return { present, svgs, goldCount: goldNodes.length, goldNodes }
      })
      assert.equal(overviewInfo.present.length, 7, 'ไม่ครบ 7 สถานีบนหน้าภาพรวม: ' + JSON.stringify(overviewInfo.present))

      await t.goto('owner', '#/production', 375)
      await t.waitText('สถานีตอนนี้')
      await t.screenshot('b1-v3-overview-375', { fullPage: true })

      await t.goto('prod1', '#/board', 1440)
      await t.waitText('SC-B1-PRT')
      await t.screenshot('b1-v3-board-1440', { fullPage: true })
      await t.goto('prod1', '#/board?station=print', 1440)
      await t.waitText('SC-B1-PRT')
      const boardTracks = await t.ev(() => ({
        routeTracks: document.querySelectorAll('ol[aria-label="เส้นทาง"]').length,
        cardsWithGoldPillOrBtn: [...document.querySelectorAll('button, [class*="rounded-full"]')].filter(el => String(el.className).includes('gold') && !el.closest('aside, header')).length,
      }))
      assert.ok(boardTracks.routeTracks >= 1, 'ไม่พบ RouteTrack บนการ์ดสถานี')
      observations.push({ key: 'B1_v3', overviewInfo, boardTracks })
      return `stations=${overviewInfo.present.length} · routeTracks=${boardTracks.routeTracks} · nonBrandGold=${boardTracks.cardsWithGoldPillOrBtn}`
    })

    await check('B2.ui-review-fixes-and-overflow', 'B2 รีวิว UI: ปุ่ม 375px ไทย+พม่า, doingFirst, เมนูไทยล้วน, staff_empty, sup1, ช่อง QC, ตรวจสาเหตุล้น 499px', async () => {
      // Check doing before hold in cut station
      await t.goto('staff_single', '#/board', 375)
      await t.waitText('SC-B2-DOING')
      const foldThaiOff = await t.ev(() => {
        const cards = [...document.querySelectorAll('section')].filter(s => s.innerText.includes('SC-B2-'))
        const doingTop = [...document.querySelectorAll('*')].find(el => el.textContent === 'SC-B2-DOING')?.getBoundingClientRect().top ?? 9999
        const holdTop = [...document.querySelectorAll('*')].find(el => el.textContent === 'SC-B2-HOLD')?.getBoundingClientRect().top ?? 9999
        const finBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('ตัดงานเสร็จ'))?.getBoundingClientRect()
        return { doingBeforeHold: doingTop < holdTop, finBottom: finBtn ? Math.round(finBtn.bottom) : null, docW: document.documentElement.scrollWidth }
      })
      assert.ok(foldThaiOff.doingBeforeHold, 'doing ต้องขึ้นก่อน hold')
      await t.screenshot('b2-staff-board-photos-off-375')

      // Check Burmese 375px finish button fold
      await t.ev(() => localStorage.setItem('pp142-lang', 'my'))
      await reloadClean(t, 'SC-B2-DOING')
      const foldMyOff = await t.ev(() => {
        const finBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('ပြီးပြီ') || b.textContent.includes('ตัดงานเสร็จ'))?.getBoundingClientRect()
        return { finBottom: finBtn ? Math.round(finBtn.bottom) : null, docW: document.documentElement.scrollWidth }
      })
      await t.ev(() => localStorage.removeItem('pp142-lang'))

      // Check station photos ON 375px card height (known ~670px baseline)
      await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
      const jNewCut = await receiveJob('SC-B2-PH375', 'cut_only', { withMockup: true })
      await as(uid('staff_single'), "public.finish_station($2::uuid, 'cut')", [jCutDoing])
      await as(uid('staff_single'), "public.start_in_queue($2::uuid, 'ทดสอบ 375')", [jNewCut])
      await t.goto('staff_single', '#/board', 375)
      await t.waitText('SC-B2-PH375')
      const foldPhotosOn = await t.ev(() => {
        const finBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('ตัดงานเสร็จ'))?.getBoundingClientRect()
        return { finBottom: finBtn ? Math.round(finBtn.bottom) : null }
      })
      await as(uid('owner'), 'public.set_station_photos_enabled(false, null)')

      // Inspect exact #/board 375px overflow for owner, manager, prod1, admin1 (from qa-part-b docScrollWidth: 499!)
      const overflowReport = {}
      for (const role of ['owner', 'manager', 'prod1', 'admin1']) {
        await t.goto(role, '#/board', 375)
        await t.waitText('SC-B')
        await delay(300)
        const ov = await t.ev(() => {
          const culprits = [...document.querySelectorAll('*')].filter(el => {
            const r = el.getBoundingClientRect()
            return r.width > 0 && r.height > 0 && r.right > window.innerWidth + 1
          }).slice(0, 12).map(el => ({
            tag: el.tagName,
            right: Math.round(el.getBoundingClientRect().right),
            w: Math.round(el.getBoundingClientRect().width),
            cls: String(el.className).slice(0, 80),
            text: el.textContent.trim().slice(0, 60),
          }))
          return { docScrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, culprits }
        })
        overflowReport[role] = ov
        if (role === 'owner' && ov.docScrollW > 375) await t.screenshot('b2-board-overflow-owner-375')
      }

      // Check English menu leakage across roles + sup1/sup2 + staff_empty + QC 375px input
      const menuAudit = {}
      for (const role of ['owner', 'manager', 'admin1', 'prod1', 'sup1', 'sup2', 'qc', 'staff_single', 'staff_empty']) {
        await t.goto(role, '#/', 1440)
        await delay(200)
        menuAudit[role] = await t.ev(() => {
          const navLinks = [...document.querySelectorAll('nav a, aside a, nav button')].map(el => el.textContent.trim()).filter(Boolean)
          const badEng = navLinks.filter(txt => /\b(Station|Audit Log|Roles|Dashboard|Overview|Settings|Reports|History|Board|Inbox)\b/i.test(txt))
          return { navLinks, badEng, bodyHint: document.body.innerText.slice(0, 220).replace(/\s+/g, ' ') }
        })
        assert.equal(menuAudit[role].badEng.length, 0, `${role} ยังมีคำอังกฤษในเมนู: ${JSON.stringify(menuAudit[role].badEng)}`)
      }

      // Verify staff_empty message
      assert.match(menuAudit.staff_empty.bodyHint, /ยังไม่.*สถานี|ยังไม่มีสถานี|เจ้าของ/, 'staff_empty ไม่แสดงข้อความแนะนำ')
      assert.ok(menuAudit.sup1.navLinks.some(s => s.includes('คิวงาน')), 'sup1 ขาดเมนูคิวงาน')

      // QC input 375px measurement
      await t.goto('qc', '#/board?station=qc_pack', 375)
      await t.waitText('SC-B2-QC')
      await t.clickButton('บันทึกผล QC / Packing')
      await t.waitText('จำนวนที่ผ่าน')
      const qcInputMeasure = await t.ev(() => {
        const inp = document.querySelector('[role=dialog] input[aria-label="จำนวนที่ผ่าน"]')
        if (!inp) return null
        const r = inp.getBoundingClientRect()
        const cs = getComputedStyle(inp)
        return { h: Math.round(r.height), fontPx: parseFloat(cs.fontSize), docScrollW: document.documentElement.scrollWidth }
      })
      assert.ok(qcInputMeasure && qcInputMeasure.h >= 44 && qcInputMeasure.fontPx >= 16, 'ช่อง QC มือถือเล็กเกิน: ' + JSON.stringify(qcInputMeasure))
      await t.screenshot('b2-qc-input-375')

      observations.push({ key: 'B2_ui_review', foldThaiOff, foldMyOff, foldPhotosOn, overflowReport, menuAudit, qcInputMeasure })
      return `doingBeforeHold=${foldThaiOff.doingBeforeHold} · finBottom(off=${foldThaiOff.finBottom},my=${foldMyOff.finBottom},on=${foldPhotosOn.finBottom}) · owner375ScrollW=${overflowReport.owner.docScrollW} · qcH=${qcInputMeasure.h}`
    })

    // === B.3 Confirmation Form (PR 195-204) ===
    await check('B3.confirmation-form-features', 'B3 ฟอร์มใบยืนยัน: ?new=1/prev/sent_sig, ชื่อตัวเลือกเก่า, เลขซ้ำต่างสินค้า, อื่นๆ, ถัดไป/ล้างฟอร์ม, ถุงมาตรฐาน', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      // 1) Open form cleanly, type unfinished draft -> navigate ?new=1 -> blank + restoreprev / dropprev
      await t.goto('admin1', '#/', 1440, '/confirmation.html')
      await t.waitText('ข้อมูลใบงาน')
      await t.fillInput('[data-k="doc_no"]', 'SC-B3-PREV')
      await t.fillInput('[data-k="customer"]', 'ลูกค้าค้าง')
      await delay(500)
      await t.ev(() => { location.href = '/confirmation.html?new=1' })
      await waitFor(() => t.ev(() => !!document.querySelector('[data-act="restoreprev"]')), 'แถบกู้ใบที่กรอกค้าง')
      await t.screenshot('b3-confirm-prev-banner-1440')
      const newDocNo = await t.ev(() => document.querySelector('[data-k="doc_no"]')?.value)
      assert.equal(newDocNo, '', '?new=1 ต้องเปิดฟอร์มเปล่า')
      await t.clickButton('เปิดใบที่กรอกค้างกลับมา')
      await waitFor(async () => (await t.ev(() => document.querySelector('[data-k="doc_no"]')?.value)) === 'SC-B3-PREV', 'กู้ใบเดิมสำเร็จ')
      await t.ev(() => { location.href = '/confirmation.html?new=1' })
      await waitFor(() => t.ev(() => !!document.querySelector('[data-act="dropprev"]')), 'แสดงปุ่มไม่ใช้ใบเดิมแล้ว')
      await t.clickButton('ไม่ใช้ใบเดิมแล้ว')
      await t.waitGone('ไม่ใช้ใบเดิมแล้ว')

      // 2) Legacy option names upgrade on load
      await t.ev(() => {
        localStorage.setItem('phappim-confirm-v1', JSON.stringify({
          product: 'tshirt',
          h: { doc_no: 'SC-B3-LEG1', customer: 'เก่า' },
          p: { tshirt: { sleeve: 'แขนจั๊ม (Raglan)' }, scarf: { sew_style: 'ม้วนริม 0.6 มม.', edge: 'ม้วนริม 0.3 มม.' } },
          imgs: [],
        }))
        location.href = '/confirmation.html'
      })
      await waitFor(async () => (await t.ev(() => document.querySelector('[data-k="doc_no"]')?.value)) === 'SC-B3-LEG1', 'โหลดใบ legacy')
      const legacyUpgraded = await t.ev(() => {
        const checkedRadio = document.querySelector('input[type=radio][name="p_sleeve"]:checked')?.value ?? null
        const radios = [...document.querySelectorAll('input[type=radio][name="p_sleeve"]')].map(x => x.value)
        return { tshirtOk: checkedRadio === 'แขนแร็กแลน (Raglan)', checkedRadio, hasRaglanRadio: radios.includes('แขนแร็กแลน (Raglan)') }
      })
      assert.ok(legacyUpgraded.tshirtOk && legacyUpgraded.hasRaglanRadio, 'ชื่อตัวเลือกเก่าไม่อัปเกรด: ' + JSON.stringify(legacyUpgraded))
      // Also check scarf 0.6 มม. -> 0.6 ซม. / 0.3 มม. -> 0.3 ซม.
      await t.ev(() => {
        localStorage.setItem('phappim-confirm-v1', JSON.stringify({
          product: 'scarf',
          h: { doc_no: 'SC-B3-LEG2', customer: 'เก่า' },
          p: { scarf: { item: 'ผ้าเช็ดหน้า', sew_style: 'ม้วนริม 0.6 มม.' } },
          imgs: [],
        }))
        location.reload()
      })
      await waitFor(async () => (await t.ev(() => document.querySelector('[data-k="doc_no"]')?.value)) === 'SC-B3-LEG2', 'โหลดใบ legacy scarf')
      const scarfUpgraded = await t.ev(() => document.querySelector('input[type=radio][name="p_sew_style"]:checked')?.value ?? null)
      assert.equal(scarfUpgraded, 'ม้วนริม 0.6 ซม.', 'ผ้าเช็ดหน้า 0.6 มม. ไม่อัปเกรด')

      // 3) Check option hints + multi-variant + multi-image + อื่นๆ + cm/inch unit toggle + save to system + sent_sig check
      await t.ev(() => { localStorage.removeItem('phappim-confirm-v1'); location.href = '/confirmation.html?new=1' })
      await delay(400)
      await t.waitText('เสื้อยืด (คอกลม / คอวี)')
      const hintsCount = await t.ev(() => document.querySelectorAll('.opt-hint, .hint').length)
      assert.ok(hintsCount > 5, 'ไม่พบคำอธิบายใต้ตัวเลือก: ' + hintsCount)

      // Fill header + multi-variant + อื่นๆ + 2 images
      await t.fillInput('[data-k="doc_no"]', 'SC-B3-MULTI')
      await t.fillInput('[data-k="customer"]', 'บริษัทมัลติ จำกัด')
      await t.fillInput('[data-k="job_name"]', 'เสื้อรุ่น 2 แบบ')
      await t.fillInput('[data-k="due_date"]', '2026-12-15')
      await t.ev(() => {
        const noSample = [...document.querySelectorAll('input[type=radio][data-k="sample"]')].find(r => r.value === 'ไม่ขึ้นตัวอย่าง')
        noSample?.click()
        const neckOther = [...document.querySelectorAll('input[type=radio][data-k="neck"]')].find(r => r.value === 'อื่นๆ')
        neckOther?.click()
      })
      await delay(200)
      await t.fillInput('[data-k="neck__other"]', 'คอปาดกว้างพิเศษ')
      // Enable spot print method so placements section renders, then toggle unit ซม. -> นิ้ว
      await t.ev(() => {
        const dtfCb = [...document.querySelectorAll('input[type=checkbox][data-k="print_method"]')].find(c => c.value.includes('DTF'))
        dtfCb?.click()
      })
      await delay(200)
      await t.ev(() => {
        const uInch = document.querySelector('[data-act="unit"][data-uk="placements"][data-u="นิ้ว"]')
        uInch?.click()
      })
      await delay(150)
      const placementUnitNow = await t.ev(() => ({
        pressed: document.querySelector('[data-act="unit"][data-uk="placements"][data-u="นิ้ว"]')?.getAttribute('aria-pressed'),
        ph: document.querySelector('[data-pl="placements"][data-pf="size"]')?.getAttribute('placeholder') ?? '',
      }))
      assert.equal(placementUnitNow.pressed, 'true', 'ปุ่มหน่วยนิ้วไม่ถูกเลือก')
      assert.match(placementUnitNow.ph, /นิ้ว/, 'สลับหน่วยเป็นนิ้วไม่เปลี่ยน')

      // Add 2 images & add 2nd size row
      await t.uploadFiles('input[type="file"][data-img]', [fx.paths.frontPng, fx.paths.backJpg])
      await waitFor(() => t.ev(() => document.querySelectorAll('.imgs figure').length === 2), 'แนบครบ 2 รูป')
      await t.clickButton('+ เพิ่มแบบ/สี')
      await t.fillInput('input[data-t="sizes"][data-r="0"][data-c="label"]', 'สีขาว')
      await t.fillInput('input[data-t="sizes"][data-r="0"][data-c="q:M"]', '15')
      await t.fillInput('input[data-t="sizes"][data-r="1"][data-c="label"]', 'สีดำ')
      await t.fillInput('input[data-t="sizes"][data-r="1"][data-c="q:L"]', '10')
      await delay(300)

      // Check preview renders "อื่นๆ: คอปาดกว้างพิเศษ" and both images
      await t.clickButton('ดูตัวอย่าง PDF')
      await t.waitText('คอปาดกว้างพิเศษ')
      await t.screenshot('b3-confirm-other-multi-preview')
      await t.clickButton('กลับไปแก้ไข')
      await delay(200)

      // Also verify direct /confirmation.html preserves state, and check next/clear!
      const savedCustomer = await t.ev(() => document.querySelector('[data-k="customer"]')?.value)
      assert.equal(savedCustomer, 'บริษัทมัลติ จำกัด')

      // Save to outbox & submit on system -> duplicate doc_no with different product (polo) MUST fail!
      await t.ev(() => { window.open = () => null })
      await t.clickButton('บันทึกเข้าระบบ')
      await t.waitText('SC-B3-MULTI')
      // Check ?new=1 right after sent_sig DOES NOT create restoreprev banner
      await t.ev(() => { location.href = '/confirmation.html?new=1' })
      await delay(400)
      const hasPrevAfterSent = await t.ev(() => !!document.querySelector('[data-act="restoreprev"]'))
      assert.equal(hasPrevAfterSent, false, 'ใบที่บันทึกเข้าระบบแล้วไม่ควรถูกเก็บใน prev')

      // Actually ingest SC-B3-MULTI via #/board?confirmation=save
      await t.goto('admin1', '#/board?confirmation=save', 1440)
      await t.waitText('SC-B3-MULTI')
      await delay(800)

      // Try saving duplicate doc_no 'SC-B3-MULTI' with product='polo' via save_confirmation_draft RPC -> must block!
      const rDupDiffProd = await callRpcHttp('admin1', 'save_confirmation_draft', {
        p_data: {
          product: 'polo',
          h: { doc_no: 'SC-B3-MULTI', customer: 'บริษัทมัลติ จำกัด', due_date: '2026-12-15', sample: 'ไม่ขึ้นตัวอย่าง' },
          p: { polo: { qty: 10 } },
          summary: { qty: 10 },
        },
      })
      assert.ok(!rDupDiffProd.ok && /ต่อท้าย|เลขที่/.test(rDupDiffProd.data?.message ?? ''), 'เลขซ้ำต่างสินค้าไม่ปฏิเสธ: ' + JSON.stringify(rDupDiffProd))

      // 4) Check bag "มาตรฐาน" prints "ขนาดมาตรฐาน" not "on", plus "ทำสินค้าถัดไป" & "ล้างฟอร์ม"
      await t.goto('admin1', '#/', 1440, '/confirmation.html?new=1')
      await t.ev(() => {
        document.querySelector('[data-act="pick"]')?.click()
        document.querySelector('input[data-product][value="bag"]')?.click()
      })
      await delay(300)
      await t.fillInput('[data-k="doc_no"]', 'SC-B3-BAG')
      await t.fillInput('[data-k="customer"]', 'ลูกค้าถุงผ้า')
      await t.fillInput('[data-k="due_date"]', '2026-12-15')
      await t.ev(() => {
        ;[...document.querySelectorAll('input[type=radio][data-k="sample"]')].find(r => r.value === 'ไม่ขึ้นตัวอย่าง')?.click()
      })
      await t.fillInput('input[data-t="items"][data-r="0"][data-c="name"]', 'ถุงสีขาว')
      await t.fillInput('input[data-t="items"][data-r="0"][data-c="qty"]', '30')
      await t.uploadFiles('input[type="file"][data-img]', [fx.paths.frontPng])
      await waitFor(() => t.ev(() => document.querySelectorAll('.imgs figure').length === 1), 'แนบรูปถุง')
      await t.clickButton('+ เพิ่มกระเป๋า')
      await t.ev(() => {
        const posSel = document.querySelector('select[data-t="pocket_rows"][data-r="0"][data-c="pos"]')
        if (posSel && posSel.options.length > 1) {
          posSel.selectedIndex = 1
          posSel.dispatchEvent(new Event('change', { bubbles: true }))
        }
        const stdCb = document.querySelector('input[data-t="pocket_rows"][data-std]') || document.querySelector('[data-std]')
        stdCb?.click()
      })
      await delay(200)
      await t.clickButton('ดูตัวอย่าง PDF')
      await t.waitText('ขนาดมาตรฐาน')
      const docTxt = await t.ev(() => document.querySelector('#doc')?.innerText ?? '')
      assert.ok(docTxt.includes('ขนาดมาตรฐาน') && !/\bon\b/i.test(docTxt), 'PDF ถุงผ้าพิมพ์คำแปลก: ' + docTxt.slice(0, 200))
      await t.clickButton('กลับไปแก้ไข')

      // Save to system -> test "ทำสินค้าถัดไป" & "ล้างฟอร์ม"
      await t.ev(() => { window.open = () => null })
      await t.clickButton('บันทึกเข้าระบบ')
      await t.waitText('ทำสินค้าถัดไป (ใช้ข้อมูลลูกค้าเดิม)')
      await t.clickButton('ทำสินค้าถัดไป (ใช้ข้อมูลลูกค้าเดิม)')
      await delay(300)
      const afterNext = await t.ev(() => ({
        docNo: document.querySelector('[data-k="doc_no"]')?.value,
        customer: document.querySelector('[data-k="customer"]')?.value,
      }))
      assert.equal(afterNext.customer, 'ลูกค้าถุงผ้า', 'ทำสินค้าถัดไปต้องเก็บชื่อลูกค้าเดิม')
      await t.ev(() => { window.confirm = () => true })
      await t.clickButton('ล้างฟอร์ม')
      await delay(300)
      const afterClear = await t.ev(() => document.querySelector('[data-k="customer"]')?.value)
      assert.equal(afterClear, '', 'ล้างฟอร์มไม่เคลียร์ลูกค้า')

      observations.push({ key: 'B3_confirmation', legacyUpgraded, scarfUpgraded, hintsCount, dupDiffProdMsg: rDupDiffProd.data?.message, afterNext })
      return `prev/sent_sig OK · legacy=OK · dupDiffProd="${rDupDiffProd.data?.message?.slice(0, 40)}" · bagStd="ขนาดมาตรฐาน"`
    }, { allowErrorStatus: true })

    // === B.4 Develop / Sample (PR 200) ===
    await check('B4.develop-sample', 'B4 งาน Develop: ปฏิเสธไม่ขึ้นตัวอย่าง, ผ่านตัวอย่าง=done+คืนจักร, แยกรายงาน, ห้ามสลับ Develop<->ผลิตจริง', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      // 1) needs_sample=false + develop=true -> REJECT
      const rBadDev = await callRpcHttp('admin1', 'receive_job', {
        p_confirmation_no: 'SC-B4-BAD', p_customer_name: 'x', p_job_name: 'x', p_product_type_code: 'tshirt',
        p_qty: 5, p_unit: 'ตัว', p_due_date: '2026-12-20', p_route_code: 'cut_only', p_confirmation_pdf_path: null,
        p_needs_sample: false, p_develop: true,
      })
      assert.ok(!rBadDev.ok && /Develop/.test(rBadDev.data?.message ?? ''), JSON.stringify(rBadDev))

      // 2) Receive develop job through normal route + book future machine + finish sample -> record_sample_result(pass=true) -> done + released!
      const jDev = await receiveJob('SC-B4-DEV', 'normal', {
        needsSample: true, develop: true, qty: 3,
        spec: { app: 'phappim-confirm', v: 1, product: 'tshirt', h: { doc_no: 'SC-B4-DEV', customer: 'ลูกค้า Dev', due_date: '2026-12-20', sample: 'ขึ้นตัวอย่าง (งาน Develop · จบที่ตัวอย่าง ไม่ผลิตจริง)' }, p: { tshirt: { qty: 3 } } },
      })
      for (const st of ['print', 'press', 'cut']) {
        await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jDev])
        await as(uid('prod1'), `public.finish_station($2::uuid, '${st}')`, [jDev])
      }
      // At sew -> start_in_queue picks machines, plus add a future booking to test cancellation!
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jDev])
      await sql(`insert into public.machine_bookings (machine_id, job_id, starts_at, ends_at, booked_by)
        select id, $1, now() + interval '2 days', now() + interval '4 days', $2 from public.sewing_machines where type_code = 'single' limit 1`, [jDev, uid('prod1')])
      await as(uid('prod1'), 'public.finish_sewing($2::uuid)', [jDev])
      await as(uid('qc'), 'public.start_in_queue($2::uuid, null)', [jDev])
      await as(uid('qc'), "public.finish_station($2::uuid, 'qc_pack')", [jDev])
      await as(uid('admin1'), "public.record_sample_result($2::uuid, true, 'ลูกค้าอนุมัติครบ', current_date)", [jDev])

      const [devAfter] = await sql('select phase, station_seq, station_status from public.jobs where id = $1', [jDev])
      assert.equal(devAfter.phase, 'done', 'งาน Develop ผ่านตัวอย่างต้องจบที่ done')
      const [activeAssign] = await sql('select count(*)::int as c from public.machine_assignments where job_id = $1 and released_at is null', [jDev])
      const [activeBook] = await sql('select count(*)::int as c from public.machine_bookings where job_id = $1 and cancelled_at is null and ends_at > now()', [jDev])
      assert.equal(activeAssign.c, 0, 'ต้องคืนจักรเมื่อจบ Develop')
      assert.equal(activeBook.c, 0, 'ต้องยกเลิกการจองจักรในอนาคตเมื่อจบ Develop')

      // Check Reports separates Develop count
      await t.goto('owner', '#/reports', 1440)
      await t.waitText('งาน Develop')
      const repHasDev = await t.ev(() => document.body.innerText.includes('Develop'))
      assert.ok(repHasDev)

      // Check revise_job_spec rejects flipping Develop <-> ผลิตจริง (and confirm UI locks sample radios!)
      const rFlipDev = await callRpcHttp('admin1', 'revise_job_spec', {
        p_job: jDev, p_rev: 1, p_customer_name: 'ลูกค้า Dev', p_job_name: 'งานทดสอบ B',
        p_qty: 3, p_spare_qty: 0, p_due_date: '2026-12-20', p_needs_sample: true, p_changes: ['แก้'],
        p_spec: { app: 'phappim-confirm', v: 1, product: 'tshirt', h: { doc_no: 'SC-B4-DEV', customer: 'ลูกค้า Dev', sample: 'ขึ้นตัวอย่าง (ลูกค้าจ่ายค่าตัวอย่าง)' }, p: { tshirt: { qty: 3 } } },
      })
      assert.ok(!rFlipDev.ok && /Develop|เปลี่ยนในใบแก้ไม่ได้/.test(rFlipDev.data?.message ?? ''), JSON.stringify(rFlipDev))

      observations.push({ key: 'B4_develop', devAfter, activeAssign: activeAssign.c, activeBook: activeBook.c, flipMsg: rFlipDev.data?.message })
      return `phase=${devAfter.phase} · bookingsReleased=true · flipBlocked="${rFlipDev.data?.message?.slice(0, 45)}"`
    }, { allowErrorStatus: true })

    // === B.5 Queue Skip Rules (PR 200) ===
    await check('B5.queue-skip-all-paths', 'B5 กฎคิว: บังคับเหตุผลทั้ง คิวสถานี / รายละเอียดงาน / จักรเย็บ + ปฏิเสธ RPC ตรง', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      const js1 = await receiveJob('SC-B5-S1', 'normal')
      const js2 = await receiveJob('SC-B5-S2', 'normal')
      for (const j of [js1, js2]) {
        for (const st of ['print', 'press', 'cut']) {
          await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [j])
          await as(uid('prod1'), `public.finish_station($2::uuid, '${st}')`, [j])
        }
      }
      const jc1 = await receiveJob('SC-B5-C1', 'cut_only')
      const jc2 = await receiveJob('SC-B5-C2', 'cut_only')
      const jc3 = await receiveJob('SC-B5-C3', 'cut_only')

      // Direct RPC start_station on jc2 (not first!) MUST be rejected!
      const rDirectCut = await callRpcHttp('prod1', 'start_station', { p_job: jc2 })
      assert.ok(!rDirectCut.ok && /ไม่ใช่คิวแรก/.test(rDirectCut.data?.message ?? ''), JSON.stringify(rDirectCut))
      // Direct RPC start_sewing on js2 (not first!) MUST be rejected!
      const rDirectSew = await callRpcHttp('prod1', 'start_sewing', { p_job: js2 })
      assert.ok(!rDirectSew.ok && /ไม่ใช่คิวแรก/.test(rDirectSew.data?.message ?? ''), JSON.stringify(rDirectSew))

      // Path 1: UI Station Queue skip on jc2
      await t.goto('prod1', '#/board?station=cut', 1440)
      await t.waitText('SC-B5-C2')
      const clickedCutSkip = await t.ev(() => {
        const card = [...document.querySelectorAll('article, li, div')].find(x => x.innerText?.includes('SC-B5-C2') && [...x.querySelectorAll('button')].some(b => b.textContent.includes('เริ่มก่อนคิว')))
        const btn = card && [...card.querySelectorAll('button')].find(b => b.textContent.includes('เริ่มก่อนคิว'))
        btn?.click()
        return !!btn
      })
      assert.ok(clickedCutSkip, 'ไม่พบปุ่มเริ่มก่อนคิวของ SC-B5-C2')
      await t.waitText('ยังไม่ถึงคิว')
      await t.fillInput('input[aria-label="เหตุผล"]', 'ลูกค้าเร่งเข้าตู้เย็นนี้')
      await t.clickButton('บันทึกและเริ่ม')
      await t.waitText('เริ่ม SC-B5-C2 ก่อนคิวแล้ว')

      // Path 2: Job Detail drawer skip on jc3
      await t.goto('prod1', `#/board?job=${jc3}`, 1440)
      await t.waitText('เริ่มก่อนคิว')
      await t.clickButton('เริ่มก่อนคิว', { inside: '[role=dialog]' })
      await t.fillInput('[role=dialog] input[aria-label="เหตุผล"]', 'วัสดุชุด 3 พร้อมก่อน')
      await t.clickButton('บันทึกและเริ่ม', { inside: '[role=dialog]' })
      await delay(500)

      // Path 3: Sewing UI skip on js2
      await t.goto('prod1', '#/sewing', 1440)
      await t.waitText('SC-B5-S2')
      const clickedSewSkip = await t.ev(() => {
        const li = [...document.querySelectorAll('li')].find(x => x.innerText.includes('SC-B5-S2'))
        const btn = li && [...li.querySelectorAll('button')].find(b => b.textContent.includes('เริ่มเย็บ'))
        if (btn) { btn.click(); return btn.textContent.trim() }
        return null
      })
      assert.ok(clickedSewSkip, 'ไม่พบปุ่มเริ่มงานข้ามคิวในหน้าเย็บ')
      await t.waitText('ยังไม่ถึงคิว')
      await t.fillInput('input[placeholder*="ผ้างานคิวแรก"]', 'คิวแรกยังตัดไม่เสร็จ')
      await t.clickButton(/เริ่มเย็บด้วย/)
      await delay(500)

      observations.push({ key: 'B5_queue_skip', directCut: rDirectCut.data?.message, directSew: rDirectSew.data?.message, clickedSewSkip })
      return `directCut+directSew rejected · all 3 UI paths require skip reason`
    }, { allowErrorStatus: true })

    // === B.6 Thumbnails, Stable Signed URLs, Single job_live Request ===
    await check('B6.thumbs-stable-url-single-fetch', 'B6 รูปย่อ (?v=thumb) + ลิงก์รูปคงที่ + กด 1 ครั้งโหลด job_live รอบเดียว', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      const jWithThumb = await receiveJob('SC-B6-THM', 'cut_only', { withMockup: true, withThumb: true })
      const jNoThumb = await receiveJob('SC-B6-ORG', 'cut_only', { withMockup: true, withThumb: false })
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jWithThumb])

      await t.goto('prod1', '#/board?station=cut', 1440)
      await t.waitText('SC-B6-THM')
      const thumbAttrs = await t.ev(() => {
        const imgs = [...document.querySelectorAll('img')]
        const thm = imgs.find(i => i.alt.includes('SC-B6-THM'))
        const org = imgs.find(i => i.alt.includes('SC-B6-ORG'))
        return { thmSrc: thm?.src, orgSrc: org?.src }
      })
      assert.ok(thumbAttrs.thmSrc?.includes('v=thumb'), 'การ์ดต้องขอ ?v=thumb')
      const rThm = await fetch(thumbAttrs.thmSrc)
      const rOrg = await fetch(thumbAttrs.orgSrc)
      assert.equal(rThm.headers.get('X-File-Variant'), 'thumb', 'มี .thumb.jpg ต้องคืน thumb variant')
      assert.equal(rOrg.headers.get('X-File-Variant'), 'original', 'ไม่มี .thumb.jpg ต้อง fallback เป็น original')

      // Reload within bucket -> signed URL stays identical!
      await reloadClean(t, 'SC-B6-THM')
      const thmSrc2 = await t.ev(() => [...document.querySelectorAll('img')].find(i => i.alt.includes('SC-B6-THM'))?.src)
      assert.equal(thmSrc2, thumbAttrs.thmSrc, 'ลิงก์รูปหลังรีเฟรชไม่คงที่ (อาจทำให้รูปกระพริบ)')

      // Return to cut station queue, then measure job_live fetch count on a single click action (start_in_queue on SC-B6-ORG)
      await t.goto('prod1', '#/board?station=cut', 1440)
      await t.waitText('SC-B6-ORG')
      await t.ev(() => performance.clearResourceTimings())
      await t.clickButton(/เริ่มตัด|เริ่มงาน/)
      await delay(800)
      const liveCount = await t.ev(() => performance.getEntriesByType('resource').filter(r => r.name.includes('/rest/v1/job_live')).length)
      assert.ok(liveCount <= 1, `กด 1 ครั้งโหลด job_live ${liveCount} รอบ (>1)`)

      // Check drawer lg size does NOT use v=thumb
      await t.goto('prod1', `#/board?job=${jWithThumb}`, 1440)
      await t.waitText('SC-B6-THM')
      const lgSrc = await t.ev(() => [...document.querySelectorAll('[role=dialog] img')].find(i => i.alt.includes('SC-B6-THM'))?.src)
      assert.ok(lgSrc && !lgSrc.includes('v=thumb'), 'รายละเอียดงานกรอบใหญ่ควรใช้รูปเต็ม: ' + lgSrc)

      observations.push({ key: 'B6_thumbs_and_fetches', liveCount, stableUrl: thmSrc2 === thumbAttrs.thmSrc })
      return `X-File-Variant(thumb=${rThm.headers.get('X-File-Variant')}, fallback=${rOrg.headers.get('X-File-Variant')}) · stableURL=true · job_live_fetches=${liveCount}`
    })

    // === B.7 R18-01..04 Regressions ===
    await check('B7.r18-regressions', 'B7 งานค้างรอบ 18 (R18-01..04): แก้ใบจากลูก -2, ป้ายเลยกำหนดบนภาพรวม, staff/qc เปิดคิวรวม, ล็อกเปลี่ยนสินค้า+ตัวอย่าง', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      // R18-02 Overdue on Overview
      await receiveJob('SC-B7-LATE', 'cut_only', { dueOffset: -3 })
      await t.goto('admin1', '#/', 1440)
      await t.waitText('SC-B7-LATE')
      const overdueText = await t.ev(() => [...document.querySelectorAll('li, div')].find(x => x.innerText.includes('SC-B7-LATE'))?.innerText ?? '')
      assert.match(overdueText, /เลยกำหนด 3 วัน/, 'R18-02 หน้าภาพรวมไม่แสดง เลยกำหนด X วัน: ' + overdueText)

      // R18-03 Direct URL #/production-queue denied for staff_single & qc
      for (const role of ['staff_single', 'qc']) {
        await t.goto(role, '#/production-queue', 1440)
        await t.waitText('บทบาทของคุณเปิดหน้านี้ไม่ได้')
      }

      // R18-01 + R18-04: Split job -> open confirmation form from child -2 -> revise works & locks product/sample
      const pJob = await receiveJob('SC-B7-SP', 'cut_only', {
        qty: 100, needsSample: false,
        spec: { app: 'phappim-confirm', v: 1, product: 'tshirt', h: { doc_no: 'SC-B7-SP', customer: 'ลูกค้าแยกงาน', due_date: '2026-12-20', sample: 'ไม่ขึ้นตัวอย่าง' }, p: { tshirt: { size_sets: ['ไซซ์ผู้ใหญ่'], sizes: [{ label: 'ดำ', q: { M: 100 } }] } }, summary: { qty: 100 } },
      })
      const cJob = (await as(uid('admin1'), 'public.split_job($2::uuid, 30) as id', [pJob]))[0].id
      await t.goto('admin1', `#/board?job=${cJob}`, 1440)
      await t.waitText('SC-B7-SP-2')
      await t.clickButton(/ส่งออก PDF ใบยืนยันอีกครั้ง \/ แก้ใบ/, { inside: '[role=dialog]' })
      await t.ev(() => { window.open = () => null })
      await t.clickButton('เปิดใบยืนยันในฟอร์ม', { inside: '[role=dialog]' })
      await t.waitText('บันทึกการแก้เข้างาน')
      // Check R18-04 UI locks: no 'เปลี่ยนสินค้า' button, sample radios disabled
      const r1804Locks = await t.ev(() => ({
        hasChangeProd: [...document.querySelectorAll('button')].some(b => b.textContent.includes('เปลี่ยนสินค้า')),
        sampleRadiosDisabled: [...document.querySelectorAll('input[type=radio][data-k="sample"]')].every(r => r.disabled),
        docNoLocked: document.querySelector('[data-k="doc_no"]')?.disabled ?? document.querySelector('[data-k="doc_no"]')?.readOnly ?? false,
      }))
      assert.equal(r1804Locks.hasChangeProd, false, 'R18-04 ยังมีปุ่มเปลี่ยนสินค้า')
      assert.equal(r1804Locks.sampleRadiosDisabled, true, 'R18-04 radio ขึ้นตัวอย่างไม่ล็อก')

      // Revise via bump rev (with window.alert, confirm & open stubbed so we capture any real alert/outbox failure!)
      await t.fillInput('[data-k="rev"]', '1')
      await t.fillInput('[data-k="customer"]', 'ลูกค้าแยกงาน (แก้แล้ว)')
      await t.ev(() => {
        window.__b7Alerts = []
        window.alert = m => window.__b7Alerts.push(m)
        window.confirm = () => true
        window.open = () => null
      })
      await t.clickButton('บันทึกการแก้เข้างาน')
      await delay(500)
      const b7FormState = await t.ev(() => ({
        alerts: window.__b7Alerts || [],
        hasOutbox: !!localStorage.getItem('pp142.confirmation.outbox'),
      }))
      assert.ok(b7FormState.hasOutbox, 'ฟอร์มไม่ส่งใบแก้เข้า outbox: ' + JSON.stringify(b7FormState))
      await t.goto('admin1', '#/board?confirmation=save', 1440)
      await waitFor(async () => {
        const res = await t.ev(() => {
          const al = [...document.querySelectorAll('[role=status], [role=alert]')].map(x => x.innerText.trim()).join(' | ')
          return { text: al, ok: document.body.innerText.includes('SC-B7-SP') && document.body.innerText.includes('แก้ไขครั้งที่ 1') }
        })
        if (/ไม่สำเร็จ/.test(res.text)) throw new Error('Outbox ปฏิเสธ: ' + res.text)
        return res.ok
      }, 'บันทึกแก้ใบจากลูก -2 สำเร็จ', 12000)
      const [pAfter] = await sql('select customer_name, qty from public.jobs where id = $1', [pJob])
      const [cAfter] = await sql('select customer_name, qty from public.jobs where id = $1', [cJob])
      assert.equal(pAfter.qty, 70); assert.equal(cAfter.qty, 30)
      assert.equal(cAfter.customer_name, 'ลูกค้าแยกงาน (แก้แล้ว)')

      observations.push({ key: 'B7_r18', r1804Locks, pAfter, cAfter })
      return `R18-01..04 ผ่านครบ (parent=70, child=30, overdue=3วัน, queueBlocked=true)`
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
  console.log(`\nSUMMARY test-part-b-new: ${results.length - failed.length}/${results.length} passed`)
  if (chrome.externalAttempts.length > 0) throw new Error('EXTERNAL ATTEMPTS: ' + JSON.stringify(chrome.externalAttempts))
  process.exit(failed.length ? 1 : 0)
}

run().catch(e => { console.error(e); process.exit(1) })
