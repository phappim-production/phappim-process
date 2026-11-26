import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('pp142-boot-recover'))
const ORIGIN = 'https://pp142.pages.dev'

function boot({ storage = new Map(), brokenStorage = false } = {}) {
  const listeners = {}
  const timers = []
  const log = { reloads: 0, cleared: 0, unregistered: 0 }
  const box = { innerHTML: '', setAttribute() {} }
  const button = {}
  const document = { getElementById: id => (id === 'boot' ? box : id === 'boot-reload' ? button : null) }
  const sessionStorage = {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { if (brokenStorage) throw new Error('QuotaExceededError'); storage.set(k, String(v)) },
  }
  class ErrorEvent { constructor(filename) { this.filename = filename } }
  const window = { addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn) } }
  const navigator = { serviceWorker: { getRegistrations: async () => [{ unregister: async () => { log.unregistered++ } }] } }
  const caches = { keys: async () => ['app', 'fonts'], delete: async () => { log.cleared++ } }
  window.caches = caches
  const location = { origin: ORIGIN, reload: () => { log.reloads++ } }
  new Function('window', 'document', 'sessionStorage', 'navigator', 'caches', 'location', 'setTimeout', 'ErrorEvent', script)(
    window, document, sessionStorage, navigator, caches, location, (fn, ms) => timers.push({ fn, ms }), ErrorEvent)
  const settle = () => new Promise(r => setTimeout(r, 0))
  return {
    log, box, button, storage, timers, settle,
    fire: (type, ev) => (listeners[type] ?? []).forEach(fn => fn(ev)),
    scriptError: src => ({ target: { tagName: 'SCRIPT', src } }),
    jsError: filename => new ErrorEvent(filename),
  }
}

test('กันจอขาว: ไฟล์ของแอปหาย = ล้างแคชแล้วโหลดใหม่เอง 1 ครั้ง · ครั้งที่สองใน 1 นาทีให้คนกด', async () => {
  const first = boot()
  first.fire('error', first.scriptError(`${ORIGIN}/assets/index-old.js`))
  await first.settle()
  assert.deepEqual(first.log, { reloads: 1, cleared: 2, unregistered: 1 })
  const again = boot({ storage: first.storage })
  again.fire('error', again.scriptError(`${ORIGIN}/assets/index-old.js`))
  await again.settle()
  assert.equal(again.log.reloads, 0)
  assert.match(again.box.innerHTML, /เปิดระบบไม่สำเร็จ/)
})

test('กันจอขาว: จดไม่ได้ว่ากู้ไปแล้ว (ที่เก็บเขียนไม่ได้) ไม่โหลดใหม่เองวนไม่รู้จบ ให้คนกด', async () => {
  const b = boot({ brokenStorage: true })
  b.fire('error', b.scriptError(`${ORIGIN}/assets/index-old.js`))
  await b.settle()
  assert.equal(b.log.reloads, 0)
  assert.match(b.box.innerHTML, /โหลดใหม่/)
})

test('กันจอขาว: error จากส่วนขยายเบราว์เซอร์ / สคริปต์เว็บอื่น ไม่ล้างแคช', async () => {
  const b = boot()
  b.fire('error', b.jsError('chrome-extension://abc/content.js'))
  b.fire('error', b.scriptError('https://www.googletagmanager.com/gtag.js'))
  b.fire('error', b.jsError(''))
  await b.settle()
  assert.deepEqual(b.log, { reloads: 0, cleared: 0, unregistered: 0 })
  b.fire('error', b.jsError(`${ORIGIN}/assets/index-new.js`))
  await b.settle()
  assert.equal(b.log.reloads, 1)
})

test('กันจอขาว: เน็ตช้าเกิน 30 วิ ขึ้นปุ่ม · กดแล้วแค่โหลดใหม่ ไม่ลบไฟล์ที่เก็บไว้ใช้ตอนเน็ตหลุด', async () => {
  const b = boot()
  const slow = b.timers.find(t => t.ms === 30000)
  slow.fn()
  assert.match(b.box.innerHTML, /เปิดระบบไม่สำเร็จ/)
  b.button.onclick()
  await b.settle()
  assert.deepEqual(b.log, { reloads: 1, cleared: 0, unregistered: 0 })
})
