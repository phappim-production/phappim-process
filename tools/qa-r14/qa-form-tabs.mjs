// ฟอร์มใบยืนยัน: ลิงก์รูปจากระบบหมดอายุแล้วขอใหม่จากแท็บระบบ · 2 แท็บใช้ฟอร์มพร้อมกันไม่ทับใบของกันตอนรีเฟรช
import assert from 'node:assert/strict'
import { startLocalStack } from './server.mjs'
import { openChrome, waitFor } from './chrome.mjs'
import { createFixtures } from './fixtures.mjs'

const NO = 'TEST-RELINK-1'
const stack = await startLocalStack()
const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
const tab = chrome.main
const t = chrome.wrap(tab)
const results = []
const step = async (id, fn) => {
  try { console.log(`PASS ${id} ${(await fn()) ?? ''}`); results.push(true) } catch (e) { console.log(`FAIL ${id} · ${e.message}`); results.push(false) }
}
const expireFirstImage = page => page.ev(() => {
  const u = new URL(state.imgs[0].src)
  u.searchParams.set('exp', String(Math.floor(Date.now() / 1000) - 60))
  state.imgs[0].src = u.toString()
  return staleLinks(0).length
})

try {
  const fixtures = await createFixtures(tab)

  await step('save-sheet-with-image', async () => {
    await t.goto('admin1', '', 1440, '/confirmation')
    await t.ev(() => { state = fresh(); state.pickOpen = false; renderForm(); window.open = () => null })
    await t.fillInput('[data-s="h"][data-k="doc_no"]', NO)
    await t.fillInput('[data-s="h"][data-k="issue_date"]', '2099-01-01')
    await t.fillInput('[data-s="h"][data-k="customer"]', 'ลูกค้าลิงก์รูป')
    await t.fillInput('input[data-t="sizes"][data-r="0"][data-c="q:M"]', '20')
    await t.uploadFiles('input[type="file"][data-img]', [fixtures.paths.frontPng])
    await waitFor(() => t.ev(() => state.imgs.length === 1 && shrunk.get(state.imgs[0].src) !== undefined), 'ย่อรูปเสร็จ')
    await t.clickButton('บันทึกเข้าระบบ', { exact: true })
    await waitFor(() => t.ev(() => Boolean(localStorage.getItem('pp142.confirmation.outbox'))), 'ฟอร์มส่งใบไปกล่องส่ง')
    await t.goto('admin1', '#/board?confirmation=save', 1440)
    await t.waitText(`บันทึกใบยืนยัน ${NO} เข้าระบบแล้ว`, 15000)
  })

  await step('reopen-sheet-in-form-with-system-image', async () => {
    await t.goto('admin1', '#/', 1440)
    await t.clickButton('รับงานใหม่')
    await waitFor(() => t.ev(no => [...document.querySelectorAll('[role="dialog"] select option')].some(o => o.textContent.includes(no)), NO), 'ใบร่างอยู่ในรายการ')
    await t.ev(no => {
      window.open = () => null
      const sel = [...document.querySelectorAll('[role="dialog"] select')].find(s => [...s.options].some(o => o.textContent.includes(no)))
      const opt = [...sel.options].find(o => o.textContent.includes(no))
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, opt.value)
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    }, NO)
    await t.clickButton('แก้ใบนี้ในฟอร์ม', { exact: true })
    await waitFor(() => t.ev(no => location.pathname === '/confirmation' && document.querySelector('[data-s="h"][data-k="doc_no"]')?.value === no, NO), 'ฟอร์มเปิดใบจากระบบ', 15000)
    const img = await t.ev(() => ({ path: state.imgs[0]?.path, http: /^https?:/.test(state.imgs[0]?.src ?? ''), exp: linkExp(state.imgs[0]?.src) }))
    assert.ok(img.path && img.http && img.exp > Date.now(), JSON.stringify(img))
    return img.path
  })

  const system = chrome.wrap(await chrome.newTab())
  await step('expired-link-refreshed-by-open-system-tab', async () => {
    await system.goto('admin1', '#/board', 1440)
    assert.equal(await expireFirstImage(t), 1)
    const ok = await t.ev(async () => linksReady())
    assert.equal(ok, true, 'แท็บระบบไม่ได้ส่งลิงก์ใหม่')
    const after = await t.ev(async () => {
      const src = state.imgs[0].src
      const loaded = await new Promise(res => { const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(0); i.src = src })
      return { stale: staleLinks(0).length, loaded, path: state.imgs[0].path }
    })
    assert.equal(after.stale, 0)
    assert.ok(after.loaded > 0, 'ลิงก์ใหม่เปิดรูปไม่ได้')
    return `รูปกว้าง ${after.loaded}px`
  })

  await step('second-form-tab-does-not-take-over-on-reload', async () => {
    await system.goto('admin1', '', 1440, '/confirmation')
    await system.ev(() => { state = fresh(); state.pickOpen = false; renderForm() })
    await system.fillInput('[data-s="h"][data-k="doc_no"]', 'TEST-TAB-B')
    await system.ev(() => flushSave())
    await t.waitText('ฟอร์มใบยืนยันเปิดอยู่อีกแท็บ')
    assert.equal(await t.ev(() => JSON.parse(localStorage.getItem('phappim-confirm-v1')).h.doc_no), 'TEST-TAB-B')
    await tab.send('Page.reload', {})
    await waitFor(() => t.ev(no => document.querySelector('[data-s="h"][data-k="doc_no"]')?.value === no, NO), 'รีเฟรชแล้วได้ใบเดิมของแท็บนี้')
  })

  await step('expired-link-without-system-tab-blocks-pdf', async () => {
    assert.equal(await expireFirstImage(t), 1)
    const before = tab.dialogs.length
    const ok = await t.ev(async () => linksReady())
    assert.equal(ok, false)
    const msg = tab.dialogs.slice(before).map(d => d.message).join(' | ')
    assert.match(msg, /รูปที่ 1 เป็นรูปจากระบบที่ลิงก์หมดอายุแล้ว/)
  })

  assert.deepEqual(chrome.externalAttempts, [])
  assert.deepEqual(tab.logs.filter(l => !/Failed to load resource/.test(l.text)), [])
} finally {
  await chrome.close()
  await stack.close()
}
console.log(`${results.filter(Boolean).length}/${results.length} ผ่าน`)
if (results.some(r => !r)) process.exitCode = 1
