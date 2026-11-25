// จับภาพคู่มือใหม่จากระบบจำลองในเครื่อง (รัน seed.mjs ก่อน) · เขียนทับไฟล์เดิมใน docs/คู่มือ/img
// ใช้: build แบบ loopback ตาม tools/qa-r14/README.md แล้ว node tools/manual-shots/capture.mjs [ชื่อภาพ,...]
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { openChrome } from '../qa-r14/chrome.mjs'

const origin = process.env.QA_ORIGIN ?? 'http://127.0.0.1:5214'
const filesOrigin = process.env.QA_FILES_ORIGIN ?? 'http://127.0.0.1:5215'
const OUT = fileURLToPath(new URL('../../docs/คู่มือ/img/', import.meta.url))
const only = (process.argv[2] ?? '').split(',').filter(Boolean)

const browser = await openChrome({ origin, filesOrigin })
const tab = browser.main
const page = browser.wrap(tab)

async function open(role, hash, { width = 1024, height = 764, scale = 1, station } = {}) {
  await page.goto(role, hash, width)
  if (station) {
    await tab.ev(s => localStorage.setItem('pp142.station', s), station)
    await page.goto(null, hash, width, '/', { keepStation: true })
  }
  await tab.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: width <= 480 })
  await delay(900)
}

async function shot(file, { clipSelector, pad = 8 } = {}) {
  await tab.ev(async () => {
    await Promise.allSettled(document.getAnimations().map(a => a.finished).slice(0, 20))
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  })
  let clip
  if (clipSelector) {
    const r = await tab.ev(sel => {
      const el = document.querySelector(sel)
      if (!el) return null
      el.scrollIntoView({ block: 'start' })
      const b = el.getBoundingClientRect()
      return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height }
    }, clipSelector)
    if (!r) throw new Error('ไม่พบส่วนที่จะจับ ' + clipSelector)
    clip = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.width + pad * 2, height: r.height + pad * 2, scale: 1 }
  }
  const jpg = file.endsWith('.jpg')
  const { data } = await tab.send('Page.captureScreenshot', { format: jpg ? 'jpeg' : 'png', ...(jpg ? { quality: 82 } : {}), ...(clip ? { clip, captureBeyondViewport: true } : {}) })
  await writeFile(OUT + file, Buffer.from(data, 'base64'))
  console.log('จับแล้ว', file)
}

const jobId = async no => {
  const r = await (await fetch(origin + '/__qa/sql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql: 'select id from public.jobs where confirmation_no = $1', params: [no] }) })).json()
  if (!r.rows?.[0]) throw new Error('ไม่พบงาน ' + no + ' (รัน seed.mjs ก่อน)')
  return r.rows[0].id
}
const W = { width: 768, height: 1024 }
const PHONE = { width: 428, height: 956, scale: 2 }
async function openJob(role, no, size = W) {
  await open(role, `#/board?job=${encodeURIComponent(await jobId(no))}`, size)
  await page.waitText(no)
  await delay(600)
}
async function scrollToText(text, scope = '[role=dialog]') {
  const found = await tab.ev((t, sc) => {
    const root = document.querySelector(sc) ?? document.body
    const el = [...root.querySelectorAll('h2, h3, h4, b, p, span, button, summary')].find(e => e.textContent.trim().startsWith(t))
    el?.scrollIntoView({ block: 'start' })
    return !!el
  }, text, scope)
  if (!found) throw new Error('ไม่พบหัวข้อ ' + text)
  await delay(400)
}
const settingsTab = label => async () => {
  await open('owner', '#/settings', PHONE)
  await tab.ev(l => {
    const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.text.includes(l)))
    const o = s && [...s.options].find(x => x.text.includes(l))
    if (!s || !o) return
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value)
    s.dispatchEvent(new Event('change', { bubbles: true }))
  }, label)
  await delay(800)
}

const SHOTS = {
  'login-768.png': async () => {
    await open('owner', '#/', W)
    await tab.ev(() => { for (const k of Object.keys(localStorage)) if (k.includes('auth-token')) localStorage.removeItem(k) })
    await page.goto(null, '#/', 768)
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false })
    await page.waitText('รหัสผ่าน')
  },
  'qc-now-768.png': async () => { await open('qc', '#/mine', W); await page.waitText('SC69104') },
  'prod-now-768.png': async () => { await open('prod1', '#/queue', W); await page.waitText('SC69101') },
  'admin-overview-768.png': async () => { await open('admin1', '#/', W); await page.waitText('สถานีตอนนี้') },
  'admin-plan-768.png': async () => { await open('admin1', '#/', W); await page.clickButton('วางแผนรับ'); await delay(800) },
  'admin-search-768.png': async () => { await open('admin1', '#/jobs', W); await page.fillInput('input[placeholder^="พิมพ์เลขที่ใบยืนยัน"]', 'SC6910'); await delay(800) },
  'manager-overview-768.png': async () => { await open('manager', '#/', W); await page.waitText('SC69106') },
  'r2-reports-768.png': async () => { await open('manager', '#/reports', W); await delay(1500) },
  'inbox-768.png': async () => { await open('prod1', '#/inbox', W); await delay(1000) },
  'r5-account-768.jpg': async () => { await open('owner', '#/system', W); await page.waitText('ออกจากระบบ') },
  'r2-admin-intake-768.png': async () => {
    await open('admin1', '#/', W)
    await page.clickButton('รับงานใหม่')
    await page.waitText('ใบยืนยันที่บันทึกเข้าระบบแล้ว')
    const picked = async () => tab.ev(() => {
      const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.text.includes('SC69120')))
      const o = s && [...s.options].find(x => x.text.includes('SC69120'))
      if (!s || !o) return false
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value)
      s.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })
    for (let i = 0; i < 40 && !(await picked()); i++) await delay(200)
    await page.waitText('ร้านดอกไม้บานเย็น')
  },
  'owner-settings-users.jpg': async () => { await open('owner', '#/users', PHONE); await page.waitText('แอดมิน 1 จำลอง') },
  'owner-settings-stations.jpg': async () => { await open('owner', '#/settings', PHONE); await page.waitText('รูปยืนยันงานที่สถานี') },
  'owner-settings-segments.jpg': settingsTab('เวลามาตรฐาน'),
  'owner-settings-materials.jpg': settingsTab('วัตถุดิบ'),
  'owner-settings-reasons.jpg': settingsTab('สาเหตุ'),
  'owner-settings-machines.jpg': async () => { await settingsTab('จักร')(); await page.waitText('ชนิดจักร') },
  'owner-settings-notify.jpg': settingsTab('แจ้งเตือน'),
  'r10-station-rail-768.jpg': async () => { await open('prod1', '#/board', { ...W, station: 'print' }); await page.waitText('SC69101') },
  'r10-station-held-768.jpg': async () => { await open('prod1', '#/board', { ...W, station: 'cut' }); await page.waitText('SC69106') },
  'r7-board-768.jpg': async () => { await open('prod1', '#/board', { ...W, station: 'all' }); await page.waitText('SC69108') },
  'r5-queue-doing-768.jpg': async () => { await open('prod1', '#/board', { ...W, station: 'cut' }); await page.waitText('SC69106') },
  'r5-queue-waiting-768.jpg': async () => { await open('prod1', '#/board', { ...W, station: 'print' }); await page.waitText('SC69102') },
  'r7-resume-768.jpg': async () => { await open('manager', '#/board', { ...W, station: 'cut' }); await page.waitText('แก้แล้ว') },
  'r7-followup-768.jpg': async () => { await open('admin1', '#/', W); await page.waitText('รอผู้บริหารแก้'); await scrollToText('SC69106', 'main') },
  'r5-overview-stations-768.jpg': async () => { await open('admin1', '#/', W); await page.waitText('สถานีตอนนี้') },
  'r2-station-panel-768.png': async () => {
    await openJob('prod1', 'SC69101')
    await tab.ev(() => { const b = [...document.querySelectorAll('[role=dialog] button')].find(x => /พิมพ์งานเสร็จ/.test(x.textContent)); b?.scrollIntoView({ block: 'center' }) })
    await delay(300)
  },
  'r7-detail-mockup-768.jpg': async () => { await openJob('prod1', 'SC69101') },
  'detail-pdf-768.png': async () => { await openJob('admin1', 'SC69101'); await scrollToText('ดูใบยืนยัน') },
  'r2-label-qr-768.png': async () => { await open('admin1', `#/label?id=${encodeURIComponent(await jobId('SC69101'))}`, W); await page.waitText('SC69101'); await delay(800) },
  'r5-outsource-box-768.jpg': async () => { await openJob('admin1', 'SC69110'); await scrollToText('อยู่ที่บริษัท') },
  'r5-outsource-form-768.jpg': async () => {
    await openJob('admin1', 'SC69108')
    await page.clickButton(/ส่งออกบริษัทภายนอก/)
    await delay(600)
  },
  'detail-sample-station-768.png': async () => { await openJob('manager', 'SC69109'); await scrollToText('รอบตัวอย่าง') },
  'detail-timeline-768.png': async () => { await openJob('manager', 'SC69109'); await scrollToText('ไทม์ไลน์ทุกการกด') },
  'detail-correct-768.png': async () => { await openJob('prod1', 'SC69109'); await scrollToText('แจ้งว่ากดผิด:') },
  'prod-machines-768.png': async () => { await open('prod1', '#/sewing', W); await page.waitText('SC69111'); await scrollToText('สถานะจักรเย็บ', 'main') },
  'prod-schedule-768.png': async () => { await open('prod1', '#/sewing', W); await page.clickButton('ตารางจอง'); await page.waitText('ตารางจองรายวัน') },
  'r9-sewing-pick.jpg': async () => {
    await open('prod1', '#/sewing', PHONE)
    await page.clickButton(/เริ่มเย็บ/)
    await page.waitText('เริ่มเย็บด้วย')
  },
  'r9-manage-machines.jpg': async () => {
    await open('prod1', '#/sewing', PHONE)
    await page.clickButton('จัดการจักร')
    await delay(800)
  },
  'r19-first-piece-wait-375.jpg': async () => {
    await openJob('prod1', 'SC69113', { width: 375, height: 812, scale: 2 })
    await scrollToText('ชิ้นแรกรออนุมัติ')
  },
  'r19-first-piece-review-1280.jpg': async () => {
    await open('admin1', '#/', { width: 1280, height: 800 })
    await page.waitText('รออนุมัติชิ้นแรก')
    await page.clickButton(/SC69113.*ตรวจ/)
    await page.waitText('ผ่าน ทำทั้งล็อตได้', 12000)
  },
}
const CLIP = {
  'r5-queue-doing-768.jpg': 'section[aria-labelledby="q-working"]',
  'r5-queue-waiting-768.jpg': 'section[aria-labelledby="q-waiting"]',
  'r7-resume-768.jpg': 'section[aria-labelledby="q-working"]',
}

const failed = []
try {
  for (const [file, setup] of Object.entries(SHOTS)) {
    if (only.length && !only.includes(file)) continue
    try {
      await setup()
      await shot(file, { clipSelector: CLIP[file] })
    } catch (err) {
      failed.push(file + ': ' + err.message)
    }
  }
  if (failed.length) throw new Error(['จับไม่ได้ ' + failed.length + ' ภาพ', ...failed].join(' | '))
  if (browser.externalAttempts.length) throw new Error('มีคำขอออกนอกเครื่อง: ' + browser.externalAttempts.join(', '))
} finally {
  await browser.close()
}
