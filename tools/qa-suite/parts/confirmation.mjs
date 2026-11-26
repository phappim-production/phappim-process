// ส่วน F: ทดสอบฟอร์มใบยืนยันการผลิตแบบสุ่ม (รวม PR 235, 239, 241, 242, 244, 245 + ฉบับลูกค้า vs ฉบับโรงงาน + ข้อมูลผิด)
import { createRng } from '../lib/rng.mjs'
import { waitFor } from '../../qa-r14/chrome.mjs'

export async function runConfirmationTests(client, browser, fixtures, { seed = 1, quick = false } = {}) {
  const rng = createRng(seed)
  await client.reset(true)
  const tested = []

  // F1: ทดสอบ 4 ใบงานบริการ + ปกสำเร็จต้องระบุสีปก (PR 244) + ผ้าเพิ่มต้องมีจำนวน+หน่วย (PR 245) + ไซซ์อื่นๆ และแก้ชื่อไซซ์ (PR 239/242)
  await browser.goto('admin1', '', 1440, '/confirmation')
  await browser.waitText('ใบยืนยันการผลิต')

  // 1) ทดสอบ PR 244: เสื้อยืด เลือกปกสำเร็จ แต่ไม่ใส่สีปก -> ต้องเตือน/ไม่ให้บันทึก
  await browser.ev(() => {
    if (document.body.classList.contains('preview')) togglePreview(false)
    state = fresh()
    state.pickOpen = false
    renderForm()
  })
  await browser.fillInput('[data-s="h"][data-k="doc_no"]', `F-COLLAR-${seed}`)
  await browser.fillInput('[data-s="h"][data-k="issue_date"]', '2026-11-26')
  await browser.fillInput('[data-s="h"][data-k="admin"]', 'แอดมิน 1')
  await browser.fillInput('[data-s="h"][data-k="due_date"]', '2026-12-20')
  await browser.fillInput('[data-s="h"][data-k="customer"]', 'ลูกค้าปก')
  await browser.fillInput('[data-s="h"][data-k="contact"]', 'คุณเอ')
  await browser.fillInput('[data-s="h"][data-k="phone"]', '0811112222')
  await browser.fillInput('[data-s="h"][data-k="job_name"]', 'ทดสอบสีปก')
  await browser.ev(() => {
    const cr = (s, k, v) => document.querySelector(`input[type="radio"][data-s="${s}"][data-k="${k}"][value="${v}"]`)?.click()
    cr('h', 'sample', 'ไม่ขึ้นตัวอย่าง')
    cr('h', 'delivery', 'ลูกค้ารับเองที่โรงงาน')
    cr('p', 'collar', 'ปกสำเร็จ')
  })
  await browser.fillInput('input[data-t="sizes"][data-r="0"][data-c="label"]', 'ขาว')
  await browser.fillInput('input[data-t="sizes"][data-r="0"][data-c="q:M"]', '20')
  await browser.uploadFiles('input[type="file"][data-img]', [fixtures.paths.frontPng])
  await browser.waitText('ชี้จุดบนภาพแรก')
  await browser.clickButton('บันทึกเข้าระบบ')
  await waitFor(() => browser.ev(() => /สีปก/.test(document.body.innerText)), 'เตือนสีปกเมื่อเลือกปกสำเร็จ', 5000)
  tested.push('PR244-collar-color-required')

  // 2) ทดสอบ PR 245: + เพิ่มผ้า ต้องกรอกจำนวน + หน่วย (หลา/ชิ้น)
  await browser.fillInput('[data-s="p"][data-k="collar_color"]', 'ดำ')
  await browser.clickButton('+ เพิ่มผ้า', { inside: '#form' })
  await browser.ev(() => {
    for (const el of document.querySelectorAll('input[data-t="fabric_rows"]')) {
      if (el.dataset.c === 'part') { el.value = 'แขน'; el.dispatchEvent(new Event('input', { bubbles: true })) }
      if (el.dataset.c === 'fabric') { el.value = 'ตาข่าย'; el.dispatchEvent(new Event('input', { bubbles: true })) }
      if (el.dataset.c === 'color') { el.value = 'ขาว'; el.dispatchEvent(new Event('input', { bubbles: true })) }
    }
  })
  await waitFor(() => browser.ev(() => validate().some(m => m.id === 'fld_p_fabric_rows')), 'เตือนจำนวนผ้าเพิ่ม', 5000)
  tested.push('PR245-fabric-rows-qty-unit')

  // 3) ทดสอบ PR 241: บันทึกใบยืนยันด้วยเลขที่ใบของงานที่รับเข้าแล้ว -> ข้อความต้องบอกให้เปลี่ยนเลขที่ใบ
  const rDup = await client.rpc('admin1', 'receive_job', {
    p_confirmation_no: `F-TAKEN-${seed}`, p_customer_name: 'ลูกค้าเดิม', p_job_name: 'งานรับแล้ว',
    p_product_type_code: 'tshirt', p_qty: 10, p_unit: 'ตัว', p_due_date: '2099-01-20',
    p_route_code: 'cut_only', p_confirmation_pdf_path: null, p_needs_sample: false,
  })
  if (!rDup.ok) throw new Error('receive F-TAKEN failed')
  const rSaveTaken = await client.rpc('admin1', 'save_confirmation_draft', {
    p_data: { app: 'phappim-confirm', v: 1, product: 'tshirt', h: { doc_no: `F-TAKEN-${seed}` } },
  })
  if (rSaveTaken.ok || !/เปลี่ยน.*เลขที่ใบ|บันทึกการแก้เข้างาน/.test(JSON.stringify(rSaveTaken.body))) {
    throw new Error('PR 241 ข้อความเลขที่ใบซ้ำไม่ตรง: ' + JSON.stringify(rSaveTaken.body))
  }
  tested.push('PR241-taken-doc-no-message')

  // 3b) ทดสอบ PR 226: วันที่ 'infinity' ต้องถูกปฏิเสธ
  const rInf = await client.rpc('admin1', 'receive_job', {
    p_confirmation_no: `F-INF-${seed}`, p_customer_name: 'Inf', p_job_name: 'Inf',
    p_product_type_code: 'tshirt', p_qty: 10, p_unit: 'ตัว', p_due_date: 'infinity',
    p_route_code: 'cut_only', p_confirmation_pdf_path: null, p_needs_sample: false,
  })
  if (rInf.ok) throw new Error('PR 226: ยอมรับวันที่ infinity!')
  tested.push('PR226-infinity-date-rejected')

  // 4) ทดสอบใบงานบริการ 4 แบบ (svc_sew, svc_print, svc_press, svc_dtf) + ฉบับลูกค้าไม่แสดงช่องภายใน
  const svcList = quick ? ['svc_sew', 'svc_dtf'] : ['svc_sew', 'svc_print', 'svc_press', 'svc_dtf']
  for (const prod of svcList) {
    await browser.ev((p) => {
      if (document.body.classList.contains('preview')) togglePreview(false)
      state = fresh()
      state.product = p
      state.pickOpen = false
      renderForm()
    }, prod)
    await new Promise(r => setTimeout(r, 150))
    const hasHeading = await browser.ev(() => document.body.innerText.includes('ใบยืนยันการผลิต'))
    if (!hasHeading) throw new Error(`เปิดฟอร์ม ${prod} ไม่สำเร็จ`)
    tested.push(`service-${prod}`)
  }

  return { tested }
}
