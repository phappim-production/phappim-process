import { createServer } from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { createHandler } from '../../workers/files/src/index.js'
import { ACCOUNT_BY_ID, ACCOUNTS, DEFAULT_PASSWORD, RECORD_SECRET, createLocalDb } from './db.mjs'
import { handleRest } from './postgrest.mjs'

const DIST = fileURLToPath(new URL('../../app/dist/', import.meta.url))
const LINK_SECRET = 'r14-local-link-secret-0123456789abcdef'
const EXPIRES_AT = 4_000_000_000

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

function makeJwt(account) {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    aud: 'authenticated',
    exp: EXPIRES_AT,
    sub: account.id,
    email: account.email,
    role: 'authenticated',
  })).toString('base64url')
  return `${head}.${payload}.r14local`
}

function userObject(account) {
  return {
    id: account.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: account.email,
    email_confirmed_at: '2026-11-21T00:00:00.000Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { name: account.name },
    created_at: '2026-11-21T00:00:00.000Z',
    updated_at: '2026-11-21T00:00:00.000Z',
  }
}

export function sessionFor(account) {
  return {
    access_token: makeJwt(account),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: EXPIRES_AT,
    refresh_token: `r14-refresh-${account.key}`,
    user: userObject(account),
  }
}

function accountFromAuth(authHeader) {
  const m = /^Bearer\s+(\S+)$/i.exec(authHeader ?? '')
  if (!m) return null
  const parts = m[1].split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return ACCOUNT_BY_ID[payload.sub] ?? null
  } catch {
    return null
  }
}

function sendJson(res, status, value, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': 'Content-Range, X-Supabase-Api-Version',
    'X-Supabase-Api-Version': '2024-01-01',
    ...extraHeaders,
  })
  if (value === undefined) res.end()
  else res.end(JSON.stringify(value))
}

function switchHtml(origin) {
  const rows = ACCOUNTS.map(acc => {
    const sess = JSON.stringify(JSON.stringify(sessionFor(acc)))
    const badge = !acc.active ? 'ปิดใช้งาน' : acc.role === null ? 'ไม่มีบทบาท' : acc.role
    const extra = acc.stations.length ? ` (${acc.stations.join(', ')})` : acc.section ? ` (เฟส ${acc.section})` : ''
    return `<li style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #e5e7eb">
      <div style="flex:1"><b>${acc.name}</b> <small style="color:#6b7280">${acc.email} · ${badge}${extra}</small></div>
      <button onclick='pick(${sess})' style="padding:8px 14px;border-radius:8px;border:1px solid #166534;background:#166534;color:#fff;cursor:pointer">เข้าใช้งาน</button>
    </li>`
  }).join('')
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA R14 — สลับบัญชีจำลอง</title></head>
<body style="font-family:sans-serif;max-width:720px;margin:24px auto;padding:0 16px">
<h1>สลับบัญชีจำลอง (QA รอบ 14 · PGlite ในเครื่อง)</h1>
<p>ฐานข้อมูลจริงในเครื่อง · ไม่มีการเชื่อมต่อระบบจริง · รหัสผ่านเริ่มต้น: <code>${DEFAULT_PASSWORD}</code></p>
<div style="display:flex;gap:10px;margin:16px 0">
  <button onclick="resetAll()" style="padding:10px 16px;border-radius:8px;border:1px solid #b91c1c;background:#b91c1c;color:#fff;cursor:pointer">ล้างข้อมูลทั้งหมด (Reset DB + R2)</button>
  <a href="/confirmation" target="_blank" style="padding:10px 16px;border-radius:8px;border:1px solid #374151;color:#111;text-decoration:none">เปิดฟอร์มใบยืนยัน</a>
  <button onclick="signOutLocal()" style="padding:10px 16px;border-radius:8px;border:1px solid #374151;background:#fff;cursor:pointer">ล้างเซสชัน (หน้าล็อกอิน)</button>
</div>
<p id="msg" style="color:#166534;font-weight:bold"></p>
<ul style="list-style:none;padding:0">${rows}</ul>
<script>
const ORIGIN = ${JSON.stringify(origin)};
function pick(raw){
  localStorage.setItem('sb-127-auth-token', raw);
  localStorage.removeItem('pp142.station');
  location.href = ORIGIN + '/#/';
}
function signOutLocal(){
  localStorage.removeItem('sb-127-auth-token');
  localStorage.removeItem('pp142.station');
  location.href = ORIGIN + '/#/';
}
async function resetAll(){
  const r = await fetch('/__qa/reset', { method: 'POST' });
  document.getElementById('msg').textContent = r.ok ? 'ล้างข้อมูล DB + R2 กลับค่าเริ่มต้นแล้ว' : 'ล้างข้อมูลไม่สำเร็จ';
}
</script></body></html>`
}

export async function startLocalStack({ port = Number(process.env.QA_PORT ?? 5214), filesPort = Number(process.env.QA_FILES_PORT ?? 5215) } = {}) {
  const db = await createLocalDb()
  const r2Store = new Map()
  const passwords = new Map(ACCOUNTS.map(a => [a.id, DEFAULT_PASSWORD]))
  let config = { latencyMs: 0, failTables: [], serverDown: false, missingChunkPattern: null, swRev: 0 }

  const r2 = {
    async head(key) {
      const v = r2Store.get(key)
      return v ? { size: v.bytes.byteLength, httpMetadata: { contentType: v.type } } : null
    },
    async get(key) {
      const v = r2Store.get(key)
      return v ? { size: v.bytes.byteLength, httpMetadata: { contentType: v.type }, body: new Blob([v.bytes]).stream() } : null
    },
    async put(key, bytes, opts) {
      r2Store.set(key, { bytes: new Uint8Array(bytes), type: opts.httpMetadata.contentType })
    },
  }

  let siteOrigin = `http://127.0.0.1:${port}`
  let filesOrigin = `http://127.0.0.1:${filesPort}`

  const workerHandler = createHandler()
  const workerEnv = () => ({
    FILES: r2,
    ALLOWED_ORIGINS: siteOrigin,
    SUPABASE_URL: siteOrigin,
    SUPABASE_ANON_KEY: 'r14-local-anon-key',
    RECORD_SECRET,
    LINK_SECRET,
  })

  async function resetAll() {
    await db.reset()
    r2Store.clear()
    for (const a of ACCOUNTS) passwords.set(a.id, DEFAULT_PASSWORD)
    config = { latencyMs: 0, failTables: [], serverDown: false, missingChunkPattern: null, swRev: 0 }
  }

  const siteServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, siteOrigin)
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Expose-Headers': 'Content-Range',
        })
        return res.end()
      }

      if (url.pathname === '/__qa/switch') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        return res.end(switchHtml(siteOrigin))
      }
      if (url.pathname === '/__qa/accounts') {
        return sendJson(res, 200, ACCOUNTS.map(a => ({ ...a, session: sessionFor(a) })))
      }
      if (url.pathname === '/__qa/reset' && req.method === 'POST') {
        await resetAll()
        return sendJson(res, 200, { ok: true })
      }
      if (url.pathname === '/__qa/config' && req.method === 'POST') {
        const patch = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        config = { ...config, ...patch }
        return sendJson(res, 200, config)
      }
      if (url.pathname === '/__qa/sql' && req.method === 'POST') {
        const { sql, params } = JSON.parse((await readBody(req)).toString('utf8'))
        const result = await db.execSuper(sql, params ?? [])
        return sendJson(res, 200, { rows: result.rows, affectedRows: result.affectedRows })
      }

      if (url.pathname.startsWith('/auth/v1/')) {
        if (config.serverDown) return sendJson(res, 503, { code: 'server_down', message: 'Simulated outage' })
        if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
          const grant = url.searchParams.get('grant_type')
          const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
          if (grant === 'password') {
            const email = String(body.email ?? '').trim().toLowerCase()
            const acc = ACCOUNTS.find(a => a.email.toLowerCase() === email)
            if (!acc || passwords.get(acc.id) !== body.password) {
              return sendJson(res, 400, { code: 'invalid_credentials', error_code: 'invalid_credentials', message: 'Invalid login credentials' })
            }
            return sendJson(res, 200, sessionFor(acc))
          }
          if (grant === 'refresh_token') {
            const key = String(body.refresh_token ?? '').replace(/^r14-refresh-/, '')
            const acc = ACCOUNTS.find(a => a.key === key)
            if (!acc) return sendJson(res, 400, { code: 'invalid_grant', error_code: 'invalid_grant', message: 'Invalid refresh token' })
            return sendJson(res, 200, sessionFor(acc))
          }
          return sendJson(res, 400, { code: 'unsupported_grant_type', error_code: 'unsupported_grant_type', message: 'Unsupported grant' })
        }
        if (url.pathname === '/auth/v1/user') {
          const acc = accountFromAuth(req.headers.authorization)
          if (!acc) return sendJson(res, 401, { code: 'session_not_found', error_code: 'session_not_found', message: 'Invalid JWT' })
          if (req.method === 'GET') return sendJson(res, 200, userObject(acc))
          if (req.method === 'PUT') {
            const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
            if (typeof body.password === 'string') {
              if (body.password === passwords.get(acc.id)) {
                return sendJson(res, 422, { code: 'same_password', error_code: 'same_password', message: 'New password should be different from the old password.' })
              }
              if (body.password.length < 8) {
                return sendJson(res, 422, { code: 'weak_password', error_code: 'weak_password', message: 'Password should be at least 8 characters.' })
              }
              passwords.set(acc.id, body.password)
            }
            return sendJson(res, 200, userObject(acc))
          }
        }
        if (url.pathname === '/auth/v1/logout' && req.method === 'POST') {
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*' })
          return res.end()
        }
        return sendJson(res, 404, { message: 'Auth endpoint not found' })
      }

      if (url.pathname.startsWith('/rest/v1/')) {
        if (config.latencyMs > 0) await new Promise(r => setTimeout(r, config.latencyMs))
        const restPath = url.pathname.slice('/rest/v1/'.length)
        if (config.serverDown || config.failTables.includes(restPath)) {
          return sendJson(res, 500, { code: 'P0001', message: 'จำลองเซิร์ฟเวอร์ขัดข้องชั่วคราว' })
        }
        const acc = accountFromAuth(req.headers.authorization)
        const rawBody = req.method === 'GET' || req.method === 'HEAD' ? '' : (await readBody(req)).toString('utf8')
        const reply = await handleRest({
          db,
          method: req.method,
          path: restPath,
          url,
          headers: { ...req.headers, 'x-qa-uid': acc?.id ?? null },
          bodyText: rawBody,
        })
        return sendJson(res, reply.status, reply.body === null ? undefined : reply.body, reply.headers)
      }

      const relPath = url.pathname === '/' ? '/index.html' : url.pathname === '/confirmation' ? '/confirmation.html' : url.pathname
      if (config.missingChunkPattern && new RegExp(config.missingChunkPattern).test(relPath)) {
        config.missingChunkPattern = null
        res.writeHead(404, { 'Cache-Control': 'no-store' })
        return res.end()
      }
      const fullPath = resolve(DIST, '.' + relPath)
      if (!fullPath.startsWith(resolve(DIST) + sep)) {
        res.writeHead(404)
        return res.end()
      }
      const data = await readFile(fullPath)
      const bytes = relPath === '/sw.js' && config.swRev > 0
        ? Buffer.concat([data, Buffer.from(`\n// local qa rev ${config.swRev}\n`)])
        : data
      res.writeHead(200, { 'Content-Type': MIME[extname(fullPath)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
      res.end(bytes)
    } catch (err) {
      if (err?.code === 'ENOENT') {
        res.writeHead(404)
        return res.end()
      }
      console.error(err)
      if (!res.headersSent) sendJson(res, 500, { message: err?.message ?? 'Internal error' })
    }
  })

  const workerServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, filesOrigin)
      if (url.pathname === '/__qa/r2-stats' && req.method === 'GET') {
        const keys = [...r2Store.entries()].map(([k, v]) => ({ key: k, size: v.bytes.byteLength, type: v.type }))
        return sendJson(res, 200, { count: keys.length, objects: keys })
      }
      if (url.pathname === '/__qa/r2-reset' && req.method === 'POST') {
        r2Store.clear()
        return sendJson(res, 200, { ok: true })
      }
      const body = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' ? undefined : Readable.toWeb(req)
      const request = new Request(filesOrigin + req.url, { method: req.method, headers: req.headers, body, duplex: 'half' })
      const reply = await workerHandler(request, workerEnv())
      res.writeHead(reply.status, Object.fromEntries(reply.headers))
      res.end(reply.body ? Buffer.from(await reply.arrayBuffer()) : undefined)
    } catch (err) {
      console.error(err)
      if (!res.headersSent) res.writeHead(500)
      res.end()
    }
  })

  siteServer.listen(port, '127.0.0.1')
  workerServer.listen(filesPort, '127.0.0.1')
  await Promise.all([once(siteServer, 'listening'), once(workerServer, 'listening')])
  siteOrigin = `http://127.0.0.1:${siteServer.address().port}`
  filesOrigin = `http://127.0.0.1:${workerServer.address().port}`

  return {
    origin: siteOrigin,
    filesOrigin,
    db,
    r2Store,
    reset: resetAll,
    setConfig(patch) {
      config = { ...config, ...patch }
    },
    async close() {
      await Promise.all([
        new Promise(r => siteServer.close(r)),
        new Promise(r => workerServer.close(r)),
      ])
      await db.close()
    },
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stack = await startLocalStack()
  console.log(`QA R14 local stack ready:`)
  console.log(`  App + Supabase API : ${stack.origin}`)
  console.log(`  Account switcher   : ${stack.origin}/__qa/switch`)
  console.log(`  Confirmation form  : ${stack.origin}/confirmation`)
  console.log(`  R2 Worker          : ${stack.filesOrigin}`)
}
