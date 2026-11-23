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

const SHOTS = {
  'qc-now-768.png': async () => { await open('qc', '#/mine'); await page.waitText('SC69104') },
  'prod-now-768.png': async () => { await open('prod1', '#/queue'); await page.waitText('SC69101') },
  'admin-overview-768.png': async () => { await open('admin1', '#/'); await page.waitText('สถานีตอนนี้') },
  'r2-admin-intake-768.png': async () => {
    await open('admin1', '#/')
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
  'owner-settings-users.jpg': async () => { await open('owner', '#/users', { width: 428, height: 956, scale: 2 }); await page.waitText('แอดมิน 1 จำลอง') },
  'owner-settings-machines.jpg': async () => {
    await open('owner', '#/settings', { width: 428, height: 956, scale: 2 })
    await tab.ev(() => {
      const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => /จักร/.test(o.text)))
      const o = s && [...s.options].find(x => /จักร/.test(x.text))
      if (!s || !o) return
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value)
      s.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await page.waitText('ชนิดจักร')
  },
  'r2-station-panel-768.png': async () => {
    await open('prod1', '#/board', { station: 'print' })
    await page.clickButton(/ดูรายละเอียดงาน SC69101|SC69101/)
    await page.waitText('พิมพ์งานเสร็จ')
    await delay(800)
    await tab.ev(() => { const b = [...document.querySelectorAll('[role=dialog] button')].find(x => /พิมพ์งานเสร็จ/.test(x.textContent)); b?.scrollIntoView({ block: 'center' }) })
    await delay(300)
  },
  'r5-queue-doing-768.jpg': async () => { await open('prod1', '#/board', { width: 768, height: 1024, station: 'cut' }); await page.waitText('SC69106') },
  'r5-queue-waiting-768.jpg': async () => { await open('prod1', '#/board', { width: 768, height: 1024, station: 'print' }); await page.waitText('SC69102') },
}
const CLIP = { 'r5-queue-doing-768.jpg': 'section[aria-labelledby="q-working"]', 'r5-queue-waiting-768.jpg': 'section[aria-labelledby="q-waiting"]' }

try {
  for (const [file, setup] of Object.entries(SHOTS)) {
    if (only.length && !only.includes(file)) continue
    await setup()
    await shot(file, { clipSelector: CLIP[file] })
  }
  if (browser.externalAttempts.length) throw new Error('มีคำขอออกนอกเครื่อง: ' + browser.externalAttempts.join(', '))
} finally {
  await browser.close()
}
