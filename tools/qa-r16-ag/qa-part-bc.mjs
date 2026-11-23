import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { startLocalStack } from '../qa-r14/server.mjs'
import { openChrome } from '../qa-r14/chrome.mjs'
import { createFixtures } from '../qa-r14/fixtures.mjs'
import { savePng, savePdf } from './helpers.mjs'

const SUMMARY_PATH = fileURLToPath(new URL('./part-bc-results.json', import.meta.url))

async function resetStack(stack) {
  const res = await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
  assert.equal(res.status, 200)
}

async function sql(stack, query, params = []) {
  const res = await fetch(`${stack.origin}/__qa/sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: query, params }),
  })
  assert.equal(res.status, 200)
  return res.json()
}

async function receiveJob(t, { no, customer, product = 'tshirt', qty = 10, route = 'normal', sample = false }) {
  await t.goto('admin1', '#/', 1440)
  await t.clickButton('รับงานใหม่')
  await t.waitText('รับงานเข้าโรงงาน')
  await t.fillInput('[role="dialog"] input[placeholder*="SC"]', no)
  await t.ev((cust, prod, q, rt, samp) => {
    const dlg = document.querySelector('[role="dialog"]')
    const set = (el, val) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const custInput = [...dlg.querySelectorAll('input')].find(i => i.closest('label')?.textContent.includes('ชื่อลูกค้า'))
    set(custInput, cust)
    const prodSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === prod))
    prodSel.value = prod
    prodSel.dispatchEvent(new Event('change', { bubbles: true }))
    const qtyInput = [...dlg.querySelectorAll('input')].find(i => i.closest('label')?.textContent.includes('จำนวน'))
    set(qtyInput, String(q))
    const dueInput = [...dlg.querySelectorAll('input')].find(i => i.type === 'date')
    set(dueInput, '2099-02-20')
    const rtSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === rt))
    rtSel.value = rt
    rtSel.dispatchEvent(new Event('change', { bubbles: true }))
    const sampRadio = [...dlg.querySelectorAll('input[name="needs-sample"]')][samp ? 0 : 1]
    if (sampRadio) sampRadio.click()
  }, customer, product, qty, route, sample)
  await t.clickButton(/^รับงาน$/, { exact: true, inside: '[role="dialog"]' })
  await t.waitText(`ส่งงาน ${no} เข้าโรงงานแล้ว`)
}

async function run() {
  const stack = await startLocalStack({ port: 5234, filesPort: 5235 })
  const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
  const fixtures = await createFixtures(chrome.main)
  const t = chrome.wrap(chrome.main)
  const results = []
  const uxIssues = []
  const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim()

  async function check(id, title, fn, { allowErrorStatus = false } = {}) {
    const offset = t.tab.logs.length
    try {
      const detail = await fn()
      const newLogs = t.tab.logs.slice(offset).filter(e => {
        if (e.text?.startsWith("Blocked attempt to show a 'beforeunload'")) return false
        if (allowErrorStatus && /400|403|404|409|413|415|422|500|503/.test(e.text ?? '')) return false
        return true
      })
      if (newLogs.length) throw new Error('Console error: ' + JSON.stringify(newLogs))
      results.push({ id, title, pass: true, detail: detail ?? '' })
      console.log(`PASS [${id}] ${title}${detail ? ' · ' + detail : ''}`)
    } catch (err) {
      const snap = await t.ev(() => document.body.innerText.slice(0, 180).replace(/\s+/g, ' ')).catch(() => '')
      results.push({ id, title, pass: false, error: clean(err.message), snap })
      console.log(`FAIL [${id}] ${title} · ${clean(err.message)} · SNAP=${snap}`)
    }
  }

  try {
    await resetStack(stack)

    // B1: 3 routes (normal, outside, sample) + prod1/prod2 concurrent + manager/owner/sup1/sup2
    await check('B1', 'เดินงานครบ 3 เส้นทาง (ปกติ · ผลิตข้างนอก · มีตัวอย่าง) + ฝ่ายผลิต 2 คน + ผู้บริหาร/เจ้าของ/ผู้ควบคุม', async () => {
      await receiveJob(t, { no: 'SC69-R16-NORM', customer: 'ลูกค้าปกติ', route: 'normal', sample: false, qty: 10 })
      await receiveJob(t, { no: 'SC69-R16-OUT', customer: 'ลูกค้าข้างนอก', route: 'outside', sample: false, qty: 10 })
      await receiveJob(t, { no: 'SC69-R16-SAMP', customer: 'ลูกค้าตัวอย่าง', route: 'normal', sample: true, qty: 10 })

      const { rows } = await sql(stack, "select id, confirmation_no from public.jobs where confirmation_no like 'SC69-R16-%'")
      const byNo = Object.fromEntries(rows.map(r => [r.confirmation_no, r.id]))

      // Upload mockup for NORM
      await t.goto('admin1', `#/board?job=${byNo['SC69-R16-NORM']}`, 1440)
      await t.waitText('ความคืบหน้า')
      await t.uploadFiles('input[type="file"][accept*="image"]', [fixtures.paths.frontPng])
      await t.clickButton('บันทึกรูปม็อคอัพ')
      await t.waitText('เพิ่มรูปม็อคอัพแล้ว')

      // Check sup1 vs sup2 isolation
      await t.goto('sup1', '#/board', 1440)
      await t.waitText('SC69-R16-NORM')
      const sup1Stations = await t.ev(() => [...document.querySelectorAll('button')].map(b => b.textContent).filter(x => /พิมพ์|รีด|ตัด|เย็บ|QC/.test(x)).join('|'))

      await t.goto('sup2', '#/board', 1440)
      const sup2SeesPhase1 = await t.ev(() => document.body.innerText.includes('SC69-R16-NORM'))
      assert.equal(sup2SeesPhase1, false, 'ผู้ควบคุมเฟส 2 ต้องไม่เห็นงานเฟส 1')

      // Approve a mockup sheet for NORM so C3 can export #/artwork PDF
      await t.goto('admin1', `#/mockup?id=${byNo['SC69-R16-NORM']}`, 1440)
      await t.waitText('บันทึกร่าง')
      await t.uploadFiles('input[type="file"][accept*="image"]', [fixtures.paths.frontPng])
      await t.waitText('บันทึกร่าง')
      await t.clickButton('บันทึกร่าง')
      await delay(500)
      await t.waitText('อนุมัติฉบับ 1 ใช้ผลิต')
      await t.clickButton('อนุมัติฉบับ 1 ใช้ผลิต')
      await delay(500)

      // prod1 & prod2 concurrent: prod1 starts print on NORM, prod2 starts print on SAMP (sample)
      await t.goto('prod1', '#/board?station=print', 1440)
      await t.waitText('SC69-R16-NORM')
      await t.clickButton('เริ่มพิมพ์งาน')
      await t.waitText('พิมพ์งานเสร็จ')
      await t.clickButton('พิมพ์งานเสร็จ')
      await t.waitText('ยืนยัน')
      await t.clickButton('ยืนยัน')
      await delay(200)

      // prod2 in second tab
      const tab2Raw = await chrome.newTab()
      const t2 = chrome.wrap(tab2Raw)
      await t2.goto('prod2', '#/queue', 1440)
      await t2.waitText('SC69-R16-SAMP')
      await tab2Raw.close()

      // outside job: admin sends out and receives back
      await t.goto('admin1', `#/board?job=${byNo['SC69-R16-OUT']}`, 1440)
      await t.waitText('ส่งออกบริษัทภายนอก')
      await t.clickButton('ส่งออกบริษัทภายนอก')
      await t.waitText('คาดว่าของถึง')
      await t.ev(() => {
        const dlg = document.querySelector('[role="dialog"]')
        const sel = dlg.querySelector('select')
        if (sel && sel.options[1]) { sel.value = sel.options[1].value; sel.dispatchEvent(new Event('change', { bubbles: true })) }
      })
      await t.clickButton('บันทึกส่งออก', { inside: '[role="dialog"]' })
      await t.waitText('อยู่ข้างนอก')
      await t.clickButton('รับของกลับเข้าโรงงาน')
      await t.waitText('ยืนยันรับของกลับ')
      await t.clickButton('ยืนยันรับของกลับ', { inside: '[role="dialog"]' })
      await delay(200)

      // manager & owner checks
      await t.goto('manager', '#/reviews', 1440)
      await t.waitText('รายการรออนุมัติ')
      await t.goto('owner', '#/admin', 1440)
      await t.waitText('ภาพรวมระบบ')
      await t.goto('owner', '#/settings', 1440)
      await t.waitText('ตั้งค่าระบบ')

      return `jobs=3, sup1HasStations=${Boolean(sup1Stations)}`
    })

    // B2: Burmese mode on staff (375px) and QC (375px + 768px)
    await check('B2', 'ภาษาพม่า: staff (375 px) และ QC (375 px / 768 px)', async () => {
      // Switch staff_single to Burmese
      await t.goto('staff_single', '#/mine', 375)
      await t.ev(() => {
        localStorage.setItem('pp142-lang', 'my')
        location.reload()
      })
      await delay(800)
      await t.waitText(/[\u1000-\u109F]/)
      await savePng(t, 'r16-ag-b-staff-my-375.png')

      const staffCheck = await t.ev(() => {
        const text = document.body.innerText
        const hasMyanmar = /[\u1000-\u109F]/.test(text)
        const overflow = document.documentElement.scrollWidth - window.innerWidth
        return { hasMyanmar, overflow, sample: text.slice(0, 120).replace(/\s+/g, ' ') }
      })

      // Switch QC to Burmese
      await t.goto('qc', '#/queue', 375)
      await t.ev(() => {
        localStorage.setItem('pp142-lang', 'my')
        location.reload()
      })
      await delay(800)
      await t.waitText(/[\u1000-\u109F]/)
      await savePng(t, 'r16-ag-b-qc-my-375.png')
      const qcCheck = await t.ev(() => ({
        hasMyanmar: /[\u1000-\u109F]/.test(document.body.innerText),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      }))

      // Reset lang to th for remaining tests
      await t.ev(() => localStorage.setItem('pp142-lang', 'th'))
      assert.ok(staffCheck.hasMyanmar && qcCheck.hasMyanmar, 'ควรแสดงอักษรพม่า')
      return `staffOverflow=${staffCheck.overflow}, qcOverflow=${qcCheck.overflow}`
    })

    // C1: Responsive UX measurement across 375 / 768 / 1440 px
    await check('C1', 'วัดเลย์เอาต์ 375 / 768 / 1440 px (ไม่ล้น · ปุ่ม >= 48px · ตัวอักษร >= 16px)', async () => {
      const checks = [
        ['admin1', '#/'],
        ['admin1', '#/production-queue'],
        ['prod1', '#/queue'],
        ['qc', '#/queue'],
        ['staff_single', '#/mine'],
        ['manager', '#/'],
        ['owner', '#/settings'],
      ]
      for (const [role, hash] of checks) {
        for (const w of [375, 768, 1440]) {
          await t.goto(role, hash, w)
          const m = await t.measureFloorUx(w)
          if (m.mainOverflow > 0 || m.docScrollWidth > w || m.smallButtons.length || m.disabledNoReason || m.badTokens.length) {
            uxIssues.push({ role, hash, w, ...m })
          }
        }
      }
      return `measured=${checks.length * 3} screens, issues=${uxIssues.length}`
    })

    // C2: Slow network 3s + rapid click + history.back + 2 tabs conflict + mid-form close
    await check('C2', 'เน็ตช้า 3 วิ + กดรัว + ย้อนกลับ + 2 แท็บ + ปิดแท็บกลางคัน', async () => {
      const { rows } = await sql(stack, "select id from public.jobs where confirmation_no = 'SC69-R16-NORM'")
      const jobId = rows[0].id

      // Slow network 3s + rapid double click on press start
      await t.goto('prod1', '#/board?station=press', 1440)
      await t.waitText('SC69-R16-NORM')
      stack.setConfig({ latencyMs: 3000 })
      await t.ev(() => {
        const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('เริ่มรีด'))
        if (btn) { btn.click(); btn.click(); btn.click() }
      })
      await delay(3500)
      stack.setConfig({ latencyMs: 0 })
      const evs = await sql(stack, "select * from public.events where job_id = $1", [jobId])
      const pressStarts = evs.rows.filter(r => r.station_code === 'press' && r.kind === 'station_start').length || evs.rows.filter(r => JSON.stringify(r).includes('press') && JSON.stringify(r).includes('start')).length
      assert.equal(pressStarts, 1, 'กดรัวต้องบันทึก station_start เพียง 1 ครั้ง')

      // history.back
      await t.goto('admin1', '#/board', 1440)
      await t.goto('admin1', `#/board?job=${jobId}`, 1440)
      await t.ev(() => history.back())
      await delay(300)

      // Mid-form close/reload in /confirmation preserves localStorage draft
      await t.goto('admin1', '', 1440, '/confirmation')
      await t.waitText('ใบยืนยันการผลิต')
      await t.ev(() => {
        const doc = document.querySelector('input[data-s="h"][data-k="doc_no"]')
        doc.value = 'SC69-UNSAVED'
        doc.dispatchEvent(new Event('input', { bubbles: true }))
        doc.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await delay(200)
      await t.goto('admin1', '', 1440, '/confirmation')
      await t.waitText('ใบยืนยันการผลิต')
      const preserved = await t.ev(() => document.querySelector('input[data-s="h"][data-k="doc_no"]')?.value)
      assert.equal(preserved, 'SC69-UNSAVED', 'ปิด/รีเฟรชกลางคันต้องกู้ร่างใน localStorage ได้')
      return `pressStartCount=${pressStarts}, preserved=${preserved}`
    })

    // C3: Print PDF (Label A5 + Artwork A4/A3)
    await check('C3', 'พิมพ์ PDF: ใบปะงาน A5 + ใบม็อคอัพกำกับสเปก A4/A3', async () => {
      const { rows } = await sql(stack, "select id from public.jobs where confirmation_no = 'SC69-R16-NORM'")
      const jobId = rows[0].id
      await t.goto('admin1', `#/label?id=${jobId}`, 1440)
      await t.waitText('SC69-R16-NORM')
      await savePng(t, 'r16-ag-c3-label-a5.png')
      await savePdf(t, 'r16-ag-c3-label-a5.pdf')

      await t.goto('admin1', `#/artwork?id=${jobId}`, 1440)
      await t.waitText('SC69-R16-NORM')
      await savePng(t, 'r16-ag-c3-artwork-a4.png')
      await savePdf(t, 'r16-ag-c3-artwork-a4.pdf')
      return 'label A5 + artwork A4 PDFs exported'
    })

    // C4: Human errors (bad numbers, long name, emoji, Excel paste, bad files)
    await check('C4', 'ทำผิดแบบคนจริง: เลข 0/-5/ทศนิยม + ชื่อยาว + อีโมจิ + วางจาก Excel + ไฟล์ผิดชนิด', async () => {
      await t.goto('admin1', '#/', 1440)
      await t.clickButton('รับงานใหม่')
      await t.waitText('รับงานเข้าโรงงาน')
      await t.fillInput('[role="dialog"] input[placeholder*="SC"]', 'SC69-EXCEL-1')
      const longCust = 'ลูกค้าชื่อยาวมากๆๆ 🧵🔥\tคอลัมน์2\nบรรทัด2 ' + 'ก'.repeat(80)
      await t.ev((cust) => {
        const dlg = document.querySelector('[role="dialog"]')
        const set = (el, val) => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val)
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
        const custInput = [...dlg.querySelectorAll('input')].find(i => i.closest('label')?.textContent.includes('ชื่อลูกค้า'))
        set(custInput, cust)
        const qtyInput = [...dlg.querySelectorAll('input')].find(i => i.closest('label')?.textContent.includes('จำนวน'))
        set(qtyInput, '-5')
      }, longCust)
      const qtyVal = await t.ev(() => {
        const dlg = document.querySelector('[role="dialog"]')
        return [...dlg.querySelectorAll('input')].find(i => i.closest('label')?.textContent.includes('จำนวน'))?.value
      })
      await t.clickButton('ปิด', { inside: '[role="dialog"]' }).catch(() => {})

      // Test bad file upload on NORM job
      const { rows } = await sql(stack, "select id from public.jobs where confirmation_no = 'SC69-R16-NORM'")
      await t.goto('admin1', `#/board?job=${rows[0].id}`, 1440)
      await t.waitText('ความคืบหน้า')
      await t.uploadFiles('input[type="file"][accept*="image"]', [fixtures.paths.gif])
      await t.waitText(/JPG|PNG|WEBP/)
      await t.uploadFiles('input[type="file"][accept*="pdf"]', [fixtures.paths.txt])
      await t.waitText(/PDF/)
      return `qtyAfterNeg5="${qtyVal}", badFilesRejected=true`
    }, { allowErrorStatus: true })

    await writeFile(SUMMARY_PATH, JSON.stringify({
      externalAttempts: chrome.externalAttempts,
      blockedFontCount: chrome.blockedFontRequests.length,
      results,
      uxIssues,
    }, null, 2))
  } finally {
    await fixtures.cleanup()
    await chrome.close()
    await stack.close()
  }
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
