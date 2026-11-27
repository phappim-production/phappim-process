// ลายเซ็นลูกค้า: แอดมินตัดลายเซ็นจากรูปใบที่เซ็น → ฝ่ายผลิตเปิด "ดูใบยืนยัน" เห็นลายเซ็นในช่องลูกค้าของฉบับโรงงาน
import assert from 'node:assert/strict'
import { startLocalStack } from './server.mjs'
import { openChrome, waitFor } from './chrome.mjs'
import { createFixtures } from './fixtures.mjs'
import { createClient } from '../qa-suite/lib/client.mjs'

const stack = await startLocalStack()
const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
const tab = chrome.main
const t = chrome.wrap(tab)
const results = []
const step = async (id, fn) => {
  try { console.log(`PASS ${id} ${(await fn()) ?? ''}`); results.push(true) } catch (e) { console.log(`FAIL ${id} · ${e.message}`); results.push(false) }
}
const sql = async (query, params = []) => (await stack.db.execSuper(query, params)).rows
const drag = async (selector, from, to) => {
  const r = await tab.ev(sel => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height } }, selector)
  const at = p => ({ x: r.x + r.w * p[0], y: r.y + r.h * p[1] })
  const a = at(from), b = at(to)
  await tab.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 })
  for (let i = 1; i <= 5; i++) {
    await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + (b.x - a.x) * i / 5, y: a.y + (b.y - a.y) * i / 5, button: 'left', buttons: 1 })
  }
  await tab.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 })
}
const openView = async role => {
  await t.goto(role, `#/board?job=${jobId}`, 1440)
  await t.waitText('ดูใบยืนยัน (ฉบับล่าสุดในระบบ)')
  await tab.ev(() => { window.open = () => null })
  await t.clickButton('ดูใบยืนยัน (ฉบับล่าสุดในระบบ)')
  await waitFor(() => tab.ev(() => location.pathname.startsWith('/confirmation') && !!document.querySelector('#doc .sign')), 'เปิดใบยืนยันฉบับโรงงาน', 15000)
}

let jobId = null
try {
  const fixtures = await createFixtures(tab)
  await sql('update public.production_settings set materials_check = false')
  const draft = { app: 'phappim-confirm', v: 1, product: 'tshirt', h: { doc_no: 'SC-SIG-1', customer: 'ลูกค้าเซ็น', job_name: 'เสื้อทีม' }, p: { tshirt: {} }, imgs: [] }
  const client = createClient(stack)
  const saved = await client.rpc('admin1', 'save_confirmation_draft', { p_data: draft })
  assert.ok(saved.ok, JSON.stringify(saved.body))
  const got = await client.rpc('admin1', 'receive_job', {
    p_confirmation_no: 'SC-SIG-1', p_customer_name: 'ลูกค้าเซ็น', p_job_name: 'เสื้อทีม', p_product_type_code: 'tshirt',
    p_qty: 20, p_unit: 'ตัว', p_due_date: '2099-01-20', p_route_code: 'cut_only', p_confirmation_pdf_path: null,
    p_spare_qty: 0, p_confirmation_rev: 0, p_spec: draft, p_needs_sample: false,
  })
  assert.ok(got.ok, JSON.stringify(got.body))
  jobId = got.body

  await step('admin-sees-no-signature-yet', async () => {
    await t.goto('admin1', `#/board?job=${jobId}`, 1440)
    await t.waitText('ยังไม่มีลายเซ็นลูกค้าในใบฉบับโรงงาน')
  })

  await step('admin-crops-and-saves-signature', async () => {
    await t.clickButton('ตัดลายเซ็นลูกค้า', { exact: true })
    await t.waitText('ลากกรอบรอบลายเซ็น')
    await t.uploadFiles('input[type="file"][aria-label="เลือกรูปใบที่ลูกค้าเซ็น"]', [fixtures.paths.frontPng])
    await waitFor(() => tab.ev(() => { const i = document.querySelector('[data-crop-area] img'); return !!i?.complete && i.naturalWidth > 0 }), 'รูปใบที่เซ็นโหลด')
    const disabled = await tab.ev(() => [...document.querySelectorAll('button')].find(b => b.textContent.startsWith('บันทึกลายเซ็น'))?.disabled)
    assert.equal(disabled, true, 'ยังไม่ลากกรอบต้องกดบันทึกไม่ได้')
    await drag('[data-crop-area] img', [0.2, 0.6], [0.8, 0.9])
    await t.screenshot('signature-crop-dialog')
    await t.clickButton('บันทึกลายเซ็น', { exact: true })
    await t.waitText('บันทึกลายเซ็นลูกค้าแล้ว', 15000)
    const [row] = await sql('select customer_signature_path p, customer_signed_on::text d, customer_signature_rev r from public.jobs where id = $1', [jobId])
    assert.match(row.p, /^SC-SIG-1\/sig[0-9a-f]+\.png$/)
    assert.equal(row.r, 0)
    const stored = stack.r2Store.get(`mockups/${row.p}`)
    assert.ok(stored?.bytes?.length > 100, 'ไฟล์ลายเซ็นอยู่ใน R2')
    assert.deepEqual([...stored.bytes.slice(1, 4)].map(c => String.fromCharCode(c)).join(''), 'PNG')
    await waitFor(() => tab.ev(() => { const i = document.querySelector('img[alt="ลายเซ็นลูกค้า"]'); return !!i?.complete && i.naturalWidth > 0 }), 'รูปลายเซ็นในรายละเอียดงาน')
    return `${row.p} · ${stored.bytes.length} bytes`
  })

  await step('production-sees-signature-in-factory-copy', async () => {
    await openView('prod1')
    await waitFor(() => tab.ev(() => { const i = document.querySelector('#doc .sign .signed img'); return !!i?.complete && i.naturalWidth > 0 }), 'ลายเซ็นในช่องลูกค้า')
    const boxes = await tab.ev(() => [...document.querySelectorAll('#doc .sign > div .t')].map(e => e.textContent))
    assert.deepEqual(boxes, ['ลูกค้า', 'ผู้อนุมัติ', 'ผู้ควบคุมการผลิต'])
    await tab.ev(() => document.querySelector('#doc .sign').scrollIntoView({ block: 'center' }))
    await t.screenshot('signature-factory-copy')
  })

  await step('new-revision-says-not-signed', async () => {
    await sql('update public.jobs set confirmation_rev = 1 where id = $1', [jobId])
    await openView('prod1')
    assert.equal(await tab.ev(() => !!document.querySelector('#doc .sign .signed')), false)
    assert.match(await tab.ev(() => document.querySelector('#doc .sign').innerText), /ลูกค้าเซ็นใบครั้งที่ 0 · ใบนี้ \(ครั้งที่ 1\) ยังไม่ได้เซ็น/)
    await t.goto('admin1', `#/board?job=${jobId}`, 1440)
    await t.waitText('ลายเซ็นนี้เป็นของใบครั้งที่ 0')
  })

  await step('crop-dialog-fits-375', async () => {
    await t.goto('admin1', `#/board?job=${jobId}`, 375)
    await t.clickButton('เปลี่ยนลายเซ็นลูกค้า', { exact: true })
    await t.uploadFiles('input[type="file"][aria-label="เลือกรูปใบที่ลูกค้าเซ็น"]', [fixtures.paths.frontPng])
    await waitFor(() => tab.ev(() => { const i = document.querySelector('[data-crop-area] img'); return !!i?.complete && i.naturalWidth > 0 }), 'รูปโหลดบนมือถือ')
    const m = await t.measureFloorUx(375)
    assert.ok(m.docScrollWidth <= 376, `กว้างเกินจอ ${m.docScrollWidth}`)
    const right = await tab.ev(() => Math.max(...[...document.querySelectorAll('[data-crop-area], [data-crop-area] img')].map(e => e.getBoundingClientRect().right)))
    assert.ok(right <= 375, `รูปล้นขวา ${right}`)
    await t.screenshot('signature-crop-375')
  })

  await step('staff-cannot-see-edit-controls', async () => {
    await t.goto('staff_single', `#/board?job=${jobId}`, 375)
    await t.waitText('SC-SIG-1')
    assert.equal(await tab.ev(() => document.body.innerText.includes('ตัดลายเซ็นลูกค้า') || document.body.innerText.includes('เปลี่ยนลายเซ็นลูกค้า')), false)
  })

  await step('admin-removes-signature', async () => {
    await t.goto('admin1', `#/board?job=${jobId}`, 1440)
    await t.waitText('เปลี่ยนลายเซ็นลูกค้า')
    await tab.ev(() => { window.confirm = () => true })
    await t.clickButton('ลบลายเซ็น', { exact: true })
    await t.waitText('ลบลายเซ็นลูกค้าแล้ว')
    assert.equal((await sql('select customer_signature_path p from public.jobs where id = $1', [jobId]))[0].p, null)
  })

  await step('no-console-errors', async () => {
    const errs = (tab.logs ?? []).filter(l => !/favicon|fonts\.g/.test(`${l.text} ${l.url ?? ''}`))
    assert.deepEqual(errs, [])
  })
} finally {
  await chrome.close()
  await stack.close?.()
}
const passed = results.filter(Boolean).length
console.log(`qa-signature ${passed}/${results.length}`)
process.exit(passed === results.length ? 0 : 1)
