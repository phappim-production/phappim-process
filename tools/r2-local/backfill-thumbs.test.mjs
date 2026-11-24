import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { deflateSync } from 'node:zlib'
import { createHandler, hmacHex } from '../../workers/files/src/index.js'
import { fakeR2, fileBytes } from '../../workers/files/test/fake-r2.mjs'
import { backfillThumbs, chromeShrink, listMockupPaths } from './backfill-thumbs.mjs'

const RECORD_SECRET = 'local-record-secret-0123456789abcdef'

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks)
}

async function startStack({ jobs }) {
  const r2 = fakeR2()
  const files = new Map()
  const roles = { admin: 'admin', qc: 'qc' }
  const worker = createHandler()
  let base = ''
  const env = () => ({ FILES: r2, ALLOWED_ORIGINS: '', SUPABASE_URL: base, SUPABASE_ANON_KEY: 'anon', RECORD_SECRET, LINK_SECRET: 'local-link-secret-0123456789abcdef' })
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)) }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, base)
    const role = roles[(req.headers.authorization ?? '').replace('Bearer ', '')]
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = url.pathname.slice('/rest/v1/rpc/'.length)
      const args = JSON.parse(await readBody(req))
      if (!role) return json(res, 400, { code: '42501', message: 'บัญชีนี้ถูกปิด' })
      if (fn === 'file_read_allowed') return json(res, 200, args.p_paths.filter(p => jobs.some(j => j.mockup_path === p || j.spec?.mockups?.some(m => m.path === p))))
      if (role !== 'admin') return json(res, 400, { code: '42501', message: `บทบาทของคุณ (${role}) ทำขั้นนี้ไม่ได้` })
      if (fn === 'file_upload_allowed') return json(res, 204)
      const want = await hmacHex(RECORD_SECRET, `${args.p_kind}|${args.p_path}|${args.p_size}|${args.p_type}`)
      if (fn !== 'record_file_upload' || args.p_proof !== want) return json(res, 400, { code: '42501', message: 'ยืนยันไฟล์ไม่ผ่าน' })
      files.set(`${args.p_kind}/${args.p_path}`, args.p_size)
      return json(res, 204)
    }
    if (url.pathname === '/rest/v1/jobs') {
      if (!role) return json(res, 401, { message: 'JWT expired' })
      const limit = Number(url.searchParams.get('limit'))
      const offset = Number(url.searchParams.get('offset'))
      return json(res, 200, jobs.slice(offset, offset + limit))
    }
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req)
    const reply = await worker(new Request(base + req.url, { method: req.method, headers: req.headers, body }), env())
    res.writeHead(reply.status, Object.fromEntries(reply.headers))
    res.end(reply.body && req.method !== 'HEAD' ? Buffer.from(await reply.arrayBuffer()) : undefined)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${server.address().port}`
  return { base, r2, files, close: () => new Promise(resolve => server.close(resolve)) }
}

const fakeShrink = async () => fileBytes('image/jpeg', 200)

test('สร้างรูปย่อให้รูปเก่าผ่าน Worker ในเครื่อง · รอบสองไม่สร้างซ้ำ · การ์ดได้รูปย่อแทนรูปเต็ม', async () => {
  const jobs = [
    { id: 'j1', mockup_path: 'SC-1/aaaaaaaaaaaaaaa1.jpg', spec: { mockups: [{ name: 'หน้า', path: 'SC-1/aaaaaaaaaaaaaaa1.jpg' }, { name: 'หลัง', path: 'SC-1/aaaaaaaaaaaaaaa2.png' }] } },
    { id: 'j2', mockup_path: 'SC-2/bbbbbbbbbbbbbbb1.webp', spec: {} },
    { id: 'j3', mockup_path: null, spec: null },
    { id: 'j4', mockup_path: 'SC-4/ccccccccccccccc1.jpg', spec: {} },
  ]
  const stack = await startStack({ jobs })
  try {
    for (const [path, type] of [['SC-1/aaaaaaaaaaaaaaa1.jpg', 'image/jpeg'], ['SC-1/aaaaaaaaaaaaaaa2.png', 'image/png'], ['SC-2/bbbbbbbbbbbbbbb1.webp', 'image/webp']]) {
      const bytes = fileBytes(type, 5000)
      const res = await fetch(`${stack.base}/upload/mockups/${path}`, { method: 'PUT', body: bytes, headers: { Authorization: 'Bearer admin', 'Content-Type': type } })
      assert.equal(res.status, 200, await res.text())
    }
    const paths = await listMockupPaths({ supabaseUrl: stack.base, anonKey: 'anon', token: 'admin', pageSize: 2 })
    assert.deepEqual(paths, ['SC-1/aaaaaaaaaaaaaaa1.jpg', 'SC-1/aaaaaaaaaaaaaaa2.png', 'SC-2/bbbbbbbbbbbbbbb1.webp', 'SC-4/ccccccccccccccc1.jpg'])

    const dry = await backfillThumbs({ filesUrl: stack.base, token: 'admin', paths, shrink: fakeShrink, dryRun: true })
    assert.equal(dry.missing.length, 3)
    assert.equal(stack.r2.puts.filter(k => k.endsWith('.thumb.jpg')).length, 0)

    const qc = await backfillThumbs({ filesUrl: stack.base, token: 'qc', paths, shrink: fakeShrink })
    assert.equal(qc.made.length, 0)
    assert.deepEqual(qc.failed.map(f => /\((\d+)\)/.exec(f.error)?.[1]), ['403', '403', '403', '404'])

    const first = await backfillThumbs({ filesUrl: stack.base, token: 'admin', paths, shrink: fakeShrink })
    assert.deepEqual(first.made, ['SC-1/aaaaaaaaaaaaaaa1.jpg', 'SC-1/aaaaaaaaaaaaaaa2.png', 'SC-2/bbbbbbbbbbbbbbb1.webp'])
    assert.deepEqual(first.failed.map(f => f.path), ['SC-4/ccccccccccccccc1.jpg'])
    assert.ok(stack.r2.store.has('mockups/SC-1/aaaaaaaaaaaaaaa2.png.thumb.jpg'))
    assert.equal(stack.files.size, 3)

    const second = await backfillThumbs({ filesUrl: stack.base, token: 'admin', paths, shrink: fakeShrink })
    assert.equal(second.made.length, 0)
    assert.equal(second.had.length, 3)

    const { urls } = await (await fetch(`${stack.base}/sign`, { method: 'POST', headers: { Authorization: 'Bearer admin' }, body: JSON.stringify({ kind: 'mockups', paths: ['SC-1/aaaaaaaaaaaaaaa2.png'] }) })).json()
    const card = await fetch(`${urls['SC-1/aaaaaaaaaaaaaaa2.png']}&v=thumb`)
    assert.equal(card.headers.get('Content-Type'), 'image/jpeg')
    assert.equal((await card.arrayBuffer()).byteLength, 200)
  } finally {
    await stack.close()
  }
})

function crc32(bytes) {
  let c = ~0
  for (const b of bytes) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function png(width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.alloc(1 + width * 3, 0x80)
  row[0] = 0
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}

function jpegSize(bytes) {
  for (let i = 2; i + 9 < bytes.length;) {
    if (bytes[i] !== 0xff) return null
    const marker = bytes[i + 1]
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    if (marker >= 0xc0 && marker <= 0xc2) return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] }
    i += 2 + len
  }
  return null
}

const chromePath = process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'

test('ย่อรูปจริงด้วย Chrome headless: ด้านยาวสุด 240 px เป็น JPEG', { skip: !existsSync(chromePath) && 'ไม่มี Chrome ในเครื่อง' }, async () => {
  const chrome = await chromeShrink({ chromePath })
  try {
    const out = await chrome.shrink(png(1200, 600), 'image/png')
    assert.deepEqual([...out.subarray(0, 3)], [0xff, 0xd8, 0xff])
    assert.deepEqual(jpegSize(out), { width: 240, height: 120 })
    assert.ok(out.byteLength < 20_000)
    await assert.rejects(chrome.shrink(new Uint8Array([1, 2, 3]), 'image/png'), /ย่อรูปไม่ได้/)
  } finally {
    await chrome.close()
  }
})
