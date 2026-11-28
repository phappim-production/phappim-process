import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { startLocalStack } from './server.mjs'
import { openChrome, waitFor } from './chrome.mjs'
import { createFixtures } from './fixtures.mjs'

const SUMMARY_PATH = fileURLToPath(new URL('./part-c-results.json', import.meta.url))
const XSS = '<script>window.__xss=1</script><img src=x onerror="window.__xss=2">'
const EMOJI_EXCEL = 'ทดสอบ\tคอลัมน์2\nบรรทัดใหม่ 👕🔥🎉 ' + 'ยาว'.repeat(180)

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

async function receiveBasic(t, stack, no, customer, qty = 10, route = 'cut_only') {
  await t.goto('admin1', '#/', 1440)
  await t.clickButton('รับงานใหม่')
  await t.fillInput('[role="dialog"] input[placeholder*="SC"]', no)
  await waitFor(() => t.ev(() => Boolean([...document.querySelectorAll('[role="dialog"] select')].find(s => [...s.options].some(o => o.value === 'tshirt')))), 'ตัวเลือกสินค้า')
  await t.ev((cust, q, rt) => {
    const dlg = document.querySelector('[role="dialog"]')
    const inputs = [...dlg.querySelectorAll('input')]
    const setVal = (el, val) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    setVal(inputs.find(i => i.closest('label')?.textContent.includes('ชื่อลูกค้า')), cust)
    const pSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'tshirt'))
    pSel.value = 'tshirt'; pSel.dispatchEvent(new Event('change', { bubbles: true }))
    setVal(inputs.find(i => i.closest('label')?.textContent.includes('จำนวน')), String(q))
    setVal(inputs.find(i => i.type === 'date'), '2099-01-20')
    const rSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === rt))
    rSel.value = rt; rSel.dispatchEvent(new Event('change', { bubbles: true }))
  }, customer, qty, route)
  await t.ev(() => document.querySelectorAll('[role="dialog"] input[name="needs-sample"]')[2].click())
  await t.clickButton(/^รับงาน$/, { exact: true, inside: '[role="dialog"]' })
  await t.waitText(`ส่งงาน ${no} เข้าโรงงานแล้ว`)
  return (await sql(stack, 'select id from public.jobs where confirmation_no = $1', [no])).rows[0].id
}

async function main() {
  const stack = await startLocalStack()
  const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
  const t = chrome.wrap(chrome.main)
  const fixtures = await createFixtures(t)
  const results = []
  const findings = []

  async function check(id, title, fn, { allowErrorStatus = false } = {}) {
    const off = chrome.main.logs.length
    try {
      const detail = await fn()
      const newLogs = chrome.main.logs.slice(off).filter(e => {
        if (e.text?.startsWith("Blocked attempt to show a 'beforeunload'")) return false
        if (allowErrorStatus && /400|403|404|409|413|415|422|500|503/.test(e.text ?? '')) return false
        return true
      })
      if (newLogs.length) throw new Error('Console errors: ' + JSON.stringify(newLogs))
      results.push({ id, title, pass: true, detail })
      console.log(`PASS [${id}] ${title}${detail ? ' · ' + detail : ''}`)
    } catch (err) {
      results.push({ id, title, pass: false, error: err.message })
      console.log(`FAIL [${id}] ${title} · ${err.message}`)
    }
  }

  try {
    await resetStack(stack)

    await check('C1', 'ตัวเลขผิดรูปแบบ (0 / ติดลบ / ทศนิยม / อังกฤษ / เลขไทย / เกินขอบเขต) ทุกจุดสำคัญ', async () => {
      await t.goto('admin1', '#/', 1440)
      await t.clickButton('รับงานใหม่')
      const intakeCheck = await t.ev(() => {
        const dlg = document.querySelector('[role="dialog"]')
        const inputs = [...dlg.querySelectorAll('input')]
        const qtyInput = inputs.find(i => i.closest('label')?.textContent.includes('จำนวน'))
        const setQ = v => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(qtyInput, v)
          qtyInput.dispatchEvent(new Event('input', { bubbles: true }))
        }
        const out = {}
        for (const bad of ['0', '-5', '1.5', 'abc', '๑๐']) {
          setQ(bad)
          out[bad] = qtyInput.value
        }
        return out
      })

      await t.goto('admin1', '', 1440, '/confirmation')
      await t.ev(() => {
        state = fresh()
        renderForm()
        state.h = { doc_no: 'TEST-C-NUM', customer: 'ลูกค้า', issue_date: '2099-01-01', due_date: '2099-01-15', sample: 'ไม่ขึ้นตัวอย่าง' }
        scope('p').sizes = [{ label: 'ชุดทดสอบ', q: { M: '-5' } }]
        rerender()
      })
      const confirmErrs = await t.ev(() => validate())

      const jid = await receiveBasic(t, stack, 'TEST-C-JOB', 'ลูกค้า C', 10, 'plain')
      await t.goto('admin1', `#/board?job=${jid}`, 1440)
      await t.clickButton('แบ่งจำนวน (ส่งออกบางส่วน)')
      const splitBlock = {}
      for (const bad of ['0', '-2', '10', '1.5']) {
        await t.fillInput('input[type="number"]', bad)
        splitBlock[bad] = await t.ev(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('บันทึกแบ่งงาน') || b.textContent.includes('ใส่ 1–'))?.disabled ?? false)
      }
      await t.clickButton('ยกเลิก')

      await t.goto('prod1', `#/board?job=${jid}`, 1440)
      await t.clickButton('เริ่มตัดงาน'); await t.clickButton('ตัดงานเสร็จ'); await t.clickButton('ยืนยัน')
      await t.goto('prod1', '#/board', 1440)
      await t.clickButton('จักรเย็บ')
      await t.waitText('งานระหว่างเย็บ')
      await t.clickButton('เริ่มเย็บ', { index: 0 }); await t.clickButton(/เริ่มเย็บด้วย/)
      await t.clickButton('เย็บเสร็จ'); await t.clickButton('ยืนยันเย็บเสร็จ')

      await t.goto('qc', `#/board?job=${jid}`, 1440)
      await t.clickButton('เริ่ม QC + Packing')
      await t.fillInput('input[aria-label="จำนวนที่ผ่าน"]', '15')
      await t.clickButton('บันทึกผ่าน')
      await t.waitText(/บันทึกผ่านได้อีกไม่เกิน|ผ่านครบ/)
      const qcBadDisabled = {}
      for (const bad of ['0', '-3', 'abc']) {
        await t.fillInput('input[aria-label="จำนวนที่ผ่าน"]', bad)
        qcBadDisabled[bad] = await t.ev(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('บันทึกผ่าน'))?.disabled)
      }

      await t.goto('admin1', `#/mockup?id=${jid}`, 1440)
      await t.clickButton('เริ่มทำม็อคอัพกำกับสเปก')
      await t.waitText('อัปโหลดภาพหลักก่อน')
      await t.uploadFiles('input[type="file"][accept*="png"]', [fixtures.paths.frontPng])
      await t.clickButton('ใช้เป็นภาพหลัก')
      await t.waitText('เพิ่มภาพหลักแล้ว')
      await waitFor(() => t.ev(() => {
        const img = document.querySelector('[data-testid="canvas-front"] img')
        if (!img?.complete || !img.naturalWidth) return false
        const r = img.getBoundingClientRect()
        img.dispatchEvent(new MouseEvent('click', { clientX: r.x + r.width * 0.5, clientY: r.y + r.height * 0.4, bubbles: true }))
        return true
      }), 'คลิกวางจุด C1')
      await t.fillInput('input[aria-label="ชื่อจุด"]', 'จุดตรวจเลข')
      await t.clickButton('+ สร้างสเปกใหม่จากจุดนี้')
      await t.fillInput('input[aria-label="กว้าง"]', 'abc')
      await t.waitText('ใส่ตัวเลขมากกว่า 0 (ค่านี้ยังไม่ถูกบันทึก)')

      await t.goto('owner', '#/settings', 1440)
      await t.clickButton('แก้ไข', { index: 0 })
      await t.ev(() => {
        const inp = [...document.querySelectorAll('input')].find(i => i.closest('label')?.textContent.includes('จำนวนเครื่อง'))
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '51')
        inp.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await t.clickButton('บันทึก')
      await t.waitText('1–50')

      findings.push({ section: 'C1', intakeCheck, confirmErrs: confirmErrs.length, splitBlock, qcBadDisabled })
      return 'ตัวเลขผิดรูปแบบถูกปฏิเสธ/บล็อกทุกจุด'
    }, { allowErrorStatus: true })

    await check('C2', 'วันที่ย้อนหลัง และวันรับของกลับก่อนวันถึงบริษัท', async () => {
      await t.goto('admin1', '#/', 1440)
      await t.clickButton('รับงานใหม่')
      await t.fillInput('[role="dialog"] input[placeholder*="SC"]', 'TEST-C-PAST')
      await waitFor(() => t.ev(() => Boolean([...document.querySelectorAll('[role="dialog"] select')].find(s => [...s.options].some(o => o.value === 'tshirt')))), 'ตัวเลือกสินค้า')
      await t.ev(() => {
        const dlg = document.querySelector('[role="dialog"]')
        const inputs = [...dlg.querySelectorAll('input')]
        const setVal = (el, val) => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val)
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
        setVal(inputs.find(i => i.closest('label')?.textContent.includes('ชื่อลูกค้า')), 'ลูกค้าวันย้อนหลัง')
        const pSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'tshirt'))
        pSel.value = 'tshirt'; pSel.dispatchEvent(new Event('change', { bubbles: true }))
        setVal(inputs.find(i => i.closest('label')?.textContent.includes('จำนวน')), '5')
        setVal(inputs.find(i => i.type === 'date'), '2020-01-01')
        const rSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'cut_only'))
        rSel.value = 'cut_only'; rSel.dispatchEvent(new Event('change', { bubbles: true }))
        document.querySelectorAll('[role="dialog"] input[name="needs-sample"]')[2].click()
      })
      const pastWarned = await t.ev(() => document.body.innerText.includes('กำหนดส่งเป็นวันที่ผ่านมาแล้ว'))
      assert.equal(pastWarned, true)
      await t.clickButton(/^รับงาน$/, { exact: true, inside: '[role="dialog"]' })
      await waitFor(() => t.ev(() => document.body.innerText.includes('ส่งงาน TEST-C-PAST เข้าโรงงานแล้ว') || Boolean(document.querySelector('[role="dialog"] p[role="alert"]'))), 'ผลรับงานวันย้อนหลัง')
      const pastAccepted = await t.ev(() => document.body.innerText.includes('ส่งงาน TEST-C-PAST เข้าโรงงานแล้ว'))
      const pastId = await sql(stack, "select id from public.jobs where confirmation_no = 'TEST-C-PAST'").then(r => r.rows[0]?.id)

      await t.goto('admin1', `#/board?job=${pastId}`, 1440)
      await t.clickButton('ส่งออกบริษัทภายนอก')
      await t.ev(() => {
        const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent.includes('บริษัท ตัดเย็บจำลอง')))
        sel.value = [...sel.options].find(o => o.textContent.includes('บริษัท ตัดเย็บจำลอง')).value
        sel.dispatchEvent(new Event('change', { bubbles: true }))
        const dates = [...document.querySelectorAll('input[type="datetime-local"]')]
        const setD = (el, val) => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val)
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
        setD(dates[0], '2099-02-10T10:00')
        setD(dates[1], '2099-02-01T10:00')
      })
      await t.waitText('วันของถึงที่ต่อไป ต้องไม่ก่อนวันของถึงบริษัท')

      await t.goto('prod1', `#/board?job=${pastId}`, 1440)
      await t.clickButton('เริ่มตัดงาน'); await t.clickButton('ตัดงานเสร็จ'); await t.clickButton('ยืนยัน')
      await t.goto('qc', `#/board?job=${pastId}`, 1440)
      await t.clickButton('เริ่ม QC + Packing')
      await sql(stack, `update public.jobs set created_at = now() - interval '40 days' where id = $1`, [pastId])
      await t.goto('qc', `#/board?job=${pastId}`, 1440)
      await t.clickButton(/^[A-Z]\d+ /)
      await t.fillInput('#delay-report textarea', 'ทดสอบวันย้อนหลัง')
      await t.fillInput('#delay-report input[type="date"]', '2020-01-01')
      const delayBlocked = await t.ev(() => [...document.querySelectorAll('#delay-report button')].at(-1)?.disabled)
      assert.equal(delayBlocked, true)

      findings.push({ section: 'C2', pastDueDateWarned: pastWarned, pastDueDateAcceptedInIntake: pastAccepted, delayPastBlocked: delayBlocked })
      return `กำหนดส่งย้อนหลังในรับงาน=${pastAccepted ? 'เตือน+ถามยืนยันแล้วรับได้' : 'ห้าม'}, ส่งออกกลับก่อนถึง=ห้าม, delay ย้อนหลัง=ห้าม`
    })

    await check('C3', 'อัปโหลดไฟล์ผิดชนิด (.gif/.txt/ปลอม) / ไฟล์ 0 ไบต์ / ใหญ่เกิน 20 MB', async () => {
      const jid = await receiveBasic(t, stack, 'TEST-C-FILES', 'ลูกค้าไฟล์', 5, 'cut_only')
      await t.goto('admin1', `#/board?job=${jid}`, 1440)
      await waitFor(() => t.ev(() => Boolean(document.querySelector('input[type="file"][accept*="pdf"]'))), 'ช่องแนบ PDF ใบยืนยัน')

      // PDF ปลอม / txt ในช่อง PDF
      await t.uploadFiles('input[type="file"][accept*="pdf"]', [fixtures.paths.txt])
      await t.waitText(/ต้องเป็น.*PDF/i)
      await t.uploadFiles('input[type="file"][accept*="pdf"]', [fixtures.paths.fakePdf])
      await t.clickButton('แนบใบยืนยันที่ลูกค้าเซ็น')
      await t.waitText(/เนื้อไฟล์ไม่ใช่ PDF|ไม่ใช่ PDF/i)

      // รูป: gif / ปลอม / 0 byte / >20MB ในช่องรูปการ์ดงาน และในหน้าม็อคอัพ
      await t.uploadFiles('input[type="file"][accept^="image/jpeg"]', [fixtures.paths.gif])
      await t.waitText(/JPG \/ PNG \/ WEBP/)
      await t.uploadFiles('input[type="file"][accept^="image/jpeg"]', [fixtures.paths.hugeJpg])
      await t.waitText(/เกิน 20 MB/)

      await t.goto('admin1', `#/mockup?id=${jid}`, 1440)
      await t.clickButton('เริ่มทำม็อคอัพกำกับสเปก')
      await t.waitText('อัปโหลดภาพหลักก่อน')
      await t.uploadFiles('input[type="file"][accept*="png"]', [fixtures.paths.fakePng])
      await t.clickButton('ใช้เป็นภาพหลัก')
      await t.waitText(/เปิดไฟล์รูปนี้ไม่ได้|ไฟล์อาจเสีย/)
      await t.uploadFiles('input[type="file"][accept*="png"]', [fixtures.paths.emptyPng])
      await t.clickButton('ใช้เป็นภาพหลัก')
      await t.waitText(/เปิดไฟล์รูปนี้ไม่ได้|ไฟล์ว่างเปล่า/)
      await t.uploadFiles('input[type="file"][accept*="png"]', [fixtures.paths.hugeJpg])
      await t.waitText(/เกิน 20 MB/)
      return 'ไฟล์ผิดชนิด / ปลอม / 0 ไบต์ / เกิน 20 MB ถูกกันทั้งหมด'
    }, { allowErrorStatus: true })

    await check('C4', 'XSS (<script>/<img>), ชื่อยาวมาก, อีโมจิ และข้อความจาก Excel ในทุกจุดแสดงผลและพิมพ์', async () => {
      const xssJobId = await receiveBasic(t, stack, 'TEST-C-XSS', `${XSS} ${EMOJI_EXCEL}`, 5, 'cut_only')
      await t.goto('admin1', `#/mockup?id=${xssJobId}`, 1440)
      await t.clickButton('เริ่มทำม็อคอัพกำกับสเปก')
      await t.waitText('อัปโหลดภาพหลักก่อน')
      await t.uploadFiles('input[type="file"][accept*="png"]', [fixtures.paths.frontPng])
      await t.clickButton('ใช้เป็นภาพหลัก')
      await t.waitText('เพิ่มภาพหลักแล้ว')
      await waitFor(() => t.ev(() => {
        const img = document.querySelector('[data-testid="canvas-front"] img')
        if (!img?.complete || !img.naturalWidth) return false
        const r = img.getBoundingClientRect()
        img.dispatchEvent(new MouseEvent('click', { clientX: r.x + r.width * 0.5, clientY: r.y + r.height * 0.4, bubbles: true }))
        return true
      }), 'คลิกวางจุด C4')
      await t.fillInput('input[aria-label="ชื่อจุด"]', XSS)
      await t.fillInput('textarea[aria-label="ข้อความเพิ่มเติม"]', EMOJI_EXCEL)
      await t.clickButton('อนุมัติฉบับ 1 ใช้ผลิต')
      await t.waitText('ใช้ผลิต: ฉบับ 1')

      // พักงานด้วยข้อความ XSS
      await t.goto('prod1', `#/board?job=${xssJobId}`, 1440)
      await t.clickButton('พักงาน / ติดปัญหา')
      await t.fillInput('input[placeholder*="ผ้าไม่พอ"]', XSS)
      await t.clickButton('บันทึกพักงาน')

      for (const route of [`#/board`, `#/board?job=${xssJobId}`, `#/mockup?id=${xssJobId}`, `#/label?id=${xssJobId}`, `#/artwork?id=${xssJobId}`]) {
        await t.goto('admin1', route, 1440)
        await waitFor(() => t.ev(() => !document.body.innerText.includes('กำลังโหลด')), route)
        const xssTriggered = await t.ev(() => window.__xss !== undefined || document.querySelector('img[src="x"]') !== null)
        assert.equal(xssTriggered, false, `XSS triggered on ${route}`)
        const hasLiteral = await t.ev(payload => document.body.innerText.includes('<script>'), XSS)
        assert.equal(hasLiteral, true, `Literal XSS text missing on ${route}`)
        const m = await t.measureFloorUx(1440)
        assert.ok(m.docScrollWidth <= 1440, `Long text caused overflow on ${route}: ${m.docScrollWidth}`)
      }
      return 'XSS, อีโมจิ, ข้อความ Excel และชื่อยาวมากแสดงเป็นข้อความปลอดภัยไม่ล้นจอ'
    })

    await check('C5', 'ลืมกดบันทึกแล้วสลับแท็บตั้งค่า + กดอนุมัติทั้งที่ยังไม่พร้อม', async () => {
      await t.goto('owner', '#/settings', 1440)
      await t.clickButton('แก้ไข', { index: 0 })
      await t.ev(() => {
        const inp = [...document.querySelectorAll('input')].find(i => i.closest('label')?.textContent.includes('ชื่อสถานี'))
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, 'แก้แล้วยังไม่บันทึก')
        inp.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await t.clickButton('เวลาผลิต', { exact: true })
      await t.waitText('ละทิ้งการแก้ไขหรือไม่')
      await t.clickButton('แก้ไขต่อ')
      const stillEditing = await t.ev(() => document.body.innerText.includes('แก้แล้วยังไม่บันทึก') || [...document.querySelectorAll('input')].some(i => i.value === 'แก้แล้วยังไม่บันทึก'))
      assert.equal(stillEditing, true)

      // อนุมัติม็อคอัพทั้งที่ยังไม่มีภาพ/จุดไม่มีสเปก
      const noImgId = await receiveBasic(t, stack, 'TEST-C-UNREADY', 'ลูกค้าไม่พร้อม', 5, 'cut_only')
      await t.goto('admin1', `#/mockup?id=${noImgId}`, 1440)
      await t.clickButton('เริ่มทำม็อคอัพกำกับสเปก')
      await t.waitText('ยังอนุมัติไม่ได้: ยังไม่มีภาพหลัก')
      const approveDisabled = await t.ev(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('อนุมัติฉบับ'))?.disabled)
      assert.equal(approveDisabled, true)
      return 'เตือนลืมบันทึกในตั้งค่า + ล็อกปุ่มอนุมัติเมื่อยังไม่พร้อม'
    })

    assert.deepEqual(chrome.externalAttempts, [])
  } finally {
    await writeFile(SUMMARY_PATH, JSON.stringify({
      externalAttempts: chrome.externalAttempts,
      blockedFontRequests: chrome.blockedFontRequests.length,
      results,
      findings,
    }, null, 2))
    await fixtures.cleanup()
    await chrome.close()
    await stack.close()
  }
  if (results.some(r => !r.pass)) process.exitCode = 1
}

main()
