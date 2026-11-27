// แอปบนมือถือ: ปุ่มติดตั้ง (Android / iPhone / เปิดจากไอคอนแล้ว) · กันจอดับที่หน้าสถานี · ล็อกอินค้างหลังปิดเปิดแอป
import assert from 'node:assert/strict'
import { startLocalStack } from './server.mjs'
import { openChrome, waitFor } from './chrome.mjs'
import { ACCOUNT_BY_KEY, DEFAULT_PASSWORD } from './db.mjs'

const ANDROID = { userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' }
const IPHONE = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', platform: 'iPhone' }
const LINE_ANDROID = { userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A155F Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 Line/14.19.1/IAB', platform: 'Linux armv8l' }
const LINE_IPHONE = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.19.0', platform: 'iPhone' }
const WINDOWS = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', platform: 'Win32' }

// Chrome จริงอาจส่ง beforeinstallprompt เอง · กันไว้ให้ผลทดสอบไม่ขึ้นกับเครื่อง แล้วส่งของปลอมเองเมื่อต้องการ
const PAGE_FAKES = `(() => {
  window.addEventListener('beforeinstallprompt', e => { if (e.isTrusted) e.stopImmediatePropagation() }, true)
  window.__wl = { req: 0, rel: 0 }
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
    request: async () => { window.__wl.req += 1; return { release: async () => { window.__wl.rel += 1 } } },
  } })
  if (sessionStorage.getItem('qa-standalone') === '1') Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
})()`

const stack = await startLocalStack()
const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
const tab = chrome.main
const t = chrome.wrap(tab)
const results = []
const step = async (id, fn) => {
  try { console.log(`PASS ${id} ${(await fn()) ?? ''}`); results.push(true) } catch (e) { console.log(`FAIL ${id} · ${e.message}`); results.push(false) }
}
const device = async ({ userAgent, platform }, touch) => {
  await tab.send('Emulation.setUserAgentOverride', { userAgent, platform })
  await tab.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 })
}
const text = () => tab.ev(() => document.body.innerText.replace(/\s+/g, ' '))
const hasInstallCard = async () => (await text()).includes('ติดตั้งแอปบนเครื่องนี้')
const shotCard = async name => {
  await tab.ev(() => document.querySelector('[aria-labelledby="install-app"]')?.scrollIntoView({ block: 'center' }))
  await t.screenshot(name)
}

try {
  await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_FAKES })

  await step('android-prompt-button', async () => {
    await device(ANDROID, true)
    await t.goto('staff_single', '#/system', 412)
    await tab.ev(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true })
      e.prompt = async () => { window.__prompted = (window.__prompted ?? 0) + 1 }
      e.userChoice = Promise.resolve({ outcome: 'accepted' })
      window.dispatchEvent(e)
    })
    await shotCard('mobile-install-android')
    await t.clickButton('ติดตั้งแอป', { exact: true })
    await waitFor(() => tab.ev(() => window.__prompted === 1), 'เรียกหน้าต่างติดตั้งของ Chrome')
    await tab.ev(() => window.dispatchEvent(new Event('appinstalled')))
    await t.waitText('ติดตั้งแล้ว · ปิดหน้านี้ แล้วกดไอคอน PP142 บนหน้าจอหลัก')
    const right = await tab.ev(() => document.querySelector('[aria-labelledby="install-app"]')?.getBoundingClientRect().right ?? 0)
    assert.ok(right <= 412, 'การ์ดติดตั้งล้นจอ')
  })

  await step('android-no-prompt-shows-menu-steps', async () => {
    await t.goto('prod1', '#/system', 375)
    await t.waitText('กดเมนู ⋮ มุมขวาบนของ Chrome')
    assert.equal(await tab.ev(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'ติดตั้งแอป')), false)
  })

  await step('iphone-steps-burmese-for-staff', async () => {
    await device(IPHONE, true)
    await t.goto('staff_single', '#/system', 375)
    await tab.ev(() => localStorage.setItem('pp142-lang', 'my'))
    await t.goto('staff_single', '#/system', 375)
    await t.waitText('ဒီစာမျက်နှာကို Safari နဲ့ ဖွင့်ပါ')
    await t.waitText('เปิดหน้านี้ด้วย Safari')
    await t.waitText('Add to Home Screen')
    await shotCard('mobile-install-iphone-my')
    await tab.ev(() => localStorage.setItem('pp142-lang', 'th'))
  })

  await step('iphone-manager-thai-steps', async () => {
    await t.goto('manager', '#/system', 375)
    await t.waitText('เลื่อนลงแล้วกด เพิ่มไปยังหน้าจอโฮม')
  })

  await step('line-android-card-opens-chrome', async () => {
    await device(LINE_ANDROID, true)
    await t.goto('staff_single', '#/system', 375)
    await t.waitText('เปิดอยู่ใน LINE · ติดตั้งแอปไม่ได้ ให้เปิดในเบราว์เซอร์ก่อน')
    const href = await tab.ev(() => [...document.querySelectorAll('a')].find(a => a.textContent.trim() === 'เปิดใน Chrome')?.href ?? '')
    assert.match(href, /\?(.*&)?openExternalBrowser=1(&.*)?#\/system$/)
    assert.equal(await tab.ev(() => document.body.innerText.includes('กดเมนู ⋮ มุมขวาบนของ Chrome')), false, 'ใน LINE ไม่ควรขึ้นขั้นตอนเมนู Chrome')
    await shotCard('mobile-install-line-android')
  })

  await step('line-iphone-login-opens-safari-burmese', async () => {
    await device(LINE_IPHONE, true)
    await tab.ev(() => { localStorage.clear(); localStorage.setItem('pp142-lang', 'my') })
    await t.goto(null, '#/', 375)
    await t.waitText('Safari နဲ့ ဖွင့်မယ်')
    await t.waitText('เปิดใน Safari')
    const right = await tab.ev(() => document.querySelector('[role="note"]')?.getBoundingClientRect().right ?? 999)
    assert.ok(right <= 375, 'กล่องเปิดในเบราว์เซอร์ล้นจอ')
    await t.screenshot('mobile-login-line-iphone-my')
    await tab.ev(() => localStorage.setItem('pp142-lang', 'th'))
  })

  await step('external-param-removed-after-open', async () => {
    await device(ANDROID, true)
    await tab.send('Page.navigate', { url: `${stack.origin}/?openExternalBrowser=1#/` })
    await waitFor(() => tab.ev(() => document.readyState === 'complete' && !location.search.includes('openExternalBrowser')), 'เอาพารามิเตอร์ออกจากที่อยู่เว็บ')
    assert.equal(await tab.ev(() => document.querySelector('[role="note"]') === null), true, 'Chrome ปกติไม่ควรขึ้นกล่องเปิดในเบราว์เซอร์')
  })

  await step('opened-from-home-screen-hides-card', async () => {
    await device(IPHONE, true)
    await tab.ev(() => sessionStorage.setItem('qa-standalone', '1'))
    await t.goto('staff_single', '#/system', 375)
    await t.waitText('ออกจากระบบ')
    assert.equal(await hasInstallCard(), false)
    await tab.ev(() => sessionStorage.removeItem('qa-standalone'))
  })

  await step('desktop-without-prompt-hides-card', async () => {
    await device(WINDOWS, false)
    await t.goto('admin1', '#/system', 1440)
    await t.waitText('ออกจากระบบ')
    assert.equal(await hasInstallCard(), false)
  })

  await step('wake-lock-on-station-screen-only', async () => {
    await device(ANDROID, true)
    await t.goto('staff_single', '#/board', 412)
    await waitFor(() => tab.ev(() => window.__wl.req >= 1), 'ขอกันจอดับที่หน้าสถานี')
    await tab.ev(() => { location.hash = '#/system' })
    await waitFor(() => tab.ev(() => window.__wl.rel >= 1), 'ปล่อยกันจอดับเมื่อออกจากหน้าสถานี')
    await t.goto('qc', '#/mine', 412)
    await waitFor(() => tab.ev(() => window.__wl.req >= 1), 'QC ก็กันจอดับ')
    await t.goto('prod1', '#/board', 412)
    await t.waitText('ฝ่ายผลิต 1 จำลอง')
    assert.equal(await tab.ev(() => window.__wl.req), 0, 'ฝ่ายผลิตไม่ต้องกันจอดับ')
  })

  await step('confirmation-form-stays-inside-installed-app', async () => {
    await device(IPHONE, true)
    await t.goto('admin1', '#/', 412)
    await tab.ev(() => sessionStorage.setItem('qa-standalone', '1'))
    await t.goto('admin1', '', 412, '/confirmation')
    await t.waitText('กลับหน้าระบบ')
    await t.ev(() => { state = fresh(); state.pickOpen = false; renderForm() })
    await t.fillInput('[data-s="h"][data-k="doc_no"]', 'TEST-APP-1')
    await t.fillInput('[data-s="h"][data-k="issue_date"]', '2099-01-01')
    await t.fillInput('[data-s="h"][data-k="customer"]', 'ลูกค้าแอปจำลอง')
    await t.fillInput('input[data-t="sizes"][data-r="0"][data-c="q:M"]', '20')
    await t.clickButton('บันทึกเข้าระบบ', { exact: true })
    await waitFor(() => tab.ev(() => location.pathname === '/'), 'บันทึกแล้วกลับหน้าระบบในหน้าเดิม')
    await t.waitText('บันทึกใบยืนยัน TEST-APP-1 เข้าระบบแล้ว')
    await waitFor(() => tab.ev(() => { const a = [...document.querySelectorAll('a')].find(x => x.textContent.includes('ทำสินค้าถัดไป')); a?.click(); return !!a }), 'ลิงก์ทำสินค้าถัดไปในแอป')
    await waitFor(() => tab.ev(() => location.pathname === '/confirmation' && document.querySelector('[data-s="h"][data-k="doc_no"]')?.value === 'TEST-APP-2'
      && document.querySelector('[data-s="h"][data-k="customer"]')?.value === 'ลูกค้าแอปจำลอง'), 'ทำสินค้าถัดไปในแอป: เลขใบถัดไป + ลูกค้าเดิม')

    await t.goto('admin1', '#/', 412)
    await t.clickButton('รับงานใหม่')
    await waitFor(() => tab.ev(() => [...document.querySelectorAll('[role="dialog"] select option')].some(o => o.textContent.includes('TEST-APP-1'))), 'ใบร่างอยู่ในรายการ')
    await tab.ev(() => {
      const sel = [...document.querySelectorAll('[role="dialog"] select')].find(s => [...s.options].some(o => o.textContent.includes('TEST-APP-1')))
      const opt = [...sel.options].find(o => o.textContent.includes('TEST-APP-1'))
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, opt.value)
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await t.clickButton('แก้ใบนี้ในฟอร์ม', { exact: true })
    await waitFor(() => tab.ev(() => location.pathname === '/confirmation' && document.querySelector('[data-s="h"][data-k="doc_no"]')?.value === 'TEST-APP-1'), 'ฟอร์มเปิดในหน้าเดิมพร้อมใบจากระบบ')
    await t.clickButton('กลับหน้าระบบ')
    await waitFor(() => tab.ev(() => location.pathname === '/'), 'ปุ่มกลับหน้าระบบ')
    await tab.ev(() => sessionStorage.removeItem('qa-standalone'))
  })

  await step('login-stays-after-reopen', async () => {
    const account = ACCOUNT_BY_KEY.staff_single
    await t.goto('none', '#/', 412)
    await t.fillInput('input[name="email"]', account.email)
    await t.fillInput('input[name="password"]', DEFAULT_PASSWORD)
    await t.clickButton('เข้าสู่ระบบ', { exact: true })
    await t.waitText(account.name)
    const tokenKeys = await tab.ev(() => Object.keys(localStorage).filter(k => k.endsWith('-auth-token')))
    assert.equal(tokenKeys.length, 1, 'ต้องเก็บล็อกอินไว้ในเครื่อง')
    await t.goto(null, '#/board', 412)
    await t.waitText(account.name)
    assert.equal((await text()).includes('เข้าสู่ระบบพนักงาน'), false)
    return tokenKeys[0]
  })

  assert.deepEqual(chrome.externalAttempts, [])
  assert.deepEqual(tab.logs, [])
} finally {
  await chrome.close()
  await stack.close()
}
console.log(`${results.filter(Boolean).length}/${results.length} ผ่าน`)
if (results.some(r => !r)) process.exitCode = 1
