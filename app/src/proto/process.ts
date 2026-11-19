import { ROUTES, STATUS_NAME, type Job, type StationCode } from './model.ts'

export const STATION_SHORT: Record<StationCode, string> = {
  print: 'พิมพ์', press: 'รีด', cut: 'ตัด', dtf_press: 'รีดฟิล์ม', emb: 'ปัก', sew: 'เย็บ', qc_pack: 'QC',
}

export type StepState = 'done' | 'now' | 'hold' | 'todo'
export type ProcessStep = { key: string; label: string; state: StepState; note?: string }

export function processSteps(j: Job): ProcessStep[] {
  const stations = ROUTES[j.route].stations
  const atStation = (j.phase === 'sample' || j.phase === 'production') && !!j.station
  const cur = atStation ? stations.indexOf(j.station!) : -1
  const before = j.phase === 'materials' ? 'รอวัตถุดิบ' : j.phase === 'sample_review' ? 'รอลูกค้ายืนยันตัวอย่าง' : null
  const steps: ProcessStep[] = before ? [{ key: 'before', label: before, state: 'now' }] : []
  stations.forEach((s, i) => {
    const state: StepState = j.phase === 'done' ? 'done'
      : cur < 0 ? 'todo'
      : i < cur ? 'done'
      : i > cur ? 'todo'
      : j.status === 'hold' ? 'hold' : 'now'
    const note = state === 'now' || state === 'hold'
      ? [j.phase === 'sample' ? 'ตัวอย่าง' : '', j.status === 'out' ? 'ข้างนอก' : STATUS_NAME[j.status ?? 'queued']].filter(Boolean).join(' · ')
      : undefined
    steps.push({ key: s, label: STATION_SHORT[s], state, note })
  })
  if (j.phase === 'done') steps.push({ key: 'done', label: 'เสร็จ', state: 'done' })
  return steps
}
