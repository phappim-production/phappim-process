import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const IMG_DIR = fileURLToPath(new URL('../../docs/qa/img/', import.meta.url))

export async function savePng(t, filename) {
  await mkdir(IMG_DIR, { recursive: true })
  await t.send('Page.bringToFront')
  const { data } = await t.send('Page.captureScreenshot', { format: 'png' })
  const out = join(IMG_DIR, filename)
  await writeFile(out, Buffer.from(data, 'base64'))
  return out
}

export async function savePdf(t, filename) {
  await mkdir(IMG_DIR, { recursive: true })
  await t.send('Page.bringToFront')
  const { data } = await t.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })
  const buf = Buffer.from(data, 'base64')
  const out = join(IMG_DIR, filename)
  await writeFile(out, buf)
  return { path: out, size: buf.length, header: buf.subarray(0, 5).toString('latin1') }
}
