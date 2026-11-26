import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixtureApi, dist, origin, roles, users, mockupJob, formJob, markup } from './api.mjs'
import { openChrome, waitFor } from '../qa-r11/chrome.mjs'

const evidence = new URL('../../docs/qa/img/', import.meta.url)
const widths = [1440, 768, 375]
const focus = process.env.QA_FOCUS ? new RegExp(process.env.QA_FOCUS, 'u') : null
const assets = await readdir(join(dist, 'assets'))
const entry = assets.find(name => /^index-.*\.js$/.test(name))
assert.ok(entry, 'ต้อง build แอปก่อน')
const bundle = await readFile(join(dist, 'assets', entry), 'utf8')
assert.ok(bundle.includes(origin) && bundle.includes('r13-loopback-fixture'), 'ต้อง build แอปด้วย URL loopback และ key จำลอง')
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
    await ev(async () => {
      await Promise.allSettled(document.getAnimations().filter(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished))
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
    const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    await writeFile(new URL('r13-cx-' + name + '.png', evidence), Buffer.from(data, 'base64'))
  }
  return { ev, send, waitText, goto, layout, shot, button, input, select }
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
pages.supervisor = pages.production
pages.qc = pages.staff
const emptyText = {
  admin: 'ยังไม่มีการแก้ตั้งค่า', users: 'ผู้ใช้งาน', roles: 'Roles & Permissions', assign: 'Station Assignment',
  audit: 'ไม่มีรายการในช่วงนี้', settings: 'ตั้งค่าระบบ', production: 'ไม่มีงานที่ต้องตาม', '': 'ไม่มีงานที่ต้องตาม',
  jobs: 'ดูงานในโรงงานทั้งหมด (0)', 'production-queue': 'ว่าง', board: /ไม่พบงาน|ไม่มีงาน|ยังไม่มี|0 งาน|ยังไม่ได้จับคู่สถานี/u,
  dept: 'ว่าง', queue: /ไม่พบงาน|ไม่มีงาน|ยังไม่มี|0 งาน|ว่าง/u, mine: /ไม่มีงาน|ยังไม่มี|0 งาน|ยังไม่ได้จับคู่สถานี/u,
  report: /ไม่มีงาน|ยังไม่ได้จับคู่สถานี/u, inbox: /ยังไม่มี|ไม่มีข้อความ/u,
}
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
    const list = pages[roles[role][0]].map(([path, title]) => [
      path,
      role === 'qc' && ['mine', 'board'].includes(path) ? 'งาน QC + Packing'
        : role.startsWith('phase') && ['queue', 'board'].includes(path) ? 'งานเฟส ' + role.at(-1) : title,
    ])
    for (const width of widths) {
      await record('C1/C2/C4 เมนู ' + role + ' ' + width, async () => {
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


  function layoutOnly(width) {
    return t.ev(w => ({
      expected: w, viewport: innerWidth, document: document.documentElement.scrollWidth,
      invalid: /\b(?:NaN|Infinity|undefined|null)\b/.test(document.body.innerText),
    }), width).then(info => {
      assert.equal(info.viewport, width)
      assert.ok(info.document <= width && !info.invalid, JSON.stringify(info))
    })
  }
  const detail = '#/board?job=' + mockupJob
  const label = '#/label?id=' + mockupJob
  const artwork = '#/artwork?id=' + mockupJob
  const second = await attach(await browser.newTab())
  const form = tester(second)

  for (const role of Object.keys(roles)) {
    await record('C1 เปิดหน้าตั้งค่าตรง ' + role, async () => {
      api.reset()
      await t.goto(role, '#/settings', 1440)
      await t.waitText(role === 'owner' ? 'ตั้งค่าระบบ' : 'หน้านี้สำหรับเจ้าของระบบ')
    })
    await record('C5 รูป PR 148 ' + role, async () => {
      api.reset('approved')
      await t.goto(role, detail, 768)
      await t.waitText('กดที่รูปเพื่อดูม็อคอัพกำกับสเปก ฉบับ 1')
      await t.ev(() => {
        const picture = document.querySelector('a[aria-label="เปิดม็อคอัพกำกับสเปก"]')
        if (!picture?.querySelector('img')) throw new Error('ไม่พบรูป')
        picture.click()
      })
      await waitFor(() => t.ev(() => location.hash.startsWith('#/mockup?id=')), 'ลิงก์รูปม็อคอัพ')
      await t.waitText('ใช้ผลิต: ฉบับ 1')
      api.reset('draft')
      await t.goto(role, detail, 768)
      await t.waitText('กดที่รูปเพื่อดูเต็มจอ')
      assert.equal(await t.ev(() => document.querySelector('a[aria-label="เปิดรูปม็อคอัพเต็มจอ"]')?.target), '_blank')
      api.reset('bare')
      await t.goto(role, detail, 768)
      await t.waitText('ยังไม่มีรูปม็อคอัพ')
      assert.equal(await t.ev(() => document.querySelector('a[aria-label="เปิดม็อคอัพกำกับสเปก"]')), null)
    })
  }

  for (const width of widths) {
    await record('C3/C4 ใบงานและเอกสาร ' + width, async () => {
      api.reset('approved')
      for (const [path, text] of [[detail, 'กดที่รูปเพื่อดูม็อคอัพกำกับสเปก'], [mockupHash, 'ใช้ผลิต: ฉบับ 1'],
        [artwork, 'ใบกำกับงานพิมพ์'], [label, 'ใบปะงาน']]) {
        await t.goto('admin', path, width)
        await t.waitText(text)
        await layoutOnly(width)
      }
      await t.goto('admin', '#/board', width)
      await t.button('รับงานใหม่')
      await t.waitText('รับงานเข้าโรงงาน')
      const primary = await t.ev(() => {
        const btn = [...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.includes('ยังขาด'))
        return btn && [btn.disabled, btn.getBoundingClientRect().height, Number.parseFloat(getComputedStyle(btn).fontSize), btn.textContent]
      })
      assert.ok(primary?.[0] && primary[1] >= 48 && primary[2] >= 16 && /ยังขาด/.test(primary[3]), JSON.stringify(primary))
      await layoutOnly(width)
      if (width === 375) await t.shot('intake-375')
    })
    await record('C2/C4 ตั้งค่าทุกแท็บ ' + width, async () => {
      api.reset()
      for (const [path, heading] of [['users', 'ผู้ใช้งาน'], ['assign', 'Station Assignment']]) {
        await t.goto('owner', '#/' + path, width)
        await t.waitText(heading)
        await layoutOnly(width)
      }
      await t.goto('owner', '#/settings', width)
      await t.waitText('ตั้งค่าระบบ')
      for (const [value, tab] of [['stations', 'สถานีและขั้นย่อย'], ['segments', 'เวลามาตรฐานของช่วง'],
        ['materials', 'แม่แบบวัตถุดิบ'], ['reasons', 'รหัสสาเหตุ'], ['machines', 'จักรเย็บ'], ['inbox', 'การแจ้งเตือน']]) {
        if (width < 640) {
          const selector = 'select:has(option[value="segments"])'
          await waitFor(() => t.ev(sel => !!document.querySelector(sel), selector), tab)
          await t.select(selector, value)
        } else await t.button(tab)
        await waitFor(() => t.ev(() => !document.body.innerText.includes('กำลังโหลด')), 'ตั้งค่า ' + tab)
        await layoutOnly(width)
      }
    })
    await record('D4 ฟอร์มใบยืนยัน ' + width, async () => {
      await form.goto('admin', '', width, '/confirmation')
      await form.layout(width)
    }, [second])
  }

  await record('C2 โหลดช้า ว่าง และผิดพลาด', async () => {
    api.reset()
    api.setLatency(600)
    await t.goto('admin', '#/board')
    await t.waitText('กำลังโหลด')
    await t.waitText('ไม่พบงาน')
    api.reset('error')
    await t.goto('admin', '#/board')
    await t.waitText('ข้อมูลจำลองโหลดไม่สำเร็จ')
  }, [], entry => entry.url?.startsWith(origin + '/rest/v1/') && entry.text?.includes('400'))

  await record('C6 บันทึกร่างสองแท็บและกดซ้ำเมื่อ API ช้า', async () => {
    api.reset('draft')
    await t.goto('admin', mockupHash)
    await form.goto('admin', mockupHash)
    for (const tab of [t, form]) {
      await tab.waitText('Callout (2)')
      await tab.ev(() => [...document.querySelectorAll('ol button')].find(b => b.textContent.includes('จุดหน้าอก')).click())
      await tab.input('[aria-label="ชื่อจุด"]', tab === t ? 'แท็บแรก C15' : 'แท็บสอง C15')
    }
    api.setLatency(350)
    await t.ev(() => {
      const save = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'บันทึกร่าง')
      save.click()
      save.click()
      save.click()
    })
    await waitFor(() => api.draft.callouts[0].title === 'แท็บแรก C15', 'แท็บแรกบันทึก')
    assert.equal(api.sheetVersion, 2)
    await form.button('บันทึกร่าง')
    await form.waitText('กดโหลดใหม่ก่อน')
    assert.equal(api.draft.callouts[0].title, 'แท็บแรก C15')
    assert.equal(api.sheetVersion, 2)
  }, [second], entry => entry.url?.endsWith('/rpc/save_mockup_draft') && entry.text?.includes('400'))

  await record('B4 ป้ายงาน รายละเอียด และใบกำกับแสดงข้อมูลเป็นข้อความ', async () => {
    api.reset('markup')
    for (const path of [detail, label, artwork, mockupHash]) {
      await t.goto('admin', path, 1440)
      await t.waitText(markup)
      assert.equal(await t.ev(() => document.querySelector('[data-r13-marker]')), null)
    }
  })

  await record('C6 ออฟไลน์แล้วกลับออนไลน์', async () => {
    api.reset('approved')
    await t.goto('admin', '#/board')
    await t.waitText('TEST-R13-WEB')
    await t.ev(() => window.dispatchEvent(new Event('offline')))
    await t.waitText('ขาดการเชื่อมต่อ')
    await t.ev(() => window.dispatchEvent(new Event('online')))
    await waitFor(() => t.ev(() => !document.body.innerText.includes('ขาดการเชื่อมต่อ')), 'คืนการเชื่อมต่อ')
  })

  await record('C6 ไฟล์หน้าจอรุ่นเดิมหาย ใช้การโหลดใหม่จริง', async () => {
    api.reset('approved')
    api.failLabelChunk()
    await t.goto('admin', label)
    await t.waitText('ใบปะงาน')
    assert.ok(api.calls.some(call => call.fn === 'stale_chunk'))
    assert.equal(api.calls.filter(call => call.fn === 'stale_reloaded').length, 1)
    assert.ok(await t.ev(() => sessionStorage.getItem('pp142-stale-build-reload')))
  }, [], entry => {
    const msg = typeof entry === 'string' ? entry : entry.text
    return entry.url?.startsWith(origin + '/assets/LabelPage-') || /dynamically imported module|preload|ChunkLoadError/.test(msg)
  })

  await record('C6 แถบมีระบบรุ่นใหม่จาก service worker ในเครื่อง', async () => {
    api.reset('approved')
    await t.goto('admin', '#/board')
    await t.waitText('TEST-R13-WEB')
    await waitFor(() => t.ev(async () => !!(await navigator.serviceWorker.getRegistration())?.active), 'service worker active')
    api.bumpWorker()
    await t.ev(async () => { await (await navigator.serviceWorker.getRegistration()).update() })
    await t.waitText('มีระบบรุ่นใหม่', 10000)
    await t.shot('update-banner')
  })

  await record('B4 PDF ใบยืนยันและผ้าเพิ่มแสดงเครื่องหมายเป็นข้อความ', async () => {
    await form.goto('admin', '', 768, '/confirmation')
    const result = await form.ev(value => {
      if (document.body.classList.contains('preview')) togglePreview(false)
      state = fresh()
      Object.assign(state.h, { doc_no: 'TEST-R13-TEXT', customer: value, job_name: value })
      state.p.tshirt = { fabric_rows: [{ part: 'แขน', fabric: value, color: 'เขียว' }] }
      rerender()
      togglePreview(true)
      const doc = document.querySelector('#doc')
      return [doc.innerText.includes(value), doc.querySelector('[data-r13-marker]') === null]
    }, markup)
    assert.deepEqual(result, [true, true])
    const pdf = await form.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })
    assert.ok(Buffer.from(pdf.data, 'base64').subarray(0, 5).equals(Buffer.from('%PDF-')))
  }, [second])

  await record('C2 สถานะผิดพลาดของรายงาน กล่องจดหมาย และหน้าพิมพ์', async () => {
    for (const [route, table] of [['#/reports', 'jobs'], ['#/inbox', 'inbox_messages'], [mockupHash, 'jobs'],
      [artwork, 'jobs'], [label, 'job_live']]) {
      api.reset('approved')
      api.failRest([table])
      await t.goto('admin', route, 768)
      try { await t.waitText('ข้อมูลจำลองโหลดไม่สำเร็จ') }
      catch (error) { throw new Error(route + ' ' + error.message) }
      await layoutOnly(768)
    }
  }, [], entry => entry.url?.startsWith(origin + '/rest/v1/') && entry.text?.includes('400'))

  await record('D2 ใบเก่าที่ไม่มีผ้าเพิ่มเปิดได้', async () => {
    await form.goto('admin', '', 375, '/confirmation')
    const old = await form.ev(() => {
      const stateIn = { app: 'phappim-confirm', v: 1, product: 'tshirt',
        h: { doc_no: 'TEST-R13-OLD', customer: 'ลูกค้าจำลอง' }, p: { tshirt: {} } }
      const file = document.querySelector('#openFile')
      const transfer = new DataTransfer()
      transfer.items.add(new File([JSON.stringify(stateIn)], 'old.json', { type: 'application/json' }))
      file.files = transfer.files
      file.dispatchEvent(new Event('change'))
      return true
    })
    assert.equal(old, true)
    await form.waitText('เปิดไฟล์ old.json แล้ว')
    assert.ok(await form.ev(() => state.h.doc_no === 'TEST-R13-OLD' && (scope('p').fabric_rows?.length ?? 0) === 0))
  }, [second])

  await record('D1/D2 เลือก กรอก ตรวจ PDF และผ้าเพิ่มครบทุกสินค้า', async () => {
    await form.goto('admin', '', 1440, '/confirmation')
    const products = await form.ev(() => Object.keys(PRODUCTS))
    assert.equal(products.length, 37)
    const failures = []
    let fabricCount = 0
    let pdfCount = 0
    for (const product of products) {
      try {
        const prepared = await form.ev(async key => {
          if (document.body.classList.contains('preview')) togglePreview(false)
          state = fresh()
          renderForm()
          document.querySelector('[data-product][value="' + key + '"]').click()
          state.h = { doc_no: 'TEST-R13-' + key, customer: 'ลูกค้าจำลอง', job_name: 'งานจำลอง',
            issue_date: '2099-01-01', due_date: '2099-01-15', sample: 'ไม่ขึ้นตัวอย่าง' }
          const image = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(await (await fetch('/fixture-shirt.svg')).text())
          state.imgs = [{ src: image }]
          function fill(section, field) {
            const f = field
            const row = scope(section)
            if (!visible(f, row) || f.id === 'fabric_rows') return
            if (f.id === 'size_sets') row[f.id] ??= [Object.keys(SIZESETS)[0]]
            if (f.type === 'radio' && f.req) row[f.id] ??= f.options[0]
            if (f.type === 'check' && f.req) row[f.id] ??= [f.options[0]]
            if (['text', 'textarea'].includes(f.type) && f.req) row[f.id] ??= 'ข้อมูลจำลอง'
            if (f.type === 'date' && f.req) row[f.id] ??= '2099-01-06'
            if (f.type === 'number' && (f.req || f.id === 'qty')) row[f.id] ??= '10'
            if (f.type === 'dims' && f.req) f.parts.forEach((_, i) => { row[f.id + '_' + i] = '10' })
            if (f.type === 'sizeTable') {
              row.size_sets ??= [Object.keys(SIZESETS)[0]]
              row[f.id] = [{ label: 'แบบจำลอง', q: { [sizeCols(row)[0]]: '10' } }]
            }
            if (f.type === 'itemTable' && (f.req || f.cols.some(c => c.sum))) {
              row[f.id] = [Object.fromEntries(f.cols.filter(c => !c.opt || c.sum).map(c =>
                [c.c, c.t === 'number' ? '10' : c.opts?.[0] ?? c.options?.[0] ?? 'ข้อมูลจำลอง']))]
            }
            if (f.type === 'placements') {
              const first = document.querySelector('[data-pos][data-s="' + section + '"]')?.dataset.pos
              const position = f.positions?.[0] ?? f.opts?.[0] ?? first ?? 'ด้านหน้า'
              row[f.id] = { [position]: { on: true, size: '10 × 10', tech: (row.print_method ?? [])[0] } }
            }
          }
          for (let pass = 0; pass < 4; pass++) layout().filter(s => s.fields).forEach(s => s.fields.forEach(f => fill(s.s, f)))
          rerender()
          const need = validate()
          const hasFabric = !!document.querySelector('button[data-act="addrow"][data-id="fabric_rows"]')
          let fabric
          if (hasFabric) {
            renderDoc()
            const fabricHeading = () => [...document.querySelectorAll('#doc .tlabel')].some(node => node.textContent.startsWith('ผ้าเพิ่ม'))
            const emptyHidden = !fabricHeading()
            const add = () => document.querySelector('button[data-act="addrow"][data-id="fabric_rows"]').click()
            add()
            scope('p').fabric_rows[0].part = 'แขน'
            const incomplete = validate().some(x => x.id.endsWith('_fabric_rows') && x.why.includes('ไม่ครบ'))
            Object.assign(scope('p').fabric_rows[0], { fabric: 'ผ้าจำลอง', color: 'เขียว', qty: '12', unit: 'หลา' })
            add()
            document.querySelector('button[data-act="delrow"][data-id="fabric_rows"][data-r="1"]').click()
            rerender()
            renderDoc()
            const printed = fabricHeading() && document.querySelector('#doc').innerText.includes('ผ้าจำลอง')
            const saved = URL.createObjectURL
            let blob
            const click = HTMLAnchorElement.prototype.click
            try {
              URL.createObjectURL = value => { blob = value; return saved.call(URL, value) }
              HTMLAnchorElement.prototype.click = () => {}
              document.querySelector('button[data-act="savefile"]').click()
            } finally {
              URL.createObjectURL = saved
              HTMLAnchorElement.prototype.click = click
            }
            const data = JSON.parse(await blob.text())
            const expected = JSON.stringify([{ part: 'แขน', fabric: 'ผ้าจำลอง', color: 'เขียว', qty: '12', unit: 'หลา' }])
            state.p[key].fabric_rows = []
            const input = document.querySelector('#openFile')
            const transfer = new DataTransfer()
            transfer.items.add(new File([blob], 'fixture.json', { type: 'application/json' }))
            input.files = transfer.files
            input.dispatchEvent(new Event('change'))
            await new Promise(resolve => setTimeout(resolve, 30))
            fabric = [emptyHidden, incomplete, printed, JSON.stringify(data.p[key].fabric_rows) === expected,
              JSON.stringify(scope('p').fabric_rows) === expected]
          }
          togglePreview(true)
          const doc = document.querySelector('#doc')
          return { need, fabric, inPreview: document.body.classList.contains('preview'), qty: totalQty(),
            text: doc.innerText.length, overflow: doc.scrollWidth - doc.clientWidth }
        }, product)
        if (prepared.fabric) {
          fabricCount++
          assert.ok(prepared.fabric.every(Boolean), 'ผ้าเพิ่ม ' + JSON.stringify(prepared.fabric))
        }
        assert.deepEqual(prepared.need, [])
        assert.ok(prepared.inPreview && prepared.qty > 0 && prepared.text > 100 && prepared.overflow <= 1, JSON.stringify(prepared))
        const pdf = await form.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })
        const bytes = Buffer.from(pdf.data, 'base64')
        assert.ok(bytes.length > 3000 && bytes.subarray(0, 5).toString() === '%PDF-')
        pdfCount++
        if (product === 'tshirt') await form.shot('fabric-pdf-1440')
      } catch (error) { failures.push(product + ': ' + clean(error.message)) }
    }
    console.log('R13_FORM ' + JSON.stringify({ products: products.length, fabricCount, pdfCount, failures }))
    assert.deepEqual(failures, [])
  }, [second])

  await record('E2 200 งาน 5000 เหตุการณ์', async () => {
    api.reset('loaded')
    assert.deepEqual(api.size(), [200, 5000])
    const times = {}
    for (const [page, marker] of [['board', 'TEST-R13-LOAD-001'], ['', 'สถานีตอนนี้'], ['reports', 'เวลาเฉลี่ยต่อสถานี']]) {
      const start = performance.now()
      await t.goto('admin', '#/' + page, 1440)
      await t.waitText(marker)
      times[page || 'overview'] = Math.round(performance.now() - start)
      await t.layout(1440)
      if (page === 'reports') await t.shot('load-reports-1440')
    }
    console.log('R13_LOAD ' + JSON.stringify(times))
  })

  await record('E2 วัดเพิ่มที่ 400 และ 800 งาน', async () => {
    const results = []
    for (const count of [400, 800]) {
      api.reset('loaded', count)
      assert.deepEqual(api.size(), [count, count * 25])
      const times = {}
      for (const [page, marker] of [['board', 'TEST-R13-LOAD-001'], ['', 'สถานีตอนนี้'], ['reports', 'เวลาเฉลี่ยต่อสถานี']]) {
        const start = performance.now()
        await t.goto('admin', '#/' + page, 1440)
        await t.waitText(marker, 15000)
        times[page || 'overview'] = Math.round(performance.now() - start)
        await t.layout(1440)
      }
      results.push({ jobs: count, events: count * 25, ...times })
    }
    console.log('R13_SCALE ' + JSON.stringify(results))
  })
  await record('D2/D3 ใบยืนยัน → ตัวอย่าง PDF → รับงาน → ร่างม็อคอัพ', async () => {
    api.reset()
    await t.goto('admin', '#/board')
    await t.ev(async () => {
      const response = await fetch('/fixture-shirt.svg')
      const img = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(await response.text())
      localStorage.setItem('phappim-confirm-v1', JSON.stringify({
        h: { doc_no: 'TEST-R13-FORM', customer: 'ลูกค้าจำลอง', job_name: 'เสื้อจำลอง', due_date: '2099-01-06', sample: 'ไม่ขึ้นตัวอย่าง' },
        product: 'tshirt', p: { tshirt: { size_sets: ['ไซซ์ผู้ใหญ่'], sizes: [{ q: { M: '10' } }], fabric_rows: [{ part: 'แขน', fabric: 'ผ้าจำลอง', color: 'ดำ' }] } }, imgs: [{ src: img }],
      }))
    })
    const importForm = tester(second)
    for (const width of [375, 768, 1440]) {
      await importForm.goto('admin', '', width, '/confirmation')
      await importForm.waitText('ชี้จุดบนภาพแรก')
      await importForm.layout(width)
    }
    for (const [i, name] of ['จุดหน้าอกจำลอง', 'จุดชายเสื้อจำลอง'].entries()) {
      await waitFor(() => importForm.ev(index => {
        const img = document.querySelector('[data-co-img]')
        if (!img?.complete || !img.naturalWidth) return false
        const r = img.getBoundingClientRect()
        img.dispatchEvent(new MouseEvent('click', { clientX: r.x + r.width * (0.4 + index * 0.25), clientY: r.y + r.height * (0.35 + index * 0.35), bubbles: true }))
        return true
      }, i), 'เพิ่มจุดในภาพ')
      await importForm.input('[data-co="' + i + '"][data-cf="title"]', name)
      await importForm.input('[data-co="' + i + '"][data-cf="body"]', 'รายละเอียดทดสอบ ' + (i + 1))
    }
    await importForm.button('ดูตัวอย่าง PDF')
    const preview = await importForm.ev(() => ({
      visible: !!document.querySelector('#doc .co-stage')?.getClientRects().length,
      lines: document.querySelectorAll('#doc .co-stage line').length,
      boxes: [...document.querySelectorAll('#doc .co-box b')].map(el => el.textContent),
      text: document.querySelector('#doc .co-stage')?.innerText,
    }))
    assert.equal(preview.visible, true)
    assert.equal(preview.lines, 2)
    assert.deepEqual(preview.boxes, ['1', '2'])
    assert.match(preview.text, /จุดหน้าอกจำลอง[\s\S]*จุดชายเสื้อจำลอง/u)
    await importForm.ev(() => document.querySelector('#doc .co-stage').scrollIntoView({ block: 'center' }))
    await importForm.shot('confirmation-preview')
    await importForm.button('กลับไปแก้ไข')
    await importForm.ev(() => { window.open = () => null })
    await importForm.button('บันทึกเข้าระบบ')
    await importForm.waitText('ส่งใบ TEST-R13-FORM แล้ว')
    const outboxLink = await importForm.ev(() => document.querySelector('#toast a')?.getAttribute('href'))
    assert.equal(outboxLink, '/#/board?confirmation=save')
    await t.goto('admin', outboxLink.slice(1))
    await waitFor(() => api.confirmation[0]?.data.callouts.length === 2, 'บันทึกใบยืนยัน')
    await t.button('รับงานใหม่')
    await waitFor(() => t.ev(() => [...document.querySelectorAll('select option')].find(o => o.textContent.includes('TEST-R13-FORM'))?.value), 'เลือกใบจำลอง')
    const value = await t.ev(() => [...document.querySelectorAll('select option')].find(o => o.textContent.includes('TEST-R13-FORM')).value)
    await t.select('select:has(option[value="' + value + '"])', value)
    await t.select('[role=dialog] select:has(option[value="normal"])', 'normal')
    await t.waitText('ลำดับสถานี:')
    await t.ev(() => {
      const buttons = [...document.querySelectorAll('input[name="needs-sample"]')]
      if (!buttons[2].checked) buttons[2].click()
    })
    await t.button('รับงาน')
    await waitFor(() => api.calls.some(c => c.fn === 'receive_job'), 'RPC รับงาน')
    assert.deepEqual(api.calls.find(c => c.fn === 'receive_job')?.args.p_spec.p.tshirt.fabric_rows, [{ part: 'แขน', fabric: 'ผ้าจำลอง', color: 'ดำ' }])
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
  await new Promise(resolve => api.server.close(resolve))
}
console.log('R13_BROWSER ' + JSON.stringify(results))
if (results.some(r => !r.pass)) process.exitCode = 1
