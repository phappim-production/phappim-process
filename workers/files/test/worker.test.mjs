import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_BYTES, contentMatches, createHandler, hmacHex, typeOfPath } from '../src/index.js'
import { fakeR2, fileBytes } from './fake-r2.mjs'

const ORIGIN = 'https://pp142.pages.dev'
const BASE = 'https://files.example.test'

function setup({ start = Date.UTC(2026, 10, 21, 2) } = {}) {
  const env = {
    FILES: fakeR2(), ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5176`, SUPABASE_URL: 'https://db.example.test',
    SUPABASE_ANON_KEY: 'anon', RECORD_SECRET: 'record-secret-0123456789abcdef0123456789', LINK_SECRET: 'link-secret-0123456789abcdef0123456789',
  }
  const users = { admin: { role: 'admin', active: true }, qc: { role: 'qc', active: true }, off: { role: 'admin', active: false } }
  const db = { records: new Map(), referenced: new Set(), calls: [], down: false, expired: new Set() }
  let clock = start
  const fetcher = async (url, init) => {
    if (db.down) throw new TypeError('fetch failed')
    const fn = url.split('/rpc/')[1]
    const token = init.headers.Authorization.replace('Bearer ', '')
    const args = JSON.parse(init.body)
    db.calls.push(fn)
    const reply = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status })
    if (db.expired.has(token)) return reply(401, { code: 'PGRST301', message: 'JWT expired' })
    const user = users[token]
    if (!user?.active) return reply(400, { code: '42501', message: 'บัญชีนี้ถูกปิดหรือยังไม่ได้ล็อกอิน ให้ล็อกอินใหม่หรือแจ้งเจ้าของระบบ' })
    if (fn === 'file_read_allowed') return reply(200, args.p_paths.filter(p => db.referenced.has(`${args.p_kind}/${p}`)))
    if (user.role !== 'admin') return reply(400, { code: '42501', message: `บทบาทของคุณ (${user.role}) ทำขั้นนี้ไม่ได้` })
    if (args.p_size > MAX_BYTES) return reply(400, { code: '23514', message: 'ไฟล์ใหญ่เกิน 20 MB ให้ย่อไฟล์ก่อน' })
    if (fn === 'file_upload_allowed') return reply(204)
    if (fn === 'record_file_upload') {
      const want = await hmacHex(env.RECORD_SECRET, `${args.p_kind}|${args.p_path}|${args.p_size}|${args.p_type}`)
      if (args.p_proof !== want) return reply(400, { code: '42501', message: 'ยืนยันไฟล์ไม่ผ่าน' })
      db.records.set(`${args.p_kind}/${args.p_path}`, args.p_size)
      return reply(204)
    }
    return reply(404, { message: 'no rpc' })
  }
  const handle = createHandler({ fetcher, now: () => clock })
  const put = (kind, path, bytes, { token = 'admin', type, length = bytes.byteLength, origin = ORIGIN, body } = {}) => handle(new Request(`${BASE}/upload/${kind}/${path}`, {
    method: 'PUT', body: body ?? bytes,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': type ?? 'application/pdf', 'Content-Length': String(length), Origin: origin },
    duplex: 'half',
  }), env)
  const sign = (kind, paths, { token = 'admin', seconds } = {}) => handle(new Request(`${BASE}/sign`, {
    method: 'POST', body: JSON.stringify({ kind, paths, seconds }),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: ORIGIN },
  }), env)
  const open = (url, method = 'GET') => handle(new Request(url, { method }), env)
  return { env, db, handle, put, sign, open, tick: ms => { clock += ms } }
}

const PDF = 'SC-1/0a1b2c3d4e5f6071.pdf'
const JPG = 'SC-1/aabbccddeeff0011.jpg'

test('ชนิดไฟล์ตาม path: PDF ใบยืนยัน / รูปม็อคอัพ / โฟลเดอร์ฉบับม็อคอัพ', () => {
  assert.equal(typeOfPath('confirmations', PDF), 'application/pdf')
  assert.equal(typeOfPath('mockups', 'SC-1/sheet/ab12.png'), 'image/png')
  assert.equal(typeOfPath('mockups', 'SC-1/ab12.webp'), 'image/webp')
  for (const [kind, path] of [['mockups', PDF], ['confirmations', JPG], ['mockups', '../x/ab.jpg'], ['mockups', 'SC-1/a b.jpg'], ['other', JPG], ['mockups', 'SC-1/x/y/ab.jpg']]) {
    assert.equal(typeOfPath(kind, path), null, `${kind} ${path}`)
  }
})

test('ตรวจเนื้อไฟล์ ไม่เชื่อแค่ชนิดที่ส่งมา', () => {
  for (const type of ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']) assert.equal(contentMatches(type, fileBytes(type, 64)), true, type)
  assert.equal(contentMatches('image/png', fileBytes('image/jpeg', 64)), false)
  assert.equal(contentMatches('application/pdf', new Uint8Array(2000)), false)
  const late = new Uint8Array(2000); late.set([0x25, 0x50, 0x44, 0x46, 0x2d], 900)
  assert.equal(contentMatches('application/pdf', late), true)
})

test('รูปม็อคอัพ 20 MiB พอดี อัปโหลดผ่าน แล้วบันทึกลงฐานข้อมูล', async () => {
  const { put, env, db } = setup()
  const res = await put('mockups', JPG, fileBytes('image/jpeg', MAX_BYTES), { type: 'image/jpeg' })
  assert.equal(res.status, 200, await res.clone().text())
  assert.deepEqual(await res.json(), { path: JPG, size: MAX_BYTES, existed: false })
  assert.equal(env.FILES.store.get(`mockups/${JPG}`).bytes.byteLength, MAX_BYTES)
  assert.equal(db.records.get(`mockups/${JPG}`), MAX_BYTES)
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN)
})

test('รูปเกิน 20 MiB 1 ไบต์ ถูกปฏิเสธก่อนรับไฟล์ ข้อความบอก 20 MB', async () => {
  const { put, env, db } = setup()
  const res = await put('mockups', JPG, fileBytes('image/jpeg', MAX_BYTES + 1), { type: 'image/jpeg' })
  assert.equal(res.status, 413)
  assert.match((await res.json()).error, /20 MB/)
  assert.equal(env.FILES.puts.length, 0)
  assert.deepEqual(db.calls, [])
})

test('แจ้งขนาดต่ำกว่าจริง (ส่งเกิน 20 MiB) ถูกปฏิเสธ ไม่เก็บไฟล์', async () => {
  const { put, env } = setup()
  const res = await put('mockups', JPG, fileBytes('image/jpeg', MAX_BYTES + 1), { type: 'image/jpeg', length: 1000 })
  assert.ok([400, 413].includes(res.status))
  assert.equal(env.FILES.puts.length, 0)
})

test('PDF 20 MiB พอดีผ่าน · เกิน 1 ไบต์ไม่ผ่าน', async () => {
  const { put } = setup()
  assert.equal((await put('confirmations', PDF, fileBytes('application/pdf', MAX_BYTES))).status, 200)
  const over = await put('confirmations', 'SC-1/ffff.pdf', fileBytes('application/pdf', MAX_BYTES + 1))
  assert.equal(over.status, 413)
})

test('ไฟล์ที่เนื้อไม่ใช่ PDF / ชนิดไม่ตรง path ถูกปฏิเสธ', async () => {
  const { put, env } = setup()
  assert.equal((await put('confirmations', PDF, fileBytes('image/png', 100))).status, 415)
  assert.equal((await put('mockups', JPG, fileBytes('image/png', 100), { type: 'image/png' })).status, 415)
  assert.equal((await put('mockups', JPG, fileBytes('image/png', 100), { type: 'image/jpeg' })).status, 415)
  assert.equal(env.FILES.puts.length, 0)
})

test('เน็ตหลุดระหว่างส่ง (ไฟล์มาไม่ครบ) ไม่เก็บไฟล์ · กดอัปโหลดใหม่ได้ไฟล์เดียว', async () => {
  const { put, env, db } = setup()
  const full = fileBytes('application/pdf', 5000)
  const cut = await put('confirmations', PDF, full.subarray(0, 2000), { length: 5000 })
  assert.equal(cut.status, 400)
  assert.match((await cut.json()).error, /เน็ตหลุด/)
  assert.equal(env.FILES.store.size, 0)
  const broken = new ReadableStream({ pull(c) { c.error(new Error('connection reset')) } })
  const dropped = await put('confirmations', PDF, full, { body: broken })
  assert.equal(dropped.status, 400)
  assert.equal(env.FILES.store.size, 0)
  assert.equal((await put('confirmations', PDF, full)).status, 200)
  const again = await put('confirmations', PDF, full)
  assert.equal(again.status, 200)
  assert.equal((await again.json()).existed, true)
  assert.equal(env.FILES.puts.length, 1)
  assert.equal(db.records.size, 1)
})

test('ไฟล์อยู่ในที่เก็บแล้วแต่บันทึกลงฐานข้อมูลไม่ทัน (เน็ตหลุดหลังส่ง) อัปโหลดซ้ำแล้วบันทึกครบ', async () => {
  const { put, env, db } = setup()
  const bytes = fileBytes('image/jpeg', 3000)
  const original = db.records.set.bind(db.records)
  let failOnce = true
  db.records.set = (k, v) => { if (failOnce) { failOnce = false; throw new Error('drop') } return original(k, v) }
  assert.equal((await put('mockups', JPG, bytes, { type: 'image/jpeg' })).status, 502)
  assert.equal(env.FILES.store.size, 1)
  assert.equal(db.records.size, 0)
  const retry = await put('mockups', JPG, bytes, { type: 'image/jpeg' })
  assert.equal(retry.status, 200)
  assert.equal(db.records.size, 1)
  assert.equal(env.FILES.puts.length, 1)
})

test('ไม่มีโทเคน / โทเคนหมดอายุ / บัญชีปิด / บทบาทไม่มีสิทธิ์ อัปโหลดไม่ได้', async () => {
  const { put, env, db } = setup()
  const bytes = fileBytes('application/pdf', 100)
  assert.equal((await put('confirmations', PDF, bytes, { token: '' })).status, 401)
  db.expired.add('admin')
  const expired = await put('confirmations', PDF, bytes)
  assert.equal(expired.status, 401)
  assert.match((await expired.json()).error, /ล็อกอินใหม่/)
  db.expired.clear()
  const off = await put('confirmations', PDF, bytes, { token: 'off' })
  assert.equal(off.status, 403)
  assert.match((await off.json()).error, /ถูกปิด/)
  const qc = await put('confirmations', PDF, bytes, { token: 'qc' })
  assert.equal(qc.status, 403)
  assert.equal(env.FILES.puts.length, 0)
})

test('เว็บอื่นเรียก Worker ไม่ได้ · preflight จากเว็บที่อนุญาตผ่าน', async () => {
  const { put, handle, env } = setup()
  assert.equal((await put('confirmations', PDF, fileBytes('application/pdf', 100), { origin: 'https://evil.example' })).status, 403)
  const pre = await handle(new Request(`${BASE}/upload/confirmations/${PDF}`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5176' } }), env)
  assert.equal(pre.status, 204)
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /Authorization/)
  const bad = await handle(new Request(`${BASE}/upload/confirmations/${PDF}`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), env)
  assert.equal(bad.status, 403)
})

test('ลิงก์เปิดไฟล์: ได้เฉพาะไฟล์ที่ฐานข้อมูลอนุญาต · เปิดได้จนหมดอายุ', async () => {
  const { put, sign, open, db, tick } = setup()
  const bytes = fileBytes('application/pdf', 1234)
  await put('confirmations', PDF, bytes)
  db.referenced.add(`confirmations/${PDF}`)
  const res = await sign('confirmations', [PDF, 'SC-9/0000.pdf', '../bad.pdf'], { token: 'qc', seconds: 300 })
  assert.equal(res.status, 200)
  const { urls } = await res.json()
  assert.deepEqual(Object.keys(urls), [PDF])
  const file = await open(urls[PDF])
  assert.equal(file.status, 200)
  assert.equal(file.headers.get('Content-Type'), 'application/pdf')
  assert.equal(file.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal((await file.arrayBuffer()).byteLength, 1234)
  assert.equal((await open(urls[PDF], 'HEAD')).status, 200)
  tick(299_000)
  assert.equal((await open(urls[PDF])).status, 200)
  tick(2_000)
  const gone = await open(urls[PDF])
  assert.equal(gone.status, 410)
  assert.match(await gone.text(), /หมดอายุ/)
})

test('ลิงก์ PDF นานสุด 10 นาที · รูปนานสุด 2 ชั่วโมง แม้ขอนานกว่า', async () => {
  const { put, sign, db } = setup()
  await put('confirmations', PDF, fileBytes('application/pdf', 100))
  db.referenced.add(`confirmations/${PDF}`)
  db.referenced.add(`mockups/${JPG}`)
  const pdf = await (await sign('confirmations', [PDF], { seconds: 99_999 })).json()
  const pic = await (await sign('mockups', [JPG], { seconds: 99_999 })).json()
  const now = Math.floor(Date.UTC(2026, 10, 21, 2) / 1000)
  assert.equal(pdf.expires - now, 600)
  assert.equal(pic.expires - now, 7200)
})

test('แก้ลิงก์ (เปลี่ยนเวลา / path / ลายเซ็น) เปิดไม่ได้', async () => {
  const { put, sign, open, db } = setup()
  await put('confirmations', PDF, fileBytes('application/pdf', 100))
  await put('confirmations', 'SC-2/1111.pdf', fileBytes('application/pdf', 100))
  db.referenced.add(`confirmations/${PDF}`)
  const url = new URL((await (await sign('confirmations', [PDF])).json()).urls[PDF])
  const later = new URL(url); later.searchParams.set('exp', String(Number(url.searchParams.get('exp')) + 3600))
  assert.equal((await open(later.href)).status, 403)
  const other = new URL(url.href.replace(PDF, 'SC-2/1111.pdf'))
  assert.equal((await open(other.href)).status, 403)
  const noSig = new URL(url); noSig.searchParams.delete('sig')
  assert.equal((await open(noSig.href)).status, 403)
})

test('บัญชีปิด / ไม่มีโทเคน ขอลิงก์ใหม่ไม่ได้', async () => {
  const { sign, db } = setup()
  db.referenced.add(`confirmations/${PDF}`)
  const off = await sign('confirmations', [PDF], { token: 'off' })
  assert.equal(off.status, 403)
  assert.match((await off.json()).error, /ถูกปิด/)
  assert.equal((await sign('confirmations', [PDF], { token: '' })).status, 401)
})

test('ตั้งค่าลับไม่ครบ = ปิดทุกทาง ไม่ออกลิงก์ที่ปลอมได้', async () => {
  const { env, open, handle } = setup()
  delete env.LINK_SECRET
  assert.equal((await open(`${BASE}/f/confirmations/${PDF}?exp=9999999999&sig=x`)).status, 503)
  const res = await handle(new Request(`${BASE}/sign`, { method: 'POST', body: '{}', headers: { Authorization: 'Bearer admin' } }), env)
  assert.equal(res.status, 503)
})

test('ติดต่อฐานข้อมูลไม่ได้ ไม่เก็บไฟล์และบอกให้ลองใหม่', async () => {
  const { put, env, db } = setup()
  db.down = true
  const res = await put('confirmations', PDF, fileBytes('application/pdf', 100))
  assert.equal(res.status, 502)
  assert.match((await res.json()).error, /ลองอีกครั้ง/)
  assert.equal(env.FILES.puts.length, 0)
})
