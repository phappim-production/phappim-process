import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const chromePath = process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'

export async function waitFor(fn, label, ms = 6500) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value } catch { /* ระหว่างเปลี่ยนเอกสาร execution context ยังไม่พร้อม */ }
    await delay(50)
  }
  throw new Error('หมดเวลารอ ' + label)
}

export async function openChrome() {
  const profile = await mkdtemp(join(tmpdir(), 'pp142-r9-chrome-'))
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
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        const entry = msg.params.entry
        if (entry.source !== 'network' || !entry.url?.startsWith('https://fonts.googleapis.com/')) logs.push(entry.text)
      }
      if (msg.method === 'Runtime.exceptionThrown') logs.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        logs.push(msg.params.args.map(arg => arg.value ?? arg.description).join(' '))
      }
    })
    for (const domain of ['Page', 'Runtime', 'Network', 'Log']) await send(domain + '.enable')
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
      await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
    }
    return { send, ev, logs, close }
  } catch (error) {
    chrome.kill()
    throw error
  }
}
