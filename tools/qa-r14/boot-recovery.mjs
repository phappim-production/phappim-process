// แท็บที่ค้างไว้ตอนขึ้นรุ่นใหม่ โหลดไฟล์ของแอปไม่ได้ → ต้องไม่เป็นจอขาว: ล้างแคชแล้วโหลดใหม่เอง 1 ครั้ง · ยังไม่ได้ขึ้นปุ่มโหลดใหม่
import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { startLocalStack } from './server.mjs'
import { openChrome, waitFor } from './chrome.mjs'

const stack = await startLocalStack()
const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
const tab = chrome.main
const t = chrome.wrap(tab)
const results = []
const step = async (id, fn) => {
  try { console.log(`PASS ${id} ${(await fn()) ?? ''}`); results.push(true) } catch (e) { console.log(`FAIL ${id} · ${e.message}`); results.push(false) }
}
const BASE_BLOCK = ['https://*', 'http://localhost/*']
const block = urls => tab.send('Network.setBlockedURLs', { urls: [...BASE_BLOCK, ...urls] })
const screen = () => tab.ev(() => ({
  boot: !!document.getElementById('boot'),
  text: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 300),
  button: !!document.getElementById('boot-reload'),
  reloads: Number(sessionStorage.getItem('pp142-boot-recover')) || 0,
}))

try {
  const chunk = (await readdir(new URL('../../app/dist/assets/', import.meta.url))).find(f => /^react-.*\.js$/.test(f))
  assert.ok(chunk, 'ไม่พบไฟล์ react-*.js ใน dist (build ก่อน)')

  await step('normal-load', async () => {
    await t.goto('admin1', '#/', 1440)
    const s = await screen()
    assert.equal(s.boot, false, 'หน้าโหลดปกติต้องแทนที่ข้อความกำลังเปิดระบบ')
    assert.ok(s.text.length > 20, s.text)
    return s.text.slice(0, 60)
  })

  await step('missing-chunk-recovers-once-then-asks', async () => {
    await tab.ev(() => sessionStorage.removeItem('pp142-boot-recover'))
    await block([`*${chunk}`])
    await t.goto('admin1', '#/', 1440, '/', { wait: false })
    const s = await waitFor(async () => { const x = await screen().catch(() => null); return x?.button ? x : false }, 'ปุ่มโหลดใหม่หลังโหลดไฟล์ไม่ได้', 20000)
    assert.ok(s.reloads > 0, 'ต้องลองล้างแคชแล้วโหลดใหม่เองก่อน 1 ครั้ง')
    assert.match(s.text, /เปิดระบบไม่สำเร็จ/)
    assert.match(s.text, /ဖွင့်လို့ မရဘူး/)
    await t.screenshot('boot-recovery-failed')
    return s.text.slice(0, 80)
  })

  await step('button-recovers-after-files-are-back', async () => {
    await block([])
    await tab.ev(() => document.getElementById('boot-reload').click())
    await waitFor(async () => { const x = await screen().catch(() => null); return x && !x.boot && x.text.length > 20 }, 'แอปขึ้นหลังกดโหลดใหม่', 20000)
    return 'แอปกลับมาใช้ได้'
  })

  await step('missing-page-file-is-not-blank', async () => {
    const page = (await readdir(new URL('../../app/dist/assets/', import.meta.url))).find(f => /^Dashboard-.*\.js$/.test(f))
    await tab.ev(() => sessionStorage.clear())
    await block([`*${page}`])
    await t.goto('admin1', '#/board', 1440, '/', { wait: false })
    const s = await waitFor(async () => {
      const x = await screen().catch(() => null)
      return x && /กำลังโหลดระบบรุ่นใหม่|ส่วนนี้แสดงไม่ได้/.test(x.text) ? x : false
    }, 'ข้อความเมื่อไฟล์หน้าโหลดไม่ได้', 20000)
    await block([])
    return s.text.match(/กำลังโหลดระบบรุ่นใหม่|ส่วนนี้แสดงไม่ได้/)[0] + ' · เมนูยังอยู่'
  })

  await step('timeout-shows-way-out-without-clearing', async () => {
    await tab.ev(() => sessionStorage.removeItem('pp142-boot-recover'))
    const html = await (await fetch(stack.origin + '/')).text()
    assert.match(html, /setTimeout\(function \(\) \{ if \(!mounted\(\) && !failed\) showFailure\(true\) \}, 30000\)/)
    assert.match(html, /if \(slow\) location\.reload\(\); else recover\(true\)/)
    return 'เน็ตช้าเกิน 30 วิ แสดงปุ่มโหลดใหม่ · กดแล้วโหลดใหม่เฉยๆ ไม่ล้างแคช (ทดสอบละเอียดใน app/tests/bootGuard.test.mjs)'
  })
} finally {
  await chrome.close()
  await stack.close?.()
}
const failed = results.filter(r => !r).length
console.log(failed ? `ไม่ผ่าน ${failed}` : `ผ่านทั้งหมด ${results.length}`)
process.exit(failed ? 1 : 0)
