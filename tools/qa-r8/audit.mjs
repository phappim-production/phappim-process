import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
async function filesIn(dir, keep) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(entries.map(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return filesIn(path, keep)
    return keep(entry.name) ? [path] : []
  }))
  return files.flat()
}
const load = async paths => Promise.all(paths.map(async path => ({ path, text: await readFile(path, 'utf8') })))
const source = await load(await filesIn(join(root, 'app/src'), name =>
  /\.(?:ts|tsx|css)$/.test(name) && !/\.test\./.test(name)))
const form = await load([join(root, 'production-confirmation.html')])
const normalize = input => input.replaceAll('&nbsp;', ' ').replace(/[\s\u200b]+/g, ' ').trim()
const runtimeText = [...source, ...form].map(file => normalize(file.text))
let boldCount = 0
const manuals = await load(await filesIn(join(root, 'docs/คู่มือ'), file => file.endsWith('.md')))
for (const { path, text } of manuals) {
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    for (const match of line.matchAll(/\*\*(.+?)\*\*/g)) {
      const label = normalize(match[1].replaceAll(String.fromCharCode(96), ''))
      boldCount++
      if (!runtimeText.some(src => src.includes(label))) {
        console.log('R8_MANUAL ' + JSON.stringify({ file: path.split(/[\\/]/).at(-1), line: i + 1, label }))
      }
    }
  }
}
console.log('R8_MANUAL_TOTAL ' + JSON.stringify({ files: manuals.length, boldOccurrences: boldCount }))

const migrations = await load(await filesIn(join(root, 'supabase/migrations'), name => name.endsWith('.sql')))
const eventTypes = new Set(migrations.flatMap(({ text }) =>
  [...text.matchAll(/private\.log\([^,]+,\s*'([a-z_]+)'/g)].map(m => m[1])))
const history = source.find(file => /[\\/]data[\\/]history\.ts$/.test(file.path)).text
const labels = new Set([...history.matchAll(/case '([a-z_]+)'/g)].map(m => m[1]))
console.log('R8_TIMELINE ' + JSON.stringify({ checked: eventTypes.size, missing: [...eventTypes].filter(event => !labels.has(event)) }))

const bundle = await load(await filesIn(join(root, 'app/dist'), name => /\.(?:js|html|json|webmanifest)$/.test(name)))
const suspicious = []
for (const { path, text } of bundle) {
  const name = path.split(/[\\/]/).at(-1)
  if (/\b(?:sb_secret_[A-Za-z0-9_-]{15,}|sk_(?:live|prod)_[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{25,})\b/.test(text)) {
    suspicious.push({ name, kind: 'key-pattern' })
  }
  for (const match of text.matchAll(/\beyJ[\w-]{10,}\.(eyJ[\w-]{10,})\.[\w-]{20,}\b/g)) {
    try {
      if (JSON.parse(Buffer.from(match[1], 'base64url')).role !== 'anon') suspicious.push({ name, kind: 'non-anon JWT' })
    } catch { suspicious.push({ name, kind: 'unrecognized JWT' }) }
  }
}
console.log('R8_BUNDLE ' + JSON.stringify({ checked: bundle.length, suspicious }))
if (suspicious.length) process.exitCode = 1
