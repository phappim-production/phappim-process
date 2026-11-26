// 1 การ์ด = 1 สิ่งที่ต้องทำต่อ
import { byQueue, filmLabel, isFilmNotOrdered, isOutLate, isOverdue, isWaitingFilm, leadReportBlocksFinish, STATION_NAME, type Job } from './model.ts'
import { spaced } from './format.ts'
import { thai, word, type Word } from '../i18n/word.ts'

export type ActionTone = 'danger' | 'warn' | 'info' | 'neutral'
export type NextAction = { job: Job; text: string; word: Word; tone: ActionTone; urgency: number }

export function nextAction(j: Job, now: Date): NextAction | null {
  const late = isOverdue(j, now)
  const at = j.station ? STATION_NAME[j.station] : ''
  const make = (w: Word, tone: ActionTone, urgency: number): NextAction =>
    ({ job: j, text: thai(w), word: w, tone: late && tone !== 'danger' ? 'danger' : tone, urgency: late ? Math.min(urgency, 1) : urgency })

  switch (j.phase) {
    case 'done':
      return null
    case 'materials':
      return make(word('เช็ควัตถุดิบ + ถ่ายรูป แล้วปล่อยเข้าไลน์การผลิต'), 'warn', 3)
    case 'sample_review':
      return make(word('แอดมินบันทึกผลตัวอย่างรอบ {n}', { n: j.sampleRound }), 'info', 4)
  }
  // อยู่บริษัทภายนอก: โรงงานกดอะไรไม่ได้ · สิ่งที่ต้องทำคือแอดมินตามของและรับกลับ
  if (j.status === 'out' && j.out) {
    const back = { at: j.out.backAt, time: true }
    const path = word(j.out.stations.map((_, i) => `{s${i}}`).join(' → '), Object.fromEntries(j.out.stations.map((s, i) => [`s${i}`, { th: STATION_NAME[s] }])))
    const what = word('{path}{rework}', { path, rework: j.out.rework ? { th: ' (งานแก้)' } : '' })
    return isOutLate(j, now)
      ? make(word('ของจาก {vendor} เลยกำหนด ({at} น.) · โทรตามบริษัท แล้วรับของกลับ', { vendor: j.out.vendor, at: back }), 'danger', 1)
      : make(word('อยู่ที่ {vendor}: {what} · รอรับของกลับ {at} น.', { vendor: j.out.vendor, what, at: back }), 'info', 6)
  }
  const station = { th: spaced(at).trimEnd() }
  if (j.status === 'hold') return make(word('แก้ปัญหา {station}: {reason}', { station: { th: at }, reason: j.holdReason ?? { th: 'ไม่ระบุสาเหตุ' } }), 'danger', 0)
  if (j.station === 'dtf_press' && isWaitingFilm(j)) return make(word('รอ{film}ก่อนเริ่มรีด', { film: { th: filmLabel(j.route) } }), 'warn', 2)
  if (j.station === 'dtf_press' && j.status === 'queued' && isFilmNotOrdered(j)) return make(word('ยังไม่ได้สั่ง{film} · แจ้งแอดมินสั่งก่อน ยังเริ่มรีดไม่ได้', { film: { th: filmLabel(j.route) } }), 'warn', 2)
  const prefix = j.phase === 'sample' ? { th: 'ตัวอย่าง · ' } : ''
  if (j.status === 'queued' && j.station === 'outside') return make(word('{prefix}แอดมินส่งออกบริษัทภายนอก', { prefix }), 'neutral', 5)
  if (j.status === 'queued') return make(word('{prefix}เริ่ม{station}', { prefix, station }), 'neutral', 5)
  if (leadReportBlocksFinish(j)) return make(word('เกินเวลาผลิต · ส่งรายงานสาเหตุก่อนกด QC + Packing เสร็จ'), 'danger', 1)
  if (j.sla === 'report' || j.sla === 'over') return make(word('{prefix}กำลังทำ{station} · เกินเวลาผลิต', { prefix, station }), 'danger', 2)
  if (j.sla === 'warn') return make(word('{prefix}กำลังทำ{station} · ใกล้ครบเวลาผลิต', { prefix, station }), 'warn', 3)
  return make(word('{prefix}กำลังทำ{station}', { prefix, station }), 'info', 6)
}

// เรียงตามคิวเสมอ · ความด่วนบอกด้วยสีของการ์ด ไม่ใช่ลำดับ
export function todoList(jobs: Job[], now: Date): NextAction[] {
  return [...jobs].sort(byQueue)
    .map(j => nextAction(j, now))
    .filter((a): a is NextAction => a !== null)
}
