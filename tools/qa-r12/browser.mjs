import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { openChrome, waitFor } from '../qa-r11/chrome.mjs'
import { dist, fixtureApi, jobIds, origin, roles, users, vendorName } from './api.mjs'

const widths = [375, 768, 1440]
const evidence = new URL('../../docs/qa/img/', import.meta.url)
const entry = (await readdir(join(dist, 'assets'))).find(name => /^index-.*\.js$/.test(name))
assert.ok(entry, 'ต้อง build แอปก่อน')
const bundle = await readFile(join(dist, 'assets', entry), 'utf8')
assert.ok(bundle.includes(origin) && bundle.includes('r12-loopback-fixture'), 'ต้อง build ด้วย URL loopback และ key จำลอง')
const api = fixtureApi()
api.server.listen(Number(new URL(origin).port), '127.0.0.1')
await once(api.server, 'listening')

function installFixture(loopback, people) {
  if (location.origin !== loopback) return
  const key = new URLSearchParams(location.search).get('qa-role')
  const user = people[key]
  const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
    btoa(JSON.stringify({ exp: 4_000_000_000, sub: user.id })).replace(/=+$/, '') + '.' + key
  localStorage.setItem('sb-127-auth-token', JSON.stringify({
    access_token: token, refresh_token: 'local-fixture', expires_at: 4_000_000_000,
    token_type: 'bearer', user: { ...user, aud: 'authenticated' },
  }))
  localStorage.removeItem('pp142.station')
  window.WebSocket = class FixtureSocket {
    constructor() {
      this.readyState = 0
      setTimeout(() => { this.readyState = 1; this.onopen?.(new Event('open')) }, 0)
    }
    send(message) {
      const [joinRef, ref, topic, event, payload] = JSON.parse(message)
      const changes = (payload?.config?.postgres_changes ?? []).map((filter, i) => ({ ...filter, id: i + 1 }))
      const data = JSON.stringify([joinRef, ref, topic, 'phx_reply', {
        status: 'ok', response: { postgres_changes: event === 'phx_join' ? changes : [] },
      }])
      setTimeout(() => this.onmessage?.(new MessageEvent('message', { data })), 0)
    }
    close() { this.readyState = 3 }
    addEventListener(event, listener) { this['on' + event] = listener }
    removeEventListener(event) { delete this['on' + event] }
  }
}

let browser
let serial = 0
let failures = 0
const focus = process.env.QA_FOCUS
const outsideText = 'สั่งผลิตข้างนอก'
try {
  browser = await openChrome()
  const { ev, send, logs } = browser
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: '(' + installFixture.toString() + ')(' + JSON.stringify(origin) + ',' + JSON.stringify(users) + ')',
  })
  const see = (text, selector = 'body') => waitFor(() => ev((selector, text) =>
    [...document.querySelectorAll(selector)].some(node => node.getClientRects().length && node.innerText.includes(text)),
  selector, text), text)
  const button = (text, selector = 'button', contains = false) => waitFor(() => ev((selector, text, contains) => {
    const node = [...document.querySelectorAll(selector)].find(item => !item.disabled && item.getClientRects().length &&
      (contains ? item.textContent.includes(text) : item.textContent.trim() === text))
    if (!node) return false
    node.scrollIntoView({ block: 'nearest' })
    node.click()
    return true
  }, selector, text, contains), 'ปุ่ม ' + text)
  const field = (label, value, tag = 'input') => waitFor(() => ev((label, value, tag) => {
    const node = [...document.querySelectorAll('label')].find(item => item.getClientRects().length &&
      item.firstChild?.textContent.trim().startsWith(label) && item.querySelector(tag))?.querySelector(tag)
    if (!node || node.disabled || tag === 'select' && ![...node.options].some(option => option.value === value)) return false
    const prototype = tag === 'select' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value)
    node.dispatchEvent(new Event(tag === 'select' ? 'change' : 'input', { bubbles: true }))
    return true
  }, label, value, tag), 'ช่อง ' + label + ' = ' + value)
  async function goto(role, hash, width) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 950, deviceScaleFactor: 1, mobile: false })
    const url = origin + '/?qa-role=' + role + '&case=' + ++serial
    await send('Page.navigate', { url: url + hash })
    await waitFor(() => ev(url => location.href.startsWith(url) && document.body.innerText.includes('ผู้ใช้จำลอง'), url), url + hash)
  }

  async function layout(width, selector = 'main') {
    const info = await ev(selector => {
      const surface = document.querySelector(selector) ?? document.querySelector('[data-scroll="dashboard"]') ?? document.body
      return {
        width: innerWidth, document: document.documentElement.scrollWidth, surface: surface.scrollWidth - surface.clientWidth,
        invalid: /\b(?:NaN|Infinity)\b|ส่วนนี้แสดงไม่ได้|โหลด[^。\n]*ไม่สำเร็จ/.test(surface.innerText),
      }
    }, selector)
    assert.equal(info.width, width)
    assert.ok(info.document <= width && info.surface <= 1 && !info.invalid, 'จอล้นหรือมีข้อความผิดปกติ ' + JSON.stringify(info))
  }
  async function shot(name, selector) {
    await ev(async selector => {
      if (selector) document.querySelector(selector)?.scrollIntoView({ block: 'center', behavior: 'instant' })
      const running = document.getAnimations().filter(animation =>
        animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime))
      await Promise.allSettled(running.map(animation => animation.finished))
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    }, selector)
    const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    await writeFile(new URL('r12-cx-' + name + '.png', evidence), Buffer.from(data, 'base64'))
  }

  async function check(name, fn) {
    if (focus && !name.startsWith(focus)) return
    const offset = logs.length
    try {
      await fn()
      const errors = logs.slice(offset).filter(log =>
        !(typeof log === 'object' && log.url?.startsWith('https://fonts.googleapis.com/')))
      assert.deepEqual(errors, [])
      console.log('PASS ' + name)
    } catch (error) {
      failures++
      console.error('FAIL ' + name + '\n' + error.stack)
      console.error('PAGE ' + (await ev(() => document.body.innerText)).slice(0, 2000))
    }
  }

  for (const width of widths) {
    await check('B1 รับงาน หมวก/หมอน ' + width, async () => {
      api.reset()
      await goto('admin', '#/board', width)
      await button('รับงานใหม่')
      await see('รับงานเข้าโรงงาน', '[role=dialog]')
      await field('เลขที่ใบยืนยัน', 'TEST-R12-INTAKE')
      await field('ชื่อลูกค้า', 'ลูกค้าจำลอง')
      await field('จำนวน', '10')
      await field('กำหนดส่ง', '2099-01-15')
      await field('เส้นทางผลิต', 'outside', 'select')
      await button('ไม่ขึ้นตัวอย่าง', 'label', true)
      for (const product of ['hat', 'pillow']) {
        await field('ประเภทสินค้า', product, 'select')
        await see('ลำดับสถานี: สั่งผลิตข้างนอก → QC + Packing', '[role=dialog]')
        await see('คาดว่าเสร็จ', '[role=dialog]')
        assert.equal(await ev(() => document.querySelector('[role=dialog] [role=alert]')?.textContent ?? ''), '')
      }
      await layout(width, '[role=dialog]')
      if (width === 375) await shot('intake-375')
      await button('รับงาน', '[role=dialog] button')
      await waitFor(() => api.calls.some(call => call.fn === 'receive_job'), 'รับงานจำลอง')
      const call = api.calls.find(item => item.fn === 'receive_job')
      assert.deepEqual([call.roleKey, call.args.p_route_code, call.args.p_product_type_code], ['admin', 'outside', 'pillow'])
    })

    for (const role of Object.keys(roles)) {
      await check('B2 บอร์ด ' + role + ' ' + width, async () => {
        api.reset()
        await goto(role, '#/board', width)
        await button('บอร์ด', '[role=tab]')
        await see('ทุกสถานี', 'nav[aria-label="เลือกสถานี"]')
        const rail = () => ev(() => [...document.querySelectorAll('nav[aria-label="เลือกสถานี"] button')].map(node =>
          [node.children[1]?.textContent, node.children[0]?.textContent, node.querySelector('b')?.textContent]))
        const exactNumbers = { พิมพ์: '1', รีด: '2', ตัด: '3', รีดฟิล์ม: '4', ส่งปัก: '5', เย็บ: '6', 'QC + Packing': '7' }
        const show = ['admin', 'owner', 'manager', 'production', 'phase1', 'outside'].includes(role)
        const checkRail = async expected => {
          const items = await rail()
          for (const [label, number] of items) if (Object.hasOwn(exactNumbers, label)) assert.equal(number, exactNumbers[label])
          assert.deepEqual(items.find(([label]) => label === outsideText), expected ? [outsideText, '', '2'] : undefined)
          if (['admin', 'owner', 'manager', 'production'].includes(role)) {
            assert.deepEqual(items.filter(([label]) => Object.hasOwn(exactNumbers, label)).map(([, number]) => number),
              ['1', '2', '3', '4', '5', '6', '7'])
          }
        }
        await checkRail(show)
        if (!show && ['multi', 'staffQc', 'unassigned', 'qc'].includes(role) && width === 768) {
          await button('ตัวกรองเพิ่มเติม', 'summary', true)
          await button('ทั้งโรงงาน', 'button')
          await see(outsideText, 'nav[aria-label="เลือกสถานี"]')
          await checkRail(true)
        }
        if (show) {
          await button(outsideText, 'nav[aria-label="เลือกสถานี"] button', true)
          await see('โรงงานนอกทำ · แอดมินส่งออกและรับเข้า', 'section[aria-label="สถานีสั่งผลิตข้างนอก"]')
        }
        await layout(width)
        if (role === 'production') await shot('station-' + width)
      })
    }

    await check('B3 รายละเอียดงานและส่งออก/รับกลับ ' + width, async () => {
      api.reset()
      for (const role of ['production', 'manager', 'outside', 'owner', 'admin']) {
        await goto(role, '#/board?job=' + jobIds.waiting, width)
        await see('TEST-R12-WAITING', '[role=dialog]')
        await waitFor(() => ev(() => !document.querySelector('[role=dialog]').innerText.includes('กำลังโหลด')), 'โหลดรายละเอียด')
        const info = await ev(() => [...document.querySelectorAll('[role=dialog] button')].map(node => node.textContent.trim()))
        assert.ok(!info.some(label => /^เริ่ม(?:$|ก่อนคิว|งาน)/.test(label)), JSON.stringify(info))
        assert.equal(info.includes('ส่งออกบริษัทภายนอก'), role === 'admin' || role === 'owner')
        if (['production', 'outside', 'owner'].includes(role)) await see('เริ่มที่โรงงานไม่ได้', '[role=dialog]')
        await layout(width, '[role=dialog]')
      }

      await button('ส่งออกบริษัทภายนอก', '[role=dialog] button')
      const groups = await ev(() => [...document.querySelectorAll('[role=dialog] optgroup')].map(group =>
        [group.label, [...group.querySelectorAll('option')].map(option => option.textContent)]))
      assert.deepEqual(groups, [['บริษัทที่รับ: สั่งผลิตข้างนอก', [vendorName]], ['บริษัทอื่น', ['บริษัทตัดจำลอง']]])
      const target = await ev(() => [...document.querySelectorAll('[role=dialog] select')].find(node => node.value === 'outside')?.disabled)
      assert.equal(target, true)
      if (width === 768) await shot('vendor-768', '[role=dialog] select:has(optgroup)')
      await button('บันทึกส่งออก', '[role=dialog] button')
      await see('อยู่ที่บริษัทภายนอก', '[role=dialog]')
      await see(vendorName, '[role=dialog]')
      await see('คาดว่าของถึงโรงงาน', '[role=dialog]')
      assert.equal(await ev(() => document.querySelector('[role=dialog]').innerText.includes('ส่งต่อบริษัทอื่น')), false)
      await layout(width, '[role=dialog]')
      if (width === 1440) await shot('out-1440')
      await button('ของถึงโรงงานแล้ว · รับเข้า', '[role=dialog] button')
      await see('งานจะไปรอที่ QC + Packing', '[role=dialog]')
      if (width === 375) await shot('return-375')
      await button('ยืนยันรับของ', '[role=dialog] button')
      await waitFor(() => api.jobs.find(job => job.id === jobIds.waiting).current_station === 'qc_pack', 'กลับ QC')
      await see('QC + Packing', '[role=dialog]')
      assert.deepEqual(api.calls.filter(item => ['send_out', 'receive_back'].includes(item.fn)).map(item => item.fn), ['send_out', 'receive_back'])
    })

    await check('B4 ภาพรวม คิวผลิต รายงาน ' + width, async () => {
      api.reset()
      await goto('admin', '#/', width)
      await see('สถานีตอนนี้', 'h2,h3')
      await see('งานที่ส่งออกข้างนอก 1 งาน', 'h2,h3')
      await see(vendorName)
      await layout(width)
      if (width === 375) await shot('overview-375')
      await button('วางแผนรับ')
      await see('งานค้างแต่ละสถานี', 'h2,h3')
      const load = await ev(() => [...document.querySelectorAll('h2,h3')].find(node => node.textContent === 'งานค้างแต่ละสถานี').closest('section').innerText)
      assert.doesNotMatch(load, /สั่งผลิตข้างนอก|NaN|Infinity/)
      await layout(width)
      await goto('production', '#/production-queue', width)
      await see('TEST-R12-WAITING')
      await see('TEST-R12-SENT')
      await layout(width)

      for (const scenario of ['standard', 'mixed']) {
        api.reset(scenario)
        await goto('admin', '#/reports', width)
        await see('เวลาเฉลี่ยต่อสถานี', 'h2,h3')
        await see('QC + Packing')
        const report = await ev(() => [...document.querySelectorAll('h2,h3')].find(node => node.textContent === 'เวลาเฉลี่ยต่อสถานี')
          .closest('section').innerText)
        assert.doesNotMatch(report, /สั่งผลิตข้างนอก|NaN|Infinity/)
        assert.match(report, scenario === 'standard' ? /รอคิว\s+—/ : /รอคิว\s+45 นาที/)
        await layout(width)
        if (scenario === 'standard' && width === 768) await shot('report-768')
      }
    })

    await check('B5 Station Assignment ' + width, async () => {
      api.reset()
      await goto('owner', '#/assign', width)
      await see('จับคู่พนักงานกับสถานี')
      await button('เลือกสถานี')
      await waitFor(() => ev(() => [...document.querySelectorAll('main label')].some(label =>
        label.innerText.includes('สั่งผลิตข้างนอก') && label.querySelector('input[type=checkbox]'))), 'ตัวเลือกสถานี outside')
      await layout(width)
      if (width === 768) await shot('assignment-768')
    })
  }
} finally {
  if (browser) await browser.close()
  await new Promise(resolve => api.server.close(resolve))
}
process.exitCode = failures ? 1 : 0
