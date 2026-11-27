// ตัวป้องกันระบบจริง: ตรวจ bundle ใน app/dist และตรวจคำขอเครือข่าย CDP ออกนอก 127.0.0.1
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function assertSafeDist(distDir, port, filesPort) {
  const assetsDir = join(distDir, 'assets')
  const files = []
  for (const name of await readdir(distDir)) {
    if (name.endsWith('.html')) files.push(join(distDir, name))
  }
  for (const name of await readdir(assetsDir)) {
    if (name.endsWith('.js')) files.push(join(assetsDir, name))
  }

  let hasSupabaseLocal = false
  let hasFilesLocal = false
  const unexpectedProd = []

  for (const file of files) {
    const txt = await readFile(file, 'utf8')
    if (txt.includes(`127.0.0.1:${port}`)) hasSupabaseLocal = true
    if (txt.includes(`127.0.0.1:${filesPort}`)) hasFilesLocal = true
    if (/workers\.dev/.test(txt)) unexpectedProd.push({ file, match: 'workers.dev' })
    // อนุญาตเฉพาะสตริงตรวจโดเมนใน @supabase/supabase-js และ URL ใน QR/file: warning ของ confirmation.html
    const matches = txt.match(/https:\/\/[a-z0-9.-]*supabase\.co/g)
    if (matches?.length) unexpectedProd.push({ file, match: matches[0] })
  }

  if (!hasSupabaseLocal || !hasFilesLocal) {
    throw new Error(`app/dist ไม่ได้ build ชี้ 127.0.0.1:${port}/${filesPort} (กรุณา build ด้วย loopback env)`)
  }
  if (unexpectedProd.length) {
    throw new Error(`พบ URL ระบบจริงใน app/dist: ${JSON.stringify(unexpectedProd)}`)
  }
  return { hasSupabaseLocal, hasFilesLocal, scannedFiles: files.length }
}

export function assertNoExternalAttempts(chrome) {
  const ext = chrome?.externalAttempts ?? []
  if (ext.length > 0) {
    throw new Error(`ตรวจพบคำขอออกนอก 127.0.0.1 (${ext.length} ครั้ง): ${JSON.stringify(ext.slice(0, 5))}`)
  }
}
