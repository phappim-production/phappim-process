import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixtureApi, dist, origin, roles, users, deliveryJob, mockupJob, formJob } from './api.mjs'
import { openChrome, waitFor } from './chrome.mjs'

const evidence = new URL('../../docs/qa/img/', import.meta.url)
const widths = [1440, 768, 375]
const focus = process.env.QA_FOCUS ? new RegExp(process.env.QA_FOCUS, 'u') : null
const assets = await readdir(join(dist, 'assets'))
const entry = assets.find(name => /^index-.*\.js$/.test(name))
assert.ok(entry, 'ต้อง build แอปก่อน')
const bundle = await readFile(join(dist, 'assets', entry), 'utf8')
assert.ok(bundle.includes(origin) && bundle.includes('r11-loopback-fixture'), 'ต้อง build แอปด้วย URL loopback และ key จำลอง')
await mkdir(evidence, { recursive: true })
const api = fixtureApi()
api.server.listen(5199, '127.0.0.1')
await once(api.server, 'listening')
let browser
let serial = 0
const results = []

function installFixture(loopback, fixtureUsers) {
  if (location.origin !== loopback) return
  const key = new URLSearchParams(location.search).get('qa-role')
  const user = fixtureUsers[key]
  if (user) {
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      btoa(JSON.stringify({ exp: 4_000_000_000, sub: user.id })).replace(/=+$/, '') + '.' + key
    localStorage.setItem('sb-127-auth-token', JSON.stringify({
      access_token: token, refresh_token: 'local-fixture', expires_at: 4_000_000_000, token_type: 'bearer',
      user: { ...user, aud: 'authenticated' },
    }))
    localStorage.removeItem('pp142.station')
  }
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

async function attach(tab) {
  await tab.send('Page.addScriptToEvaluateOnNewDocument', {
    source: '(' + installFixture.toString() + ')(' + JSON.stringify(origin) + ',' + JSON.stringify(users) + ')',
  })
  return tab
}

function tester(tab) {
  const { ev, send } = tab
  const waitText = (label, ms) => waitFor(() => ev(s => document.body.innerText.includes(s), label), label, ms)
  const select = (selector, value) => ev((sel, v) => {
    const node = document.querySelector(sel)
    if (!node) throw new Error('ไม่พบ ' + sel)
    node.value = v
    node.dispatchEvent(new Event('change', { bubbles: true }))
  }, selector, value)
  const input = (selector, value) => ev((sel, v) => {
    const node = document.querySelector(sel)
    if (!node) throw new Error('ไม่พบ ' + sel)
    node.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, v)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  }, selector, value)
  const button = (label, delay = 0) => waitFor(() => ev((text, ms) => {
    const el = [...document.querySelectorAll('button')].find(b =>
      b.getClientRects().length && !b.disabled && b.textContent.replace(/\s+/g, ' ').trim() === text)
    if (!el) return false
    el.scrollIntoView({ block: 'nearest' })
    if (ms) setTimeout(() => el.click(), ms)
    else el.click()
    return true
  }, label, delay), label)
  async function goto(role, hash, width = 1440, path = '/') {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 950, deviceScaleFactor: 1, mobile: false })
    const base = origin + path + '?qa-role=' + role + '&case=' + ++serial
    await send('Page.navigate', { url: base + hash })
    await waitFor(() => ev((href, form) => location.href.startsWith(href) &&
      (form ? !!document.querySelector('#form') : document.body.innerText.includes('ผู้ใช้จำลอง')), base, path === '/confirmation'), base)
  }
  async function layout(width) {
    const info = await ev(() => {
      const main = document.querySelector('main,[data-scroll="dashboard"]') ?? document.body
      return {
        width: innerWidth, document: document.documentElement.scrollWidth,
        main: main.scrollWidth - main.clientWidth,
        bad: /(?:^|\s)(?:NaN|Infinity)(?:\s|$)|ส่วนนี้แสดงไม่ได้|เกิดข้อผิดพลาด|โหลด[^。\n]*ไม่สำเร็จ/.test(main.innerText),
        heading: Boolean(main.querySelector('h1,h2,h3')),
        overflow: main.scrollWidth > main.clientWidth + 1
          ? [...main.querySelectorAll('*')].filter(el => !el.closest('.overflow-auto') && el.getBoundingClientRect().right > innerWidth + 1)
            .slice(0, 5).map(el => [el.tagName, Math.round(el.getBoundingClientRect().right), el.getAttribute('class')?.slice(0, 100)])
          : [],
      }
    })
    assert.equal(info.width, width)
    assert.ok(info.heading && !info.bad, JSON.stringify(info))
    assert.ok(info.document <= width && info.main <= 1, 'ล้น ' + JSON.stringify(info))
  }
  async function shot(name) {
    await send('Page.bringToFront')
    const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    await writeFile(new URL('r11-cx-' + name + '.png', evidence), Buffer.from(data, 'base64'))
  }
    async function key(selector, code, key) {
    await ev(sel => document.querySelector(sel).focus(), selector)
    const windowsVirtualKeyCode = code.charCodeAt(3)
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code, key, windowsVirtualKeyCode, modifiers: 2 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode, modifiers: 2 })
  }
return { ev, send, waitText, goto, layout, shot, button, input, select, key }
}

const pages = {
  owner: [
    ['admin', 'ภาพรวมระบบ'], ['users', 'ผู้ใช้งาน'], ['roles', 'Roles & Permissions'], ['assign', 'Station Assignment'],
    ['audit', 'Audit Log'], ['settings', 'ตั้งค่าระบบ'], ['production', 'ภาพรวมการผลิต'], ['board', 'หน้างานทั้งโรงงาน'], ['reports', 'ยังไม่มีงานที่เสร็จในช่วงนี้'], ['inbox', 'กล่องจดหมาย'],
  ],
  manager: [['', 'ภาพรวมการผลิต'], ['jobs', 'ดูงานในโรงงานทั้งหมด'], ['board', 'หน้างานทั้งโรงงาน'], ['reports', 'ยังไม่มีงานที่เสร็จในช่วงนี้'], ['reviews', 'ไม่มีรายงานรอรับทราบ'], ['inbox', 'กล่องจดหมาย']],
  admin: [['', 'ภาพรวมการผลิต'], ['jobs', 'ดูงานในโรงงานทั้งหมด'], ['production-queue', 'คิวการผลิต'], ['board', 'หน้างานทั้งโรงงาน'], ['reports', 'ยังไม่มีงานที่เสร็จในช่วงนี้'], ['inbox', 'กล่องจดหมาย']],
  production: [['dept', 'ภาพรวมแผนก'], ['queue', 'งานฝ่ายผลิต'], ['board', 'งานฝ่ายผลิต'], ['issues', 'ไม่มีงานติดปัญหา'], ['reports', 'ยังไม่มีงานที่เสร็จในช่วงนี้'], ['inbox', 'กล่องจดหมาย']],
  staff: [['mine', 'สถานี'], ['board', 'สถานี'], ['history', 'ยังไม่มีงานที่คุณกด'], ['report', 'แจ้งปัญหา'], ['inbox', 'กล่องจดหมาย']],
}
const emptyText = {
  admin: 'ยังไม่มีการแก้ตั้งค่า', users: 'ผู้ใช้งาน', roles: 'Roles & Permissions', assign: 'Station Assignment',
  audit: 'ไม่มีรายการในช่วงนี้', settings: 'ตั้งค่าระบบ', production: 'ไม่มีงานที่ต้องตาม', '': 'ไม่มีงานที่ต้องตาม',
  jobs: 'ดูงานในโรงงานทั้งหมด (0)', 'production-queue': 'ว่าง', board: /ไม่พบงาน|ไม่มีงาน|ยังไม่มี|0 งาน|ยังไม่ได้จับคู่สถานี/u,
  dept: 'ว่าง', queue: /ไม่พบงาน|ไม่มีงาน|ยังไม่มี|0 งาน|ว่าง/u, mine: /ไม่มีงาน|ยังไม่มี|0 งาน|ยังไม่ได้จับคู่สถานี/u,
  report: /ไม่มีงาน|ยังไม่ได้จับคู่สถานี/u, inbox: /ยังไม่มี|ไม่มีข้อความ/u,
}
const nameField = '[aria-label="ชื่อจุด"]'
const mockupHash = '#/mockup?id=' + mockupJob
const clean = value => value.replace(/\s+/g, ' ').trim()

try {
  browser = await attach(await openChrome())
  const t = tester(browser)
  async function record(label, test, otherTabs = [], accept = () => false) {
    if (focus && !focus.test(label)) return
    const tabs = [browser, ...otherTabs]
    const offsets = tabs.map(tab => tab.logs.length)
    try {
      const detail = await test()
      assert.deepEqual(tabs.flatMap((tab, i) => tab.logs.slice(offsets[i])).filter(entry => !accept(entry) && !entry.text?.startsWith("Blocked attempt to show a 'beforeunload' confirmation panel for a frame that never had a user gesture")), [], 'console error')
      results.push({ label, pass: true, detail })
      console.log('PASS ' + label + (detail ? ' ' + detail : ''))
    } catch (error) {
      const screen = await t.ev(() => ({ hash: location.hash, text: document.body.innerText.slice(-900) })).catch(() => null)
      const result = { label, pass: false, error: clean(error.message), screen }
      results.push(result)
      console.log('FAIL ' + JSON.stringify(result))
    }
  }

  for (const role of Object.keys(roles)) {
    if (role === 'qc') continue
    const list = pages[roles[role][0]]
    for (const width of widths) {
      await record('B1/B2/B6 ' + role + ' ' + width, async () => {
        api.reset()
        const failures = []
        for (const [hash, marker] of [...list, ['system', 'ผู้ใช้จำลอง ' + role]]) {
          try {
            await t.goto(role, '#/' + hash, width)
            await t.waitText(marker, 2000)
            const expected = emptyText[hash]
            if (expected) {
              const text = await waitFor(async () => {
                const body = await t.ev(() => (document.querySelector('main,[data-scroll="dashboard"]') ?? document.body).innerText)
                return (typeof expected === 'string' ? body.includes(expected) : expected.test(body)) && body
              }, String(expected), 2000)
              if (typeof expected === 'string') assert.ok(text.includes(expected), 'ไม่พบ ' + expected)
              else assert.match(text, expected)
            }
            if (width === 1440) {
              const menu = await t.ev(() => [...document.querySelectorAll('aside nav[aria-label="เมนูหลัก"] a')].map(a => a.getAttribute('href')))
              assert.deepEqual(menu, list.map(([route]) => '#/' + route))
            } else {
              const count = await t.ev(() => [...document.querySelectorAll('nav[aria-label="เมนูหลัก"]')].find(nav => nav.getClientRects().length).children.length)
              assert.ok(count <= 5)
            }
            await t.layout(width)
          } catch (error) { failures.push(hash + ' ' + error.message) }
        }
        assert.deepEqual(failures, [], 'หน้าที่ตรวจไม่ผ่าน')
        if (width === 1440 && ['owner', 'admin', 'unassigned'].includes(role)) {
          await t.goto(role, role === 'owner' ? '#/admin' : role === 'admin' ? '#/' : '#/mine', width)
          await t.waitText({ owner: 'ยังไม่มีการแก้ตั้งค่า', admin: 'ไม่มีงานที่ต้องตาม', unassigned: 'ยังไม่ได้จับคู่สถานี' }[role])
          await t.shot('empty-' + role)
        }
        return (list.length + 1) + ' หน้า'
      })
    }
  }

  for (const width of widths) {
    await record('B3/B6 จัดส่ง ' + width, async () => {
      api.reset('delivery')
      const hash = '#/board?job=' + deliveryJob
      await t.goto('production', hash, width)
      await t.waitText('แอดมินเป็นคนบันทึกเมื่อส่งให้ลูกค้า')
      assert.equal(await t.ev(() => [...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'จัดส่งให้ลูกค้าแล้ว')), false)
      await t.goto('admin', '#/', width)
      if (width >= 768) await t.waitText('รอจัดส่ง 1 งาน')
      await t.goto('admin', '#/board', width)
      await t.waitText('เสร็จ · รอส่ง')
      await t.goto('admin', hash, width)
      await t.waitText('เสร็จ · รอส่ง')
      await t.waitText('เลขพัสดุ / ผู้รับ / วิธีส่ง')
      await t.layout(width)
      await t.input('input[placeholder^="เช่น Kerry"]', 'R11-TRACK')
      await t.button('จัดส่งให้ลูกค้าแล้ว')
      assert.equal(api.calls.filter(c => c.fn === 'mark_delivered').length, 0)
      await t.button('ยืนยัน')
      await t.waitText('R11-TRACK')
      await t.waitText('จัดส่งแล้ว')
      await t.layout(width)
      if (width === 1440) await t.shot('delivery')
      await t.button('บันทึกผิด · ยกเลิกการจัดส่ง')
      await t.waitText('ใส่เหตุผลก่อนกดยืนยัน')
      await t.button('ยืนยัน')
      assert.equal(api.calls.filter(c => c.fn === 'undo_delivery').length, 0)
      await t.input('input[placeholder^="เช่น กดผิดงาน"]', 'กดผิดงานจำลอง')
      await t.button('ยืนยัน')
      await t.waitText('เสร็จ · รอส่ง')
      await t.waitText('ยกเลิกการบันทึกจัดส่ง')
      await t.goto('admin', '#/board', width)
      await t.waitText('เสร็จ · รอส่ง')
      assert.deepEqual(api.calls.filter(c => ['mark_delivered', 'undo_delivery'].includes(c.fn)).map(c => [c.fn, c.args]), [
        ['mark_delivered', { p_job: deliveryJob, p_note: 'R11-TRACK' }],
        ['undo_delivery', { p_job: deliveryJob, p_reason: 'กดผิดงานจำลอง' }],
      ])
    })
  }

  await record('BUG: B3 ภาพรวมมือถือไม่แสดงจำนวนรอจัดส่ง', async () => {
    api.reset('delivery')
    await t.goto('admin', '#/', 375)
    await t.waitText('เสร็จวันนี้')
    await t.shot('delivery-overview-375')
    assert.ok(await t.ev(() => document.body.innerText.includes('รอจัดส่ง 1 งาน')), 'จำนวนรอจัดส่งถูกซ่อนที่ 375 px')
  })

  async function editFirst(tab = t) {
    await tab.waitText('Callout (2)')
    await tab.ev(() => [...document.querySelectorAll('ol button')].find(b => b.textContent.includes('จุดหน้าอก')).click())
    await waitFor(() => tab.ev(s => document.querySelector(s)?.value, nameField), 'ช่องชื่อจุด')
  }

  await record('BUG: B4 คีย์ลัด Ctrl+Z/Y ไม่ทำงานเมื่อโฟกัสชื่อจุด', async () => {
    api.reset('draft')
    await t.goto('admin', mockupHash)
    await editFirst()
    await t.input(nameField, 'จุดหน้าอกใหม่')
    await t.waitText('จุดหน้าอกใหม่')
    assert.equal(await t.ev(() => document.querySelector('button[aria-label="ย้อนกลับ (Undo)"]').disabled), false)
    await t.ev(() => {
      window.r11Press = []
      window.addEventListener('keydown', e => {
        window.r11Press.push({ code: e.code, key: e.key, ctrl: e.ctrlKey, consumed: e.defaultPrevented,
          field: e.target.getAttribute?.('aria-label'), panel: Boolean(e.target.closest?.('[data-draft-undo]')) })
      })
    })
    await t.key(nameField, 'KeyZ', 'ผ')
    const afterUndo = await t.ev(s => ({ value: document.querySelector(s).value, keys: window.r11Press }), nameField)
    if (afterUndo.value !== 'จุดหน้าอก') await t.button('↶ ย้อน')
    assert.equal(await t.ev(s => document.querySelector(s).value, nameField), 'จุดหน้าอก', 'ปุ่มย้อนในแถบเครื่องมือต้องทำงาน')
    await t.key(nameField, 'KeyY', 'ั')
    const afterRedo = await t.ev(s => ({ value: document.querySelector(s).value, keys: window.r11Press }), nameField)
    assert.deepEqual([afterUndo.value, afterRedo.value], ['จุดหน้าอก', 'จุดหน้าอกใหม่'],
      JSON.stringify(afterRedo.keys))
  })

  for (const width of [1440, 1920]) {
    await record('B4/B6 ขนาดและรายการ ' + width, async () => {
      api.reset('draft')
      await t.goto('admin', mockupHash, width)
      await editFirst()
      await t.waitText('DTF · 8x8 ซม.')
      for (const [field, value] of [['กว้าง', 'abc'], ['สูง', '0']]) {
        const selector = 'input[aria-label="' + field + '"]'
        await t.input(selector, value)
        assert.equal(await t.ev(s => document.querySelector(s).getAttribute('aria-invalid'), selector), 'true')
      }
      await t.waitText('ใส่ตัวเลขมากกว่า 0')
      await t.layout(width)
      const maxOverflow = await t.ev(() => Math.max(...[...document.querySelectorAll('button')].filter(el =>
        el.textContent.includes('รายละเอียด'.repeat(4)) && el.getClientRects().length).map(el => el.scrollWidth - el.clientWidth)))
      assert.ok(Number.isFinite(maxOverflow) && maxOverflow <= 1, 'Callout ล้น ' + maxOverflow + ' px')
      if (width === 1440) {
        await t.ev(() => document.querySelector('[aria-label="กว้าง"]').scrollIntoView({ block: 'center' }))
        await t.shot('mockup-edit')
      }
    })
  }

  await record('B4 อนุมัติร่างที่ยังไม่บันทึกหลังยืนยัน', async () => {
    api.reset('blocked')
    await t.goto('admin', mockupHash)
    await t.waitText('ยังอนุมัติไม่ได้')
    assert.equal(await t.ev(() => [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'อนุมัติฉบับ 1 ใช้ผลิต')?.disabled), true)
    api.reset('draft')
    await t.goto('admin', mockupHash)
    await editFirst()
    await t.input(nameField, 'ชื่อใหม่ก่อนอนุมัติ')
    await t.button('อนุมัติฉบับ 1 ใช้ผลิต', 50)
    await waitFor(() => t.send('Page.handleJavaScriptDialog', { accept: false }).then(() => true), 'กล่องยืนยัน')
    assert.equal(api.calls.filter(c => /^(save_mockup_draft|approve_mockup_sheet)$/.test(c.fn)).length, 0)
    await t.button('อนุมัติฉบับ 1 ใช้ผลิต', 50)
    await waitFor(() => t.send('Page.handleJavaScriptDialog', { accept: true }).then(() => true), 'กล่องยืนยัน')
    await t.waitText('ใช้ผลิต: ฉบับ 1')
    const calls = api.calls.filter(c => /^(save_mockup_draft|approve_mockup_sheet)$/.test(c.fn))
    assert.deepEqual(calls.map(c => [c.fn, c.args.p_version]), [['save_mockup_draft', 1], ['approve_mockup_sheet', 2]])
    assert.equal(calls[0].args.p_data.callouts[0].title, 'ชื่อใหม่ก่อนอนุมัติ')
  })

  const second = await attach(await browser.newTab())
  const other = tester(second)
  await record('B4 แก้ 2 แท็บ · ได้ข้อความขัดแย้งทันที', async () => {
    api.reset('draft')
    await t.goto('admin', mockupHash)
    await editFirst()
    await other.goto('admin', mockupHash)
    await editFirst(other)
    await t.input(nameField, 'ชื่อจากแท็บแรก')
    await t.button('บันทึกร่าง')
    await waitFor(() => api.draft.callouts[0].title === 'ชื่อจากแท็บแรก', 'แท็บแรกบันทึก')
    await other.input(nameField, 'ชื่อที่เก่าจากแท็บสอง')
    const at = Date.now()
    await other.button('บันทึกร่าง')
    await other.waitText('มีคนบันทึกฉบับใหม่กว่าแล้ว กดโหลดใหม่ก่อน')
    const elapsed = Date.now() - at
    assert.ok(elapsed < 2000, 'ข้อความขัดแย้งช้า ' + elapsed + ' ms')
    assert.equal(api.draft.callouts[0].title, 'ชื่อจากแท็บแรก')
    assert.deepEqual(api.calls.filter(c => c.fn === 'save_mockup_draft').map(c => c.args.p_version), [1, 1])
    await other.shot('conflict')
    return elapsed + ' ms'
  }, [second], entry => entry.url === origin + '/rest/v1/rpc/save_mockup_draft' && entry.text.includes('400'))

  for (const [role, links] of [['qc', ['qc_pack']], ['staffQc', ['qc_pack']], ['cut', ['cut']], ['multi', ['print', 'press', 'cut']]]) {
    for (const width of widths) {
      await record((width === 375 ? 'BUG: ' : '') + 'B4/B6 สถานีม็อคอัพ ' + role + ' ' + width, async () => {
        api.reset('approved')
        await t.goto(role, mockupHash, width)
        await t.waitText('ดูเฉพาะสถานี')
        const data = await t.ev(() => {
          const field = [...document.querySelectorAll('select')].find(s => s.parentElement.innerText.includes('ดูเฉพาะสถานี'))
          return { options: [...field.options].map(o => o.value), disabled: field.disabled }
        })
        assert.deepEqual(data, { options: links, disabled: links.length === 1 })
        if (role === 'staffQc' && width === 768) {
          await t.button('รับทราบสเปกฉบับ 1 · สถานีQC + Packing')
          await t.waitText('รับทราบสเปกฉบับ 1 แล้ว')
          assert.equal(api.calls.find(c => c.fn === 'ack_mockup_sheet').args.p_station, 'qc_pack')
        }
        if (role === 'staffQc' && width === 375) await t.shot('mockup-staff-qc-375')
        await t.layout(width)
      })
    }
  }

  for (const width of widths) {
    await record('B6 ร่างม็อคอัพ ' + width, async () => {
      api.reset('draft')
      await t.goto('admin', mockupHash, width)
      await t.waitText('Callout (2)')
      if (width === 375) await t.waitText('มือถือดูได้อย่างเดียว')
      else await editFirst()
      await t.layout(width)
    })
  }

  await record('B5/B6 ใบยืนยัน → ตัวอย่าง PDF → รับงาน → ร่างม็อคอัพ', async () => {
    api.reset()
    await t.goto('admin', '#/board')
    await t.ev(async () => {
      const response = await fetch('/fixture-shirt.svg')
      const img = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(await response.text())
      localStorage.setItem('phappim-confirm-v1', JSON.stringify({
        h: { doc_no: 'TEST-R11-FORM', customer: 'ลูกค้าจำลอง', job_name: 'เสื้อจำลอง', due_date: '2099-01-06', sample: 'ไม่ขึ้นตัวอย่าง' },
        product: 'tshirt', p: { tshirt: { size_sets: ['ไซซ์ผู้ใหญ่'], sizes: [{ q: { M: '10' } }] } }, imgs: [{ src: img }],
      }))
    })
    const form = tester(second)
    for (const width of [375, 768, 1440]) {
      await form.goto('admin', '', width, '/confirmation')
      await form.waitText('ชี้จุดบนภาพแรก')
      await form.layout(width)
    }
    for (const [i, name] of ['จุดหน้าอกจำลอง', 'จุดชายเสื้อจำลอง'].entries()) {
      await waitFor(() => form.ev(index => {
        const img = document.querySelector('[data-co-img]')
        if (!img?.complete || !img.naturalWidth) return false
        const r = img.getBoundingClientRect()
        img.dispatchEvent(new MouseEvent('click', { clientX: r.x + r.width * (0.4 + index * 0.25), clientY: r.y + r.height * (0.35 + index * 0.35), bubbles: true }))
        return true
      }, i), 'เพิ่มจุดในภาพ')
      await form.input('[data-co="' + i + '"][data-cf="title"]', name)
      await form.input('[data-co="' + i + '"][data-cf="body"]', 'รายละเอียดทดสอบ ' + (i + 1))
    }
    await form.button('ดูตัวอย่าง PDF')
    const preview = await form.ev(() => ({
      visible: !!document.querySelector('#doc .co-stage')?.getClientRects().length,
      lines: document.querySelectorAll('#doc .co-stage line').length,
      boxes: [...document.querySelectorAll('#doc .co-box b')].map(el => el.textContent),
      text: document.querySelector('#doc .co-stage')?.innerText,
    }))
    assert.equal(preview.visible, true)
    assert.equal(preview.lines, 2)
    assert.deepEqual(preview.boxes, ['1', '2'])
    assert.match(preview.text, /จุดหน้าอกจำลอง[\s\S]*จุดชายเสื้อจำลอง/u)
    await form.ev(() => document.querySelector('#doc .co-stage').scrollIntoView({ block: 'center' }))
    await form.shot('confirmation-preview')
    await form.button('กลับไปแก้ไข')
    await form.ev(() => { window.open = () => null })
    await form.button('บันทึกเข้าระบบ')
    await form.waitText('ส่งใบ TEST-R11-FORM แล้ว')
    const outboxLink = await form.ev(() => document.querySelector('#toast a')?.getAttribute('href'))
    assert.equal(outboxLink, '/#/board?confirmation=save')
    await t.goto('admin', outboxLink.slice(1))
    await waitFor(() => api.confirmation[0]?.data.callouts.length === 2, 'บันทึกใบยืนยัน')
    await t.button('รับงานใหม่')
    await waitFor(() => t.ev(() => [...document.querySelectorAll('select option')].find(o => o.textContent.includes('TEST-R11-FORM'))?.value), 'เลือกใบจำลอง')
    const value = await t.ev(() => [...document.querySelectorAll('select option')].find(o => o.textContent.includes('TEST-R11-FORM')).value)
    await t.select('select:has(option[value="' + value + '"])', value)
    await t.select('[role=dialog] select:has(option[value="normal"])', 'normal')
    await t.waitText('ลำดับสถานี:')
    await t.ev(() => {
      const buttons = [...document.querySelectorAll('input[name="needs-sample"]')]
      if (!buttons[1].checked) buttons[1].click()
    })
    await t.button('รับงาน')
    await waitFor(() => api.draft.callouts.length === 2, 'เก็บร่างจากใบยืนยัน')
    assert.deepEqual(api.draft.callouts.map(c => c.title), ['จุดหน้าอกจำลอง', 'จุดชายเสื้อจำลอง'])
    assert.deepEqual(api.calls.filter(c => ['receive_job', 'start_mockup_sheet', 'save_mockup_draft'].includes(c.fn)).map(c => c.fn),
      ['receive_job', 'start_mockup_sheet', 'save_mockup_draft'])
    await t.goto('admin', '#/mockup?id=' + formJob)
    await t.waitText('Callout (2)')
    await t.shot('confirmation-draft')
  }, [second])
} finally {
  await browser?.close()
  api.server.close()
}
console.log('R11_BROWSER ' + JSON.stringify(results))
if (results.some(r => !r.pass)) process.exitCode = 1
