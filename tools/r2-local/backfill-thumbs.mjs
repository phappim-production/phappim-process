// สร้างรูปย่อให้รูปม็อคอัพเก่าที่ยังไม่มี ผ่าน Worker ด้วยโทเคนแอดมิน (ทางเดียวกับหน้าเว็บ) · ย่อรูปด้วย Chrome headless ในเครื่อง ไม่ต้องลงแพ็กเกจเพิ่ม
// ใช้: FILES_URL=… SUPABASE_URL=… SUPABASE_ANON_KEY=… ACCESS_TOKEN=<โทเคนแอดมิน> node tools/r2-local/backfill-thumbs.mjs [--dry-run] [--live]
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

const SIGN_BATCH = 200

export async function listMockupPaths({ supabaseUrl, anonKey, token, fetcher = fetch, pageSize = 1000 }) {
  const paths = new Set()
  for (let offset = 0; ; offset += pageSize) {
    const res = await fetcher(`${supabaseUrl}/rest/v1/jobs?select=id,mockup_path,spec&order=id&limit=${pageSize}&offset=${offset}`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`อ่านรายการงานไม่ได้ (${res.status}) ${await res.text()}`)
    const rows = await res.json()
    for (const row of rows) {
      if (typeof row.mockup_path === 'string' && row.mockup_path) paths.add(row.mockup_path)
      for (const m of Array.isArray(row.spec?.mockups) ? row.spec.mockups : []) if (typeof m?.path === 'string' && m.path) paths.add(m.path)
    }
    if (rows.length < pageSize) break
  }
  return [...paths].sort()
}

export async function backfillThumbs({ filesUrl, token, paths, shrink, fetcher = fetch, log = () => {}, dryRun = false }) {
  const result = { made: [], missing: [], had: [], skipped: [], failed: [] }
  const auth = { Authorization: `Bearer ${token}` }
  for (let i = 0; i < paths.length; i += SIGN_BATCH) {
    const batch = paths.slice(i, i + SIGN_BATCH)
    const signed = await fetcher(`${filesUrl}/sign`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'mockups', paths: batch, seconds: 600 }),
    })
    if (!signed.ok) throw new Error(`ขอลิงก์ไม่ได้ (${signed.status}) ${await signed.text()}`)
    const { urls = {} } = await signed.json()
    for (const path of batch) {
      const url = urls[path]
      if (!url) { result.skipped.push(path); continue }
      try {
        const probe = await fetcher(`${url}&v=thumb`, { method: 'HEAD' })
        if (!probe.ok) throw new Error(`เปิดรูปไม่ได้ (${probe.status})`)
        if (probe.headers.get('X-File-Variant') === 'thumb') { result.had.push(path); continue }
        if (dryRun) { result.missing.push(path); continue }
        const original = await fetcher(url)
        if (!original.ok) throw new Error(`โหลดรูปต้นฉบับไม่ได้ (${original.status})`)
        const small = await shrink(new Uint8Array(await original.arrayBuffer()), original.headers.get('Content-Type') ?? 'image/jpeg')
        const up = await fetcher(`${filesUrl}/upload/mockups/${path}.thumb.jpg`, {
          method: 'PUT', body: small,
          headers: { ...auth, 'Content-Type': 'image/jpeg', 'Content-Length': String(small.byteLength) },
        })
        if (!up.ok) throw new Error(`ส่งรูปย่อไม่ได้ (${up.status}) ${await up.text()}`)
        result.made.push(path)
        log(`รูปย่อ ${path} (${small.byteLength} ไบต์)`)
      } catch (e) {
        result.failed.push({ path, error: e instanceof Error ? e.message : String(e) })
        log(`ไม่สำเร็จ ${path}: ${e instanceof Error ? e.message : e}`)
      }
    }
  }
  return result
}

async function pageShrink(base64, type, side, quality) {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const bmp = await createImageBitmap(new Blob([bytes], { type }))
  const k = Math.min(1, side / Math.max(bmp.width, bmp.height))
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)))
  const g = canvas.getContext('2d')
  g.fillStyle = '#fff'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const out = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality })).arrayBuffer())
  let text = ''
  for (let i = 0; i < out.length; i += 0x8000) text += String.fromCharCode(...out.subarray(i, i + 0x8000))
  return btoa(text)
}

export async function chromeShrink({ chromePath = process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', side = 240, quality = 0.7 } = {}) {
  const profile = await mkdtemp(join(tmpdir(), 'pp142-thumbs-'))
  const chrome = spawn(chromePath, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--no-first-run', '--no-proxy-server',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' })
  const exited = once(chrome, 'exit').catch(() => {})
  let ws = null
  const close = async () => {
    ws?.close()
    chrome.kill()
    await exited
    await rm(profile, { recursive: true, force: true }).catch(() => {})
  }
  try {
    let port = null
    for (let i = 0; i < 200 && !port; i++) {
      port = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').then(t => t.split(/\r?\n/)[0], () => null)
      if (!port) await delay(50)
    }
    if (!port) throw new Error('เปิด Chrome ไม่ได้ ตั้ง QA_CHROME เป็นที่อยู่ chrome.exe')
    const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page')
    ws = new WebSocket(page.webSocketDebuggerUrl)
    await once(ws, 'open')
    const pending = new Map()
    let id = 0
    ws.addEventListener('message', ({ data }) => {
      const msg = JSON.parse(data)
      const task = pending.get(msg.id)
      if (!task) return
      pending.delete(msg.id)
      if (msg.error) task.reject(new Error(msg.error.message))
      else task.resolve(msg.result)
    })
    const send = (method, params) => new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
    const shrink = async (bytes, type) => {
      const args = [Buffer.from(bytes).toString('base64'), type, side, quality].map(a => JSON.stringify(a)).join(', ')
      const res = await send('Runtime.evaluate', { expression: `(${pageShrink})(${args})`, awaitPromise: true, returnByValue: true })
      if (res.exceptionDetails) throw new Error(`ย่อรูปไม่ได้: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`)
      return new Uint8Array(Buffer.from(res.result.value, 'base64'))
    }
    return { shrink, close }
  } catch (e) {
    await close()
    throw e
  }
}

const isLoopback = url => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)

async function main() {
  const { FILES_URL, SUPABASE_URL, SUPABASE_ANON_KEY, ACCESS_TOKEN } = process.env
  const dryRun = process.argv.includes('--dry-run')
  if (!FILES_URL || !SUPABASE_URL || !SUPABASE_ANON_KEY || !ACCESS_TOKEN) {
    console.error('ต้องตั้ง FILES_URL SUPABASE_URL SUPABASE_ANON_KEY ACCESS_TOKEN (โทเคนของบัญชีแอดมิน)')
    process.exit(2)
  }
  if (!process.argv.includes('--live') && !(isLoopback(FILES_URL) && isLoopback(SUPABASE_URL))) {
    console.error('ที่อยู่ไม่ใช่เครื่องนี้ · ระบบจริงต้องใส่ --live (เจ้าของสั่งเท่านั้น)')
    process.exit(2)
  }
  const filesUrl = FILES_URL.replace(/\/+$/, '')
  const paths = await listMockupPaths({ supabaseUrl: SUPABASE_URL.replace(/\/+$/, ''), anonKey: SUPABASE_ANON_KEY, token: ACCESS_TOKEN })
  console.log(`รูปม็อคอัพในงาน ${paths.length} รูป${dryRun ? ' (ตรวจอย่างเดียว)' : ''}`)
  const chrome = dryRun ? null : await chromeShrink()
  try {
    const r = await backfillThumbs({
      filesUrl, token: ACCESS_TOKEN, paths, dryRun, log: line => console.log(line),
      shrink: chrome ? chrome.shrink : () => { throw new Error('dry run') },
    })
    console.log(`สร้างใหม่ ${r.made.length} · ยังไม่มี ${r.missing.length} · มีอยู่แล้ว ${r.had.length} · เปิดไม่ได้ ${r.skipped.length} · ไม่สำเร็จ ${r.failed.length}`)
    if (r.failed.length) process.exitCode = 1
  } finally {
    await chrome?.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
