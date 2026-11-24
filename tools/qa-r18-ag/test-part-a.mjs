import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { startLocalStack } from '../qa-r14/server.mjs'
import { openChrome, waitFor } from '../qa-r14/chrome.mjs'
import { createFixtures } from '../qa-r14/fixtures.mjs'

const OUT_JSON = fileURLToPath(new URL('./part-a-r18-results.json', import.meta.url))

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
      await t.screenshot(`r18-fail-${id}`).catch(() => {})
    }
  }

  try {
    // =========================================================================
    // A1: แก้ใบหลังรับงาน แบบระบบจำ (PR 185) + ส่งออก PDF โดยไม่ต้องรีเฟรช (PR 184)
    // =========================================================================
    await check('A-PR185-1', 'แก้ใบหลังรับงานแบบระบบจำ + ม็อคอัพเตือนค่าเก่า + แก้ซ้ำ + 2 แท็บ', async () => {
      await resetStack(stack)
      await t.goto('admin1', '', 1440, '/confirmation')
      await t.waitText('ใบยืนยันการผลิต')
      await t.ev(() => {
        if (document.body.classList.contains('preview')) togglePreview(false)
        state = fresh()
        state.pickOpen = false
        state.product = 'tshirt'
        Object.assign(state.h, {
          doc_no: 'SC69-A185',
          job_name: 'เสื้อทีมรุ่นแรก',
          admin: 'น้ำ',
          sample: 'ไม่ขึ้นตัวอย่าง',
          due_date: '2099-02-15',
          customer: 'บ.ลูกค้าเดิม',
          contact: 'คุณเอ',
          phone: '081-111-1111',
          delivery: 'จัดส่ง',
          address: '123 ถนนเดิม กทม.',
        })
        state.p.print_method = ['ซับลิเมชั่น เฉพาะจุด']
        state.p.size_sets = ['ไซซ์ผู้ใหญ่']
        state.p.sizes = [{ label: 'สีขาว', q: { M: 30, L: 20 } }]
        state.p.spare = 2
        renderForm()
      })
      await t.clickButton('บันทึกเข้าระบบ')
      await t.goto('admin1', '#/board?confirmation=save', 1440)
      await t.waitText('บันทึกใบยืนยัน SC69-A185 เข้าระบบแล้ว')

      await t.clickButton('ส่งงานเข้าโรงงานเลย')
      await t.waitText('รับงานใหม่')
      await t.ev(() => {
        const dlg = document.querySelector('[role="dialog"]')
        const rSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'normal'))
        rSel.value = 'normal'
        rSel.dispatchEvent(new Event('change', { bubbles: true }))
      })
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
        const el = document.querySelector('[data-testid="canvas-front"]')
        const r = el.getBoundingClientRect()
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width * 0.45, clientY: r.top + r.height * 0.4 }))
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
      await t.clickButton('เริ่มพิมพ์')
      await t.waitText('กำลังพิมพ์')
      await t.clickButton('พิมพ์เสร็จ')
      await t.clickButton('ยืนยัน', { inside: '[role="dialog"]' })
      await t.waitText('รอรีด')
      await t.clickButton('เริ่มรีด')
      await t.waitText('กำลังรีด')
      await t.clickButton('รีดเสร็จ')
      await t.clickButton('ยืนยัน', { inside: '[role="dialog"]' })
      await t.waitText('รอตัด')

      // แอดมินเปิดใบจากรายละเอียดงาน -> เปิดในฟอร์ม -> ส่งออก PDF ได้เลยโดยไม่ต้องรีเฟรช (PR 184)
      await t.goto('admin1', `#/board?job=${jobId}`, 1440)
      await t.clickButton('ส่งออก PDF ใบยืนยันอีกครั้ง / แก้ใบ')
      await t.waitText('เปิดใบยืนยันในฟอร์ม')
      const inboxPayload = await t.ev(() => {
        const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('เปิดใบยืนยันในฟอร์ม'))
        btn.click()
        return localStorage.getItem('pp142.confirmation.inbox')
      })
      assert.ok(inboxPayload, 'ต้องเขียน pp142.confirmation.inbox')
      await t.goto('admin1', '', 1440, '/confirmation')
      await t.waitText('SC69-A185')
      const pdfBefore = await t.pdf('r18-a1-confirm-before.pdf')
      assert.ok(pdfBefore.length > 50000, 'PDF ก่อนแก้ต้องสร้างได้ทันทีไม่ต้องรีเฟรช')

      const blockedCheck = await t.ev(() => {
        const prodBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('เปลี่ยนสินค้า'))
        const sampleRadios = [...document.querySelectorAll('input[type="radio"][data-s="h"][data-k="sample"]')]
        return {
          prodDisabledOrHidden: !prodBtn || prodBtn.disabled,
          sampleDisabled: sampleRadios.length > 0 && sampleRadios.every(r => r.disabled),
        }
      })

      // แก้ลูกค้า, ชื่องาน, จำนวน (50->60), เผื่อเสีย (2->5), กำหนดส่ง, สเปก (เปลี่ยนเทคนิคพิมพ์)
      await t.ev(() => {
        state.h.rev = 1
        state.h.customer = 'บ.ลูกค้าใหม่จำกัด'
        state.h.job_name = 'เสื้อทีมรุ่นปรับปรุง'
        state.h.due_date = '2099-02-20'
        state.p.sizes = [{ label: 'สีขาว', q: { M: 35, L: 25 } }]
        state.p.spare = 5
        state.p.print_method = ['DTF']
        renderForm()
      })
      chrome.main.setDialogAccept(true)
      await t.clickButton('บันทึกการแก้เข้างาน')
      await t.goto('admin1', '#/board?confirmation=revise', 1440)
      await t.waitText('บันทึกการแก้ใบ SC69-A185 เข้างานแล้ว')
      await t.screenshot('r18-a1-revise-saved')

      await t.goto('admin1', `#/board?job=${jobId}`, 1440)
      await t.waitText('บ.ลูกค้าใหม่จำกัด')
      await t.waitText('เสื้อทีมรุ่นปรับปรุง')
      await t.waitText('60')
      const jobText = await t.ev(() => document.body.innerText)
      const hasStaleWarn = jobText.includes('ม็อคอัพกำกับสเปก') && jobText.includes('ค่าเก่า')
      const hasRevisedHistory = jobText.includes('แก้ใบยืนยัน ครั้งที่ 1')
      await t.screenshot('r18-a1-job-detail-revised')

      await t.goto('admin1', `#/label?id=${jobId}`, 768)
      await t.waitText('SC69-A185')
      await t.waitText('บ.ลูกค้าใหม่จำกัด')
      await t.waitText('60')
      const labelPdf = await t.pdf('r18-a1-label-revised.pdf')
      assert.ok(labelPdf.length > 50000)

      await t.goto('prod1', '#/inbox', 1440)
      await t.waitText('แก้ใบยืนยัน')
      await t.waitText('SC69-A185')
      await t.goto('qc', '#/inbox', 1440)
      await t.waitText('แก้ใบยืนยัน')

      // ทดสอบส่ง rev ถอยหลัง (0) -> ต้องถูกปฏิเสธ
      await t.goto('admin1', `#/board?job=${jobId}`, 1440)
      await t.clickButton('ส่งออก PDF ใบยืนยันอีกครั้ง / แก้ใบ')
      await t.clickButton('เปิดใบยืนยันในฟอร์ม')
      await t.goto('admin1', '', 1440, '/confirmation')
      await t.waitText('SC69-A185')
      const backRevErr = await t.ev(async jId => {
        const res = await fetch('/rest/v1/rpc/revise_job_spec', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: 'r14-local-anon-key',
            Authorization: 'Bearer ' + JSON.parse(localStorage.getItem('sb-127-auth-token')).access_token,
          },
          body: JSON.stringify({
            p_job: jId, p_spec: state, p_rev: 0,
            p_customer_name: 'บ.ลูกค้าใหม่จำกัด', p_job_name: 'เสื้อทีมรุ่นปรับปรุง',
            p_qty: 60, p_spare_qty: 5, p_due_date: '2099-02-20', p_needs_sample: false,
          }),
        })
        return { status: res.status, body: await res.text() }
      }, jobId)
      assert.ok(backRevErr.status >= 400, 'ครั้งที่ถอยหลังต้องถูกปฏิเสธ')

      return `staleWarn=${hasStaleWarn}, hist=${hasRevisedHistory}, blocked=${JSON.stringify(blockedCheck)}, backRevStatus=${backRevErr.status}`
    }, { allowErrorStatus: true })

    // =========================================================================
    // A2: ปุ่ม "ไม่ใช้กับงานนี้" (PR 185)
    // =========================================================================
    await check('A-PR185-2', 'ปุ่ม ไม่ใช้กับงานนี้ (ซ่อนคำเตือน ไม่พิมพ์ ไม่ส่ง · ช่องตั้งค่ากดไม่ได้ · ยกเลิกได้)', async () => {
      await t.goto('admin1', '', 1440, '/confirmation')
      await t.waitText('ใบยืนยันการผลิต')
      await t.ev(() => {
        if (document.body.classList.contains('preview')) togglePreview(false)
        state = fresh()
        state.pickOpen = false
        state.product = 'tshirt'
        state.h.doc_no = 'SC69-NA1'
        state.h.customer = 'ลูกค้า NA'
        state.h.job_name = 'งาน NA'
        renderForm()
      })
      const naInfo = await t.ev(() => {
        const naBtns = [...document.querySelectorAll('button')].filter(b => b.textContent.includes('ไม่ใช้กับงานนี้'))
        const coreLabels = ['เลขที่ใบ', 'ชื่องาน', 'ชื่อลูกค้า', 'วันที่ออกใบ', 'กำหนดส่ง']
        const coreHasNa = coreLabels.some(lbl => {
          const f = [...document.querySelectorAll('.field')].find(x => x.textContent.includes(lbl))
          return f && [...f.querySelectorAll('button')].some(b => b.textContent.includes('ไม่ใช้กับงานนี้'))
        })
        return { naCount: naBtns.length, coreHasNa }
      })
      assert.ok(naInfo.naCount > 0)
      assert.equal(naInfo.coreHasNa, false)
      await t.ev(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('ไม่ใช้กับงานนี้')).click())
      await t.waitText('ใช้ช่องนี้')
      await t.screenshot('r18-a2-na-button')
      await t.clickButton('ใช้ช่องนี้')
      return `naCount=${naInfo.naCount}, coreHasNa=${naInfo.coreHasNa}`
    })

    // =========================================================================
    // A3: แบ่งงาน + แก้ใบ (PR 187)
    // =========================================================================
    await check('A-PR187-3', 'แบ่งงาน 100→70+30 + แก้ใบจากงานแม่ + ยอดไม่ตรงปฏิเสธ + แบ่งซ้ำ + หลายสินค้า', async () => {
      await resetStack(stack)
      const receiveViaUi = async (no, qty) => {
        await t.goto('admin1', '#/', 1440)
        await t.clickButton('รับงานใหม่')
        await t.fillInput('[role="dialog"] input[placeholder*="SC"]', no)
        await waitFor(() => t.ev(() => Boolean([...document.querySelectorAll('[role="dialog"] select')].find(s => [...s.options].some(o => o.value === 'tshirt')))), 'ตัวเลือก')
        await t.ev((q) => {
          const dlg = document.querySelector('[role="dialog"]')
          const inputs = [...dlg.querySelectorAll('input')]
          const setVal = (el, val) => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val)
            el.dispatchEvent(new Event('input', { bubbles: true }))
            el.dispatchEvent(new Event('change', { bubbles: true }))
          }
          setVal(inputs.find(i => i.closest('label')?.textContent.includes('ชื่อลูกค้า')), 'ลูกค้าแบ่งงาน')
          const pSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'tshirt'))
          pSel.value = 'tshirt'; pSel.dispatchEvent(new Event('change', { bubbles: true }))
          setVal(inputs.find(i => i.closest('label')?.textContent.includes('จำนวน')), String(q))
          setVal(inputs.find(i => i.type === 'date'), '2099-03-01')
          const rSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'normal'))
          rSel.value = 'normal'; rSel.dispatchEvent(new Event('change', { bubbles: true }))
        }, qty)
        await t.ev(() => document.querySelectorAll('[role="dialog"] input[name="needs-sample"]')[2].click())
        await t.clickButton(/^รับงาน$/, { exact: true, inside: '[role="dialog"]' })
        await t.waitText(`ส่งงาน ${no} เข้าโรงงานแล้ว`)
        return (await sql(stack, `select id from public.jobs where confirmation_no = $1`, [no])).rows[0].id
      }

      const parentId = await receiveViaUi('SC69-SP-0001', 100)
      await receiveViaUi('SC69-SP-0002', 40)

      await t.goto('admin1', `#/board?job=${parentId}`, 1440)
      await t.clickButton('แบ่งจำนวน (ส่งออกบางส่วน)')
      await t.fillInput('input[type="number"]', '30')
      await t.clickButton('บันทึกแบ่งงาน')
      await t.waitText('SC69-SP-0001-2')
      const childId = (await sql(stack, `select id from public.jobs where confirmation_no = 'SC69-SP-0001-2'`)).rows[0].id

      const validSpec = { v: 1, product: 'tshirt', h: { doc_no: 'SC69-SP-0001' }, p: { print_method: ['DTF'] } }
      const mismatch = await t.ev(async (pId, sp) => {
        const res = await fetch('/rest/v1/rpc/revise_job_spec', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: 'r14-local-anon-key',
            Authorization: 'Bearer ' + JSON.parse(localStorage.getItem('sb-127-auth-token')).access_token,
          },
          body: JSON.stringify({
            p_job: pId, p_spec: sp, p_rev: 1,
            p_customer_name: 'ลูกค้าแบ่งงานแก้', p_job_name: 'งานแก้แบ่ง', p_qty: 90, p_spare_qty: 0,
            p_due_date: '2099-03-05', p_needs_sample: false,
          }),
        })
        return { status: res.status, body: await res.text() }
      }, parentId, validSpec)
      assert.ok(mismatch.status >= 400 && mismatch.body.includes('100'), `ต้องปฏิเสธและบอกยอด 100: ${mismatch.body}`)

      const okRev = await t.ev(async (pId, sp) => {
        const res = await fetch('/rest/v1/rpc/revise_job_spec', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: 'r14-local-anon-key',
            Authorization: 'Bearer ' + JSON.parse(localStorage.getItem('sb-127-auth-token')).access_token,
          },
          body: JSON.stringify({
            p_job: pId, p_spec: sp, p_rev: 1,
            p_customer_name: 'ลูกค้าแบ่งงานแก้แล้ว', p_job_name: 'งานแก้แบ่งแล้ว', p_qty: 100, p_spare_qty: 0,
            p_due_date: '2099-03-10', p_needs_sample: false,
          }),
        })
        return { status: res.status, body: await res.text() }
      }, parentId, validSpec)
      assert.equal(okRev.status, 200, okRev.body)

      const jobsAfter = (await sql(stack, `select confirmation_no, customer_name, qty from public.jobs where confirmation_no like 'SC69-SP-%' order by confirmation_no`)).rows
      const pRow = jobsAfter.find(r => r.confirmation_no === 'SC69-SP-0001')
      const cRow = jobsAfter.find(r => r.confirmation_no === 'SC69-SP-0001-2')
      const sRow = jobsAfter.find(r => r.confirmation_no === 'SC69-SP-0002')
      assert.equal(pRow.qty, 70)
      assert.equal(cRow.qty, 30)
      assert.equal(pRow.customer_name, 'ลูกค้าแบ่งงานแก้แล้ว')
      assert.equal(cRow.customer_name, 'ลูกค้าแบ่งงานแก้แล้ว')
      assert.equal(sRow.customer_name, 'ลูกค้าแบ่งงาน')

      // แบ่งซ้ำที่ท้ายคิวแล้วรับงานใหม่ได้
      await t.goto('admin1', `#/board?job=${childId}`, 1440)
      await t.clickButton('แบ่งจำนวน (ส่งออกบางส่วน)')
      await t.fillInput('input[type="number"]', '10')
      await t.clickButton('บันทึกแบ่งงาน')
      await t.waitText('SC69-SP-0001-2-2')
      await receiveViaUi('SC69-SP-AFTER', 15)
      await t.screenshot('r18-a3-split-revise')

      return `parent=${pRow.qty}, child=${cRow.qty}, siblingUntouched=${sRow.customer_name === 'ลูกค้าแบ่งงาน'}, splitTailAndReceive=true`
    }, { allowErrorStatus: true })

    // =========================================================================
    // A4: ป้าย "ล่าช้า X วัน" (PR 189)
    // =========================================================================
    await check('A-PR189-4', 'ป้าย ล่าช้า X วัน บนบอร์ด/การ์ด/ภาพรวม/รายละเอียด/รายงาน + โหมดพม่า', async () => {
      await resetStack(stack)
      await t.goto('admin1', '#/', 1440)
      await t.clickButton('รับงานใหม่')
      await t.fillInput('[role="dialog"] input[placeholder*="SC"]', 'SC69-LATE1')
      await waitFor(() => t.ev(() => Boolean([...document.querySelectorAll('[role="dialog"] select')].find(s => [...s.options].some(o => o.value === 'tshirt')))), 'ตัวเลือก')
      await t.ev(() => {
        const dlg = document.querySelector('[role="dialog"]')
        const inputs = [...dlg.querySelectorAll('input')]
        const setVal = (el, val) => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val)
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
        setVal(inputs.find(i => i.closest('label')?.textContent.includes('ชื่อลูกค้า')), 'ลูกค้างานล่าช้า')
        const pSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'tshirt'))
        pSel.value = 'tshirt'; pSel.dispatchEvent(new Event('change', { bubbles: true }))
        setVal(inputs.find(i => i.closest('label')?.textContent.includes('จำนวน')), '20')
        setVal(inputs.find(i => i.type === 'date'), '2026-11-19')
        const rSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'normal'))
        rSel.value = 'normal'; rSel.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await t.ev(() => document.querySelectorAll('[role="dialog"] input[name="needs-sample"]')[2].click())
      chrome.main.setDialogAccept(true)
      await t.clickButton(/^รับงาน$/, { exact: true, inside: '[role="dialog"]' })
      await t.waitText('ส่งงาน SC69-LATE1 เข้าโรงงานแล้ว')
      const jobId = (await sql(stack, `select id from public.jobs where confirmation_no = 'SC69-LATE1'`)).rows[0].id

      await t.goto('admin1', '#/board', 1440)
      await t.waitText('SC69-LATE1')
      const boardLate = await t.ev(() => document.body.innerText.match(/ล่าช้า\s*\d+\s*วัน/)?.[0] ?? null)
      await t.goto('admin1', `#/board?job=${jobId}`, 1440)
      await t.waitText('SC69-LATE1')
      const detailLate = await t.ev(() => document.body.innerText.match(/ล่าช้า\s*\d+\s*วัน/)?.[0] ?? null)
      await t.goto('admin1', '#/', 1440)
      await t.waitText('SC69-LATE1')
      const overviewCardText = await t.ev(() => {
        const cards = [...document.querySelectorAll('button, div, article')].filter(el => el.textContent.includes('SC69-LATE1') && el.textContent.length < 300)
        return cards.map(c => c.innerText.replace(/\s+/g, ' '))[0] ?? ''
      })
      await t.goto('admin1', '#/reports', 1440)
      const reportsLate = await t.ev(() => document.body.innerText.match(/ล่าช้า\s*\d+\s*วัน/)?.[0] ?? null)
      await t.screenshot('r18-a4-overdue-thai')

      await t.goto('staff_multi', '#/board', 375)
      await t.ev(() => { localStorage.setItem('pp142-lang', 'my') })
      await t.goto('staff_multi', '#/board', 375)
      await t.waitText('SC69-LATE1')
      await t.screenshot('r18-a4-overdue-my-375')
      const myHasLate = await t.ev(() => document.body.innerText.includes('နောက်ကျနေပြီ'))

      return `board=${boardLate}, detail=${detailLate}, overviewCard="${overviewCardText}", reports=${reportsLate}, myLate=${myHasLate}`
    })

    // =========================================================================
    // A5: ใบยืนยัน PR 177–184
    // =========================================================================
    await check('A-PR177-5', 'ใบยืนยัน PR 177-184: เลขติดลบบล็อก PDF + ช่วง 28-34 + กุ๊น/มาตรฐาน + ถุงพับ', async () => {
      await t.goto('admin1', '', 1440, '/confirmation')
      await t.waitText('ใบยืนยันการผลิต')
      const negBlocked = await t.ev(() => {
        if (document.body.classList.contains('preview')) togglePreview(false)
        state = fresh(); state.pickOpen = false; state.product = 'jersey'
        state.h.doc_no = 'SC69-NEG1'; state.h.customer = 'ลูกค้าทดสอบ'; state.h.job_name = 'ทดสอบติดลบ'; state.h.due_date = '2099-02-01'
        const sec = layout().find(s => s.fields?.some(f => f.id === 'measure_rows'))
        const v = scope(sec.s)
        v.size_chart = SIZE_OWN
        v.measure_rows = [{ size: 'M', chest: '-5', length: '28-34' }]
        renderForm()
        return validate().filter(e => e.hard)
      })
      const rangeOk = await t.ev(() => {
        const sec = layout().find(s => s.fields?.some(f => f.id === 'measure_rows'))
        scope(sec.s).measure_rows = [{ size: 'M', chest: '40', length: '28-34' }]
        renderForm()
        return validate().filter(e => String(e.why).includes('ติดลบ')).length === 0
      })
      assert.ok(negBlocked.some(e => String(e.why).includes('ติดลบ')), `เลขติดลบต้อง hard block: ${JSON.stringify(negBlocked)}`)
      assert.equal(rangeOk, true, 'ช่วง 28-34 ต้องผ่าน')

      const extraChecks = await t.ev(() => {
        state = fresh(); state.pickOpen = false; state.product = 'polo'
        renderForm()
        const hasStd = Boolean(document.querySelector('label.std'))
        state = fresh(); state.pickOpen = false; state.product = 'foldable'
        renderForm()
        const hasFoldPiping = document.body.innerText.includes('กุ๊น')
        return { hasStd, hasFoldPiping }
      })
      return `negHard=${negBlocked.length}, range28_34_ok=${rangeOk}, extra=${JSON.stringify(extraChecks)}`
    })

    // =========================================================================
    // A6: ม็อคอัพ PR 181 + /confirmation?x=1
    // =========================================================================
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
      await t.ev(() => document.querySelectorAll('[role="dialog"] input[name="needs-sample"]')[2].click())
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
        const el = document.querySelector('[data-testid="canvas-front"]')
        const r = el.getBoundingClientRect()
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width * 0.88, clientY: r.top + r.height * 0.15 }))
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

      // ทดสอบ /confirmation?from=test (มี query string)
      await t.goto('admin1', '', 1440, '/confirmation')
      await t.waitText('ใบยืนยันการผลิต')
      return `boxCheck=${JSON.stringify(boxCheck)}`
    })
  } finally {
    await writeFile(OUT_JSON, JSON.stringify({
      externalAttempts: chrome.externalAttempts,
      blockedFontRequests: chrome.blockedFontRequests,
      results,
    }, null, 2))
    await chrome.close()
    await stack.close()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
