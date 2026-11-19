// กฎเดียวกับ private.missing_substeps · หน้าเว็บใช้บอกเหตุผลก่อนกด ฐานข้อมูลตรวจซ้ำ
import { thaiWorkEnd, type Phase, type StationCode } from '../proto/model.ts'

export type SubstepKind = 'req' | 'num' | 'appr' | 'lock' | 'opt'
export type Substep = { key: string; name: string; kind: SubstepKind }

export const KIND_LABEL: Record<SubstepKind, string> = {
  req: 'ต้องติ๊ก', num: 'กรอกค่า', appr: 'ต้องอนุมัติ', lock: 'รอเงื่อนไข', opt: 'เช็คลิสต์',
}

export type StepContext = {
  station: StationCode
  phase: Phase
  rework: boolean
  done: Set<string>        // job_substeps ของ visit ปัจจุบัน
  filmReceived: boolean
  qcPassed: number
  qty: number
}

// สถานีไม่บังคับเช็คลิสต์แล้ว เหลือแค่รอฟิล์ม และ QC ผลิตจริงต้องผ่านครบจำนวน
export function isRequired(s: Substep, c: Pick<StepContext, 'phase' | 'station'>): boolean {
  if (s.kind === 'lock') return true
  return c.station === 'qc_pack' && s.key === 'inspect' && c.phase === 'production'
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

// หน้างานลงแค่วันที่ → ใช้เวลาเลิกงานของวันนั้น · วันนี้เลยเวลาเลิกงานแล้วใช้สิ้นวัน เพราะฐานข้อมูลบังคับเวลาข้างหน้า
export function etaFromDay(day: string, now: Date): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const eod = thaiWorkEnd(day)
  if (eod > now) return eod
  const end = new Date(`${day}T23:59:00+07:00`)
  return end > now ? end : null
}
