import { DEPT_NAME, ROUTES, STATION_NAME, STATUS_NAME, missingDepts, thaiDay, thaiDayDiff, type Job } from './model.ts'
import { thai, word, type Word } from '../i18n/word.ts'

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
  return thai(relDayWord(d, now))
}

export function relDayWord(d: Date, now: Date): Word {
  const diff = dayDiff(now, d)
  return diff === 0 ? word('วันนี้') : diff === 1 ? word('เมื่อวาน') : { th: '{at}', vars: { at: { at: d } } }
}

export function duration(ms: number) {
  return thai(durationWord(ms))
}

export function durationWord(ms: number): Word {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 60) return word('{n} นาที', { n: min })
  const h = Math.floor(min / 60)
  if (h < 24) return min % 60 ? word('{h} ชม. {m} นาที', { h, m: min % 60 }) : word('{n} ชม.', { n: h })
  return h % 24 ? word('{d} วัน {h} ชม.', { d: Math.floor(h / 24), h: h % 24 }) : word('{n} วัน', { n: Math.floor(h / 24) })
}

export function stageText(j: Job) {
  switch (j.phase) {
    case 'materials': return `รอวัตถุดิบ (รอ ${missingDepts(j).map(d => DEPT_NAME[d]).join(', ')})`
    case 'sample': return `ขึ้นตัวอย่าง${j.sampleRound > 1 ? ` รอบ ${j.sampleRound}` : ''}${j.station ? ` · ${STATION_NAME[j.station]}` : ''}`
    case 'sample_review': return 'รอลูกค้ายืนยันตัวอย่าง'
    case 'production': return j.station ? `${STATION_NAME[j.station]} · ${STATUS_NAME[j.status ?? 'queued']}` : 'กำลังผลิต'
    case 'done': return j.delivered ? 'จัดส่งแล้ว' : 'เสร็จ / รอจัดส่ง'
  }
}

// งานที่ไม่ขึ้นตัวอย่างไม่มี 2 ขั้นกลาง
export function stageSteps(j: Job) {
  const pre = j.needsSample === false ? ['วัตถุดิบ'] : ['วัตถุดิบ', 'ขึ้นตัวอย่าง', 'ลูกค้ายืนยัน']
  const steps = [...pre, ...(j.develop ? [] : ROUTES[j.route].stations.map(s => STATION_NAME[s]))]
  const current = j.phase === 'materials' ? 0 : j.phase === 'sample' ? 1 : j.phase === 'sample_review' ? 2
    : j.phase === 'production' ? pre.length + Math.max(0, ROUTES[j.route].stations.indexOf(j.station ?? ROUTES[j.route].stations[0])) : steps.length
  return { steps, current }
}

// แอดมินพิมพ์ปี พ.ศ. ในช่องวันที่ได้ (เช่น 2569) · เกิน 1 ปีจึงถือว่าพิมพ์ปีผิด
export function dueDateWarning(due: string, now: Date): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return null
  const today = thaiDay(now)
  if (due < today) return 'กำหนดส่งเป็นวันที่ผ่านมาแล้ว · งานจะขึ้นเลยกำหนดทันที ตรวจวันและปีอีกครั้ง'
  if (Date.parse(due) - Date.parse(today) > 366 * 86_400_000) return 'กำหนดส่งเกิน 1 ปีจากวันนี้ · ตรวจว่าใส่ปี ค.ศ. ไม่ใช่ พ.ศ.'
  return null
}

export function wholeCount(text: string): number | null {
  return /^\s*\d+\s*$/.test(text) ? Number(text) : null
}
