import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { ACCOUNTS } from './db.mjs'
import { sessionFor } from './server.mjs'

const CHROME_PATH = process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const IMG_DIR = process.env.QA_IMG_DIR ?? fileURLToPath(new URL('../../docs/qa/img/', import.meta.url))

export async function waitFor(fn, label, ms = 8000) {
  const end = Date.now() + ms
  let lastErr
  while (Date.now() < end) {
    try {
      const value = await fn()
      if (value) return value
    } catch (err) {
      lastErr = err
    }
    await delay(50)
  }
  throw new Error(`หมดเวลารอ ${label}${lastErr ? ` (${lastErr.message})` : ''}`)
}

function installPageScript(loopback, sessionsByKey) {
  if (location.origin !== loopback) return
  const params = new URLSearchParams(location.search)
  const key = params.get('qa-role')
  if (key === 'none') {
    localStorage.removeItem('sb-127-auth-token')
    localStorage.removeItem('pp142.station')
  } else if (key && sessionsByKey[key]) {
    localStorage.setItem('sb-127-auth-token', JSON.stringify(sessionsByKey[key]))
    if (params.get('keep-station') !== '1') localStorage.removeItem('pp142.station')
  }
  window.WebSocket = class LocalStubSocket {
    constructor() {
      this.readyState = 0
      setTimeout(() => {
        this.readyState = 1
        this.onopen?.(new Event('open'))
      }, 0)
    }
    send(message) {
      const [joinRef, ref, topic, event, payload] = JSON.parse(message)
      const changes = (payload?.config?.postgres_changes ?? []).map((f, i) => ({ ...f, id: i + 1 }))
      const data = JSON.stringify([joinRef, ref, topic, 'phx_reply', {
        status: 'ok',
        response: { postgres_changes: event === 'phx_join' ? changes : [] },
      }])
      setTimeout(() => this.onmessage?.(new MessageEvent('message', { data })), 0)
    }
    close() {
      this.readyState = 3
    }
    addEventListener(event, listener) {
      this['on' + event] = listener
    }
    removeEventListener(event) {
      delete this['on' + event]
    }
  }
}

export async function openChrome({ origin = 'http://127.0.0.1:5214', filesOrigin = 'http://127.0.0.1:5215' } = {}) {
  await mkdir(IMG_DIR, { recursive: true })
  const profile = await mkdtemp(join(tmpdir(), 'pp142-r14-chrome-'))
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-proxy-server',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    'about:blank',
  ], { windowsHide: true, stdio: 'ignore' })

  const sessionsByKey = Object.fromEntries(ACCOUNTS.map(a => [a.key, sessionFor(a)]))
  const externalAttempts = []
  const blockedFontRequests = []

  try {
    const port = (await waitFor(() => readFile(join(profile, 'DevToolsActivePort'), 'utf8'), 'Chrome')).split(/\r?\n/)[0]
    const endpoint = 'http://127.0.0.1:' + port

    async function connect(target) {
      const ws = new WebSocket(target.webSocketDebuggerUrl)
      await once(ws, 'open')
      const pending = new Map()
      const logs = []
      const dialogs = []
      let nextDialogAccept = true
      let id = 0

      const send = (method, params = {}) => new Promise((resolve, reject) => {
        const ticket = ++id
        const timer = setTimeout(() => {
          pending.delete(ticket)
          reject(new Error('CDP timeout: ' + method))
        }, 12_000)
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
          return
        }
        if (msg.method === 'Network.requestWillBeSent') {
          const u = msg.params.request?.url ?? ''
          if (/^https?:\/\//i.test(u) && !u.startsWith(origin) && !u.startsWith(filesOrigin)) {
            if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//i.test(u)) blockedFontRequests.push(u)
            else externalAttempts.push(u)
          }
        }
        if (msg.method === 'Page.javascriptDialogOpening') {
          dialogs.push({ type: msg.params.type, message: msg.params.message })
          void send('Page.handleJavaScriptDialog', { accept: nextDialogAccept }).catch(() => {})
        }
        if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
          const entry = msg.params.entry
          if (entry.source !== 'network' || !entry.url?.startsWith('https://fonts.googleapis.com/')) {
            logs.push({ source: 'log', text: entry.text, url: entry.url })
          }
        }
        if (msg.method === 'Runtime.exceptionThrown') {
          logs.push({
            source: 'exception',
            text: msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text,
          })
        }
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
          logs.push({
            source: 'console',
            text: msg.params.args.map(a => a.value ?? a.description).join(' '),
          })
        }
      })

      for (const domain of ['Page', 'Runtime', 'Network', 'Log', 'DOM']) await send(`${domain}.enable`)
      await send('Network.setBlockedURLs', { urls: ['https://*', 'http://localhost/*'] })
      await send('Network.setBypassServiceWorker', { bypass: true })
      await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(${installPageScript.toString()})(${JSON.stringify(origin)}, ${JSON.stringify(sessionsByKey)})`,
      })

      const ev = async (fn, ...args) => {
        const res = await send('Runtime.evaluate', {
          expression: `(${fn.toString()})(...${JSON.stringify(args)})`,
          awaitPromise: true,
          returnByValue: true,
        })
        if (res.exceptionDetails) {
          throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
        }
        return res.result.value
      }

      return {
        send,
        ev,
        logs,
        dialogs,
        setDialogAccept(v) { nextDialogAccept = v },
        detach: () => ws.close(),
      }
    }

    const targets = await (await fetch(endpoint + '/json/list')).json()
    const main = await connect(targets[0])
    const tabs = [main]
    const browserContexts = []

    async function browserSend(method, params = {}) {
      const ver = await (await fetch(endpoint + '/json/version')).json()
      const ws = new WebSocket(ver.webSocketDebuggerUrl)
      await once(ws, 'open')
      try {
        return await new Promise((resolve, reject) => {
          const ticket = Math.floor(Math.random() * 1e9)
          const onMsg = ({ data }) => {
            const msg = JSON.parse(data)
            if (msg.id !== ticket) return
            ws.removeEventListener('message', onMsg)
            if (msg.error) reject(new Error(msg.error.message))
            else resolve(msg.result)
          }
          ws.addEventListener('message', onMsg)
          ws.send(JSON.stringify({ id: ticket, method, params }))
        })
      } finally {
        ws.close()
      }
    }

    async function newTab({ isolated = false } = {}) {
      let target
      if (isolated) {
        const { browserContextId } = await browserSend('Target.createBrowserContext')
        browserContexts.push(browserContextId)
        const { targetId } = await browserSend('Target.createTarget', { url: 'about:blank', browserContextId })
        const list = await (await fetch(endpoint + '/json/list')).json()
        target = list.find(x => x.id === targetId)
        if (!target) throw new Error('ไม่พบ isolated target')
      } else {
        target = await (await fetch(endpoint + '/json/new?about:blank', { method: 'PUT' })).json()
      }
      const conn = await connect(target)
      tabs.push(conn)
      return conn
    }

    async function close() {
      for (const id of browserContexts) {
        await browserSend('Target.disposeBrowserContext', { browserContextId: id }).catch(() => {})
      }
      try { await Promise.race([main.send('Browser.close'), delay(600)]) } catch { /* ปิดแล้ว */ }
      for (const tab of tabs) tab.detach()
      chrome.kill()
      await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
    }

    return {
      main,
      newTab,
      close,
      get externalAttempts() { return externalAttempts },
      get blockedFontRequests() { return blockedFontRequests },
      wrap: tab => makeHelper(tab, origin),
    }
  } catch (err) {
    chrome.kill()
    throw err
  }
}

let navSeq = 0

function makeHelper(tab, origin) {
  const { ev, send } = tab

  async function goto(role, hash = '#/', width = 1440, path = '/', { keepStation = false, wait = true } = {}) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 920, deviceScaleFactor: 1, mobile: width <= 480 })
    const q = new URLSearchParams()
    if (role) q.set('qa-role', role)
    if (keepStation) q.set('keep-station', '1')
    q.set('r14', String(++navSeq))
    const url = `${origin}${path}?${q.toString()}${hash}`
    await send('Page.navigate', { url })
    if (wait) {
      await waitFor(() => ev(() => {
        if (document.readyState !== 'complete') return false
        const text = document.body.innerText.trim()
        if (!text.length) return false
        return !text.includes('กำลังตรวจสอบบัญชี') && !text.includes('กำลังโหลดข้อมูลงาน')
      }), `โหลดหน้า ${path}${hash}`)
    }
  }

  async function waitText(needle, ms = 8000) {
    const isRe = needle instanceof RegExp
    return waitFor(
      () => ev((pat, flags) => {
        const text = document.body.innerText
        return flags !== null ? new RegExp(pat, flags).test(text) : text.includes(pat)
      }, isRe ? needle.source : needle, isRe ? needle.flags : null),
      `ข้อความ "${needle}"`,
      ms,
    )
  }

  async function waitGone(needle, ms = 8000) {
    const isRe = needle instanceof RegExp
    return waitFor(
      () => ev((pat, flags) => {
        const text = document.body.innerText
        return !(flags !== null ? new RegExp(pat, flags).test(text) : text.includes(pat))
      }, isRe ? needle.source : needle, isRe ? needle.flags : null),
      `หายไป "${needle}"`,
      ms,
    )
  }

  async function clickButton(label, { exact = false, inside = 'body', index = 0 } = {}) {
    const isRe = label instanceof RegExp
    return waitFor(() => ev((pat, flags, ex, scope, idx) => {
      const root = document.querySelector(scope) ?? document.body
      const btns = [...root.querySelectorAll('button, [role="button"], summary')].filter(el => {
        if (!el.getClientRects().length) return false
        if ('disabled' in el && el.disabled) return false
        const txt = el.textContent.replace(/\s+/g, ' ').trim()
        if (flags !== null) return new RegExp(pat, flags).test(txt)
        return ex ? txt === pat : txt.includes(pat)
      })
      const btn = btns[idx]
      if (!btn) return false
      btn.scrollIntoView({ block: 'center', inline: 'nearest' })
      btn.click()
      return true
    }, isRe ? label.source : label, isRe ? label.flags : null, exact, inside, index), `ปุ่ม "${label}"`)
  }

  async function fillInput(selector, value, { index = 0 } = {}) {
    return waitFor(() => ev((sel, val, idx) => {
      const nodes = [...document.querySelectorAll(sel)].filter(n => n.getClientRects().length || n.type === 'date' || n.type === 'datetime-local')
      const el = nodes[idx]
      if (!el) return false
      el.scrollIntoView({ block: 'center' })
      el.focus()
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }, selector, value, index), `ช่อง "${selector}"`)
  }

  async function selectOption(selector, value, { index = 0 } = {}) {
    return waitFor(() => ev((sel, val, idx) => {
      const nodes = [...document.querySelectorAll(sel)].filter(n => n.getClientRects().length)
      const el = nodes[idx]
      if (!el) return false
      el.scrollIntoView({ block: 'center' })
      el.value = val
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }, selector, value, index), `เลือก "${selector}=${value}"`)
  }

  async function uploadFiles(selector, files, { index = 0 } = {}) {
    await send('DOM.getDocument', { depth: -1 })
    const ok = await ev((sel, idx) => {
      const nodes = document.querySelectorAll(sel)
      return Boolean(nodes[idx])
    }, selector, index)
    if (!ok) throw new Error(`ไม่พบ file input ${selector}[${index}]`)
    const { root } = await send('DOM.getDocument', { depth: -1 })
    const list = await send('DOM.querySelectorAll', { nodeId: root.nodeId, selector })
    const nodeId = list.nodeIds[index]
    if (!nodeId) throw new Error(`ไม่พบ DOM node ${selector}[${index}]`)
    await send('DOM.setFileInputFiles', { nodeId, files })
  }

  async function screenshot(name, { fullPage = false } = {}) {
    await send('Page.bringToFront')
    await ev(async () => {
      await Promise.allSettled(document.getAnimations().map(a => a.finished).slice(0, 20))
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    })
    const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: fullPage })
    const out = join(IMG_DIR, `r14-ag-${name}.png`)
    await writeFile(out, Buffer.from(data, 'base64'))
    return out
  }

  async function printPdf(name, { landscape = false, paperWidth, paperHeight } = {}) {
    await send('Page.bringToFront')
    const opts = {
      printBackground: true,
      preferCSSPageSize: true,
      landscape,
      ...(paperWidth ? { paperWidth } : {}),
      ...(paperHeight ? { paperHeight } : {}),
    }
    const { data } = await send('Page.printToPDF', opts)
    const buf = Buffer.from(data, 'base64')
    const out = join(IMG_DIR, `r14-ag-${name}.pdf`)
    await writeFile(out, buf)
    return { path: out, bytes: buf.byteLength, header: buf.subarray(0, 5).toString() }
  }

  async function setOffline(offline) {
    await send('Network.emulateNetworkConditions', {
      offline,
      latency: 0,
      downloadThroughput: offline ? 0 : -1,
      uploadThroughput: offline ? 0 : -1,
    })
    await ev(isOff => window.dispatchEvent(new Event(isOff ? 'offline' : 'online')), offline)
  }

  async function measureFloorUx(width) {
    return ev(w => {
      const main = document.querySelector('main,[data-scroll="dashboard"]') ?? document.body
      const text = main.innerText
      const badTokens = text.match(/(?:^|[\s(])(?:NaN|Infinity|undefined|null)(?=[\s.,)]|$)/g) ?? []
      const overflows = [...main.querySelectorAll('*')].filter(el => {
        if (!el.getClientRects().length) return false
        if (el.closest('.overflow-auto,.overflow-x-auto,[data-allow-scroll]')) return false
        const r = el.getBoundingClientRect()
        return r.right > w + 2
      }).slice(0, 5).map(el => ({
        tag: el.tagName,
        right: Math.round(el.getBoundingClientRect().right),
        text: el.textContent.trim().slice(0, 40),
      }))
      const smallButtons = [...main.querySelectorAll('button,a[role="button"]')].filter(b => {
        if (!b.getClientRects().length) return false
        const cls = b.getAttribute('class') ?? ''
        const isPrimaryAction = /\b(bg-brand|bg-danger|bg-ok|min-h-12)\b/.test(cls)
        if (!isPrimaryAction) return false
        const h = b.getBoundingClientRect().height
        return h < 47.5
      }).map(b => ({ text: b.textContent.trim().slice(0, 40), height: Math.round(b.getBoundingClientRect().height) }))
      const disabledNoReason = [...main.querySelectorAll('button:disabled')].filter(b => {
        if (!b.getClientRects().length) return false
        const txt = b.textContent.trim()
        const title = b.getAttribute('title') ?? ''
        return !txt && !title
      }).length
      const bodyFontSize = Number.parseFloat(getComputedStyle(main).fontSize)
      return {
        viewport: innerWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        mainOverflow: main.scrollWidth - main.clientWidth,
        overflows,
        smallButtons,
        disabledNoReason,
        bodyFontSize,
        badTokens,
      }
    }, width)
  }

  return {
    tab,
    ev,
    send,
    goto,
    waitText,
    waitGone,
    clickButton,
    fillInput,
    selectOption,
    uploadFiles,
    screenshot,
    printPdf,
    setOffline,
    measureFloorUx,
  }
}
