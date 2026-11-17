// ขั้นย่อยที่ยังขาดก่อนกดเสร็จ · กฎเดียวกับ private.missing_substeps ในฐานข้อมูล
// หน้าเว็บใช้บอกเหตุผลก่อนกด (ปุ่มที่กดไม่ได้ต้องบอกว่าทำไม) · ฐานข้อมูลตรวจซ้ำเสมอ
import type { Phase, StationCode } from '../proto/model.ts'

export type SubstepKind = 'req' | 'num' | 'appr' | 'lock' | 'opt'
export type Substep = { key: string; name: string; kind: SubstepKind }

export const KIND_LABEL: Record<SubstepKind, string> = {
  req: 'ต้องติ๊ก', num: 'กรอกค่า', appr: 'ต้องอนุมัติ', lock: 'รอเงื่อนไข', opt: 'เช็คลิสต์',
}

export type StepContext = {
  station: StationCode
  phase: Phase
  rework: boolean
  done: Set<string>        // ขั้นที่ติ๊กแล้วในรอบนี้ (job_substeps ของ visit ปัจจุบัน)
  filmReceived: boolean
  qcPassed: number
  qty: number
}

/** ขั้นนี้ต้องทำก่อนกดเสร็จไหม (ตัวอย่างบังคับเฉพาะ req · QC ตอนขึ้นตัวอย่างไม่บังคับ) */
export function isRequired(s: Substep, c: Pick<StepContext, 'phase' | 'station'>): boolean {
  if (c.phase === 'sample') return s.kind === 'req' && c.station !== 'qc_pack'
  return s.kind !== 'opt'
}

export function isStepDone(s: Substep, c: StepContext): boolean {
  if (s.kind === 'lock') return c.filmReceived
  if (c.station === 'qc_pack' && s.key === 'inspect') return c.qcPassed >= c.qty
  return c.done.has(s.key)
}

export function missingSteps(steps: Substep[], c: StepContext): Substep[] {
  if (c.station === 'sew') return []                         // เย็บยืนยันเสร็จครั้งเดียว
  if (c.rework && c.station !== 'qc_pack') return []          // สถานีที่แก้งานไม่ต้องติ๊กซ้ำ
  return steps.filter(s => isRequired(s, c) && !isStepDone(s, c))
}

// วันที่คาดว่าเสร็จใหม่: หน้างานลงแค่วันที่ (PP-SOP-01) → ใช้เวลาเลิกงาน 17:00 ของวันนั้น
// ถ้าเป็นวันนี้และเลย 17:00 แล้ว ใช้สิ้นวันแทน เพื่อให้ยังเป็นเวลาข้างหน้าตามที่ฐานข้อมูลบังคับ
export function etaFromDay(day: string, now: Date): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const eod = new Date(`${day}T17:00:00+07:00`)
  if (eod > now) return eod
  const end = new Date(`${day}T23:59:00+07:00`)
  return end > now ? end : null
}
