// สร้างรายงาน report.md และ report.json นอก repo พร้อมเทียบผลกับรอบก่อนหน้า
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function writeReport({ outDir, meta, parts, comparePath = null }) {
  await mkdir(outDir, { recursive: true })
  const passed = parts.filter(p => p.status === 'PASS').length
  const failed = parts.filter(p => p.status === 'FAIL').length

  let diff = null
  if (comparePath) {
    try {
      const prev = JSON.parse(await readFile(comparePath, 'utf8'))
      const prevMap = Object.fromEntries((prev.parts ?? []).map(p => [p.id, p.status]))
      const newlyFailed = parts.filter(p => p.status === 'FAIL' && prevMap[p.id] === 'PASS').map(p => p.id)
      const newlyPassed = parts.filter(p => p.status === 'PASS' && prevMap[p.id] === 'FAIL').map(p => p.id)
      diff = { comparePath, newlyFailed, newlyPassed }
    } catch (e) {
      diff = { comparePath, error: e.message }
    }
  }

  const reportJson = {
    meta,
    summary: { total: parts.length, passed, failed, ok: failed === 0 },
    diff,
    parts,
  }
  await writeFile(join(outDir, 'report.json'), JSON.stringify(reportJson, null, 2))

  const lines = [
    `# รายงานผลระบบทดสอบอัตโนมัติ (qa-suite)`,
    ``,
    `- **โหมด:** ${meta.mode} · **Seed:** ${meta.seed} · **วัน:** ${meta.days}${meta.mutate ? ` · **ใส่บั๊กทดสอบ:** ${meta.mutate}` : ''}`,
    `- **เวลาเริ่ม:** ${meta.startedAt} · **ใช้เวลา:** ${meta.durationMs} ms`,
    `- **สรุป:** ผ่าน **${passed}/${parts.length}** · ไม่ผ่าน **${failed}** · คำขอออกนอกเครื่อง: **${meta.externalAttempts}**`,
    `- **คำสั่งรันซ้ำ:** \`${meta.replay}\``,
    ``,
    `| ส่วน | สถานะ | เวลา (ms) | รายละเอียด |`,
    `|---|---|---|---|`,
  ]
  for (const p of parts) {
    const st = p.status === 'PASS' ? '✅ ผ่าน' : '❌ ไม่ผ่าน'
    const info = p.status === 'PASS' ? (p.detail ?? '') : (p.error ?? '')
    lines.push(`| ${p.id} | ${st} | ${p.durationMs ?? 0} | ${String(info).replace(/\|/g, '\\|').slice(0, 200)} |`)
  }
  if (diff && !diff.error) {
    lines.push('', '## เทียบกับรอบก่อน', `- เพิ่งล้ม: ${diff.newlyFailed.join(', ') || 'ไม่มี'}`, `- เพิ่งหาย: ${diff.newlyPassed.join(', ') || 'ไม่มี'}`)
  }
  const failedParts = parts.filter(p => p.status === 'FAIL')
  if (failedParts.length) {
    lines.push('', '## รายละเอียดข้อที่ล้ม')
    for (const p of failedParts) {
      lines.push(`### ${p.id}`, `- **สาเหตุ:** ${p.error}`)
      if (p.replay) lines.push(`- **คำสั่งรันซ้ำ:** \`${p.replay}\``)
      if (p.details?.length) lines.push('- **ทุกข้อที่เจอ:**', ...p.details.map(d => `  - ${d}`))
      if (p.trace?.length) lines.push(`- **${p.trace.length} ขั้นสุดท้ายก่อนล้ม:**`, '```json', JSON.stringify(p.trace, null, 2), '```')
    }
  }
  await writeFile(join(outDir, 'report.md'), lines.join('\n'))
  return reportJson
}
