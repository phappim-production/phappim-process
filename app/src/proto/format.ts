import { DEPT_NAME, ROUTES, STATION_NAME, STATUS_NAME, missingDepts, startOfDay, type Job } from './model'

export function shortDate(d: Date) {
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
}

export function dayDiff(a: Date, b: Date) {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86_400_000)
}

export function relDay(d: Date, now: Date) {
  const diff = dayDiff(now, d)
  return diff === 0 ? 'วันนี้' : diff === 1 ? 'เมื่อวาน' : shortDate(d)
}

export function duration(ms: number) {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 60) return `${min} นาที`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} ชม. ${min % 60 ? `${min % 60} นาที` : ''}`.trim()
  return `${Math.floor(h / 24)} วัน ${h % 24 ? `${h % 24} ชม.` : ''}`.trim()
}

/** ขั้นตอนปัจจุบันเป็นประโยคสั้นๆ */
export function stageText(j: Job) {
  switch (j.phase) {
    case 'materials': return `รอวัตถุดิบ (รอ ${missingDepts(j).map(d => DEPT_NAME[d]).join(', ')})`
    case 'sample': return `ขึ้นตัวอย่าง${j.sampleRound > 1 ? ` รอบ ${j.sampleRound}` : ''}${j.station ? ` · ${STATION_NAME[j.station]}` : ''}`
    case 'sample_review': return 'รอลูกค้ายืนยันตัวอย่าง'
    case 'production': return j.station ? `${STATION_NAME[j.station]} · ${STATUS_NAME[j.status ?? 'queued']}` : 'กำลังผลิต'
    case 'done': return 'เสร็จ / พร้อมส่ง'
  }
}

/** ขั้นทั้งหมดของงาน (วัตถุดิบ → ตัวอย่าง → ลูกค้ายืนยัน → สถานีตามเส้นทาง) และตำแหน่งปัจจุบัน */
export function stageSteps(j: Job) {
  const steps = ['วัตถุดิบ', 'ขึ้นตัวอย่าง', 'ลูกค้ายืนยัน', ...ROUTES[j.route].stations.map(s => STATION_NAME[s])]
  const current = j.phase === 'materials' ? 0 : j.phase === 'sample' ? 1 : j.phase === 'sample_review' ? 2
    : j.phase === 'production' ? 3 + Math.max(0, ROUTES[j.route].stations.indexOf(j.station ?? ROUTES[j.route].stations[0])) : steps.length
  return { steps, current }
}
