import { MAX_BYTES, createHandler } from '../../workers/files/src/index.js'

// Worker จริง + ฟังก์ชัน SQL จริงบน PGlite · โทเคนจำลอง = user id · R2 จำลองด้วย Map
export async function r2EndToEndTests({ db, ok, as }) {
  const U = {
    admin: '00000000-0000-0000-0000-0000000002b1', qc: '00000000-0000-0000-0000-0000000002b2',
    off: '00000000-0000-0000-0000-0000000002b3', prod: '00000000-0000-0000-0000-0000000002b4',
  }
  await db.exec(`
    insert into auth.users values ('${U.admin}','e2a@test'),('${U.qc}','e2q@test'),('${U.off}','e2o@test'),('${U.prod}','e2p@test');
    insert into public.profiles (user_id, name, role, active) values
      ('${U.admin}','แอดมิน E2E','admin',true),('${U.qc}','QC E2E','qc',true),('${U.off}','QC ลาออก','qc',true),('${U.prod}','ผลิต E2E','production',true);`)
  const env = {
    FILES: memoryR2(), ALLOWED_ORIGINS: 'https://pp142.pages.dev', SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon',
    RECORD_SECRET: 'e2e-record-secret-0123456789abcdef-0123', LINK_SECRET: 'e2e-link-secret-0123456789abcdef-0123',
  }
  await db.exec(`insert into private.file_settings (record_secret) values ('${env.RECORD_SECRET}')`)

  let clock = Date.UTC(2026, 10, 21, 2)
  const fetcher = async (url, init) => {
    const fn = url.split('/rpc/')[1]
    const uid = init.headers.Authorization.replace('Bearer ', '')
    const args = JSON.parse(init.body)
    const keys = Object.keys(args)
    try {
      const r = await as(uid, () => db.query(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) r`, keys.map(k => args[k])))
      const v = r.rows[0].r
      return new Response(v === null || v === '' ? null : JSON.stringify(v), { status: v === null || v === '' ? 204 : 200 })
    } catch (e) {
      return new Response(JSON.stringify({ code: e.code, message: e.message }), { status: 400 })
    }
  }
  const handle = createHandler({ fetcher, now: () => clock })
  const put = (uid, kind, path, bytes, type) => handle(new Request(`https://files.test/upload/${kind}/${path}`, {
    method: 'PUT', body: bytes, duplex: 'half',
    headers: { Authorization: `Bearer ${uid}`, 'Content-Type': type, 'Content-Length': String(bytes.byteLength), Origin: 'https://pp142.pages.dev' },
  }), env)
  const sign = async (uid, kind, paths) => {
    const res = await handle(new Request('https://files.test/sign', {
      method: 'POST', body: JSON.stringify({ kind, paths }),
      headers: { Authorization: `Bearer ${uid}`, 'Content-Type': 'application/json', Origin: 'https://pp142.pages.dev' },
    }), env)
    return { status: res.status, body: await res.json() }
  }
  const open = url => handle(new Request(url), env)
  const val = async sql => Object.values((await db.query(sql)).rows[0] ?? {})[0]
  const bytesOf = (head, size) => { const b = new Uint8Array(size); b.set(head); return b }
  const pdf = bytesOf([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37], 4096)
  const jpg = bytesOf([0xff, 0xd8, 0xff, 0xe0], MAX_BYTES)

  const pdfPath = 'SC-E2E-1/0123456789abcdef.pdf'
  const up = await put(U.admin, 'confirmations', pdfPath, pdf, 'application/pdf')
  ok('E2E แอดมินอัปโหลด PDF ผ่าน Worker เข้า R2', up.status === 200, await up.clone().text())
  ok('E2E ฐานข้อมูลจดไฟล์ที่ Worker ยืนยันแล้ว', await val(`select size from private.file_objects where kind = 'confirmations' and path = '${pdfPath}'`) === 4096)
  const again = await put(U.admin, 'confirmations', pdfPath, pdf, 'application/pdf')
  ok('E2E อัปโหลดซ้ำหลังเน็ตหลุด ได้ไฟล์เดิม ไม่ซ้ำ', again.status === 200 && (await again.json()).existed === true
    && env.FILES.puts === 1 && await val(`select count(*)::int from private.file_objects where path = '${pdfPath}'`) === 1)
  const byProd = await put(U.prod, 'confirmations', 'SC-E2E-1/1111.pdf', pdf, 'application/pdf')
  ok('E2E ฝ่ายผลิตอัปโหลดไม่ได้', byProd.status === 403, await byProd.text())

  let jobId = null
  try {
    jobId = (await as(U.admin, () => db.query(`select public.receive_job('SC-E2E-1', 'ลูกค้า E2E', 'งาน E2E', 'tshirt', 5, 'ตัว', '2026-12-31', 'normal', '${pdfPath}') id`))).rows[0].id
    ok('E2E ส่งงานเข้าด้วย PDF ที่อยู่ใน R2', true)
  } catch (e) { ok('E2E ส่งงานเข้าด้วย PDF ที่อยู่ใน R2', false, e.message) }

  const qcLink = await sign(U.qc, 'confirmations', [pdfPath])
  const url = qcLink.body.urls?.[pdfPath]
  ok('E2E QC ขอลิงก์ PDF จากใบงานได้', qcLink.status === 200 && !!url)
  const file = url ? await open(url) : null
  ok('E2E เปิด PDF จากลิงก์ได้ เนื้อไฟล์ครบ', file?.status === 200 && (await file.arrayBuffer()).byteLength === 4096)

  await db.exec(`update public.profiles set active = false where user_id = '${U.off}'`)
  const offLink = await sign(U.off, 'confirmations', [pdfPath])
  ok('E2E บัญชีที่ถูกปิดขอลิงก์ใหม่ไม่ได้', offLink.status === 403 && /ถูกปิด/.test(offLink.body.error), JSON.stringify(offLink.body))
  const offUp = await put(U.off, 'mockups', 'SC-E2E-1/abcd.jpg', jpg.subarray(0, 100), 'image/jpeg')
  ok('E2E บัญชีที่ถูกปิดอัปโหลดไม่ได้', offUp.status === 403)

  clock += 11 * 60 * 1000
  ok('E2E ลิงก์ PDF หมดอายุหลัง 10 นาที', url ? (await open(url)).status === 410 : false)

  const picPath = 'SC-E2E-1/fedcba9876543210.jpg'
  const pic = await put(U.admin, 'mockups', picPath, jpg, 'image/jpeg')
  ok('E2E รูปม็อคอัพ 20 MiB พอดี ผ่าน Worker + ฐานข้อมูล', pic.status === 200, await pic.clone().text())
  const tooBig = await put(U.admin, 'mockups', 'SC-E2E-1/0000000000000001.jpg', bytesOf([0xff, 0xd8, 0xff], MAX_BYTES + 1), 'image/jpeg')
  ok('E2E รูปเกิน 20 MiB 1 ไบต์ ถูกปฏิเสธ', tooBig.status === 413 && /20 MB/.test((await tooBig.json()).error))
  try {
    await as(U.admin, () => db.query(`select public.set_job_mockup('${jobId}', '${picPath}')`))
    ok('E2E ใส่รูปม็อคอัพจาก R2 ให้ใบงาน', true)
  } catch (e) { ok('E2E ใส่รูปม็อคอัพจาก R2 ให้ใบงาน', false, e.message) }
  const picLink = await sign(U.prod, 'mockups', [picPath, 'SC-E2E-1/0000000000000002.jpg'])
  ok('E2E ฝ่ายผลิตเปิดรูปของใบงานได้ · รูปที่ไม่มีไม่ออกลิงก์', picLink.status === 200 && Object.keys(picLink.body.urls).join() === picPath)
  const picFile = await open(picLink.body.urls[picPath])
  ok('E2E เปิดรูปจากลิงก์ได้ ชนิดไฟล์ถูก', picFile.status === 200 && picFile.headers.get('Content-Type') === 'image/jpeg')

  await db.exec(`delete from private.file_settings; delete from private.file_objects;`)
}

function memoryR2() {
  const store = new Map()
  const r2 = {
    puts: 0,
    async head(key) { const v = store.get(key); return v ? { size: v.bytes.byteLength, httpMetadata: { contentType: v.type } } : null },
    async get(key) { const v = store.get(key); return v ? { size: v.bytes.byteLength, httpMetadata: { contentType: v.type }, body: new Blob([v.bytes]).stream() } : null },
    async put(key, bytes, opts) { r2.puts++; store.set(key, { bytes: new Uint8Array(bytes), type: opts.httpMetadata.contentType }) },
  }
  return r2
}
