import { createHash, createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex')

const sha256Hex = data => createHash('sha256').update(data).digest('hex')
const hmac = (key, data) => createHmac('sha256', key).update(data).digest()

export function encodeRfc3986(text) {
  return encodeURIComponent(text).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function canonicalUri(path) {
  return path.split('/').map(encodeRfc3986).join('/')
}

export function canonicalQuery(params) {
  return Object.entries(params)
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)])
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

export function signRequest({ method, host, path, query = {}, amzDate, region, service, accessKeyId, secretAccessKey, payloadHash = EMPTY_SHA256, extraHeaders = {} }) {
  const day = amzDate.slice(0, 8)
  const headers = { host, 'x-amz-date': amzDate, ...extraHeaders }
  const names = Object.keys(headers).map(h => h.toLowerCase()).sort()
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]))
  const signedHeaders = names.join(';')
  const canonicalRequest = [
    method,
    canonicalUri(path),
    canonicalQuery(query),
    names.map(n => `${n}:${lower[n]}\n`).join(''),
    signedHeaders,
    payloadHash,
  ].join('\n')
  const scope = `${day}/${region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), 'aws4_request')
  const signature = createHmac('sha256', key).update(stringToSign).digest('hex')
  return {
    ...lower,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unescapeXml = text => text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) => {
  if (e[0] !== '#') return XML_ENTITIES[e.toLowerCase()]
  return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
})
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))
  return m ? unescapeXml(m[1]) : null
}

export function parseList(xml) {
  const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, c]) => ({ key: tag(c, 'Key'), size: Number(tag(c, 'Size')) }))
  return { objects, truncated: tag(xml, 'IsTruncated') === 'true', next: tag(xml, 'NextContinuationToken') }
}

export function safeLocalPath(dest, key) {
  const parts = key.split('/')
  if (!key || key.includes('\\') || key.includes('\0') || parts.some(p => p === '' || p === '.' || p === '..') || /^[a-z]:/i.test(key)) return null
  const root = resolve(dest)
  const full = resolve(root, ...parts)
  return full.startsWith(root + sep) ? full : null
}

// ชื่อไฟล์ที่หน้าเว็บตั้ง = SHA-256 ของเนื้อไฟล์ 16 ตัวแรก · ชื่อแบบเวลา (เครื่องไม่มี crypto.subtle) ตรวจไม่ได้
export function contentProblem(key, bytes, expectedSize) {
  if (bytes.length !== expectedSize) return `ขนาดไม่ตรง (ได้ ${bytes.length} ควรเป็น ${expectedSize})`
  const base = key.split('/').pop().replace(/\.[^.]*$/, '')
  if (/^[0-9a-f]{16}$/.test(base) && !sha256Hex(bytes).startsWith(base)) return 'เนื้อไฟล์ไม่ตรงชื่อ (ไฟล์เสีย)'
  return null
}

const amzNow = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

export function makeClient({ endpoint, bucket, accessKeyId, secretAccessKey, fetcher = fetch, now = amzNow }) {
  const base = new URL(endpoint)
  const send = async (path, query) => {
    const headers = signRequest({
      method: 'GET', host: base.host, path, query, amzDate: now(), region: 'auto', service: 's3',
      accessKeyId, secretAccessKey, extraHeaders: { 'x-amz-content-sha256': EMPTY_SHA256 },
    })
    delete headers.host
    const qs = canonicalQuery(query)
    const res = await fetcher(`${base.origin}${canonicalUri(path)}${qs ? `?${qs}` : ''}`, { headers })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`R2 ตอบ ${res.status} ${tag(body, 'Code') ?? ''}`.trim())
    }
    return res
  }
  return {
    async *list() {
      let token = null
      do {
        const query = { 'list-type': '2', ...(token ? { 'continuation-token': token } : {}) }
        const page = parseList(await (await send(`/${bucket}`, query)).text())
        yield* page.objects
        token = page.truncated ? page.next : null
      } while (token)
    },
    async get(key) {
      return Buffer.from(await (await send(`/${bucket}/${key}`, {})).arrayBuffer())
    },
  }
}

export async function pullAll({ client, dest, log = () => {} }) {
  const result = { total: 0, skipped: 0, downloaded: 0, bytes: 0, failed: [] }
  for await (const { key, size } of client.list()) {
    result.total++
    const file = safeLocalPath(dest, key)
    if (!file) {
      result.failed.push({ key, why: 'ชื่อไฟล์ไม่ปลอดภัย' })
      continue
    }
    const local = await stat(file).catch(() => null)
    if (local?.isFile() && local.size === size) {
      result.skipped++
      continue
    }
    try {
      const bytes = await client.get(key)
      const problem = contentProblem(key, bytes, size)
      if (problem) {
        result.failed.push({ key, why: problem })
        continue
      }
      await mkdir(dirname(file), { recursive: true })
      await writeFile(`${file}.part`, bytes)
      await rename(`${file}.part`, file)
      result.downloaded++
      result.bytes += size
      log(`ได้ ${key}`)
    } catch (e) {
      await rm(`${file}.part`, { force: true })
      result.failed.push({ key, why: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}

function readArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([a-z-]+)$/)
    if (m) args[m[1]] = argv[++i]
  }
  return args
}

async function main() {
  const args = readArgs(process.argv.slice(2))
  const envFile = args.env ?? join(homedir(), '.pp142-r2', 'r2-backup.env')
  if (existsSync(envFile)) process.loadEnvFile(envFile)
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env
  const missing = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].filter(n => !process.env[n])
  if (!process.env.R2_ENDPOINT && !R2_ACCOUNT_ID) missing.unshift('R2_ACCOUNT_ID')
  if (missing.length) {
    console.error(`ไม่พบค่า ${missing.join(', ')} · ใส่ในไฟล์ ${envFile} (ดู docs/สำรองและกู้ข้อมูล.md)`)
    process.exit(2)
  }
  const dest = resolve(args.to ?? join(homedir(), 'pp142-backup', 'r2'))
  const client = makeClient({
    endpoint: process.env.R2_ENDPOINT ?? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    bucket: process.env.R2_BUCKET ?? 'pp142-files',
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  })
  console.log(`สำรองไฟล์ R2 → ${dest}`)
  const r = await pullAll({ client, dest, log: line => console.log(line) })
  console.log(`ไฟล์ใน R2 ${r.total} · โหลดใหม่ ${r.downloaded} (${(r.bytes / 1048576).toFixed(1)} MB) · มีแล้ว ${r.skipped} · ไม่สำเร็จ ${r.failed.length}`)
  for (const f of r.failed) console.error(`ไม่สำเร็จ ${f.key}: ${f.why}`)
  await mkdir(dest, { recursive: true })
  await writeFile(join(dest, 'last-run.txt'), `${new Date().toISOString()}\t${r.total}\t${r.downloaded}\t${r.failed.length}\n`, { flag: 'a' }).catch(() => {})
  process.exit(r.failed.length ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(e => {
    console.error(`สำรองไม่สำเร็จ: ${e instanceof Error ? e.message : e}`)
    process.exit(1)
  })
}
