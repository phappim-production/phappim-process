import { DEPT_NAME, ROUTES, STATION_NAME, STATUS_NAME, missingDepts, thaiDayDiff, type Job } from './model.ts'

// ใส่ช่องว่างรอบชื่อที่ขึ้นต้น/ลงท้ายด้วยอังกฤษหรือตัวเลข เมื่อวางในประโยคไทย
export function spaced(name: string): string {
  return `${/^[A-Za-z0-9]/.test(name) ? ' ' : ''}${name}${/[A-Za-z0-9)]$/.test(name) ? ' ' : ''}`
}

export function shortDate(d: Date) {
  return d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' })
}

// "วันนี้ / พรุ่งนี้ / อีก n วัน" ต้องนับตามวันไทย เหมือนสีเลยกำหนด
export function dayDiff(a: Date, b: Date) {
  return thaiDayDiff(a, b)
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

export function stageText(j: Job) {
  switch (j.phase) {
    case 'materials': return `รอวัตถุดิบ (รอ ${missingDepts(j).map(d => DEPT_NAME[d]).join(', ')})`
    case 'sample': return `ขึ้นตัวอย่าง${j.sampleRound > 1 ? ` รอบ ${j.sampleRound}` : ''}${j.station ? ` · ${STATION_NAME[j.station]}` : ''}`
    case 'sample_review': return 'รอลูกค้ายืนยันตัวอย่าง'
    case 'production': return j.station ? `${STATION_NAME[j.station]} · ${STATUS_NAME[j.status ?? 'queued']}` : 'กำลังผลิต'
    case 'done': return 'เสร็จ / พร้อมส่ง'
  }
}

// งานที่ไม่ขึ้นตัวอย่างไม่มี 2 ขั้นกลาง
export function stageSteps(j: Job) {
  const pre = j.needsSample === false ? ['วัตถุดิบ'] : ['วัตถุดิบ', 'ขึ้นตัวอย่าง', 'ลูกค้ายืนยัน']
  const steps = [...pre, ...ROUTES[j.route].stations.map(s => STATION_NAME[s])]
  const current = j.phase === 'materials' ? 0 : j.phase === 'sample' ? 1 : j.phase === 'sample_review' ? 2
    : j.phase === 'production' ? pre.length + Math.max(0, ROUTES[j.route].stations.indexOf(j.station ?? ROUTES[j.route].stations[0])) : steps.length
  return { steps, current }
}

// 1 วันทำงานในฐานข้อมูล = 24 ชม. (private.work_days นับจันทร์–เสาร์) · ไม่ถึงครึ่งวันแสดงเป็นชั่วโมง
export function slaAmount(days: number): string {
  if (days < 0.5) return `${(Math.round(days * 24 * 10) / 10).toLocaleString('th-TH')} ชม.`
  return `${(Math.round(days * 10) / 10).toLocaleString('th-TH')} วัน`
}
