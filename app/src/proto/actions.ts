// "ต้องทำตอนนี้" ของแต่ละฝ่าย: แปลงสถานะงานเป็นสิ่งที่คนต้องลงมือ 1 อย่างต่องาน (หลัก 1 การ์ด = 1 สิ่งที่ต้องทำต่อ)
// เรียงให้เรื่องด่วนขึ้นก่อน คนหน้างานจะได้ไม่ต้องไล่อ่านทุกการ์ดบนบอร์ด
import { DEPT_NAME, filmLabel, isOverdue, isWaitingFilm, missingDepts, STATION_NAME, startOfDay, type Job } from './model.ts'
import { spaced } from './format.ts'

export type ActionTone = 'danger' | 'warn' | 'info' | 'neutral'
export type NextAction = { job: Job; text: string; tone: ActionTone; urgency: number }

export function nextAction(j: Job, now: Date): NextAction | null {
  const late = isOverdue(j, now)
  const at = j.station ? STATION_NAME[j.station] : ''
  const make = (text: string, tone: ActionTone, urgency: number): NextAction =>
    ({ job: j, text, tone: late && tone !== 'danger' ? 'danger' : tone, urgency: late ? Math.min(urgency, 1) : urgency })

  switch (j.phase) {
    case 'done':
      return null
    case 'materials':
      return make(`ติ๊กวัตถุดิบ: รอ ${missingDepts(j).map(d => DEPT_NAME[d]).join(', ')}`, 'warn', 3)
    case 'sample_review':
      return make(`แอดมินบันทึกผลตัวอย่างรอบ ${j.sampleRound}`, 'info', 4)
  }
  if (j.status === 'hold') return make(`แก้ปัญหา ${at}: ${j.holdReason ?? 'ไม่ระบุสาเหตุ'}`, 'danger', 0)
  if (j.station === 'dtf_press' && isWaitingFilm(j)) return make(`รอ${filmLabel(j.route)}ก่อนเริ่มรีด`, 'warn', 2)
  const prefix = j.phase === 'sample' ? 'ตัวอย่าง · ' : ''
  if (j.status === 'queued') return make(`${prefix}เริ่ม${spaced(at).trimEnd()}`, 'neutral', 5)
  return make(`${prefix}กำลังทำ${spaced(at).trimEnd()}`, 'info', 6)
}

// ด่วนสุดก่อน · เท่ากันให้กำหนดส่งใกล้กว่าขึ้นก่อน
export function todoList(jobs: Job[], now: Date): NextAction[] {
  return jobs
    .map(j => nextAction(j, now))
    .filter((a): a is NextAction => a !== null)
    .sort((a, b) => a.urgency - b.urgency || startOfDay(a.job.due).getTime() - startOfDay(b.job.due).getTime())
}
