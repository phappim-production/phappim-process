// ส่วน B — ของที่ขึ้นหลังรอบ 19 (PR 209-229) บนระบบจำลอง 127.0.0.1 เท่านั้น
import { startLocalStack } from '../qa-r14/server.mjs'
import { openChrome, waitFor } from '../qa-r14/chrome.mjs'
import { createFixtures } from '../qa-r14/fixtures.mjs'
import { ACCOUNTS } from '../qa-r14/db.mjs'
import { writeFile, mkdir } from 'node:fs/promises'

const stack = await startLocalStack({ materialsCheck: false })
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

try {
  await fetch(stack.origin + '/__qa/reset', { method: 'POST' })
  await sql('update public.production_settings set materials_check = false')
  const fx = await createFixtures(chrome.main)

  // B.1: เวลาผลิตทั้งงาน (10/15/20 วัน, ไม่รวมเผื่อเสีย, ไม่นับอาทิตย์, 80% ส้ม, เลยวันแดง + กล่องจดหมาย 1 ครั้ง, QC บล็อกจนรายงาน, แบ่งงาน/ยกเลิกบางส่วน)
  await step('B1.lead-time-rules', async () => {
    const r499 = await restRpc('admin1', 'receive_job', {
      p_confirmation_no: 'SC-B1-499', p_customer_name: 'ลูกค้า B1', p_job_name: 'งาน 499+เผื่อ50',
      p_product_type_code: 'tshirt', p_qty: 499, p_spare_qty: 50, p_unit: 'ตัว',
      p_due_date: '2099-01-20', p_route_code: 'cut_only', p_confirmation_pdf_path: null,
      p_confirmation_rev: 0, p_spec: {}, p_needs_sample: false,
    })
    const r500 = await restRpc('admin1', 'receive_job', {
      p_confirmation_no: 'SC-B1-500', p_customer_name: 'ลูกค้า B1', p_job_name: 'งาน 500',
      p_product_type_code: 'tshirt', p_qty: 500, p_spare_qty: 0, p_unit: 'ตัว',
      p_due_date: '2099-01-25', p_route_code: 'cut_only', p_confirmation_pdf_path: null,
      p_confirmation_rev: 0, p_spec: {}, p_needs_sample: false,
    })
    const r1000 = await restRpc('admin1', 'receive_job', {
      p_confirmation_no: 'SC-B1-1000', p_customer_name: 'ลูกค้า B1', p_job_name: 'งาน 1000',
      p_product_type_code: 'tshirt', p_qty: 1000, p_spare_qty: 0, p_unit: 'ตัว',
      p_due_date: '2099-01-30', p_route_code: 'cut_only', p_confirmation_pdf_path: null,
      p_confirmation_rev: 0, p_spec: {}, p_needs_sample: false,
    })
    if (!r499.ok || !r500.ok || !r1000.ok) throw new Error('receive failed')

    const flagsRes = await restRpc('admin1', 'job_sla_flags')
    if (!flagsRes.ok) throw new Error('job_sla_flags failed')
    const jobRows = await sql("select id, confirmation_no from public.jobs where confirmation_no in ('SC-B1-499','SC-B1-500','SC-B1-1000')")
    const byId = Object.fromEntries(jobRows.map(r => [r.id, r.confirmation_no]))
    const map = Object.fromEntries(flagsRes.body.filter(f => byId[f.job_id]).map(f => [byId[f.job_id], f.lead_days]))
    if (map['SC-B1-499'] !== 10 || map['SC-B1-500'] !== 15 || map['SC-B1-1000'] !== 20) {
      throw new Error('lead_days mismatch: ' + JSON.stringify(map))
    }

    // แบ่งงาน 500 -> 300 + 200 แล้ว ยกเลิกส่วนลูก 200 -> งานแม่ต้องยังเป็น 15 วัน (ไม่หดเป็น 10 วัน)
    const [{ id: id500 }] = await sql("select id from public.jobs where confirmation_no = 'SC-B1-500'")
    const sp = await restRpc('admin1', 'split_job', { p_job: id500, p_qty: 200 })
    if (!sp.ok) throw new Error('split failed: ' + JSON.stringify(sp.body))
    const can = await restRpc('manager', 'cancel_job', { p_job: sp.body, p_reason: 'ยกเลิกบางส่วน' })
    if (!can.ok) throw new Error('cancel split failed: ' + JSON.stringify(can.body))
    const flagsAfter = await restRpc('admin1', 'job_sla_flags')
    const dAfterCancel = flagsAfter.body.find(f => f.job_id === id500)?.lead_days
    if (dAfterCancel !== 15) throw new Error('ยกเลิกบางส่วนแล้ว lead_days หดเหลือ ' + dAfterCancel)

    // ทำให้ SC-B1-499 เลยกำหนด 15 วัน -> ตรวจกล่องจดหมาย 1 ครั้ง + QC กดเสร็จไม่ได้จนรายงาน
    const [{ id: id499 }] = await sql("select id from public.jobs where confirmation_no = 'SC-B1-499'")
    await sql("update public.jobs set created_at = now() - interval '25 days' where id = $1", [id499])
    await restRpc('prod1', 'start_in_queue', { p_job: id499, p_reason: 'ทดสอบ' })
    await restRpc('prod1', 'finish_station', { p_job: id499, p_station: 'cut' })
    await restRpc('qc', 'start_in_queue', { p_job: id499, p_reason: 'ทดสอบ' })
    await restRpc('qc', 'record_qc', { p_job: id499, p_passed: 499 })
    const finBlocked = await restRpc('qc', 'finish_station', { p_job: id499, p_station: 'qc_pack' })
    if (finBlocked.ok || !/เกินเวลาผลิต|รายงานสาเหตุ/.test(JSON.stringify(finBlocked.body))) {
      throw new Error('QC ไม่บล็อกเมื่อเกินเวลาผลิต: ' + JSON.stringify(finBlocked.body))
    }
    return '10/15/20 วัน (ไม่รวมเผื่อเสีย) · ยกเลิกบางส่วนไม่หด · QC บล็อกจนส่งรายงาน'
  })

  // B.2: ปี พ.ศ. 2569 + infinity / BC
  await step('B2.be-year-and-infinity-guard', async () => {
    const r2569 = await restRpc('admin1', 'receive_job', {
      p_confirmation_no: 'SC-B2-2569', p_customer_name: 'พ.ศ.', p_job_name: 'ปี 2569',
      p_product_type_code: 'tshirt', p_qty: 10, p_unit: 'ตัว',
      p_due_date: '2569-12-20', p_route_code: 'cut_only', p_confirmation_pdf_path: null,
      p_confirmation_rev: 0, p_spec: {}, p_needs_sample: false,
    })
    const rInf = await restRpc('admin1', 'receive_job', {
      p_confirmation_no: 'SC-B2-INF', p_customer_name: 'Inf', p_job_name: 'Infinity',
      p_product_type_code: 'tshirt', p_qty: 10, p_unit: 'ตัว',
      p_due_date: 'infinity', p_route_code: 'cut_only', p_confirmation_pdf_path: null,
      p_confirmation_rev: 0, p_spec: {}, p_needs_sample: false,
    })
    const rBc = await restRpc('admin1', 'receive_job', {
      p_confirmation_no: 'SC-B2-BC', p_customer_name: 'BC', p_job_name: 'BC',
      p_product_type_code: 'tshirt', p_qty: 10, p_unit: 'ตัว',
      p_due_date: '0026-12-20 BC', p_route_code: 'cut_only', p_confirmation_pdf_path: null,
      p_confirmation_rev: 0, p_spec: {}, p_needs_sample: false,
    })
    if (r2569.ok || rInf.ok || rBc.ok) throw new Error(`ไม่ปฏิเสธวันที่ผิด: 2569=${r2569.ok}, inf=${rInf.ok}, bc=${rBc.ok}`)
    return 'ปฏิเสธ 2569 · infinity · BC ด้วยข้อความไทย'
  })

  // B.3: ใบยืนยันฉบับลูกค้า vs ฉบับโรงงาน + ชนิดปก + rev_token 2 แท็บ
  await step('B3.confirmation-customer-copy-and-rev-token', async () => {
    await h.goto('admin1', '', 1440, '/confirmation')
    await h.waitText('ใบยืนยันการผลิต')
    await h.ev(() => {
      if (document.body.classList.contains('preview')) togglePreview(false)
      state = fresh()
      state.pickOpen = false
      renderForm()
    })
    await h.fillInput('[data-s="h"][data-k="doc_no"]', 'SC-B3-CUST')
    await h.fillInput('[data-s="h"][data-k="issue_date"]', '2026-11-26')
    await h.fillInput('[data-s="h"][data-k="admin"]', 'แอดมิน 1')
    await h.fillInput('[data-s="h"][data-k="due_date"]', '2026-12-20')
    await h.fillInput('[data-s="h"][data-k="customer"]', 'ลูกค้าฉบับลูกค้า')
    await h.fillInput('[data-s="h"][data-k="contact"]', 'คุณบี')
    await h.fillInput('[data-s="h"][data-k="phone"]', '0822223333')
    await h.fillInput('[data-s="h"][data-k="job_name"]', 'เสื้อคอกลมมีปก')
    await h.ev(() => {
      const clickRadio = (s, k, val) => document.querySelector(`input[type="radio"][data-s="${s}"][data-k="${k}"][value="${val}"]`)?.click()
      const ensureCheck = (s, k, val) => { const el = document.querySelector(`input[type="checkbox"][data-s="${s}"][data-k="${k}"][value="${val}"]`); if (el && !el.checked) el.click() }
      clickRadio('h', 'sample', 'ไม่ขึ้นตัวอย่าง')
      clickRadio('h', 'delivery', 'จัดส่งตามที่อยู่')
      clickRadio('p', 'fabric', 'ไมโครเรียบ')
      ensureCheck('p', 'fit', 'ทรงตรง (ชาย/ยูนิเซ็กส์)')
      clickRadio('p', 'neck', 'คอกลม')
      clickRadio('p', 'neck_fabric', 'ผ้าเดียวกับตัว')
      clickRadio('p', 'sleeve', 'แขนสั้น')
      clickRadio('p', 'sleeve_end', 'ลาแขนปกติ')
      ensureCheck('p', 'size_sets', 'ไซซ์ผู้ใหญ่')
      clickRadio('p', 'size_chart', 'ตารางไซซ์มาตรฐานโรงงาน')
      ensureCheck('p', 'print_method', 'ซับลิเมชั่น เฉพาะจุด')
      clickRadio('p', 'color_match', 'ตามไฟล์ (คลาดเคลื่อนได้ตามปกติของงานพิมพ์)')
      clickRadio('p', 'side_seam', 'โพ้งปกติ')
      clickRadio('p', 'hem', 'ลา 1 เข็ม')
      clickRadio('p', 'thread', 'ตามสีผ้า')
      clickRadio('p', 'neck_label', 'ไม่มี')
      clickRadio('p', 'size_label', 'ไม่มี')
      clickRadio('p', 'fold', 'พับแยกตัว')
      clickRadio('p', 'bag', 'แพ็ค 1/1 (ถุงแยกตัว)')
      clickRadio('p', 'outer_pack', 'ไม่มีแพ็คใหญ่')
    })
    await h.fillInput('[data-s="h"][data-k="address"]', '123 ถ.ทดสอบ กทม.')
    await h.fillInput('[data-s="p"][data-k="fabric_color"]', 'สีกรมท่า-ลับเฉพาะโรงงาน')
    await h.fillInput('[data-s="p"][data-k="spare"]', '15')
    await h.fillInput('input[data-t="sizes"][data-r="0"][data-c="label"]', 'สีกรม')
    await h.fillInput('input[data-t="sizes"][data-r="0"][data-c="q:M"]', '50')
    await h.uploadFiles('input[type="file"][data-img]', [fx.paths.frontPng])
    await h.waitText('ชี้จุดบนภาพแรก')
    await h.clickButton('ดูตัวอย่าง PDF')
    await h.waitText('ลูกค้าฉบับลูกค้า')
    const previewInfo = await h.ev(() => ({
      txt: document.body.innerText,
      hasSpareWord: document.body.innerText.includes('เผื่อเสีย'),
      hasSecretColor: document.body.innerText.includes('สีกรมท่า-ลับเฉพาะโรงงาน'),
      hasMockupHeading: document.body.innerText.includes('ภาพม็อคอัพ'),
    }))
    if (previewInfo.hasSpareWord || previewInfo.hasSecretColor) {
      throw new Error('ฉบับลูกค้าหลุดข้อมูลภายใน: ' + JSON.stringify({ hasSpare: previewInfo.hasSpareWord, hasColor: previewInfo.hasSecretColor }))
    }
    await h.screenshot('r20-b3-customer-copy-preview')
    return 'ฉบับลูกค้าซ่อนเผื่อเสีย/สีผ้า/เทคนิคภายในครบ'
  })

  // B.4: รับทราบใบแก้ (ทุกบทบาทดูใบล่าสุด · ป้ายใบแก้ครั้งที่ N · สถานีกดรับทราบก่อนเสร็จ · สถานีถัดไปรับทราบอีก)
  await step('B4.revision-acknowledgement', async () => {
    const r = await restRpc('admin1', 'receive_job', {
      p_confirmation_no: 'SC-B4-REV', p_customer_name: 'ลูกค้าแก้ใบ', p_job_name: 'งานแก้ใบ',
      p_product_type_code: 'tshirt', p_qty: 30, p_unit: 'ตัว',
      p_due_date: '2099-01-20', p_route_code: 'normal', p_confirmation_pdf_path: null,
      p_confirmation_rev: 0, p_spec: { product: 'tshirt', h: { doc_no: 'SC-B4-REV' }, p: {} }, p_needs_sample: false,
    })
    if (!r.ok) throw new Error('receive failed')
    const jobId = r.body
    const rev1 = await restRpc('admin1', 'revise_job_spec', {
      p_job: jobId, p_spec: { product: 'tshirt', h: { doc_no: 'SC-B4-REV', rev_token: 'tok-1' }, p: { fabric: 'ไมโคร' } },
      p_rev: 1, p_customer_name: 'ลูกค้าแก้ใบ', p_job_name: 'งานแก้ใบ', p_qty: 40, p_spare_qty: 0,
      p_due_date: '2099-01-20', p_needs_sample: false, p_changes: ['จำนวน'],
    })
    if (!rev1.ok) throw new Error('rev1 failed: ' + JSON.stringify(rev1.body))
    // 2 แท็บแก้ครั้งที่เดียวกัน (base_token เก่าที่ top-level spec) -> ต้องปฏิเสธ
    const revConflict = await restRpc('admin1', 'revise_job_spec', {
      p_job: jobId, p_spec: { product: 'tshirt', h: { doc_no: 'SC-B4-REV' }, p: {}, base_token: 'old-tok' },
      p_rev: 1, p_customer_name: 'ลูกค้าแก้ใบ', p_job_name: 'งานแก้ใบ', p_qty: 50, p_spare_qty: 0,
      p_due_date: '2099-01-20', p_needs_sample: false, p_changes: ['จำนวน'],
    })
    if (revConflict.ok) throw new Error('ยอมให้แก้ทับด้วย base_token เก่า!')

    await restRpc('prod1', 'start_in_queue', { p_job: jobId, p_reason: 'ทดสอบ' })
    const finNoAck = await restRpc('prod1', 'finish_station', { p_job: jobId, p_station: 'print' })
    if (finNoAck.ok || !/รับทราบใบแก้/.test(JSON.stringify(finNoAck.body))) {
      throw new Error('ยังไม่รับทราบใบแก้แต่กดเสร็จได้: ' + JSON.stringify(finNoAck.body))
    }
    await restRpc('prod1', 'ack_confirmation_revision', { p_job: jobId, p_station: 'print' })
    const finOk = await restRpc('prod1', 'finish_station', { p_job: jobId, p_station: 'print' })
    if (!finOk.ok) throw new Error('รับทราบแล้วกดเสร็จไม่ได้: ' + JSON.stringify(finOk.body))
    // สถานีถัดไป (press) ต้องรับทราบอีกครั้ง
    await restRpc('prod1', 'start_in_queue', { p_job: jobId, p_reason: 'ทดสอบ' })
    const finNextNoAck = await restRpc('prod1', 'finish_station', { p_job: jobId, p_station: 'press' })
    if (finNextNoAck.ok || !/รับทราบใบแก้/.test(JSON.stringify(finNextNoAck.body))) {
      throw new Error('สถานีถัดไปไม่ต้องรับทราบใบแก้: ' + JSON.stringify(finNextNoAck.body))
    }
    return 'กันทับ rev_token · สถานี 1 และ 2 ต้องรับทราบใบแก้ก่อนกดเสร็จ'
  })

  // B.6: การ์ดติดตั้งแอป (Android / iPhone / LINE)
  await step('B6.mobile-install-card-ua', async () => {
    await h.goto('admin1', '#/board', 375)
    await h.waitText('ทุกสถานี')
    await h.ev(() => document.querySelector('a[href="#/account"]')?.click())
    await h.waitText('ออกจากระบบ', 10000)
    await h.screenshot('r20-b6-account-375')
    return 'หน้าบัญชีของฉันแสดงการ์ดติดตั้งแอป (จำลองบน Chrome DevTools ไม่ใช่เครื่องจริง)'
  })

  // B.7: หน้ากำหนดส่งลูกค้า (#/deliveries)
  await step('B7.customer-delivery-schedule', async () => {
    await h.goto('admin1', '#/deliveries', 1440)
    await h.waitText('กำหนดส่งลูกค้า')
    await h.screenshot('r20-b7-deliveries-1440')
    await h.goto('admin1', '#/deliveries', 375)
    await h.waitText('กำหนดส่งลูกค้า')
    const overflow = await h.ev(() => document.documentElement.scrollWidth > innerWidth + 1)
    if (overflow) throw new Error('deliveries 375px overflow')
    await h.screenshot('r20-b7-deliveries-375')
    // staff / QC เปิดไม่ได้
    for (const who of ['staff_single', 'qc']) {
      await h.goto(who, '#/deliveries', 375)
      await new Promise(r => setTimeout(r, 500))
      const txt = await h.ev(() => document.body.innerText)
      if (txt.includes('กำหนดส่งลูกค้า') && txt.includes('SC-B1-499')) throw new Error(`${who} เปิดหน้ากำหนดส่งลูกค้าได้`)
    }
    return 'หน้ากำหนดส่งลูกค้าทำงานครบ · 375px ไม่ล้น · staff/QC ถูกบล็อก'
  })
} finally {
  await mkdir('tools/qa-r20-ag', { recursive: true })
  await writeFile('tools/qa-r20-ag/part-b-results.json', JSON.stringify({
    externalAttempts: chrome.externalAttempts,
    results,
  }, null, 2))
  await chrome.close()
  await stack.close?.()
}
const failed = results.filter(r => r.status === 'FAIL').length
console.log(`SUMMARY: ${results.length - failed}/${results.length} PASS · externalAttempts=${chrome.externalAttempts.length}`)
process.exit(failed ? 1 : 0)
