import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_BYTES, THUMB_MAX_BYTES, contentMatches, createHandler, hmacHex, originalOfThumb, thumbPathOf, typeOfPath } from '../src/index.js'
import { fakeR2, fileBytes } from './fake-r2.mjs'

const ORIGIN = 'https://pp142.pages.dev'
const BASE = 'https://files.example.test'

function setup({ start = Date.UTC(2026, 10, 21, 2) } = {}) {
  const env = {
    FILES: fakeR2(), ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5176`, SUPABASE_URL: 'https://db.example.test',
    SUPABASE_ANON_KEY: 'anon', RECORD_SECRET: 'record-secret-0123456789abcdef0123456789', LINK_SECRET: 'link-secret-0123456789abcdef0123456789',
  }
  const users = { admin: { role: 'admin', active: true }, qc: { role: 'qc', active: true }, off: { role: 'admin', active: false }, sup: { role: 'supervisor', active: true } }
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
    const canUpload = args.p_kind === 'station_photos' ? ['supervisor', 'qc'].includes(user.role) : user.role === 'admin'
    if (!canUpload) return reply(400, { code: '42501', message: `บทบาทของคุณ (${user.role}) ทำขั้นนี้ไม่ได้` })
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

test('ลิงก์ PDF ไม่เกิน 10 นาทีทุกเวลาที่ขอ · รูปอย่างน้อย 2 ชม. ไม่เกิน 4 ชม. แม้ขอนานกว่า', async () => {
  const start = Date.UTC(2026, 10, 21, 2)
  for (const offset of [0, 1_000, 59_000, 61_000, 3_599_000, 7_199_000, 7_200_000 + 30_500]) {
    const { put, sign, db } = setup({ start: start + offset })
    await put('confirmations', PDF, fileBytes('application/pdf', 100))
    db.referenced.add(`confirmations/${PDF}`)
    db.referenced.add(`mockups/${JPG}`)
    const now = Math.floor((start + offset) / 1000)
    for (const seconds of [99_999, undefined, 600]) {
      const pdf = await (await sign('confirmations', [PDF], { seconds })).json()
      assert.ok(pdf.expires - now <= 600 && pdf.expires - now >= 540, `PDF offset ${offset} ${seconds}: ${pdf.expires - now}`)
    }
    const short = await (await sign('confirmations', [PDF], { seconds: 1 })).json()
    assert.ok(short.expires - now >= 30 && short.expires - now < 90)
    const pic = await (await sign('mockups', [JPG], { seconds: 99_999 })).json()
    assert.ok(pic.expires - now >= 3600 && pic.expires - now <= 7200, `รูป offset ${offset}: ${pic.expires - now}`)
    assert.equal(pic.expires % 3600, 0)
  }
})

test('ลิงก์เดิมในช่วง 1 ชม. เดียวกัน (เบราว์เซอร์ใช้รูปจาก cache ได้) · ข้ามช่วงได้ลิงก์ใหม่', async () => {
  const { put, sign, db, tick } = setup({ start: Date.UTC(2026, 10, 21, 2, 0, 1) })
  await put('mockups', JPG, fileBytes('image/jpeg', 100), { type: 'image/jpeg' })
  db.referenced.add(`mockups/${JPG}`)
  const urlNow = async () => (await (await sign('mockups', [JPG])).json()).urls[JPG]
  const first = await urlNow()
  tick(60_000)
  assert.equal(await urlNow(), first)
  tick(3600_000 - 62_000)
  assert.equal(await urlNow(), first)
  tick(2_000)
  const next = await urlNow()
  assert.notEqual(next, first)
  assert.equal(Number(new URL(next).searchParams.get('exp')) - Number(new URL(first).searchParams.get('exp')), 3600)
})

test('ไฟล์ที่เปิดได้ส่งหัว cache แบบส่วนตัว จนถึงเวลาหมดอายุของลิงก์พอดี', async () => {
  const { put, sign, open, db, tick } = setup({ start: Date.UTC(2026, 10, 21, 2, 30) })
  await put('mockups', JPG, fileBytes('image/jpeg', 100), { type: 'image/jpeg' })
  await put('confirmations', PDF, fileBytes('application/pdf', 100))
  db.referenced.add(`mockups/${JPG}`)
  db.referenced.add(`confirmations/${PDF}`)
  const pic = await (await sign('mockups', [JPG])).json()
  const nowSec = Math.floor(Date.UTC(2026, 10, 21, 2, 30) / 1000)
  assert.equal((await open(pic.urls[JPG])).headers.get('Cache-Control'), `private, max-age=${pic.expires - nowSec}, immutable`)
  tick(10_000)
  assert.equal((await open(pic.urls[JPG])).headers.get('Cache-Control'), `private, max-age=${pic.expires - nowSec - 10}, immutable`)
  const pdf = await (await sign('confirmations', [PDF], { seconds: 300 })).json()
  const cc = (await open(pdf.urls[PDF])).headers.get('Cache-Control')
  assert.match(cc, /^private, max-age=\d+, immutable$/)
  assert.ok(Number(/max-age=(\d+)/.exec(cc)[1]) <= 600)
  assert.equal((await open(`${BASE}/f/mockups/${JPG}?exp=1&sig=x`)).headers.get('Cache-Control'), 'no-store')
})

const THUMB = `${JPG}.thumb.jpg`

test('path รูปย่อ: ได้จากรูปต้นฉบับเท่านั้น · PDF / path แปลก / รูปย่อของรูปย่อ ไม่ใช่รูปย่อ', () => {
  assert.equal(thumbPathOf(JPG), THUMB)
  assert.equal(originalOfThumb('mockups', THUMB), JPG)
  assert.equal(originalOfThumb('mockups', 'SC-1/sheet/ab12.png.thumb.jpg'), 'SC-1/sheet/ab12.png')
  for (const [kind, path] of [['confirmations', `${PDF}.thumb.jpg`], ['mockups', `${THUMB}.thumb.jpg`], ['mockups', '../x/ab.jpg.thumb.jpg'],
    ['mockups', 'SC-1/ab.thumb.jpg'], ['mockups', JPG], ['mockups', 'SC-1/ab.gif.thumb.jpg']]) {
    assert.equal(originalOfThumb(kind, path), null, `${kind} ${path}`)
  }
  assert.equal(typeOfPath('mockups', THUMB), null)
})

test('อัปโหลดรูปย่อได้เมื่ออัปโหลดรูปต้นฉบับได้ และมีต้นฉบับในที่เก็บแล้ว · ไม่จดในฐานข้อมูล · ส่งซ้ำไม่เขียนทับ', async () => {
  const { put, env, db } = setup()
  assert.equal((await put('mockups', JPG, fileBytes('image/jpeg', 5000), { type: 'image/jpeg' })).status, 200)
  db.calls.length = 0
  const res = await put('mockups', THUMB, fileBytes('image/jpeg', 300), { type: 'image/jpeg' })
  assert.equal(res.status, 200, await res.clone().text())
  assert.deepEqual(await res.json(), { path: THUMB, size: 300, existed: false })
  assert.equal(env.FILES.store.get(`mockups/${THUMB}`).type, 'image/jpeg')
  assert.deepEqual(db.calls, ['file_upload_allowed'])
  assert.equal(db.records.has(`mockups/${THUMB}`), false)
  const again = await put('mockups', THUMB, fileBytes('image/jpeg', 400), { type: 'image/jpeg' })
  assert.equal((await again.json()).existed, true)
  assert.equal(env.FILES.store.get(`mockups/${THUMB}`).bytes.byteLength, 300)
})

test('อัปโหลดรูปย่อไม่ได้: ไม่มีสิทธิ์อัปโหลดต้นฉบับ / ไม่มีต้นฉบับ / ไม่ใช่ JPG / ใหญ่เกิน 1 MB / path ต้นฉบับผิด', async () => {
  const { put, env, db } = setup()
  await put('mockups', JPG, fileBytes('image/jpeg', 5000), { type: 'image/jpeg' })
  const small = fileBytes('image/jpeg', 300)
  const opts = extra => ({ type: 'image/jpeg', ...extra })
  assert.equal((await put('mockups', THUMB, small, opts({ token: 'qc' }))).status, 403)
  assert.equal((await put('mockups', THUMB, small, opts({ token: 'off' }))).status, 403)
  assert.equal((await put('mockups', THUMB, small, opts({ token: '' }))).status, 401)
  db.expired.add('admin')
  assert.equal((await put('mockups', THUMB, small, opts())).status, 401)
  db.expired.clear()
  const orphan = await put('mockups', 'SC-1/0000000000000009.png.thumb.jpg', small, opts())
  assert.equal(orphan.status, 409)
  assert.match((await orphan.json()).error, /ต้นฉบับ/)
  assert.equal((await put('mockups', THUMB, fileBytes('image/png', 300), { type: 'image/png' })).status, 415)
  assert.equal((await put('mockups', THUMB, fileBytes('image/png', 300), opts())).status, 415)
  const big = await put('mockups', THUMB, fileBytes('image/jpeg', THUMB_MAX_BYTES + 1), opts())
  assert.equal(big.status, 413)
  assert.equal((await put('mockups', `${THUMB}.thumb.jpg`, small, opts())).status, 400)
  assert.equal((await put('confirmations', `${PDF}.thumb.jpg`, small, opts())).status, 400)
  assert.equal((await put('mockups', THUMB, small, opts({ origin: 'https://evil.example' }))).status, 403)
  assert.deepEqual(env.FILES.puts, [`mockups/${JPG}`])
})

test('ลิงก์รูป + ?v=thumb: มีรูปย่อได้รูปย่อ · ยังไม่มีได้รูปต้นฉบับ (ไม่ขึ้นรูปเสีย) · ลายเซ็นผิดยังเปิดไม่ได้', async () => {
  const { put, sign, open, db } = setup()
  const OLD = 'SC-1/0000000000000001.png'
  await put('mockups', JPG, fileBytes('image/jpeg', 5000), { type: 'image/jpeg' })
  await put('mockups', THUMB, fileBytes('image/jpeg', 300), { type: 'image/jpeg' })
  await put('mockups', OLD, fileBytes('image/png', 4000), { type: 'image/png' })
  db.referenced.add(`mockups/${JPG}`)
  db.referenced.add(`mockups/${OLD}`)
  const { urls } = await (await sign('mockups', [JPG, OLD, THUMB])).json()
  assert.deepEqual(Object.keys(urls).sort(), [JPG, OLD].sort())
  const full = await open(urls[JPG])
  assert.equal((await full.arrayBuffer()).byteLength, 5000)
  assert.equal(full.headers.get('X-File-Variant'), null)
  const small = await open(`${urls[JPG]}&v=thumb`)
  assert.equal(small.status, 200)
  assert.equal(small.headers.get('X-File-Variant'), 'thumb')
  assert.equal(small.headers.get('Content-Type'), 'image/jpeg')
  assert.equal((await small.arrayBuffer()).byteLength, 300)
  const head = await open(`${urls[JPG]}&v=thumb`, 'HEAD')
  assert.equal(head.headers.get('Content-Length'), '300')
  const fallback = await open(`${urls[OLD]}&v=thumb`)
  assert.equal(fallback.status, 200)
  assert.equal(fallback.headers.get('X-File-Variant'), 'original')
  assert.equal(fallback.headers.get('Content-Type'), 'image/png')
  assert.equal((await fallback.arrayBuffer()).byteLength, 4000)
  const forged = new URL(`${urls[JPG]}&v=thumb`); forged.searchParams.set('sig', '0'.repeat(64))
  assert.equal((await open(forged.href)).status, 403)
  const direct = new URL(urls[JPG]); direct.pathname = `/f/mockups/${THUMB}`
  assert.equal((await open(direct.href)).status, 404)
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

const STATION_JPG = 'SC-1/print/2/aabbccddeeff0011.jpg'

test('รูปจากสถานี: JPG ในโฟลเดอร์ งาน/สถานี/รอบ เท่านั้น', () => {
  assert.equal(typeOfPath('station_photos', STATION_JPG), 'image/jpeg')
  for (const path of ['SC-1/print/2/ab.png', 'SC-1/ab.jpg', 'SC-1/PRINT/2/ab.jpg', 'SC-1/print/x/ab.jpg', '../print/2/ab.jpg', 'SC-1/print/2/a b.jpg']) {
    assert.equal(typeOfPath('station_photos', path), null, path)
  }
})

test('หัวหน้าสถานีอัปโหลดรูปจากสถานีได้ แล้วบันทึกลงฐานข้อมูล · เปิดลิงก์ได้', async () => {
  const { put, sign, open, db } = setup()
  const res = await put('station_photos', STATION_JPG, fileBytes('image/jpeg', 300_000), { token: 'sup', type: 'image/jpeg' })
  assert.equal(res.status, 200, await res.clone().text())
  assert.equal(db.records.get(`station_photos/${STATION_JPG}`), 300_000)
  db.referenced.add(`station_photos/${STATION_JPG}`)
  const { urls } = await (await sign('station_photos', [STATION_JPG], { token: 'qc' })).json()
  const pic = await open(urls[STATION_JPG])
  assert.equal(pic.status, 200)
  assert.equal(pic.headers.get('Content-Type'), 'image/jpeg')
})

test('รูปจากสถานีต้องเป็น JPG จริง', async () => {
  const { put } = setup()
  const res = await put('station_photos', STATION_JPG, fileBytes('image/png', 100), { token: 'sup', type: 'image/jpeg' })
  assert.equal(res.status, 415)
  assert.match((await res.json()).error, /ภาพ JPG/)
  assert.equal((await put('station_photos', STATION_JPG.replace('.jpg', '.png'), fileBytes('image/png', 100), { token: 'sup', type: 'image/png' })).status, 400)
})
