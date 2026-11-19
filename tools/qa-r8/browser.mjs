// รันจากโฟลเดอร์ใดก็ได้หลัง build โดยตั้ง VITE_SUPABASE_URL เป็น origin นี้
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../../app/dist/', import.meta.url))
const evidence = new URL('../../docs/qa/img/', import.meta.url)
const origin = 'http://127.0.0.1:5198'
const chromePath = process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const focus = process.env.QA_FOCUS ? new RegExp(process.env.QA_FOCUS, 'u') : null
const roles = ['owner', 'admin', 'production', 'qc', 'manager']
const stations = Object.entries({
  print: 'พิมพ์งาน', press: 'รีดงาน', cut: 'ตัดงาน', dtf_press: 'รีดฟิล์ม',
  emb: 'ปักงาน', sew: 'เย็บงาน', qc_pack: 'QC + Packing',
}).map(([code, name], sort) => ({ code, name, sort, substeps: [], sla_days: 1, section: sort < 5 ? 'p1' : 'p2' }))
const mkId = i => '80000000-0000-0000-0000-' + String(i + 1).padStart(12, '0')
const now = new Date()
const jobs = stations.flatMap((station, i) => ['queued', 'doing', 'hold'].map((status, j) => ({
  id: mkId(3 * i + j), confirmation_no: 'TEST-R8-' + (3 * i + j + 1),
  customer_name: 'ลูกค้าจำลอง', job_name: 'เสื้อจำลองทดสอบ', product_type_code: 'tshirt',
  qty: 10, unit: 'ตัว', due_date: j === 2 ? '2020-01-01' : '2099-01-06',
  route_code: i === 3 ? 'dtf' : i === 4 ? 'emb' : 'normal',
  phase: 'production', station_status: status, current_station: station.code, stage_entered_at: now.toISOString(),
  created_at: now.toISOString(), sample_round: 1, needs_sample: false, visit: 1, queue_seq: 1024 * (3 * i + j + 1),
  qc_passed: 0, sew_count: 0, dtf_film_received_at: now.toISOString(), hold_reason: 'รอตรวจวัสดุ',
  mockup_path: j === 0 ? 'TEST-R8-' + (3 * i + 1) + '/fixture.jpg' : null,
})))
const machines = Array.from({ length: 21 }, (_, i) => ({
  id: i + 1, code: 'SN-' + String(i + 1).padStart(2, '0'), type_code: 'single', status: 'ready', sort: i,
  machine_assignments: [], machine_bookings: [], machine_status_log: [],
}))
const fixtures = {
  stations, jobs, job_live: jobs, sewing_machines: machines,
  machine_assignments: [{ machine_id: 1, job_id: mkId(16) }],
  machine_bookings: Array.from({ length: 50 }, (_, i) => ({
    id: i + 1, machine_id: i % 21 + 1, job_id: mkId(i % jobs.length),
    starts_at: new Date(now.getTime() + (Math.floor(i / 21) + 1) * 3_600_000).toISOString(),
    ends_at: new Date(now.getTime() + (Math.floor(i / 21) + 2) * 3_600_000).toISOString(),
  })),
  machine_types: [{ code: 'single', name: 'จักรเข็มเดี่ยว', prefix: 'SN', shared: false, sort: 1 }],
  product_machine_needs: [{ product_type_code: 'tshirt', type_code: 'single', qty: 1 }],
  product_types: [{ code: 'tshirt', name: 'เสื้อยืด' }],
  routes: [{ code: 'normal', name: 'พิมพ์ทั้งตัว' }],
  route_stations: ['print', 'press', 'cut', 'sew', 'qc_pack'].map((station_code, i) => ({ route_code: 'normal', seq: i + 1, station_code })),
  events: jobs.map((job, i) => ({ id: i + 1, job_id: job.id, type: 'received', at: now.toISOString(), payload: { qty: job.qty }, phase: 'production' })),
  reason_codes: [{ code: 'material', grp: 'work', name: 'รอวัสดุ', active: true, sort: 1 }],
}
const textFixture = '<script></script> "' + "' 🙂 " + 'ก'.repeat(500)
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon' }
let mode = 'normal'
let requests = []
let revision = 1
const json = (res, body, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}
const app = createServer(async (req, res) => {
  const url = new URL(req.url, origin)
  const path = url.pathname
  const role = req.headers.authorization?.split('.').at(-1) ?? 'owner'
  const user = { id: mkId(899), email: 'fixture@pp142.test', app_metadata: {}, user_metadata: {} }
  if (path === '/auth/v1/user') return json(res, user)
  if (path === '/favicon.ico') { res.writeHead(204); return res.end() }
  if (path === '/r8-img.svg') {
    res.setHeader('Content-Type', 'image/svg+xml')
    return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"><rect width="60" height="40" fill="teal"/></svg>')
  }
  if (path === '/storage/v1/object/sign/mockups') {
    const parts = []
    for await (const part of req) parts.push(part)
    const { paths } = JSON.parse(Buffer.concat(parts).toString('utf8'))
    return json(res, paths.map(path => ({ path, signedURL: '/r8-img.svg' })))
  }
  if (path === '/storage/v1/r8-img.svg') {
    res.writeHead(302, { Location: '/r8-img.svg' })
    return res.end()
  }
  if (path.startsWith('/storage/v1/object/mockups/')) {
    requests.push({ table: 'mockup-upload', method: req.method, path })
    if (mode === 'upload-failed') return json(res, { message: 'Bucket not found' }, 404)
    if (mode === 'upload-duplicate') return json(res, { message: 'Resource already exists' }, 409)
    return json(res, { Key: path })
  }
  if (path.startsWith('/rest/v1/')) {
    const table = path.slice('/rest/v1/'.length)
    const request = { table, role, method: req.method }
    requests.push(request)
    if (table !== 'profiles' && mode === 'slow') await delay(1_200)
    if (table !== 'profiles' && mode === 'error') return json(res, { message: 'บริการจำลองขัดข้อง', code: 'XX000' }, 500)
    if (table === 'profiles') {
      const data = { user_id: user.id, name: 'ผู้ใช้จำลอง', role, section: null, active: true }
      return json(res, url.searchParams.has('role') ? [] : [data])
    }
    if (table === 'rpc/owner_list_users') return json(res, mode === 'empty' ? [] : [{ id: user.id, user_id: user.id, email: user.email, role: 'owner', active: true }])
    if (table === 'rpc/save_confirmation_draft') {
      const chunks = []
      for await (const part of req) chunks.push(part)
      request.body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      return json(res, mkId(900))
    }
    if (table === 'rpc/start_in_queue' && mode === 'rpc-slow') {
      await delay(31_000)
      return json(res, null)
    }
    if (table === 'rpc/job_sla_flags') return json(res, mode === 'empty' ? [] : [
      { job_id: mkId(1), warn: true, over: false, need_report: false },
      { job_id: mkId(4), warn: true, over: true, need_report: true },
    ])
    let data = mode === 'empty' ? [] : fixtures[table] ?? []
    if (table === 'job_live' && mode === 'broken-component') {
      data = jobs.map(job => ({ ...job, route_code: 'invalid-fixture-route' }))
    }
    if (table === 'job_live' && mode === 'literal-text') {
      data = jobs.map(job => ({ ...job, customer_name: textFixture, job_name: textFixture, hold_reason: textFixture }))
    }
    if (table === 'sewing_machines' && mode === 'literal-text') {
      data = machines.map((machine, i) => i ? machine : { ...machine, status: 'broken', note: textFixture })
    }
    if (table === 'job_live' && mode === 'volume' && !url.searchParams.has('id')) {
      data = Array.from({ length: 300 }, (_, i) => ({
        ...jobs[i % jobs.length], id: mkId(1000 + i), confirmation_no: 'TEST-R8-LOAD-' + i,
        queue_seq: (i + 1) * 1024, mockup_path: null,
      }))
    }
    for (const [key, filter] of url.searchParams) {
      if (filter.startsWith('eq.') && data.some(row => key in row)) {
        data = data.filter(row => String(row[key]) === filter.slice(3))
      }
    }
    return json(res, req.headers.accept?.includes('vnd.pgrst.object') ? data[0] ?? null : data)
  }
  const name = path === '/' ? 'index.html' : path === '/confirmation' ? 'confirmation.html' : path.slice(1)
  const file = resolve(dist, name)
  try {
    if (!file.startsWith(resolve(dist) + '\\') && !file.startsWith(resolve(dist) + '/')) throw new Error('path')
    res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream')
    const asset = await readFile(file)
    if (path === '/sw.js') res.setHeader('Cache-Control', 'no-store')
    res.end(path === '/sw.js' ? asset.toString() + '\nself.addEventListener("message", e => { if (e.data === "QA_REVISION") e.ports[0].postMessage(' + revision + ') })' : asset)
  } catch {
    res.writeHead(404)
    res.end('missing fixture resource')
  }
})

async function waitFor(fn, label, ms = 6500) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value } catch { /* ระหว่างเปลี่ยนเอกสาร execution context ยังไม่พร้อม */ }
    await delay(50)
  }
  throw new Error('หมดเวลารอ ' + label)
}

async function openChrome() {
  const profile = await mkdtemp(join(tmpdir(), 'pp142-r8-chrome-'))
  const chrome = spawn(chromePath, [
    '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--hide-scrollbars',
    '--no-first-run', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    'about:blank',
  ], { windowsHide: true, stdio: 'ignore' })
  try {
    const port = (await waitFor(() => readFile(join(profile, 'DevToolsActivePort'), 'utf8'), 'Chrome')).split(/\r?\n/)[0]
    const [tab] = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
    const ws = new WebSocket(tab.webSocketDebuggerUrl)
    await once(ws, 'open')
    const pending = new Map()
    const logs = []
    let id = 0
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const ticket = ++id
      const timer = setTimeout(() => {
        pending.delete(ticket)
        reject(new Error('CDP timeout: ' + method))
      }, 8_000)
      pending.set(ticket, { resolve, reject, timer })
      ws.send(JSON.stringify({ id: ticket, method, params }))
    })
    ws.addEventListener('message', ({ data }) => {
      const msg = JSON.parse(data)
      if (msg.id) {
        const task = pending.get(msg.id)
        if (!task) return
        pending.delete(msg.id)
        clearTimeout(task.timer)
        if (msg.error) task.reject(new Error(msg.error.message))
        else task.resolve(msg.result)
      }
      if (msg.method === 'Runtime.exceptionThrown') logs.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)
      if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
        logs.push(msg.params.args.map(arg => arg.value ?? arg.description).join(' '))
      }
    })
    for (const domain of ['Page', 'Runtime', 'Network', 'DOM']) await send(domain + '.enable')
    await send('Network.setBlockedURLs', { urls: ['https://*', 'http://localhost/*'] })
    await send('Network.setBypassServiceWorker', { bypass: true })
    const ev = async (fn, ...args) => {
      const result = await send('Runtime.evaluate', {
        expression: '(' + fn.toString() + ')(...' + JSON.stringify(args) + ')', awaitPromise: true, returnByValue: true,
      })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
      return result.result.value
    }
    async function close() {
      try { await Promise.race([send('Browser.close'), delay(500)]) } catch { /* Chrome ปิดไปแล้ว */ }
      ws.close()
      chrome.kill()
    }
    return { send, ev, logs, close }
  } catch (error) {
    chrome.kill()
    throw error
  }
}

const assets = (await readdir(join(dist, 'assets'))).filter(f => f.endsWith('.js'))
const entry = assets.find(f => /^index-/.test(f))
assert.ok(entry, 'ต้อง build แอปก่อน')
assert.match(await readFile(join(dist, 'assets', entry), 'utf8'), /http:\/\/127\.0\.0\.1:5198/, 'ต้อง build ด้วย API จำลอง')
app.listen(5198, '127.0.0.1')
await once(app, 'listening')
let browser
const results = []
try {
  browser = await openChrome()
  const { send, ev, logs } = browser
  await send('Page.addScriptToEvaluateOnNewDocument', { source: '(' + ((origin, userId) => {
    if (location.origin !== origin) return
    const role = new URLSearchParams(location.search).get('qa-role')
    if (!role) return
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + btoa(JSON.stringify({ exp: 4_000_000_000, sub: userId })).replace(/=+$/, '') + '.' + role
    localStorage.setItem('sb-127-auth-token', JSON.stringify({
      access_token: token, refresh_token: 'local-fixture', expires_at: 4_000_000_000, token_type: 'bearer',
      user: { id: userId, email: 'fixture@pp142.test', app_metadata: {}, user_metadata: {}, aud: 'authenticated' },
    }))
    localStorage.removeItem('pp142.station')
    if (location.pathname === '/confirmation') localStorage.removeItem('phappim-confirm-v1')
    window.open = (...args) => { (window.qaOpened ??= []).push(args); return null }
    window.alert = text => { (window.qaAlerts ??= []).push(text) }
    const NativeWebSocket = window.WebSocket
    window.WebSocket = class FixtureSocket extends EventTarget {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSING = 2
      static CLOSED = 3
      constructor(url, protocols) {
        super()
        if (new URL(url).pathname !== '/realtime/v1/websocket') return new NativeWebSocket(url, protocols)
        this.readyState = 0
        this.channels = new Map()
        ;(window.qaSockets ??= []).push(this)
        setTimeout(() => { this.readyState = 1; this.onopen?.(new Event('open')) }, 0)
      }
      deliver(frame) {
        const data = JSON.stringify([frame.joinRef ?? null, frame.ref ?? null, frame.topic, frame.event, frame.payload])
        this.onmessage?.(new MessageEvent('message', { data }))
      }
      send(data) {
        const [joinRef, ref, topic, event, payload] = JSON.parse(data)
        const filters = payload?.config?.postgres_changes ?? []
        const postgres_changes = filters.map((item, i) => ({ ...item, id: i + 1 }))
        if (event === 'phx_join') this.channels.set(topic, postgres_changes)
        if (event === 'phx_leave') this.channels.delete(topic)
        setTimeout(() => this.deliver({ joinRef, ref, topic, event: 'phx_reply',
          payload: { status: 'ok', response: { postgres_changes } } }), 0)
      }
      change(table) {
        let matched = 0
        for (const [topic, filters] of this.channels) {
          const ids = filters.filter(filter => filter.table === table).map(filter => filter.id)
          if (!ids.length) continue
          matched += ids.length
          this.deliver({ topic, event: 'postgres_changes', payload: { ids, data: {
            schema: 'public', table, type: 'UPDATE', commit_timestamp: new Date().toISOString(),
            columns: [], record: {}, old_record: {},
          } } })
        }
        return matched
      }
      close() { this.readyState = 3; this.onclose?.(new CloseEvent('close', { code: 1000, wasClean: true })) }
      addEventListener(event, listener, options) {
        if (['open', 'message', 'close', 'error'].includes(event)) this['on' + event] = listener
        else super.addEventListener(event, listener, options)
      }
    }
  }).toString() + ')(' + JSON.stringify(origin) + ',' + JSON.stringify(mkId(899)) + ')' })
  const waitText = text => waitFor(() => ev(s => document.body.innerText.includes(s), text), text)
  let navigation = 0
  async function goto(role, page) {
    const target = new URL(page.startsWith('/confirmation') ? page : '/#' + page, origin)
    target.searchParams.set('qa-role', role)
    target.searchParams.set('case', String(++navigation))
    await send('Page.navigate', { url: target.href })
    await waitFor(() => ev(href => location.href.split('#')[0] === href.split('#')[0] && document.readyState === 'complete', target.href), target.href)
    if (!page.startsWith('/confirmation')) await waitText('ผู้ใช้จำลอง')
  }
  const button = text => ev(label => {
    const el = [...document.querySelectorAll('button')].find(b => b.getClientRects().length && b.textContent.trim() === label)
    if (el) el.click()
    return Boolean(el)
  }, text)
  const click = text => waitFor(() => button(text), text)
  async function screenshot(slug) {
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile(new URL('r8-cx-' + slug + '.png', evidence), Buffer.from(data, 'base64'))
  }
  async function record(label, test) {
    if (focus && !focus.test(label)) return
    const from = logs.length
    try {
      const detail = await test()
      results.push({ label, pass: true, ...detail, console: logs.slice(from) })
    } catch (error) {
      results.push({ label, pass: false, error: error.message, console: logs.slice(from) })
    }
  }
  async function inspect(width) {
    return ev(expected => {
      const visible = el => el.getClientRects().length > 0
      const main = document.querySelector('main') ?? document.body
      const controls = [...main.querySelectorAll('button, a[role=button]')].filter(visible).map(el => ({
        text: (el.textContent.trim() || el.getAttribute('aria-label') || el.title).replace(/\s+/g, ' '),
        height: Math.round(el.getBoundingClientRect().height), font: parseFloat(getComputedStyle(el).fontSize),
        disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
        title: el.title || el.getAttribute('aria-describedby') || '',
      }))
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
      const english = new Set()
      while (walker.nextNode()) {
        const text = walker.currentNode.textContent.trim()
        if (/^[A-Za-z][A-Za-z ]{2,}$/.test(text) && !/^(Packing|WEBP|JPEG|PNG|PDF|JPG|DTF|DTG|QC)$/.test(text)
          && visible(walker.currentNode.parentElement) && !['STYLE', 'SCRIPT'].includes(walker.currentNode.parentElement.tagName)) english.add(text)
      }
      return { width: innerWidth, expected, scrollWidth: document.documentElement.scrollWidth,
        denied: /หน้านี้สำหรับ/.test(main.innerText), boundary: main.innerText.includes('ส่วนนี้แสดงไม่ได้'),
        headings: [...main.querySelectorAll('h1,h2')].filter(visible).slice(0, 5).map(el => el.textContent.trim()),
        main: main.innerText.slice(0, 1500), controls, english: [...english] }
    }, width)
  }

  for (const width of [375, 768, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    for (const role of roles) {
      const pages = [['overview', '/'], ['board', '/board'],
        ...stations.map(s => [s.code, '/board?station=' + s.code]),
        ['detail', '/board?job=' + mkId(0)], ['inbox', '/inbox'], ['reports', '/reports'],
        ['settings', '/settings'], ['account', '/system'], ['label', '/label?id=' + mkId(0)], ['confirmation', '/confirmation']]
      for (const [name, path] of pages) {
        await record([width, role, name].join('/'), async () => {
          await goto(role, path)
          if (name === 'detail') await waitFor(() => ev(() => !!document.querySelector('[role=dialog]')), name)
          if (name === 'label') await waitText('TEST-R8-1')
          if (name === 'confirmation') await waitText('บันทึกเข้าระบบ')
          if (['overview', 'board', ...stations.map(s => s.code)].includes(name)) {
            await waitFor(() => ev(() => !document.body.innerText.includes('กำลังโหลดข้อมูลงาน') &&
              !document.body.innerText.includes('กำลังโหลดหน้าติดตามการผลิต')), 'โหลดบอร์ด')
          }
          await delay(100)
          const sizes = await inspect(width)
          if (sizes.scrollWidth > width && !results.some(r => r.label.endsWith('/' + name) && r.error?.includes('ล้น'))) {
            await screenshot('overflow-' + name + '-' + width)
          }
          assert.ok(sizes.scrollWidth <= width, 'ล้น ' + sizes.scrollWidth + 'px')
          assert.equal(sizes.boundary, false)
          if (name === 'board') {
            assert.equal(sizes.controls.some(c => c.text === 'รับงานใหม่'), ['owner', 'admin'].includes(role))
          }
          return sizes
        })
      }
      if (['owner', 'admin', 'production', 'manager'].includes(role)) {
        await record([width, role, 'sewing'].join('/'), async () => {
          await goto(role, '/board')
          await click('จักรเย็บ')
          const subpages = []
          for (const label of ['งานเย็บ', 'ตารางจอง', 'สถานะจักร']) {
            const start = performance.now()
            await click(label)
            await delay(100)
            const info = await inspect(width)
            assert.ok(info.scrollWidth <= width, 'ล้น ' + label)
            assert.equal(info.boundary, false)
            subpages.push({ label, ...info, ms: Math.round(performance.now() - start) })
          }
          return { subpages }
        })
      }
      if (['owner', 'admin'].includes(role)) await record([width, role, 'intake'].join('/'), async () => {
        await goto(role, '/board')
        await click('รับงานใหม่')
        await waitFor(() => ev(() => !!document.querySelector('[role=dialog]')), 'หน้ารับงาน')
        const info = await inspect(width)
        assert.ok(info.scrollWidth <= width, 'ล้นหน้ารับงาน')
        return info
      })
      if (role === 'owner') await record([width, role, 'settings-tabs'].join('/'), async () => {
        await goto(role, '/settings')
        await waitFor(() => ev(() => !!document.querySelector('select')), 'หมวดตั้งค่า')
        const options = await ev(() => [...document.querySelector('select').options].map(o => [o.value, o.text]))
        const subpages = []
        for (const [value, name] of options) {
          await ev(v => {
            const select = document.querySelector('select')
            select.value = v
            select.dispatchEvent(new Event('change', { bubbles: true }))
          }, value)
          await delay(100)
          const info = await inspect(width)
          assert.ok(info.scrollWidth <= width, 'ล้น ' + name)
          assert.equal(info.boundary, false)
          subpages.push({ label: name, ...info })
        }
        return { subpages }
      })
      if (['owner', 'admin'].includes(role)) await record([width, role, 'overview-tabs'].join('/'), async () => {
        await goto(role, '/')
        const subpages = []
        for (const label of ['ต้องตาม', 'ค้นหางาน', 'วางแผนรับ']) {
          await click(label)
          const info = await inspect(width)
          assert.ok(info.scrollWidth <= width, 'ล้น ' + label)
          assert.equal(info.boundary, false)
          subpages.push({ label, ...info })
        }
        return { subpages }
      })
    }
  }

  for (const variant of ['slow', 'empty', 'error']) {
    for (const [name, path] of [['board', '/board'], ['reports', '/reports'], ['settings', '/settings'], ['inbox', '/inbox'], ['label', '/label?id=' + mkId(0)]]) {
      mode = variant
      await record('state/' + variant + '/' + name, async () => {
        await goto('owner', path)
        const early = await inspect(1440)
        await delay(variant === 'slow' ? 1_650 : 650)
        const late = await inspect(1440)
        const observation = { early: early.main, late: late.main }
        if (variant === 'slow') assert.match(early.main, /กำลังโหลด|รอสักครู่/)
        if (variant === 'error') assert.match(late.main, /ไม่สำเร็จ|ขัดข้อง|ลองอีกครั้ง|โหลดใหม่/)
        if (variant === 'empty') assert.match(late.main, /ไม่มี|ไม่พบ|0 งาน|0 รายการ|ยังไม่มี/)
        return observation
      })
    }
  }

  mode = 'volume'
  await record('volume/300-jobs', async () => {
    requests = []
    const start = performance.now()
    await goto('owner', '/board')
    await click('บอร์ด')
    await waitText('TEST-R8-LOAD-0')
    return { ms: Math.round(performance.now() - start), requests: requests.length }
  })
  mode = 'normal'

  await record('resilience/offline-realtime', async () => {
    const no = 'TEST-R8-UPDATED'
    await goto('production', '/board')
    await waitText('TEST-R8-1')
    await waitFor(() => ev(() => !document.body.innerText.includes('ขาดการเชื่อมต่อ')), 'เชื่อม Realtime')
    await ev(() => window.dispatchEvent(new Event('offline')))
    await waitText('ขาดการเชื่อมต่อ')
    assert.equal(await ev(() => document.body.innerText.includes('TEST-R8-1')), true)
    await ev(() => window.dispatchEvent(new Event('online')))
    await waitFor(() => ev(() => !document.body.innerText.includes('ขาดการเชื่อมต่อ')), 'เชื่อมต่ออีกครั้ง')
    const old = jobs[0].confirmation_no
    try {
      jobs[0].confirmation_no = no
      const ignored = await ev(() => Object.fromEntries(
        ['machine_types', 'confirmation_drafts', 'vendors'].map(table => [
          table, window.qaSockets.reduce((n, socket) => n + socket.change(table), 0),
        ]),
      ))
      assert.ok(Object.values(ignored).every(value => value === 0))
      assert.equal(await ev(s => document.body.innerText.includes(s), no), false)
      const listened = await ev(() => window.qaSockets.reduce((n, s) => n + s.change('jobs'), 0))
      assert.ok(listened > 0)
      await waitText(no)
      return { ignored, listened }
    } finally { jobs[0].confirmation_no = old }
  })
  await record('resilience/ส่วนหนึ่งแสดงไม่ได้', async () => {
    mode = 'broken-component'
    try {
      await goto('owner', '/board')
      await waitText('ส่วนนี้แสดงไม่ได้')
      assert.equal(await ev(() => Boolean(document.querySelector('nav[aria-label="เมนูหลัก"]'))), true)
      return { expectedConsole: true }
    } finally { mode = 'normal' }
  })
  await record('resilience/คำขอบันทึกค้าง 31 วินาที', async () => {
    mode = 'rpc-slow'
    try {
      await goto('production', '/board?station=cut')
      await click('เริ่มตัดงาน')
      await waitText('กำลังเริ่ม…')
      const start = performance.now()
      await waitFor(() => ev(() => document.body.innerText.includes('ระบบตอบช้าเกินไป')), 'ข้อความหมดเวลา', 32_000)
      const buttonReady = await ev(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'เริ่มตัดงาน' && !b.disabled))
      assert.equal(buttonReady, true)
      return { ms: Math.round(performance.now() - start) }
    } finally { mode = 'normal' }
  })

  for (const [variant, warning] of [['normal', false], ['upload-duplicate', false], ['upload-failed', true]]) {
    await record('outbox/' + variant, async () => {
      mode = variant
      requests = []
      try {
        await goto('admin', '/confirmation')
        await ev(() => {
          localStorage.setItem('pp142.confirmation.outbox', JSON.stringify({
            app: 'phappim-confirm', h: { doc_no: 'TEST-R8-OUTBOX' }, mockup: 'data:image/png;base64,AA==',
          }))
        })
        await goto('admin', '/board?confirmation=save')
        await waitText('บันทึกใบยืนยัน TEST-R8-OUTBOX เข้าระบบแล้ว')
        const saved = requests.find(r => r.table === 'rpc/save_confirmation_draft').body.p_data
        assert.equal('mockup' in saved, false)
        assert.equal(Boolean(saved.mockup_path), !warning)
        assert.equal(await ev(() => document.body.innerText.includes('รูปม็อคอัพยังไม่เข้าระบบ')), warning)
        return { path: saved.mockup_path, warning }
      } finally { mode = 'normal' }
    })
  }

  await record('BUG: form/บันทึกทันทีหลังเลือกรูป', async () => {
    await goto('owner', '/confirmation')
    const outcome = await ev(async () => {
      localStorage.removeItem('pp142.confirmation.outbox')
      const no = document.querySelector('[data-k=doc_no]')
      no.value = 'TEST-R8-FORM-QUICK'
      no.dispatchEvent(new Event('input', { bubbles: true }))
      const input = document.querySelector('input[data-img]')
      const canvas = document.createElement('canvas')
      canvas.width = 64; canvas.height = 32
      const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
      const transfer = new DataTransfer()
      transfer.items.add(new File([png], 'fixture.png', { type: 'image/png' }))
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      document.querySelector('[data-act=savedb]').click()
      return { sent: (window.qaOpened ?? []).length, alerts: window.qaAlerts ?? [],
        stored: Boolean(localStorage.getItem('pp142.confirmation.outbox')) }
    })
    if (outcome.sent) await screenshot('form-early-save')
    assert.deepEqual([outcome.sent, outcome.stored], [0, false], JSON.stringify(outcome))
    assert.match(outcome.alerts.join(' '), /เตรียมรูป/)
    return outcome
  })
  await record('form/PNG โปร่งใส 6000×4000 หลังรอได้ JPEG ไม่เกิน 800px', async () => {
    await goto('owner', '/confirmation')
    await ev(async () => {
      localStorage.removeItem('pp142.confirmation.outbox')
      const no = document.querySelector('[data-k=doc_no]')
      no.value = 'TEST-R8-FORM-LARGE'
      no.dispatchEvent(new Event('input', { bubbles: true }))
      const canvas = document.createElement('canvas')
      canvas.width = 6000; canvas.height = 4000
      const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
      const transfer = new DataTransfer()
      transfer.items.add(new File([png], 'transparent.png', { type: 'image/png' }))
      const input = document.querySelector('input[data-img]')
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const outcome = await waitFor(() => ev(async () => {
      document.querySelector('[data-act=savedb]').click()
      const raw = JSON.parse(localStorage.getItem('pp142.confirmation.outbox') ?? 'null')
      if (!raw?.mockup) return false
      const image = new Image()
      image.src = raw.mockup
      await image.decode()
      return { jpeg: raw.mockup.startsWith('data:image/jpeg;'), width: image.width, height: image.height }
    }), 'ได้ JPEG')
    assert.equal(outcome.jpeg, true)
    assert.equal(outcome.width, 800)
    assert.ok(Math.abs(outcome.height - 800 * 4000 / 6000) < 1)
    return outcome
  })
  await record('form/รูปของใบเดิมอยู่ต่อเมื่อเลขเดิม · เปลี่ยนเลขไม่ส่ง path', async () => {
    await goto('owner', '/board')
    await ev(() => {
      localStorage.setItem('pp142.confirmation.inbox', JSON.stringify({
        h: { doc_no: 'TEST-R8-ORIGINAL', customer: 'ลูกค้าจำลอง' }, product: 'tshirt', p: {}, imgs: [],
        mockup_path: 'TEST-R8-ORIGINAL/original.jpg',
      }))
    })
    await goto('owner', '/confirmation')
    const out = await ev(() => {
      const read = () => JSON.parse(localStorage.getItem('pp142.confirmation.outbox'))
      const button = document.querySelector('[data-act=savedb]')
      button.click()
      const original = read().mockup_path
      const number = document.querySelector('[data-k=doc_no]')
      number.value = 'TEST-R8-NEW'
      number.dispatchEvent(new Event('input', { bubbles: true }))
      button.click()
      return [original, read().mockup_path ?? null]
    })
    assert.deepEqual(out, ['TEST-R8-ORIGINAL/original.jpg', null])
  })
  await record('form/localStorage เต็ม แจ้งให้บันทึกไฟล์', async () => {
    await goto('owner', '/confirmation')
    const out = await ev(() => {
      const number = document.querySelector('[data-k=doc_no]')
      number.value = 'TEST-R8-QUOTA'
      number.dispatchEvent(new Event('input', { bubbles: true }))
      const put = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (key === 'pp142.confirmation.outbox') throw new DOMException('fixture', 'QuotaExceededError')
        return put.call(this, key, value)
      }
      document.querySelector('[data-act=savedb]').click()
      return { alerts: window.qaAlerts, opened: window.qaOpened?.length ?? 0 }
    })
    assert.match(out.alerts.join(' '), /พื้นที่เบราว์เซอร์เต็ม/)
    assert.equal(out.opened, 0)
  })
  await record('form/ลบรูปทั้งหมดแล้วไม่ส่งรูปย่อ', async () => {
    await goto('owner', '/confirmation')
    await ev(async () => {
      const field = document.querySelector('[data-k=doc_no]')
      field.value = 'TEST-R8-DELETE-IMAGE'
      field.dispatchEvent(new Event('input', { bubbles: true }))
      const canvas = document.createElement('canvas')
      const data = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
      const transfer = new DataTransfer()
      transfer.items.add(new File([data], 'remove.png', { type: 'image/png' }))
      const input = document.querySelector('input[data-img]')
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitFor(() => ev(() => Boolean(document.querySelector('[data-act=delimg]'))), 'ปุ่มลบภาพ')
    const out = await ev(() => {
      document.querySelector('[data-act=delimg]').click()
      document.querySelector('[data-act=savedb]').click()
      const draft = JSON.parse(localStorage.getItem('pp142.confirmation.outbox'))
      return { number: draft.h.doc_no, mockup: draft.mockup ?? null, images: draft.imgs.length }
    })
    assert.deepEqual(out, { number: 'TEST-R8-DELETE-IMAGE', mockup: null, images: 0 })
  })
  await record('BUG: form/ไฟล์ไม่ใช่รูปค้างที่ข้อความเตรียมรูป', async () => {
    await goto('owner', '/confirmation')
    await ev(() => {
      const field = document.querySelector('[data-k=doc_no]')
      field.value = 'TEST-R8-NON-IMAGE'
      field.dispatchEvent(new Event('input', { bubbles: true }))
      const transfer = new DataTransfer()
      transfer.items.add(new File(['fixture'], 'not-image.txt', { type: 'text/plain' }))
      const input = document.querySelector('input[data-img]')
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitFor(() => ev(() => Boolean(document.querySelector('[data-act=delimg]')) || Boolean(window.qaAlerts?.length)), 'ผลตรวจชนิดไฟล์')
    await delay(1_500)
    const out = await ev(() => {
      document.querySelector('[data-act=savedb]').click()
      return { alerts: (window.qaAlerts ?? []).join(' '), kept: Boolean(document.querySelector('[data-act=delimg]')) }
    })
    if (out.kept) {
      await ev(() => document.querySelector('[data-act=delimg]').closest('figure').scrollIntoView({ block: 'center' }))
      await delay(100)
      await screenshot('form-invalid-file')
    }
    assert.equal(out.kept, false, JSON.stringify(out))
    assert.doesNotMatch(out.alerts, /กำลังเตรียมรูป/)
  })
  await record('outbox/สองแท็บแชร์ใบร่างเดียว', async () => {
    requests = []
    await goto('admin', '/confirmation')
    await ev(() => {
      localStorage.setItem('pp142.confirmation.outbox', JSON.stringify({
        app: 'phappim-confirm', h: { doc_no: 'TEST-R8-TWO-TABS' },
      }))
    })
    const other = await send('Target.createTarget', { url: origin + '/?qa-second-tab=1#/board?confirmation=save', background: true })
    try {
      await goto('admin', '/board?confirmation=save')
      await waitFor(() => ev(() => document.body.innerText.includes('TEST-R8-TWO-TABS')), 'ผลบันทึกหรือแจ้งว่าอีกแท็บรับแล้ว')
      await delay(1_000)
      const saved = requests.filter(r => r.table === 'rpc/save_confirmation_draft')
      assert.equal(saved.length, 1)
      return { submitted: saved.length }
    } finally { await send('Target.closeTarget', { targetId: other.targetId }) }
  })
  for (const [label, id, hasImage] of [['with', mkId(0), true], ['without', mkId(1), false]]) {
    await record('print/A5/' + label, async () => {
      await goto('owner', '/label?id=' + id)
      await waitText(hasImage ? 'TEST-R8-1' : 'TEST-R8-2')
      await waitText('6 ม.ค. 2642')
      await send('Emulation.setEmulatedMedia', { media: 'print' })
      try {
        const { data } = await send('Page.printToPDF', { preferCSSPageSize: true })
        const pdf = Buffer.from(data, 'base64').toString('latin1')
        assert.equal((pdf.match(/\/Type \/Page\b/g) ?? []).length, 1, 'ต้องมี A5 หน้าเดียว')
        const image = await ev(() => Boolean(document.querySelector('.job-label-mockup')))
        assert.equal(image, hasImage)
        return { image, page: pdf.match(/\/MediaBox \[([^\]]+)\]/)?.[1] }
      } finally { await send('Emulation.setEmulatedMedia', { media: '' }) }
    })
  }
  await record('security/ข้อความจริงไม่กลายเป็นแท็กในแอป ใบปะงาน และ PDF ฟอร์ม', async () => {
    mode = 'literal-text'
    try {
      await goto('production', '/board?station=cut')
      await waitText(textFixture)
      const rendered = await ev(text => ({
        text: document.body.innerText.includes(text),
        script: Boolean(document.querySelector('#root script')),
      }), textFixture)
      assert.deepEqual(rendered, { text: true, script: false })
      await click('จักรเย็บ')
      await click('สถานะจักร')
      await waitText('อาการ: ' + textFixture)
      await goto('owner', '/label?id=' + mkId(0))
      await waitText(textFixture)
      assert.equal(await ev(() => Boolean(document.querySelector('.job-label-sheet script'))), false)

      const formFixture = JSON.parse(await readFile(new URL('../../app/tests/fixtures/tshirt-print-emb.json', import.meta.url), 'utf8'))
      await ev((fixture, text) => {
        fixture.h.customer = text
        localStorage.setItem('pp142.confirmation.inbox', JSON.stringify(fixture))
      }, formFixture, textFixture)
      await goto('owner', '/confirmation')
      await click('ดูตัวอย่าง PDF')
      const safe = await ev(text => ({
        text: document.querySelector('#doc').textContent.includes(text),
        script: Boolean(document.querySelector('#doc script')),
      }), textFixture)
      assert.deepEqual(safe, { text: true, script: false })
      await send('Emulation.setEmulatedMedia', { media: 'print' })
      try {
        const { data } = await send('Page.printToPDF', { preferCSSPageSize: true })
        assert.ok(Buffer.from(data, 'base64').subarray(0, 5).equals(Buffer.from('%PDF-')))
        return { pdfBytes: Buffer.from(data, 'base64').length }
      } finally { await send('Emulation.setEmulatedMedia', { media: '' }) }
    } finally { mode = 'normal' }
  })
  await record('BUG: resilience/service-worker รอรุ่นใหม่หลังคลิก', async () => {
    await send('Network.setBypassServiceWorker', { bypass: false })
    await goto('owner', '/system')
    await ev(async () => Boolean(await navigator.serviceWorker.ready))
    await goto('owner', '/system')
    const controlledRevision = () => ev(() => new Promise(resolve => {
      const worker = navigator.serviceWorker.controller
      if (!worker) return resolve(0)
      const channel = new MessageChannel()
      channel.port1.onmessage = ({ data }) => resolve(data)
      worker.postMessage('QA_REVISION', [channel.port2])
      setTimeout(() => resolve(0), 750)
    }))
    await waitFor(async () => await controlledRevision() === 1, 'service worker รุ่น 1 ควบคุมแท็บ')
    revision = 2
    await ev(async () => (await navigator.serviceWorker.ready).update().then(() => true))
    await waitText('มีระบบรุ่นใหม่')
    await click('โหลดรุ่นใหม่')
    try {
      await waitFor(async () => await controlledRevision() === 2, 'แท็บเปลี่ยนเป็น service worker revision 2', 15_000)
    } catch (error) {
      const worker = await ev(async () => {
        const registration = await navigator.serviceWorker.getRegistration()
        return { ready: registration?.active?.state, waiting: registration?.waiting?.state,
          controlling: navigator.serviceWorker.controller?.state }
      })
      await screenshot('worker-update-stalled')
      throw new Error(error.message + ' · ' + JSON.stringify(worker) + ' · revision ' + await controlledRevision())
    }
    return { revision }
  })
} finally {
  for (const row of results) console.log('R8_BROWSER ' + JSON.stringify(row))
  const failed = results.filter(r => !r.pass).length
  console.log('R8_BROWSER_TOTAL ' + JSON.stringify({ cases: results.length, failed }))
  if (failed) process.exitCode = 1
  await browser?.close()
  app.closeAllConnections()
  await new Promise(resolve => app.close(resolve))
}
