// 1 การ์ด = 1 สิ่งที่ต้องทำต่อ
import { DEPT_NAME, byQueue, filmLabel, isOutLate, isOverdue, isWaitingFilm, missingDepts, STATION_NAME, type Job } from './model.ts'
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
  // อยู่บริษัทภายนอก: โรงงานกดอะไรไม่ได้ · สิ่งที่ต้องทำคือแอดมินตามของและรับกลับ
  if (j.status === 'out' && j.out) {
    const back = j.out.backAt.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    const what = j.out.stations.map(s => STATION_NAME[s]).join(' → ') + (j.out.rework ? ' (งานแก้)' : '')
    return isOutLate(j, now)
      ? make(`ของจาก ${j.out.vendor} เลยกำหนด (${back} น.) · โทรตามบริษัท แล้วรับของกลับ`, 'danger', 1)
      : make(`อยู่ที่ ${j.out.vendor}: ${what} · รอรับของกลับ ${back} น.`, 'info', 6)
  }
  if (j.status === 'hold') return make(`แก้ปัญหา ${at}: ${j.holdReason ?? 'ไม่ระบุสาเหตุ'}`, 'danger', 0)
  if (j.station === 'dtf_press' && isWaitingFilm(j)) return make(`รอ${filmLabel(j.route)}ก่อนเริ่มรีด`, 'warn', 2)
  const prefix = j.phase === 'sample' ? 'ตัวอย่าง · ' : ''
  if (j.status === 'queued' && j.station === 'outside') return make(`${prefix}แอดมินส่งออกบริษัทภายนอก`, 'neutral', 5)
  if (j.status === 'queued') return make(`${prefix}เริ่ม${spaced(at).trimEnd()}`, 'neutral', 5)
  // ให้เห็นเวลามาตรฐานจากรายการเลย ไม่ต้องเปิดทีละงาน
  if (j.sla === 'report') return make(`${at} เกินเวลามาตรฐาน · ส่งรายงานปัญหาก่อนกดเสร็จ`, 'danger', 1)
  if (j.sla === 'over') return make(`${prefix}กำลังทำ${spaced(at).trimEnd()} · เกินเวลามาตรฐาน (รายงานแล้ว)`, 'danger', 2)
  if (j.sla === 'warn') return make(`${prefix}กำลังทำ${spaced(at).trimEnd()} · ใกล้ครบเวลามาตรฐาน`, 'warn', 3)
  return make(`${prefix}กำลังทำ${spaced(at).trimEnd()}`, 'info', 6)
}

// เรียงตามคิวเสมอ · ความด่วนบอกด้วยสีของการ์ด ไม่ใช่ลำดับ
export function todoList(jobs: Job[], now: Date): NextAction[] {
  return [...jobs].sort(byQueue)
    .map(j => nextAction(j, now))
    .filter((a): a is NextAction => a !== null)
}
