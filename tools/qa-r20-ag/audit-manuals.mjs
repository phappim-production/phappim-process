// ตรวจคู่มือทุกไฟล์ใน docs/คู่มือ/*.md เทียบกับเมนูและหน้าจอปัจจุบัน
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const dir = 'docs/คู่มือ'
const files = (await readdir(dir)).filter(f => f.endsWith('.md'))
const findings = []

for (const f of files) {
  const txt = await readFile(join(dir, f), 'utf8')
  const hasSilkscreen = /ซิลค์สกรีน/.test(txt)
  const hasOldUrgent = /ด่วน\s+n/.test(txt)
  const hasMaterials = /รอผลิต|เช็ควัตถุดิบ/.test(txt)
  const imgs = [...txt.matchAll(/img\/([A-Za-z0-9_.-]+)/g)].map(m => m[1])
  findings.push({ file: f, hasSilkscreen, hasOldUrgent, hasMaterials, imgCount: imgs.length })
}

await mkdir('tools/qa-r20-ag', { recursive: true })
await writeFile('tools/qa-r20-ag/manuals-audit-results.json', JSON.stringify({ findings }, null, 2))
console.log(JSON.stringify(findings, null, 2))
