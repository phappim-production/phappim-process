import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'

export async function auditBundle() {
  const assets = new URL('../../app/dist/assets/', import.meta.url)
  const files = (await readdir(assets)).filter(name => name.endsWith('.js'))
  const scripts = await Promise.all(files.map(name => readFile(new URL(name, assets), 'utf8')))
  const form = await readFile(new URL('../../app/dist/confirmation.html', import.meta.url), 'utf8')
  const text = [...scripts, form].join('\n')
  for (const port of [5214, 5215]) assert.ok(text.includes('http://127.0.0.1:' + port))
  const domains = text.match(/https?:\/\/[^\s"'`<>]*(?:pp142\.pages\.dev|\.supabase\.co|\.workers\.dev)[^\s"'`<>]*/gi) ?? []
  const qr = 'https://pp142.pages.dev/#/board?job='
  assert.deepEqual(domains.filter(url => url !== qr), [])
  return { scripts: files.length, loopback: [5214, 5215], qrReferences: domains.length }
}
