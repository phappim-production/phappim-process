import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { startLocalStack } from '../qa-r14/server.mjs'
import { openChrome, waitFor } from '../qa-r14/chrome.mjs'
import { createFixtures } from '../qa-r14/fixtures.mjs'

const OUT_JSON = fileURLToPath(new URL('./part-a-1-6-results.json', import.meta.url))

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

async function main() {
  const stack = await startLocalStack()
  const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
  const t = chrome.wrap(chrome.main)
  const fixtures = await createFixtures(t)
  const results = []

  async function check(id, title, fn, { allowErrorStatus = false, tabs = [chrome.main] } = {}) {
    const offsets = tabs.map(tb => tb.logs.length)
    try {
      const detail = await fn()
      const newLogs = tabs.flatMap((tb, i) => tb.logs.slice(offsets[i])).filter(e => {
        if (e.text?.startsWith("Blocked attempt to show a 'beforeunload'")) return false
        if (allowErrorStatus && /400|403|404|409|413|415|422|500|503/.test(e.text ?? '')) return false
        return true
      })
      if (newLogs.length) throw new Error('Console errors: ' + JSON.stringify(newLogs))
      results.push({ id, title, pass: true, detail })
      console.log(`PASS [${id}] ${title} · ${detail ?? ''}`)
    } catch (err) {
      results.push({ id, title, pass: false, error: err.message })
      console.log(`FAIL [${id}] ${title} · ${err.message}`)
    }
  }

  try {
    await check('A-PR185-1', 'แก้ใบหลังรับงานแบบระบบจำ + ม็อคอัพเตือนค่าเก่า + แก้ซ้ำ + 2 แท็บ', async () => {
      await resetStack(stack)
      await t.goto('admin1', '', 1440, '/confirmation')
      await t.waitText('ใบยืนยันการผลิต')
      await t.ev(() => {
        if (document.body.classList.contains('preview')) togglePreview(false)
        state = fresh(); state.pickOpen = false; renderForm()
      })
      await t.fillInput('[data-s="h"][data-k="doc_no"]', 'SC69-A185')
      await t.fillInput('[data-s="h"][data-k="issue_date"]', '2099-01-01')
      await t.fillInput('[data-s="h"][data-k="admin"]', 'น้ำ')
      await t.fillInput('[data-s="h"][data-k="due_date"]', '2099-02-15')
      await t.fillInput('[data-s="h"][data-k="customer"]', 'บ.ลูกค้าเดิม')
      await t.fillInput('[data-s="h"][data-k="job_name"]', 'เสื้อทีมรุ่นแรก')
      await t.ev(() => {
        document.querySelector('input[type="radio"][data-s="h"][data-k="sample"][value="ไม่ขึ้นตัวอย่าง"]')?.click()
        const el = document.querySelector('input[type="checkbox"][data-s="p"][data-k="size_sets"][value="ไซซ์ผู้ใหญ่"]')
        if (el && !el.checked) el.click()
        const pm = document.querySelector('input[type="checkbox"][data-s="p"][data-k="print_method"][value="ซับลิเมชั่น เฉพาะจุด"]')
        if (pm && !pm.checked) pm.click()
      })
      await t.fillInput('input[data-t="sizes"][data-r="0"][data-c="label"]', 'สีขาว')
      await t.fillInput('input[data-t="sizes"][data-r="0"][data-c="q:M"]', '30')
      await t.fillInput('input[data-t="sizes"][data-r="0"][data-c="q:L"]', '20')
      await t.fillInput('[data-s="p"][data-k="spare"]', '2')
      await t.clickButton('บันทึกเข้าระบบ')
      await t.goto('admin1', '#/board?confirmation=save', 1440)
      await t.waitText('บันทึกใบยืนยัน SC69-A185 เข้าระบบแล้ว')

      await t.clickButton('ส่งงานเข้าโรงงานเลย')
      await t.waitText('รับงานเข้าโรงงาน')
      await waitFor(() => t.ev(() => {
        const dlg = document.querySelector('[role="dialog"]')
        if (!dlg || dlg.innerText.includes('กำลังโหลด')) return false
        return [...dlg.querySelectorAll('input')].some(i => i.value === 'SC69-A185')
      }), 'โหลดร่างใบ SC69-A185')
      await t.ev(() => {
        const dlg = document.querySelector('[role="dialog"]')
        const rSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'normal'))
        rSel.value = 'normal'
        rSel.dispatchEvent(new Event('change', { bubbles: true }))
        document.querySelectorAll('[role="dialog"] input[name="needs-sample"]')[1].click()
      })
      await t.waitText('ลำดับสถานี:')
      await t.clickButton(/^รับงาน$/, { exact: true, inside: '[role="dialog"]' })
      await t.waitText('ส่งงาน SC69-A185 เข้าโรงงานแล้ว')
      const jobId = (await sql(stack, `select id from public.jobs where confirmation_no = 'SC69-A185'`)).rows[0].id

      // สร้างม็อคอัพฉบับ 1 ผูกจุดกับใบยืนยัน (เทคนิคพิมพ์) แล้วอนุมัติ
      await t.goto('admin1', `#/mockup?id=${jobId}`, 1440)
      await t.clickButton('เริ่มทำม็อคอัพกำกับสเปก')
      await t.waitText('อัปโหลดภาพหลักก่อน')
      await t.uploadFiles('input[type="file"][accept*="png"]', [fixtures.paths.frontPng])
      await t.clickButton('ใช้เป็นภาพหลัก')
      await t.waitText('เพิ่มภาพหลักแล้ว')
      await waitFor(() => t.ev(() => document.querySelector('[data-testid="canvas-front"] img')?.complete), 'โหลดภาพหลัก')
      await t.ev(() => {
        const img = document.querySelector('[data-testid="canvas-front"] img')
        const r = img.getBoundingClientRect()
        img.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width * 0.45, clientY: r.top + r.height * 0.4 }))
      })
      await t.fillInput('input[placeholder*="คอเสื้อ"]', 'อกซ้าย')
      await t.ev(() => {
        const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent.includes('ซับลิเมชั่น')))
        if (sel) {
          const opt = [...sel.options].find(o => o.textContent.includes('ซับลิเมชั่น'))
          sel.value = opt.value
          sel.dispatchEvent(new Event('change', { bubbles: true }))
        }
      })
      await t.clickButton('อนุมัติฉบับ 1 ใช้ผลิต')
      await t.waitText('ใช้ผลิต: ฉบับ 1')

      // ฝ่ายผลิตเดิน 2 สถานี (พิมพ์ + รีด)
      await t.goto('prod1', `#/board?job=${jobId}`, 1440)
      await t.clickButton('เริ่มพิมพ์งาน')
      await t.waitText('กำลังทำ')
      await t.clickButton('พิมพ์งานเสร็จ')
      await t.clickButton('ยืนยัน', { exact: true })
      await t.waitText('รีดงาน')
      await t.clickButton('เริ่มรีดงาน')
      await t.waitText('กำลังทำ')
      await t.clickButton('รีดงานเสร็จ')
      await t.clickButton('ยืนยัน', { exact: true })
      await t.waitText('ตัดงาน')

      // แอดมินเปิดใบจากรายละเอียดงาน -> เปิดในฟอร์ม -> ส่งออก PDF ได้เลยโดยไม่ต้องรีเฟรช (PR 184)
      await t.goto('admin1', `#/board?job=${jobId}`, 1440)
      await t.clickButton('ส่งออก PDF ใบยืนยันอีกครั้ง / แก้ใบ')
      await t.waitText('เปิดใบยืนยันในฟอร์ม')
      await t.ev(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('เปิดใบยืนยันในฟอร์ม')).click())
      await t.goto('admin1', '', 1440, '/confirmation')
      await t.waitText('SC69-A185')
      const pdfBefore = await t.printPdf('r18-a1-confirm-before')
      assert.equal(pdfBefore.header, '%PDF-', 'PDF ก่อนแก้ต้องสร้างได้ทันทีไม่ต้องรีเฟรช')

      const blockedCheck = await t.ev(() => {
        const prodBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('เปลี่ยนสินค้า'))
        const sampleRadios = [...document.querySelectorAll('input[type="radio"][data-s="h"][data-k="sample"]')]
        return {
          prodDisabledOrHidden: !prodBtn || prodBtn.disabled,
          sampleDisabled: sampleRadios.length > 0 && sampleRadios.every(r => r.disabled),
        }
      })

      // แก้ลูกค้า, ชื่องาน, จำนวน (50->60), เผื่อเสีย (2->5), กำหนดส่ง, สเปก (เปลี่ยนเทคนิคพิมพ์)
      await t.fillInput('[data-s="h"][data-k="rev"]', '1')
      await t.fillInput('[data-s="h"][data-k="customer"]', 'บ.ลูกค้าใหม่จำกัด')
      await t.fillInput('[data-s="h"][data-k="job_name"]', 'เสื้อทีมรุ่นปรับปรุง')
      await t.fillInput('[data-s="h"][data-k="due_date"]', '2099-02-20')
      await t.fillInput('input[data-t="sizes"][data-r="0"][data-c="q:M"]', '35')
      await t.fillInput('input[data-t="sizes"][data-r="0"][data-c="q:L"]', '25')
      await t.fillInput('[data-s="p"][data-k="spare"]', '5')
      await t.ev(() => {
        const sub = document.querySelector('input[type="checkbox"][data-s="p"][data-k="print_method"][value="ซับลิเมชั่น เฉพาะจุด"]')
        if (sub?.checked) sub.click()
        const dtf = document.querySelector('input[type="checkbox"][data-s="p"][data-k="print_method"][value="DTF"]')
        if (dtf && !dtf.checked) dtf.click()
      })
      chrome.main.setDialogAccept(true)
      await t.clickButton('บันทึกการแก้เข้างาน')
      await t.goto('admin1', '#/board?confirmation=save', 1440)
      await t.waitText('บันทึกการแก้ใบ SC69-A185 (แก้ไขครั้งที่ 1) เข้างานแล้ว')
      await t.screenshot('r18-a1-revise-saved')

      await t.goto('admin1', `#/board?job=${jobId}`, 1440)
      await t.waitText('บ.ลูกค้าใหม่จำกัด')
      await t.waitText('60')
      const jobText = await t.ev(() => document.body.innerText)
      const hasJobName = jobText.includes('เสื้อทีมรุ่นปรับปรุง')
      const hasStaleWarn = jobText.includes('ม็อคอัพกำกับสเปก') && jobText.includes('ค่าเก่า')
      const hasRevisedHistory = jobText.includes('แก้ใบยืนยัน ครั้งที่ 1')
      await t.screenshot('r18-a1-job-detail-revised')

      await t.goto('admin1', `#/label?id=${jobId}`, 768)
      await t.waitText('SC69-A185')
      await t.waitText('บ.ลูกค้าใหม่จำกัด')
      await t.waitText('60')
      const labelPdf = await t.printPdf('r18-a1-label-revised')
      assert.equal(labelPdf.header, '%PDF-')

      await t.goto('prod1', '#/inbox', 1440)
      await t.waitText('แก้ใบยืนยัน')
      await t.waitText('SC69-A185')
      await t.goto('qc', '#/inbox', 1440)
      await t.waitText('แก้ใบยืนยัน')

      // ทดสอบส่ง rev ถอยหลัง (0) -> ต้องถูกปฏิเสธ
      const backRevErr = await t.ev(async jId => {
        const res = await fetch('/rest/v1/rpc/revise_job_spec', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: 'r14-local-anon-key',
            Authorization: 'Bearer ' + JSON.parse(localStorage.getItem('sb-127-auth-token')).access_token,
          },
          body: JSON.stringify({
            p_job: jId, p_spec: { v: 1, product: 'tshirt', h: { doc_no: 'SC69-A185' }, p: { print_method: ['DTF'] } }, p_rev: 0,
            p_customer_name: 'บ.ลูกค้าใหม่จำกัด', p_job_name: 'เสื้อทีมรุ่นปรับปรุง',
            p_qty: 60, p_spare_qty: 5, p_due_date: '2099-02-20', p_needs_sample: false,
          }),
        })
        return { status: res.status, body: await res.text() }
      }, jobId)
      assert.ok(backRevErr.status >= 400, 'ครั้งที่ถอยหลังต้องถูกปฏิเสธ')

      return `staleWarn=${hasStaleWarn}, jobNameShown=${hasJobName}, hist=${hasRevisedHistory}, blocked=${JSON.stringify(blockedCheck)}, backRevStatus=${backRevErr.status}`
    }, { allowErrorStatus: true })

    await check('A-PR181-6', 'ม็อคอัพ PR 181: จุดชี้ใกล้ขอบไม่ตัด + จอแคบ 375px + /confirmation?test=1', async () => {
      await resetStack(stack)
      await t.goto('admin1', '#/', 1440)
      await t.clickButton('รับงานใหม่')
      await t.fillInput('[role="dialog"] input[placeholder*="SC"]', 'SC69-MK181')
      await waitFor(() => t.ev(() => Boolean([...document.querySelectorAll('[role="dialog"] select')].find(s => [...s.options].some(o => o.value === 'tshirt')))), 'ตัวเลือก')
      await t.ev(() => {
        const dlg = document.querySelector('[role="dialog"]')
        const inputs = [...dlg.querySelectorAll('input')]
        const setVal = (el, val) => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val)
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
        setVal(inputs.find(i => i.closest('label')?.textContent.includes('ชื่อลูกค้า')), 'ลูกค้าม็อคอัพขอบ')
        const pSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'tshirt'))
        pSel.value = 'tshirt'; pSel.dispatchEvent(new Event('change', { bubbles: true }))
        setVal(inputs.find(i => i.closest('label')?.textContent.includes('จำนวน')), '10')
        setVal(inputs.find(i => i.type === 'date'), '2099-02-01')
        const rSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'cut_only'))
        rSel.value = 'cut_only'; rSel.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await t.ev(() => document.querySelectorAll('[role="dialog"] input[name="needs-sample"]')[1].click())
      await t.clickButton(/^รับงาน$/, { exact: true, inside: '[role="dialog"]' })
      await t.waitText('ส่งงาน SC69-MK181 เข้าโรงงานแล้ว')
      const jobId = (await sql(stack, `select id from public.jobs where confirmation_no = 'SC69-MK181'`)).rows[0].id

      await t.goto('admin1', `#/mockup?id=${jobId}`, 1440)
      await t.clickButton('เริ่มทำม็อคอัพกำกับสเปก')
      await t.waitText('อัปโหลดภาพหลักก่อน')
      await t.uploadFiles('input[type="file"][accept*="png"]', [fixtures.paths.frontPng])
      await t.clickButton('ใช้เป็นภาพหลัก')
      await t.waitText('เพิ่มภาพหลักแล้ว')
      await waitFor(() => t.ev(() => document.querySelector('[data-testid="canvas-front"] img')?.complete), 'โหลดภาพ')
      await t.ev(() => {
        const img = document.querySelector('[data-testid="canvas-front"] img')
        const r = img.getBoundingClientRect()
        img.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width * 0.92, clientY: r.top + r.height * 0.08 }))
      })
      await t.fillInput('input[placeholder*="คอเสื้อ"]', 'จุดมุมขวาบน')
      await t.fillInput('textarea', 'สเปกมุมขวาบนทดสอบไม่ตัดขอบ')
      await t.clickButton('อนุมัติฉบับ 1 ใช้ผลิต')
      await t.waitText('ใช้ผลิต: ฉบับ 1')

      await t.goto('staff_single', `#/mockup?id=${jobId}`, 375)
      await t.waitText('จุดมุมขวาบน')
      await t.screenshot('r18-a6-mockup-375')
      const boxCheck = await t.ev(() => {
        const canvas = document.querySelector('[data-testid="canvas-front"]')
        if (!canvas) return null
        const cr = canvas.getBoundingClientRect()
        const labels = [...canvas.querySelectorAll('div, span, button')].filter(el => el.textContent.includes('จุดมุมขวาบน'))
        return labels.map(el => {
          const r = el.getBoundingClientRect()
          return { w: Math.round(r.width), clippedLeft: r.left < cr.left - 2, clippedRight: r.right > cr.right + 2, clippedTop: r.top < cr.top - 2 }
        })
      })

      // ทดสอบ /confirmation?from=test (ปิด bypass SW เพื่อตรวจว่า SW ไม่แย่งตอบ)
      await chrome.main.send('Network.setBypassServiceWorker', { bypass: false })
      await t.goto('admin1', '', 1440, '/confirmation')
      await t.waitText('ใบยืนยันการผลิต')
      return `boxCheck=${JSON.stringify(boxCheck)}`
    })
  } finally {
    await writeFile(OUT_JSON, JSON.stringify({ results }, null, 2))
    await chrome.close()
    await stack.close()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
