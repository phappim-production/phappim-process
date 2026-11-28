export const MAX_BYTES = 20 * 1024 * 1024
export const THUMB_MAX_BYTES = 1024 * 1024
const THUMB_SUFFIX = '.thumb.jpg'

// เวลาหมดอายุปัดขึ้นถึงขอบช่วง: ขอซ้ำในช่วงเดียวกันได้ลิงก์เดิม เบราว์เซอร์ใช้ cache ได้ · อายุจริง ≤ maxAskSeconds + linkBucketSeconds (ใบยืนยัน ≤ 10 นาที รูป ≤ 2 ชม.)
const KINDS = {
  confirmations: {
    path: /^[A-Za-z0-9_-]{1,200}\/[A-Za-z0-9]{1,64}\.(?:pdf|jpg|png|webp)$/,
    types: { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' },
    maxAskSeconds: 9 * 60,
    linkBucketSeconds: 60,
    wrongType: 'ไฟล์ใบยืนยันต้องเป็น PDF หรือรูป (JPG / PNG / WEBP)',
  },
  mockups: {
    path: /^[A-Za-z0-9_-]{1,200}\/(?:sheet\/)?[A-Za-z0-9]{1,64}\.(?:jpg|png|webp)$/,
    types: { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' },
    maxAskSeconds: 60 * 60,
    linkBucketSeconds: 60 * 60,
    wrongType: 'รูปม็อคอัพต้องเป็นไฟล์ภาพ (JPG / PNG / WEBP)',
  },
  station_photos: {
    path: /^[A-Za-z0-9_-]{1,200}\/[a-z_]{1,20}\/[0-9]{1,4}\/[A-Za-z0-9]{1,64}\.jpg$/,
    types: { jpg: 'image/jpeg' },
    maxAskSeconds: 60 * 60,
    linkBucketSeconds: 60 * 60,
    wrongType: 'รูปจากสถานีต้องเป็นไฟล์ JPG',
  },
}

const TOO_BIG = 'ไฟล์ใหญ่เกิน 20 MB ให้ย่อไฟล์ก่อน'
const enc = new TextEncoder()

export function typeOfPath(kind, path) {
  const rule = KINDS[kind]
  if (!rule || typeof path !== 'string' || !rule.path.test(path)) return null
  return rule.types[path.slice(path.lastIndexOf('.') + 1)] ?? null
}

export const thumbPathOf = path => `${path}${THUMB_SUFFIX}`

export function originalOfThumb(kind, path) {
  if (kind !== 'mockups' || typeof path !== 'string' || !path.endsWith(THUMB_SUFFIX)) return null
  const original = path.slice(0, -THUMB_SUFFIX.length)
  return typeOfPath(kind, original) ? original : null
}

export function linkExpiry(kind, nowSeconds, askedSeconds) {
  const rule = KINDS[kind]
  const asked = Number.isFinite(askedSeconds) ? Math.floor(askedSeconds) : rule.maxAskSeconds
  const seconds = Math.max(30, Math.min(rule.maxAskSeconds, asked))
  return Math.ceil((nowSeconds + seconds) / rule.linkBucketSeconds) * rule.linkBucketSeconds
}

export function contentMatches(type, bytes) {
  const at = (offset, list) => list.every((b, i) => bytes[offset + i] === b)
  if (type === 'application/pdf') {
    const sign = [0x25, 0x50, 0x44, 0x46, 0x2d]
    for (let i = 0; i + sign.length <= Math.min(bytes.length, 1024); i++) if (at(i, sign)) return true
    return false
  }
  if (type === 'image/jpeg') return at(0, [0xff, 0xd8, 0xff])
  if (type === 'image/png') return at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (type === 'image/webp') return at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])
  return false
}

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
  return [...mac].map(b => b.toString(16).padStart(2, '0')).join('')
}

function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin')
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (!origin || !allowed.includes(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(request, env, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(request, env) },
  })
}

const fail = (request, env, status, error) => json(request, env, status, { error })

function textPage(status, message) {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
}

function bearer(request) {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') ?? '')
  return m ? m[1] : null
}

async function callRpc(env, fetcher, token, fn, args) {
  let res
  try {
    res = await fetcher(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
  } catch {
    return { ok: false, status: 502, error: 'ติดต่อฐานข้อมูลไม่ได้ ลองอีกครั้ง' }
  }
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  if (res.ok) return { ok: true, data: body }
  if (res.status === 401 || /JWT/i.test(body?.message ?? '')) {
    return { ok: false, status: 401, error: 'หมดเวลาล็อกอิน ให้ออกจากระบบแล้วล็อกอินใหม่' }
  }
  const forbidden = body?.code === '42501'
  return { ok: false, status: forbidden ? 403 : 400, error: body?.message || 'ฐานข้อมูลปฏิเสธคำขอนี้' }
}

// ไฟล์เดิม (ชื่อไฟล์ = ลายนิ้วมือเนื้อไฟล์) ไม่เขียนทับ · อัปโหลดซ้ำหลังเน็ตหลุดจึงได้ไฟล์เดียว
async function upload(request, env, fetcher, kind, path) {
  const token = bearer(request)
  if (!token) return fail(request, env, 401, 'ให้ล็อกอินก่อนอัปโหลดไฟล์')
  const original = originalOfThumb(kind, path)
  if (original) return uploadThumb(request, env, fetcher, token, kind, path, original)
  const expected = typeOfPath(kind, path)
  if (!expected) return fail(request, env, 400, KINDS[kind]?.wrongType ?? 'ไม่รู้จักประเภทไฟล์')
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
  if (type !== expected) return fail(request, env, 415, KINDS[kind].wrongType)
  const lengthHeader = request.headers.get('Content-Length')
  const declared = lengthHeader === null ? NaN : Number(lengthHeader)
  if (!Number.isSafeInteger(declared)) return fail(request, env, 411, 'ไม่ทราบขนาดไฟล์ ให้เลือกไฟล์แล้วอัปโหลดอีกครั้ง')
  if (declared > MAX_BYTES) return fail(request, env, 413, TOO_BIG)
  if (declared <= 0) return fail(request, env, 400, 'ไฟล์ว่างเปล่า ให้เลือกไฟล์ใหม่')

  const allowed = await callRpc(env, fetcher, token, 'file_upload_allowed', { p_kind: kind, p_path: path, p_size: declared, p_type: type })
  if (!allowed.ok) return fail(request, env, allowed.status, allowed.error)

  // รับไฟล์ให้ครบก่อนตอบเสมอ (แม้ไฟล์มีอยู่แล้ว) · ตอบก่อนรับจบ เบราว์เซอร์บางตัวถือว่าเน็ตหลุด
  let bytes
  try { bytes = new Uint8Array(await request.arrayBuffer()) } catch {
    return fail(request, env, 400, 'ไฟล์มาไม่ครบ (เน็ตหลุดระหว่างส่ง) ให้กดอัปโหลดอีกครั้ง')
  }
  if (bytes.byteLength > MAX_BYTES) return fail(request, env, 413, TOO_BIG)
  if (bytes.byteLength !== declared) return fail(request, env, 400, 'ไฟล์มาไม่ครบ (เน็ตหลุดระหว่างส่ง) ให้กดอัปโหลดอีกครั้ง')
  if (!contentMatches(type, bytes)) return fail(request, env, 415, `เนื้อไฟล์ไม่ใช่ ${type === 'application/pdf' ? 'PDF' : kind === 'station_photos' ? 'ภาพ JPG' : 'ภาพ JPG / PNG / WEBP'} ให้บันทึกไฟล์ใหม่แล้วเลือกอีกครั้ง`)

  const key = `${kind}/${path}`
  let head = await env.FILES.head(key)
  const existed = !!head
  if (!head) {
    await env.FILES.put(key, bytes, { httpMetadata: { contentType: type } })
    head = await env.FILES.head(key)
    if (!head) return fail(request, env, 503, 'ที่เก็บไฟล์ยังไม่ยืนยันไฟล์ ลองอีกครั้ง')
  }
  const storedType = head.httpMetadata?.contentType ?? ''
  if (head.size > MAX_BYTES || storedType !== expected) return fail(request, env, 409, 'ไฟล์ชื่อนี้ในที่เก็บไม่ถูกต้อง แจ้งเจ้าของระบบ')

  const proof = await hmacHex(env.RECORD_SECRET, `${kind}|${path}|${head.size}|${storedType}`)
  const recorded = await callRpc(env, fetcher, token, 'record_file_upload', {
    p_kind: kind, p_path: path, p_size: head.size, p_type: storedType, p_proof: proof,
  })
  if (!recorded.ok) return fail(request, env, recorded.status, recorded.error)
  return json(request, env, 200, { path, size: head.size, existed })
}

// รูปย่อใช้สิทธิ์ของรูปต้นฉบับ (ถามฐานข้อมูลด้วย path ต้นฉบับ) และต้องมีต้นฉบับในที่เก็บแล้ว · ไม่จดในฐานข้อมูล
async function uploadThumb(request, env, fetcher, token, kind, path, original) {
  const wrongType = 'รูปย่อต้องเป็นไฟล์ JPG'
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
  if (type !== 'image/jpeg') return fail(request, env, 415, wrongType)
  const lengthHeader = request.headers.get('Content-Length')
  const declared = lengthHeader === null ? NaN : Number(lengthHeader)
  if (!Number.isSafeInteger(declared)) return fail(request, env, 411, 'ไม่ทราบขนาดไฟล์ ให้เลือกไฟล์แล้วอัปโหลดอีกครั้ง')
  if (declared > THUMB_MAX_BYTES) return fail(request, env, 413, 'รูปย่อใหญ่เกิน 1 MB')
  if (declared <= 0) return fail(request, env, 400, 'ไฟล์ว่างเปล่า ให้เลือกไฟล์ใหม่')

  const allowed = await callRpc(env, fetcher, token, 'file_upload_allowed', {
    p_kind: kind, p_path: original, p_size: declared, p_type: typeOfPath(kind, original),
  })
  if (!allowed.ok) return fail(request, env, allowed.status, allowed.error)

  let bytes
  try { bytes = new Uint8Array(await request.arrayBuffer()) } catch {
    return fail(request, env, 400, 'ไฟล์มาไม่ครบ (เน็ตหลุดระหว่างส่ง) ให้กดอัปโหลดอีกครั้ง')
  }
  if (bytes.byteLength > THUMB_MAX_BYTES) return fail(request, env, 413, 'รูปย่อใหญ่เกิน 1 MB')
  if (bytes.byteLength !== declared) return fail(request, env, 400, 'ไฟล์มาไม่ครบ (เน็ตหลุดระหว่างส่ง) ให้กดอัปโหลดอีกครั้ง')
  if (!contentMatches(type, bytes)) return fail(request, env, 415, wrongType)
  if (!await env.FILES.head(`${kind}/${original}`)) return fail(request, env, 409, 'ยังไม่มีรูปต้นฉบับในที่เก็บ ให้อัปโหลดรูปต้นฉบับก่อน')

  const key = `${kind}/${path}`
  let head = await env.FILES.head(key)
  const existed = !!head
  if (!head) {
    await env.FILES.put(key, bytes, { httpMetadata: { contentType: type } })
    head = await env.FILES.head(key)
    if (!head) return fail(request, env, 503, 'ที่เก็บไฟล์ยังไม่ยืนยันไฟล์ ลองอีกครั้ง')
  }
  return json(request, env, 200, { path, size: head.size, existed })
}

async function sign(request, env, fetcher, now) {
  const token = bearer(request)
  if (!token) return fail(request, env, 401, 'ให้ล็อกอินก่อนเปิดไฟล์')
  let body
  try { body = await request.json() } catch { return fail(request, env, 400, 'คำขอไม่ถูกต้อง') }
  const kind = body?.kind
  const rule = KINDS[kind]
  if (!rule || !Array.isArray(body.paths)) return fail(request, env, 400, 'คำขอไม่ถูกต้อง')
  const paths = [...new Set(body.paths.filter(p => typeOfPath(kind, p)))].slice(0, 200)
  if (!paths.length) return json(request, env, 200, { urls: {} })
  const allowed = await callRpc(env, fetcher, token, 'file_read_allowed', { p_kind: kind, p_paths: paths })
  if (!allowed.ok) return fail(request, env, allowed.status, allowed.error)
  const exp = linkExpiry(kind, Math.floor(now() / 1000), Number(body.seconds))
  const base = new URL(request.url).origin
  const urls = {}
  for (const p of Array.isArray(allowed.data) ? allowed.data : []) {
    if (!paths.includes(p)) continue
    const sig = await hmacHex(env.LINK_SECRET, `${kind}|${p}|${exp}`)
    urls[p] = `${base}/f/${kind}/${p}?exp=${exp}&sig=${sig}`
  }
  return json(request, env, 200, { urls, expires: exp })
}

async function serve(request, env, now, kind, path, url) {
  if (!typeOfPath(kind, path)) return textPage(404, 'ไม่พบไฟล์')
  const exp = Number(url.searchParams.get('exp'))
  const sig = url.searchParams.get('sig') ?? ''
  if (!Number.isSafeInteger(exp) || !sameText(sig, await hmacHex(env.LINK_SECRET, `${kind}|${path}|${exp}`))) {
    return textPage(403, 'ลิงก์ไม่ถูกต้อง กลับไปกดเปิดไฟล์จากใบงานอีกครั้ง')
  }
  const left = exp - Math.floor(now() / 1000)
  if (left <= 0) return textPage(410, 'ลิงก์หมดอายุแล้ว กลับไปกดเปิดไฟล์จากใบงานอีกครั้ง')
  const read = key => (request.method === 'HEAD' ? env.FILES.head(key) : env.FILES.get(key))
  // ลิงก์รูปต้นฉบับเปิดรูปย่อได้ด้วย ?v=thumb · รูปเก่าที่ยังไม่มีรูปย่อได้รูปต้นฉบับแทน ไม่ขึ้นรูปเสีย
  const wantThumb = kind === 'mockups' && url.searchParams.get('v') === 'thumb'
  const thumb = wantThumb ? await read(`${kind}/${thumbPathOf(path)}`) : null
  const obj = thumb ?? await read(`${kind}/${path}`)
  if (!obj) return textPage(404, 'ไม่พบไฟล์ในที่เก็บ แจ้งแอดมินให้แนบไฟล์ใหม่')
  return new Response(request.method === 'HEAD' ? null : obj.body, {
    status: 200,
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Content-Length': String(obj.size),
      'Content-Disposition': 'inline',
      'Cache-Control': `private, max-age=${left}, immutable`,
      ...(wantThumb ? { 'X-File-Variant': thumb ? 'thumb' : 'original' } : {}),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      // แอปอ่านไฟล์ใบยืนยันที่แนบไว้มาตัดลายเซ็น (fetch ข้ามโดเมน)
      ...corsHeaders(request, env),
    },
  })
}

export function createHandler({ fetcher = (...a) => fetch(...a), now = () => Date.now() } = {}) {
  return async function handle(request, env) {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)
    const [route, kind] = parts
    const path = parts.slice(2).join('/')
    if (request.method === 'OPTIONS') {
      const cors = corsHeaders(request, env)
      return new Response(null, { status: cors['Access-Control-Allow-Origin'] ? 204 : 403, headers: cors })
    }
    if (!env.RECORD_SECRET || !env.LINK_SECRET || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      return fail(request, env, 503, 'ระบบเก็บไฟล์ยังตั้งค่าไม่ครบ แจ้งเจ้าของระบบ')
    }
    if (route === 'f' && (request.method === 'GET' || request.method === 'HEAD')) return serve(request, env, now, kind, path, url)
    const origin = request.headers.get('Origin')
    if (origin && !corsHeaders(request, env)['Access-Control-Allow-Origin']) return textPage(403, 'เว็บนี้ไม่ได้รับอนุญาต')
    if (route === 'upload' && request.method === 'PUT') return upload(request, env, fetcher, kind, path)
    if (route === 'sign' && request.method === 'POST' && parts.length === 1) return sign(request, env, fetcher, now)
    return fail(request, env, 404, 'ไม่พบหน้านี้')
  }
}

const handle = createHandler()
export default { fetch: (request, env) => handle(request, env) }
