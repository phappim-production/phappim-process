// สภาพแวดล้อมแยกสำหรับลองหน้าจอ R2: เว็บที่ build แล้ว + Supabase จำลอง (qa-r11) + Worker ตัวจริงกับ R2 ในหน่วยความจำ
// build: VITE_SUPABASE_URL=http://127.0.0.1:5199 VITE_SUPABASE_ANON_KEY=r11-loopback-fixture VITE_FILES_URL=http://127.0.0.1:5198 npm --prefix app run build
// ล็อกอินจำลอง: เปิด http://127.0.0.1:5199/?qa-role=admin แล้วรัน loginScript('admin') ในคอนโซล (พิมพ์ไว้ตอนเริ่ม)
import { createServer } from 'node:http'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import { fixtureApi, users } from '../qa-r11/api.mjs'
import { MAX_BYTES, createHandler, hmacHex } from '../../workers/files/src/index.js'

const SITE = 'http://127.0.0.1:5199'
const FIXTURE = 'http://127.0.0.1:5197'
const WORKER = 'http://127.0.0.1:5198'
const RECORD_SECRET = 'local-record-secret-0123456789abcdef'
const uploaders = new Set(['admin', 'owner'])
const disabled = new Set(process.env.R2_DISABLED?.split(',') ?? [])

const api = fixtureApi()
api.reset(process.env.R2_SCENARIO ?? 'approved')
api.server.listen(5197, '127.0.0.1')
await once(api.server, 'listening')

const files = new Map()
const overlay = new Map()
const store = new Map()
const r2 = {
  async head(key) { const v = store.get(key); return v ? { size: v.bytes.byteLength, httpMetadata: { contentType: v.type } } : null },
  async get(key) { const v = store.get(key); return v ? { size: v.bytes.byteLength, httpMetadata: { contentType: v.type }, body: new Blob([v.bytes]).stream() } : null },
  async put(key, bytes, opts) { store.set(key, { bytes: new Uint8Array(bytes), type: opts.httpMetadata.contentType }); console.log('R2 put', key, bytes.byteLength) },
}
const env = {
  FILES: r2, ALLOWED_ORIGINS: SITE, SUPABASE_URL: SITE, SUPABASE_ANON_KEY: 'r11-loopback-fixture',
  RECORD_SECRET, LINK_SECRET: 'local-link-secret-0123456789abcdef',
}
const worker = createHandler()

const send = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': SITE })
  res.end(value === undefined ? '' : JSON.stringify(value))
}
async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks)
}

async function fileRpc(fn, args, roleKey) {
  if (!users[roleKey] || disabled.has(roleKey)) return [400, { code: '42501', message: 'บัญชีนี้ถูกปิดหรือยังไม่ได้ล็อกอิน ให้ล็อกอินใหม่หรือแจ้งเจ้าของระบบ' }]
  if (fn === 'file_read_allowed') {
    const referenced = new Set([...overlay.values()].flatMap(o => [o.confirmation_pdf_path, o.mockup_path]).filter(Boolean))
    return [200, args.p_paths.filter(p => referenced.has(p) || files.get(`${args.p_kind}/${p}`)?.by === roleKey)]
  }
  if (!uploaders.has(roleKey)) return [400, { code: '42501', message: `บทบาทของคุณ (${roleKey}) ทำขั้นนี้ไม่ได้` }]
  if (args.p_size > MAX_BYTES) return [400, { code: '23514', message: 'ไฟล์ใหญ่เกิน 20 MB ให้ย่อไฟล์ก่อน' }]
  if (fn === 'file_upload_allowed') return [204]
  const want = await hmacHex(RECORD_SECRET, `${args.p_kind}|${args.p_path}|${args.p_size}|${args.p_type}`)
  if (args.p_proof !== want) return [400, { code: '42501', message: 'ยืนยันไฟล์ไม่ผ่าน ให้อัปโหลดไฟล์อีกครั้ง' }]
  if (!files.has(`${args.p_kind}/${args.p_path}`)) files.set(`${args.p_kind}/${args.p_path}`, { size: args.p_size, by: roleKey })
  return [204]
}

async function site(req, res) {
  const url = new URL(req.url, SITE)
  const roleKey = req.headers.authorization?.split('.').at(-1)
  const rpc = url.pathname.startsWith('/rest/v1/rpc/') ? url.pathname.slice('/rest/v1/rpc/'.length) : null
  if (req.method === 'OPTIONS') return send(res, 204)
  if (rpc && ['file_upload_allowed', 'record_file_upload', 'file_read_allowed'].includes(rpc)) {
    const [status, value] = await fileRpc(rpc, JSON.parse(await readBody(req)), roleKey)
    return send(res, status, value)
  }
  if (rpc === 'attach_confirmation_pdf' || rpc === 'set_job_mockup') {
    const args = JSON.parse(await readBody(req))
    const kind = rpc === 'attach_confirmation_pdf' ? 'confirmations' : 'mockups'
    if (!files.has(`${kind}/${args.p_path}`)) return send(res, 400, { code: '23514', message: kind === 'mockups' ? 'ยังไม่พบรูปม็อคอัพในระบบ ให้เลือกรูปแล้วกดอีกครั้ง' : 'ยังไม่พบไฟล์ PDF ใบยืนยันในระบบ ให้แนบไฟล์แล้วกดอีกครั้ง' })
    overlay.set(args.p_job, { ...overlay.get(args.p_job), [kind === 'mockups' ? 'mockup_path' : 'confirmation_pdf_path']: args.p_path })
    console.log(rpc, args.p_job, args.p_path)
    return send(res, 200, null)
  }
  const raw = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req)
  if (rpc === 'receive_job') {
    const args = JSON.parse(raw)
    if (args.p_confirmation_pdf_path && !files.has(`confirmations/${args.p_confirmation_pdf_path}`)) {
      return send(res, 400, { code: '23514', message: 'ยังไม่พบไฟล์ PDF ใบยืนยันในระบบ ให้แนบไฟล์แล้วกดอีกครั้ง' })
    }
  }
  const upstream = await fetch(FIXTURE + req.url, { method: req.method, headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => !['host', 'connection', 'content-length'].includes(k))), body: raw })
  const type = upstream.headers.get('content-type') ?? ''
  if (rpc === 'receive_job' && upstream.ok) {
    const id = await upstream.json()
    const args = JSON.parse(raw)
    overlay.set(id, { ...overlay.get(id), confirmation_pdf_path: args.p_confirmation_pdf_path || null })
    return send(res, 200, id)
  }
  if (/^\/rest\/v1\/(jobs|job_live)$/.test(url.pathname) && type.includes('json') && req.method === 'GET') {
    const rows = await upstream.json()
    const patch = r => (r && overlay.has(r.id) ? { ...r, ...Object.fromEntries(Object.entries(overlay.get(r.id)).filter(([, v]) => v !== undefined)) } : r)
    return send(res, 200, Array.isArray(rows) ? rows.map(patch) : patch(rows))
  }
  const headers = Object.fromEntries([...upstream.headers].filter(([k]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(k)))
  res.writeHead(upstream.status, headers)
  res.end(Buffer.from(await upstream.arrayBuffer()))
}

const wrap = handler => createServer((req, res) => handler(req, res).catch(e => { console.error(e); if (!res.headersSent) res.writeHead(500); res.end() }))
const siteServer = wrap(site)
siteServer.listen(5199, '127.0.0.1')

const outage = { dropPuts: 0 }
const workerServer = wrap(async (req, res) => {
  const drop = /^\/__drop\/(\d+)$/.exec(req.url)
  if (drop) { outage.dropPuts = Number(drop[1]); return send(res, 200, outage) }
  if (req.method === 'PUT' && outage.dropPuts > 0) {
    outage.dropPuts--
    console.log('จำลองเน็ตหลุดระหว่างอัปโหลด', req.url)
    req.once('data', () => req.socket.destroy())
    return
  }
  const body = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' ? undefined : Readable.toWeb(req)
  const request = new Request(WORKER + req.url, { method: req.method, headers: req.headers, body, duplex: 'half' })
  const reply = await worker(request, env)
  res.writeHead(reply.status, Object.fromEntries(reply.headers))
  res.end(reply.body ? Buffer.from(await reply.arrayBuffer()) : undefined)
})
workerServer.listen(5198, '127.0.0.1')
await Promise.all([once(siteServer, 'listening'), once(workerServer, 'listening')])

const token = key => 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + Buffer.from(JSON.stringify({ exp: 4_000_000_000, sub: users[key].id })).toString('base64url') + '.' + key
console.log('พร้อม: เว็บ', SITE, '· Worker', WORKER)
for (const key of ['admin', 'production', 'qc']) {
  console.log(`login ${key}: localStorage.setItem('sb-127-auth-token', ${JSON.stringify(JSON.stringify({ access_token: token(key), refresh_token: 'local', expires_at: 4_000_000_000, token_type: 'bearer', user: { ...users[key], aud: 'authenticated' } }))})`)
}
