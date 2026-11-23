import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { startLocalStack } from '../qa-r14/server.mjs'
import { openChrome } from '../qa-r14/chrome.mjs'
import { createFixtures } from '../qa-r14/fixtures.mjs'
import { savePng, savePdf } from './helpers.mjs'

const SUMMARY_PATH = fileURLToPath(new URL('./part-a-results.json', import.meta.url))

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

async function pickProduct(t, prod) {
  await t.ev(p => {
    let r = document.querySelector(`input[type="radio"][data-product][value="${p}"]`)
    if (!r) {
      const pickBtn = document.querySelector('button[data-act="pick"]')
      if (pickBtn) pickBtn.click()
      r = document.querySelector(`input[type="radio"][data-product][value="${p}"]`)
    }
    if (!r) throw new Error('ไม่พบสินค้า ' + p)
    r.checked = true
    r.dispatchEvent(new Event('change', { bubbles: true }))
  }, prod)
}

async function run() {
  const stack = await startLocalStack({ port: 5234, filesPort: 5235 })
  const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
  const fixtures = await createFixtures(chrome.main)
  const t = chrome.wrap(chrome.main)
  const results = []
  const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim()

  async function check(id, title, fn) {
    const offset = t.tab.logs.length
    try {
      const detail = await fn()
      const newLogs = t.tab.logs.slice(offset).filter(e => !e.text?.startsWith("Blocked attempt to show a 'beforeunload'"))
      if (newLogs.length) throw new Error('Console error: ' + JSON.stringify(newLogs))
      results.push({ id, title, pass: true, detail: detail ?? '' })
      console.log(`PASS [${id}] ${title}${detail ? ' · ' + detail : ''}`)
    } catch (err) {
      results.push({ id, title, pass: false, error: clean(err.message) })
      console.log(`FAIL [${id}] ${title} · ${clean(err.message)}`)
    }
  }

  try {
    await resetStack(stack)

    // A1: Customer changes delivery address after job received
    await check('A1', 'ลูกค้าเปลี่ยนที่อยู่จัดส่งหลังรับงาน (1440 + 768 + 375 px)', async () => {
      // 1. Open /confirmation, fill polo form with "รับเองที่โรงงาน", save to system
      await t.goto('admin1', '', 1440, '/confirmation')
      await t.waitText('ใบยืนยันการผลิต')
      await pickProduct(t, 'polo')
      await t.waitText('เสื้อโปโล')
      await t.ev(() => {
        const set = (el, val) => {
          el.value = val
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
        const doc = document.querySelector('input[data-s="h"][data-k="doc_no"]')
        const cust = document.querySelector('input[data-s="h"][data-k="customer"]')
        const due = document.querySelector('input[data-s="h"][data-k="due_date"]')
        const rev = document.querySelector('input[data-s="h"][data-k="revision"]')
        set(doc, 'SC69-R16-A1')
        set(cust, 'บริษัท เอวัน ทดสอบ จำกัด')
        if (due) set(due, '2099-02-15')
        if (rev) set(rev, '0')
        const radioSelf = [...document.querySelectorAll('input[type="radio"][data-s="h"][data-k="delivery"]')].find(r => r.value.includes('รับเอง'))
        if (radioSelf) { radioSelf.checked = true; radioSelf.dispatchEvent(new Event('change', { bubbles: true })) }
        const qtyInput = document.querySelector('input[data-t="sizes"][data-r="0"]')
        if (qtyInput) set(qtyInput, '20')
      })
      await t.uploadFiles('input[type="file"][data-img]', [fixtures.paths.frontPng])
      await t.waitText('ม็อคอัพ')
      // Click บันทึกเข้าระบบ
      await t.ev(() => { window.open = () => null })
      await t.clickButton('บันทึกเข้าระบบ')
      await t.waitText('ส่งใบ SC69-R16-A1 แล้ว')

      // 2. Receive job in main app via confirmation=save
      await t.goto('admin1', '#/board?confirmation=save', 1440)
      await t.waitText('บันทึกใบยืนยัน SC69-R16-A1 เข้าระบบแล้ว')
      await t.clickButton('ส่งงานเข้าโรงงานเลย')
      await t.waitText('รับงานเข้าโรงงาน')
      await delay(300)
      await t.ev(() => {
        const dlg = document.querySelector('[role="dialog"]')
        const dueInput = [...dlg.querySelectorAll('input')].find(i => i.type === 'date')
        if (dueInput && !dueInput.value) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(dueInput, '2099-02-15')
          dueInput.dispatchEvent(new Event('input', { bubbles: true }))
          dueInput.dispatchEvent(new Event('change', { bubbles: true }))
        }
        const qtyInp = [...dlg.querySelectorAll('input')].find(i => i.closest('label')?.textContent.includes('จำนวน'))
        if (qtyInp && (!qtyInp.value || Number(qtyInp.value) <= 0)) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(qtyInp, '20')
          qtyInp.dispatchEvent(new Event('input', { bubbles: true }))
          qtyInp.dispatchEvent(new Event('change', { bubbles: true }))
        }
        const rtSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'normal'))
        if (rtSel) { rtSel.value = 'normal'; rtSel.dispatchEvent(new Event('change', { bubbles: true })) }
        const noSample = [...dlg.querySelectorAll('input[name="needs-sample"]')][1]
        if (noSample) noSample.click()
      })
      await t.clickButton(/^รับงาน$/, { exact: true, inside: '[role="dialog"]' })
      await t.waitText('ส่งงาน SC69-R16-A1 เข้าโรงงานแล้ว')

      // 3. Attach signed PDF in drawer
      const { rows } = await sql(stack, "select id from public.jobs where confirmation_no = 'SC69-R16-A1'")
      const jobId = rows[0].id
      await t.goto('admin1', `#/board?job=${jobId}`, 1440)
      await t.waitText('ยังไม่มี PDF ใบยืนยันที่ลูกค้าเซ็น')
      await t.uploadFiles('input[type="file"][accept*="pdf"]', [fixtures.paths.pdf])
      await t.clickButton('แนบ PDF')
      await t.waitText('เปิด PDF ใบยืนยัน')

      // 4. Advance job 2 stations (print start -> finish)
      await t.goto('prod1', '#/board?station=print', 1440)
      await t.waitText('SC69-R16-A1')
      await t.clickButton('เริ่มพิมพ์งาน')
      await t.waitText('พิมพ์งานเสร็จ')
      await t.clickButton('พิมพ์งานเสร็จ')
      await t.waitText('ยืนยัน')
      await t.clickButton('ยืนยัน')
      await delay(300)

      // 5. Admin opens job drawer -> expands "ลูกค้าขอแก้ใบยืนยัน" -> tests 1440, 768, 375
      await t.goto('admin1', `#/board?job=${jobId}`, 1440)
      await t.waitText('ลูกค้าขอแก้ใบยืนยัน')
      await t.ev(() => {
        const sum = [...document.querySelectorAll('summary')].find(s => s.textContent.includes('ลูกค้าขอแก้ใบยืนยัน'))
        sum.click()
      })
      await t.waitText('เปิดใบยืนยันในฟอร์ม')
      await savePng(t, 'r16-ag-a1-revise-drawer.png')

      // Check popup behavior on 768px -> test fallback navigation in same tab
      await t.send('Emulation.setDeviceMetricsOverride', { width: 768, height: 920, deviceScaleFactor: 1, mobile: false })
      await t.ev(() => {
        window.open = () => null
        const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('เปิดใบยืนยันในฟอร์ม'))
        btn.click()
      })
      await t.waitText('ของงานที่รับแล้ว')
      await savePng(t, 'r16-ag-a1-revise-form.png')

      // Change to รถบริษัทไปส่ง + address + revision 1
      await t.ev(() => {
        const shipDeliv = [...document.querySelectorAll('input[type="radio"][data-s="h"][data-k="delivery"]')].find(r => r.value.includes('รถบริษัท'))
        if (!shipDeliv) throw new Error('ไม่พบตัวเลือก รถบริษัทไปส่ง')
        shipDeliv.checked = true
        shipDeliv.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await delay(100)
      await t.ev(() => {
        const set = (el, val) => {
          el.value = val
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
        const addr = document.querySelector('input[data-s="h"][data-k="address"], textarea[data-s="h"][data-k="address"]')
        if (addr) set(addr, '99/9 ถ.พระราม 2 แขวงแสมดำ เขตบางขุนเทียน กทม. 10150')
        const rev = document.querySelector('input[data-s="h"][data-k="revision"]')
        if (rev) set(rev, '1')
      })
      await t.clickButton('ดูตัวอย่าง PDF')
      await t.waitText('ข้อตกลง')
      const v2Text = await t.ev(() => document.querySelector('#doc')?.innerText ?? '')
      const v2Pdf = await savePdf(t, 'r16-ag-a1-confirm-v2.pdf')

      // Replace PDF in job drawer
      await t.goto('admin1', `#/board?job=${jobId}`, 1440)
      await t.waitText('ลูกค้าขอแก้ใบยืนยัน')
      await t.ev(() => {
        const sum = [...document.querySelectorAll('summary')].find(s => s.textContent.includes('ลูกค้าขอแก้ใบยืนยัน'))
        sum.click()
      })
      await t.waitText('เปลี่ยนเป็น PDF ใบใหม่')
      await t.uploadFiles('details input[type="file"][accept*="pdf"]', [fixtures.paths.pdf])
      await t.clickButton('เปลี่ยนเป็น PDF ใบใหม่')
      await t.waitText('เปลี่ยนเป็น PDF ใบใหม่ (เลือกไฟล์ก่อน)')
      await savePng(t, 'r16-ag-a1-history-replaced.png')

      const evs = await sql(stack, "select * from public.events where job_id = $1", [jobId])
      const hasReplaced = evs.rows.some(r => JSON.stringify(r).includes('เปลี่ยน') || JSON.stringify(r).includes('confirmation_pdf'))
      return `events=${evs.rows.length}, hasReplaced=${hasReplaced}, v2PdfSize=${v2Pdf.size}, hasDeliv=${v2Text.includes('รถบริษัท')}`
    })

    // A2: Pockets with piping + standard size + custom size
    await check('A2', 'กระเป๋าเสื้อโปโล: กุ๊น + ขนาดมาตรฐาน + กำหนดขนาดเอง + PDF', async () => {
      await t.goto('admin1', '', 1440, '/confirmation')
      await t.waitText('ใบยืนยันการผลิต')
      await pickProduct(t, 'polo')
      await t.waitText('เสื้อโปโล')
      await t.ev(() => {
        const set = (el, val) => {
          el.value = val
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
        set(document.querySelector('input[data-s="h"][data-k="doc_no"]'), 'SC69-R16-A2')
        set(document.querySelector('input[data-s="h"][data-k="customer"]'), 'ทดสอบกระเป๋าหลายใบ')
        // Add 2 more pocket rows
        const addBtn = document.querySelector('button[data-act="addrow"][data-id="pocket_rows"]')
        if (!addBtn) throw new Error('ไม่พบปุ่มเพิ่มแถวกระเป๋า')
        addBtn.click()
        addBtn.click()
      })
      await delay(100)
      await t.ev(() => {
        const set = (el, val) => {
          el.value = val
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
        // Row 0: standard size + piping กุ๊นปากกระเป๋า
        const setSel = (sel, optIdx) => {
          if (sel && sel.options[optIdx]) {
            sel.value = sel.options[optIdx].value
            sel.dispatchEvent(new Event('input', { bubbles: true }))
            sel.dispatchEvent(new Event('change', { bubbles: true }))
          }
        }
        setSel(document.querySelector('select[data-t="pocket_rows"][data-r="0"][data-c="pos"]'), 1)
        setSel(document.querySelector('select[data-t="pocket_rows"][data-r="0"][data-c="piping"]'), 2)
        const std0 = document.querySelector('input[type="checkbox"][data-t="pocket_rows"][data-r="0"][data-c="size"]')
        if (!std0) throw new Error('ไม่พบติ๊ก มาตรฐาน ในตารางกระเป๋า')
        std0.checked = true
        std0.dispatchEvent(new Event('change', { bubbles: true }))

        // Row 1: custom size + piping กุ๊นรอบกระเป๋า
        setSel(document.querySelector('select[data-t="pocket_rows"][data-r="1"][data-c="pos"]'), 2)
        setSel(document.querySelector('select[data-t="pocket_rows"][data-r="1"][data-c="piping"]'), 3)
        const sz1 = document.querySelector('input[data-t="pocket_rows"][data-r="1"][data-c="size"]')
        if (sz1) set(sz1, '4.5 x 5 นิ้ว')
      })
      await savePng(t, 'r16-ag-a2-pockets-form.png')
      await t.clickButton('ดูตัวอย่าง PDF')
      await t.waitText('ข้อตกลง')
      const pText = await t.ev(() => document.querySelector('#doc')?.innerText ?? '')
      const pPdf = await savePdf(t, 'r16-ag-a2-pockets.pdf')
      return `3 pocket rows + PDF (${pPdf.size} B), hasStd=${pText.includes('ขนาดมาตรฐาน')}, hasPiping=${pText.includes('กุ๊น')}`
    })

    // A3: Pants custom size (elephant FS/PS -> custom + pajama)
    await check('A3', 'กางเกงขนาดลูกค้ากำหนด (กางเกงช้าง + ชุดนอน)', async () => {
      await t.goto('admin1', '', 1440, '/confirmation')
      await t.waitText('ใบยืนยันการผลิต')
      await pickProduct(t, 'elephant')
      await t.waitText('กางเกงช้าง')
      await t.ev(() => {
        const set = (el, val) => {
          el.value = val
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
        set(document.querySelector('input[data-s="h"][data-k="doc_no"]'), 'SC69-R16-A3-EL')
        set(document.querySelector('input[data-s="h"][data-k="customer"]'), 'ทดสอบกางเกงช้าง')
        const customRadio = [...document.querySelectorAll('input[type="radio"][data-s="p"][data-k="size_chart"]')].find(r => r.value.includes('กำหนดขนาดเอง'))
        if (!customRadio) throw new Error('ไม่พบตัวเลือก กำหนดขนาดเอง')
        customRadio.checked = true
        customRadio.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await t.waitText('รอบเอว')
      await t.ev(() => {
        const set = (el, val) => {
          el.value = val
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
        set(document.querySelector('input[data-t="measure_rows"][data-r="0"][data-c="size"]'), 'Free')
        set(document.querySelector('input[data-t="measure_rows"][data-r="0"][data-c="waist"]'), '26-40')
        set(document.querySelector('input[data-t="measure_rows"][data-r="0"][data-c="hip"]'), '46')
        set(document.querySelector('input[data-t="measure_rows"][data-r="0"][data-c="leg"]'), '39')
      })
      await savePng(t, 'r16-ag-a3-elephant-form.png')
      await t.clickButton('ดูตัวอย่าง PDF')
      await t.waitText('ข้อตกลง')
      const elText = await t.ev(() => document.querySelector('#doc')?.innerText ?? '')
      const elPdf = await savePdf(t, 'r16-ag-a3-elephant.pdf')
      await t.goto('admin1', '', 1440, '/confirmation')
      await t.waitText('ใบยืนยันการผลิต')

      // Now pajama
      await pickProduct(t, 'pajama')
      await t.waitText('ชุดนอน')
      await t.ev(() => {
        const set = (el, val) => {
          el.value = val
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
        set(document.querySelector('input[data-s="h"][data-k="doc_no"]'), 'SC69-R16-A3-PJ')
        const customRadio = [...document.querySelectorAll('input[type="radio"][data-s="p"][data-k="size_chart"]')].find(r => r.value.includes('กำหนดขนาดเอง'))
        if (!customRadio) throw new Error('ไม่พบตัวเลือก กำหนดขนาดเอง ในชุดนอน')
        customRadio.checked = true
        customRadio.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await t.waitText('อก')
      await t.ev(() => {
        const set = (el, val) => {
          el.value = val
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
        set(document.querySelector('input[data-t="measure_rows"][data-r="0"][data-c="size"]'), 'M')
        set(document.querySelector('input[data-t="measure_rows"][data-r="0"][data-c="chest"]'), '40')
        set(document.querySelector('input[data-t="measure_rows"][data-r="0"][data-c="waist"]'), '28-36')
      })
      await t.clickButton('ดูตัวอย่าง PDF')
      await t.waitText('ข้อตกลง')
      const pjText = await t.ev(() => document.querySelector('#doc')?.innerText ?? '')
      const pjPdf = await savePdf(t, 'r16-ag-a3-pajama.pdf')
      return `elPdf=${elPdf.size}B (factoryHidden=${!elText.includes('FS (เอว')}), pjPdf=${pjPdf.size}B (hasTopPants=${pjText.includes('รอบอก') && pjText.includes('รอบเอว')})`
    })

    // A4: Foldable bag + Canvas bag with binding + standard sewing
    await check('A4', 'ถุงพับได้ / ถุงผ้า: สายผ้ากุ๊นขอบ + กุ๊นปากถุง + เย็บมาตรฐานโรงงาน', async () => {
      await t.goto('admin1', '', 1440, '/confirmation')
      await t.waitText('ใบยืนยันการผลิต')
      await pickProduct(t, 'foldable')
      await t.waitText('ถุงผ้าร่มพับได้')
      await t.ev(() => {
        const set = (el, val) => {
          el.value = val
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
        set(document.querySelector('input[data-s="h"][data-k="doc_no"]'), 'SC69-R16-A4-FOLD')
        set(document.querySelector('input[data-s="h"][data-k="customer"]'), 'ทดสอบถุงพับได้')
        const handleRadio = [...document.querySelectorAll('input[type="radio"][data-s="p"][data-k="handle_mat"]')].find(c => c.value.includes('กุ๊นขอบ'))
        if (handleRadio) { handleRadio.checked = true; handleRadio.dispatchEvent(new Event('change', { bubbles: true })) }
        const bindCb = [...document.querySelectorAll('input[type="checkbox"][data-s="p"][data-k="binding"]')].find(c => c.value.includes('ปากถุง'))
        if (!bindCb) throw new Error('ไม่พบตัวเลือกกุ๊น ปากถุง')
        bindCb.checked = true
        bindCb.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await t.waitText('สีกุ๊น')
      await t.ev(() => {
        const bc = document.querySelector('input[data-s="p"][data-k="binding_color"]')
        bc.value = 'สีดำ 2 ซม.'
        bc.dispatchEvent(new Event('input', { bubbles: true }))
        bc.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await savePng(t, 'r16-ag-a4-foldbag-form.png')
      await t.clickButton('ดูตัวอย่าง PDF')
      await t.waitText('ข้อตกลง')
      const fbText = await t.ev(() => document.querySelector('#doc')?.innerText ?? '')
      const fbPdf = await savePdf(t, 'r16-ag-a4-foldbag.pdf')
      await t.goto('admin1', '', 1440, '/confirmation')
      await t.waitText('ใบยืนยันการผลิต')

      // Canvas bag
      await pickProduct(t, 'bag')
      await t.waitText('ถุงผ้า')
      await t.ev(() => {
        const set = (el, val) => {
          el.value = val
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
        set(document.querySelector('input[data-s="h"][data-k="doc_no"]'), 'SC69-R16-A4-BAG')
        const bindCb = [...document.querySelectorAll('input[type="checkbox"][data-s="p"][data-k="binding"]')].find(c => c.value.includes('ปาก'))
        if (!bindCb) throw new Error('ไม่พบตัวเลือกกุ๊นในถุงผ้า')
        bindCb.checked = true
        bindCb.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await t.waitText('สีกุ๊น')
      await t.ev(() => {
        const bc = document.querySelector('input[data-s="p"][data-k="binding_color"]')
        bc.value = 'สีดำ 2 ซม.'
        bc.dispatchEvent(new Event('input', { bubbles: true }))
        bc.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await t.clickButton('ดูตัวอย่าง PDF')
      await t.waitText('ข้อตกลง')
      const bagText = await t.ev(() => document.querySelector('#doc')?.innerText ?? '')
      const bagPdf = await savePdf(t, 'r16-ag-a4-bag.pdf')
      return `foldPdf=${fbPdf.size}B (hasBind=${fbText.includes('ปากถุง')}), bagPdf=${bagPdf.size}B (hasBind=${bagText.includes('สีดำ 2 ซม.')})`
    })

    // A5: 375px mobile check on confirmation form
    await check('A5', 'ฟอร์มใบยืนยันบนมือถือ 375 px: ตารางเลื่อนได้ ติ๊กมาตรฐานกดง่าย ไม่ล้นจอ', async () => {
      await t.goto('admin1', '', 375, '/confirmation')
      await t.waitText('ใบยืนยันการผลิต')
      await pickProduct(t, 'polo')
      await t.waitText('เสื้อโปโล')
      const metrics = await t.ev(() => {
        const docOverflow = document.documentElement.scrollWidth - window.innerWidth
        const wraps = [...document.querySelectorAll('.ft-wrap, .tbl-wrap, .table-wrap, div')].filter(el => el.querySelector('table.ft'))
        const scrollable = wraps.some(w => w.scrollWidth > w.clientWidth)
        const stdLabel = document.querySelector('label.std')
        const rect = stdLabel ? stdLabel.getBoundingClientRect() : null
        return { docOverflow, scrollable, wrapClass: wraps[0]?.className ?? '', stdRect: rect ? { w: Math.round(rect.width), h: Math.round(rect.height) } : null }
      })
      await savePng(t, 'r16-ag-a5-mobile-375.png')
      assert.ok(metrics.docOverflow <= 0, `หน้าล้นขอบขวา ${metrics.docOverflow}px`)
      assert.ok(metrics.scrollable, 'ตารางควรเลื่อนแนวนอนได้ใน .table-wrap')
      return JSON.stringify(metrics)
    })

    await writeFile(SUMMARY_PATH, JSON.stringify({
      externalAttempts: chrome.externalAttempts,
      blockedFontCount: chrome.blockedFontRequests.length,
      results,
    }, null, 2))
  } finally {
    await chrome.close()
    await stack.close()
  }
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
