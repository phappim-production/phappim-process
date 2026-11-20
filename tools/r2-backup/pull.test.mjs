import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { canonicalQuery, contentProblem, makeClient, parseList, pullAll, safeLocalPath, signRequest } from './pull.mjs'

const AWS_EXAMPLE = {
  host: 'example.amazonaws.com', amzDate: '20150830T123600Z', region: 'us-east-1', service: 'service',
  accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
}

test('ลายเซ็นตรงชุดทดสอบ SigV4 ของ AWS (get-vanilla)', () => {
  const h = signRequest({ ...AWS_EXAMPLE, method: 'GET', path: '/' })
  assert.equal(h.authorization, 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31')
})

test('ลายเซ็นตรงชุดทดสอบ SigV4 ของ AWS (เรียง query)', () => {
  const h = signRequest({ ...AWS_EXAMPLE, method: 'GET', path: '/', query: { Param2: 'value2', Param1: 'value1' } })
  assert.match(h.authorization, /Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500$/)
})

test('query เข้ารหัสแบบ RFC 3986 และเรียงตามชื่อ', () => {
  assert.equal(canonicalQuery({ 'list-type': '2', 'continuation-token': 'a+b/c=' }), 'continuation-token=a%2Bb%2Fc%3D&list-type=2')
})

test('อ่านรายการไฟล์จาก XML รวมชื่อที่มีอักขระพิเศษ', () => {
  const xml = '<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>mockups/A&amp;B/x.jpg</Key><Size>12</Size></Contents><NextContinuationToken>t1</NextContinuationToken></ListBucketResult>'
  assert.deepEqual(parseList(xml), { objects: [{ key: 'mockups/A&B/x.jpg', size: 12 }], truncated: true, next: 't1' })
})

test('ชื่อไฟล์ที่พาออกนอกโฟลเดอร์สำรองถูกปฏิเสธ', () => {
  const dest = join(tmpdir(), 'r2b')
  assert.ok(safeLocalPath(dest, 'confirmations/SC-1/ab.pdf'))
  for (const bad of ['../x.pdf', 'a/../../x', '/etc/passwd', 'a\\..\\x', 'C:/x', 'a//b', '']) assert.equal(safeLocalPath(dest, bad), null, bad)
})

test('ตรวจเนื้อไฟล์กับชื่อที่เป็นลายนิ้วมือ', () => {
  const bytes = Buffer.from('%PDF-1.7 hello')
  const name = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  assert.equal(contentProblem(`confirmations/SC-1/${name}.pdf`, bytes, bytes.length), null)
  assert.match(contentProblem('confirmations/SC-1/0000000000000000.pdf', bytes, bytes.length), /ไฟล์เสีย/)
  assert.match(contentProblem(`confirmations/SC-1/${name}.pdf`, bytes, 3), /ขนาดไม่ตรง/)
  assert.equal(contentProblem('mockups/SC-1/1763600000000.jpg', bytes, bytes.length), null)
})

function fakeR2(objects, { pageSize = 2, failKeys = [] } = {}) {
  const calls = []
  const fetcher = async (url, init) => {
    const u = new URL(url)
    calls.push({ path: decodeURIComponent(u.pathname), query: Object.fromEntries(u.searchParams), auth: init.headers.authorization })
    if (!init.headers.authorization?.startsWith('AWS4-HMAC-SHA256 Credential=KEY/')) return new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 })
    if (u.pathname === '/pp142-files') {
      const keys = Object.keys(objects).sort()
      const start = Number(u.searchParams.get('continuation-token') ?? 0)
      const page = keys.slice(start, start + pageSize)
      const more = start + pageSize < keys.length
      const body = `<ListBucketResult><IsTruncated>${more}</IsTruncated>${page.map(k => `<Contents><Key>${k.replace(/&/g, '&amp;')}</Key><Size>${objects[k].length}</Size></Contents>`).join('')}${more ? `<NextContinuationToken>${start + pageSize}</NextContinuationToken>` : ''}</ListBucketResult>`
      return new Response(body)
    }
    const key = decodeURIComponent(u.pathname.replace('/pp142-files/', ''))
    if (failKeys.includes(key)) return new Response('', { status: 500 })
    return objects[key] ? new Response(objects[key]) : new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 })
  }
  return { fetcher, calls }
}

const named = (prefix, text, ext) => {
  const bytes = Buffer.from(text)
  return [`${prefix}/${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${ext}`, bytes]
}

const dirs = []
after(() => Promise.all(dirs.map(d => rm(d, { recursive: true, force: true }))))
const tempDir = async () => {
  const d = await mkdtemp(join(tmpdir(), 'r2-backup-'))
  dirs.push(d)
  return d
}

test('โหลดครบทุกหน้า แล้วรอบถัดไปโหลดเฉพาะไฟล์ใหม่', async () => {
  const objects = Object.fromEntries([
    named('confirmations/SC-1', '%PDF a', 'pdf'),
    named('confirmations/SC-2', '%PDF b', 'pdf'),
    named('mockups/SC-1/sheet', 'img c', 'jpg'),
  ])
  const dest = await tempDir()
  const { fetcher, calls } = fakeR2(objects)
  const client = makeClient({ endpoint: 'https://acc.r2.cloudflarestorage.com', bucket: 'pp142-files', accessKeyId: 'KEY', secretAccessKey: 'SECRET', fetcher })

  const first = await pullAll({ client, dest })
  assert.deepEqual({ ...first, failed: first.failed.length }, { total: 3, skipped: 0, downloaded: 3, bytes: 17, failed: 0 })
  assert.equal(calls.filter(c => c.path === '/pp142-files').length, 2)
  for (const [key, bytes] of Object.entries(objects)) assert.deepEqual(await readFile(join(dest, ...key.split('/'))), bytes)

  const [newKey, newBytes] = named('mockups/SC-3', 'img d', 'png')
  objects[newKey] = newBytes
  calls.length = 0
  const second = await pullAll({ client, dest })
  assert.equal(second.downloaded, 1)
  assert.equal(second.skipped, 3)
  assert.deepEqual(calls.filter(c => c.path !== '/pp142-files').map(c => c.path), [`/pp142-files/${newKey}`])
})

test('ไฟล์เสีย / โหลดไม่ได้ / ชื่อไม่ปลอดภัย นับเป็นไม่สำเร็จ และไม่ทิ้งไฟล์ครึ่งๆ', async () => {
  const [goodKey, goodBytes] = named('confirmations/SC-1', '%PDF ok', 'pdf')
  const [brokenKey, brokenBytes] = named('confirmations/SC-2', '%PDF x', 'pdf')
  const objects = {
    [goodKey]: goodBytes,
    'confirmations/SC-2/aaaaaaaaaaaaaaaa.pdf': brokenBytes,
    [brokenKey]: brokenBytes,
    'mockups/../escape.jpg': Buffer.from('x'),
  }
  const dest = await tempDir()
  const { fetcher } = fakeR2(objects, { pageSize: 10, failKeys: [brokenKey] })
  const client = makeClient({ endpoint: 'https://acc.r2.cloudflarestorage.com', bucket: 'pp142-files', accessKeyId: 'KEY', secretAccessKey: 'SECRET', fetcher })
  const r = await pullAll({ client, dest })
  assert.equal(r.downloaded, 1)
  assert.deepEqual(r.failed.map(f => f.why).sort(), ['R2 ตอบ 500', 'ชื่อไฟล์ไม่ปลอดภัย', 'เนื้อไฟล์ไม่ตรงชื่อ (ไฟล์เสีย)'].sort())
  assert.deepEqual(await readdir(join(dest, 'confirmations', 'SC-2')).catch(() => []), [])
})

test('ไฟล์ในเครื่องขนาดไม่ตรง (โหลดค้างรอบก่อน) โหลดใหม่ทับ', async () => {
  const [key, bytes] = named('confirmations/SC-1', '%PDF full', 'pdf')
  const dest = await tempDir()
  await mkdir(join(dest, 'confirmations', 'SC-1'), { recursive: true })
  await writeFile(join(dest, ...key.split('/')), 'half')
  const { fetcher } = fakeR2({ [key]: bytes })
  const client = makeClient({ endpoint: 'https://acc.r2.cloudflarestorage.com', bucket: 'pp142-files', accessKeyId: 'KEY', secretAccessKey: 'SECRET', fetcher })
  const r = await pullAll({ client, dest })
  assert.equal(r.downloaded, 1)
  assert.deepEqual(await readFile(join(dest, ...key.split('/'))), bytes)
})

test('กุญแจผิด → หยุดพร้อมข้อความจาก R2', async () => {
  const { fetcher } = fakeR2({})
  const client = makeClient({ endpoint: 'https://acc.r2.cloudflarestorage.com', bucket: 'pp142-files', accessKeyId: 'WRONG', secretAccessKey: 'SECRET', fetcher })
  await assert.rejects(pullAll({ client, dest: await tempDir() }), /R2 ตอบ 403 AccessDenied/)
})
