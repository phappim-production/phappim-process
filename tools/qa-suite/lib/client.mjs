// ตัวช่วยเรียก API, SQL, ล็อกอินทุกบทบาท และอัปโหลดไฟล์ในระบบจำลอง 127.0.0.1
import { ACCOUNTS } from '../../qa-r14/db.mjs'
import { createHash } from 'node:crypto'

export function createClient(stack) {
  const tokens = new Map()

  async function sql(query, params = []) {
    const res = await fetch(stack.origin + '/__qa/sql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql: query, params }),
    })
    const data = await res.json()
    if (data.message) throw new Error(data.message)
    return data.rows
  }

  async function reset(materialsCheck = true) {
    await fetch(stack.origin + '/__qa/reset', { method: 'POST' })
    await sql(`do $$ begin
      if to_regclass('public.production_settings') is not null then
        update public.production_settings set materials_check = ${materialsCheck ? 'true' : 'false'};
      end if;
    end $$`)
    tokens.clear()
  }

  async function tokenFor(roleKey) {
    if (roleKey === 'anon') return 'r14-local-anon-key'
    if (tokens.has(roleKey)) return tokens.get(roleKey)
    const acc = ACCOUNTS.find(a => a.key === roleKey)
    if (!acc) throw new Error('ไม่พบบัญชีจำลอง: ' + roleKey)
    const res = await fetch(`${stack.origin}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: 'r14-local-anon-key' },
      body: JSON.stringify({ email: acc.email, password: acc.password ?? 'r14-local-pass' }),
    })
    const json = await res.json()
    tokens.set(roleKey, json.access_token)
    return json.access_token
  }

  async function rpc(roleKey, fn, args = {}) {
    const tok = await tokenFor(roleKey)
    const res = await fetch(`${stack.origin}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: 'r14-local-anon-key',
        authorization: `Bearer ${tok}`,
      },
      body: JSON.stringify(args),
    })
    const text = await res.text()
    let body = text
    try { body = JSON.parse(text) } catch {}
    return { status: res.status, ok: res.ok, body }
  }

  async function rest(roleKey, method, path, body = undefined) {
    const tok = await tokenFor(roleKey)
    const headers = { apikey: 'r14-local-anon-key', authorization: `Bearer ${tok}` }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const res = await fetch(`${stack.origin}/rest/v1/${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let parsed = text
    try { parsed = JSON.parse(text) } catch {}
    return { status: res.status, ok: res.ok, body: parsed }
  }

  async function uploadFile(roleKey, kind, relPath, bytes, contentType = 'image/jpeg') {
    const tok = await tokenFor(roleKey)
    const res = await fetch(`${stack.filesOrigin}/upload/${kind}/${relPath}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${tok}`, 'content-type': contentType },
      body: bytes,
    })
    return { status: res.status, ok: res.ok, text: await res.text() }
  }

  async function seedMockJpg(kind, relPath, seedStr = relPath) {
    const hash = createHash('sha256').update(seedStr).digest('hex').slice(0, 16)
    const finalPath = relPath.includes('.') ? relPath : `${relPath}/${hash}.jpg`
    const minimalJpg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
      0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
      0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
    ])
    await sql("insert into private.file_objects (kind, path, size, content_type) values ($1, $2, $3, 'image/jpeg') on conflict do nothing",
      [kind, finalPath, minimalJpg.length])
    stack.r2Store.set(`${kind}/${finalPath}`, { bytes: new Uint8Array(minimalJpg), type: 'image/jpeg' })
    return finalPath
  }

  async function signUrls(roleKey, kind, paths) {
    const tok = await tokenFor(roleKey)
    const res = await fetch(`${stack.filesOrigin}/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
      body: JSON.stringify({ kind, paths }),
    })
    const text = await res.text()
    let body = text
    try { body = JSON.parse(text) } catch {}
    return { status: res.status, ok: res.ok, body }
  }

  return { stack, sql, reset, tokenFor, rpc, rest, uploadFile, seedMockJpg, signUrls }
}
