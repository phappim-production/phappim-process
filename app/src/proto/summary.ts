// แต่ละตำแหน่งเห็น 4 ตัวเลขที่ตัวเองใช้ตัดสินใจ ไม่ใช่ชุดเดียวกันทั้งโรงงาน
import { columnOf, isDoneToday, isOverdue, isWaitingFilm, type Job } from './model.ts'
import { floorSummary, sewQueue, type Machine } from './sewing.ts'
import { word, type Word } from '../i18n/word.ts'

export type SummaryKind = 'factory' | 'phase1' | 'phase2' | 'allPhases' | 'qc' | 'production' | 'staff'
export type SummaryTone = 'brand' | 'danger' | 'warn' | 'info' | 'ok'
export type SummaryIcon = 'factory' | 'alert' | 'clock' | 'film' | 'sewing' | 'check' | 'package' | 'clipboard'
export type SummaryTab = 'todo' | 'board' | 'sewing'
export type SewingView = 'work' | 'booking' | 'machines'
export type SummaryTile = {
  key: string
  label: string
  value: number
  note?: string | Word
  tone: SummaryTone
  icon: SummaryIcon
  tab?: SummaryTab
  sewingView?: SewingView
}

const active = (jobs: Job[]) => jobs.filter(j => j.phase !== 'done')
// รวมงานขึ้นตัวอย่างที่มาถึง QC (บอร์ดของ QC แสดงงานนี้ในคอลัมน์เดียวกัน)
const atQc = (j: Job) => columnOf(j) === 'qc_pack' || (j.phase === 'sample' && j.station === 'qc_pack')
const doing = (jobs: Job[]) => active(jobs).filter(j => j.status === 'doing')
// เลยกำหนดส่ง หรือ พักงานอยู่ = ต้องจัดการก่อน (นับงานละครั้ง)
const urgent = (jobs: Job[], now: Date) => active(jobs).filter(j => j.status === 'hold' || isOverdue(j, now))

// งานที่ทั้งพักและเลยกำหนดนับในบรรทัดรองทั้งสองค่า ไม่ให้ขึ้น "เลยกำหนด 0" ขณะที่การ์ดบอกว่าเลยกำหนดแล้ว
function urgentTile(jobs: Job[], now: Date): SummaryTile {
  const list = urgent(jobs, now)
  const hold = list.filter(j => j.status === 'hold').length
  const late = list.filter(j => isOverdue(j, now)).length
  return {
    key: 'urgent', label: 'เลยกำหนด / ติดปัญหา', value: list.length, tone: 'danger', icon: 'alert', tab: 'todo',
    note: list.length ? word('พักงาน {hold} · เลยกำหนด {late}', { hold, late }) : 'ไม่มีงานเลยกำหนดหรือติดปัญหา',
  }
}

function machineTile(machines: Machine[]): SummaryTile {
  const s = floorSummary(machines)
  return {
    key: 'machines', label: 'จักรว่างตอนนี้', value: s.freeTotal, tone: 'ok', icon: 'sewing', tab: 'sewing', sewingView: 'machines',
    note: s.broken ? word('จาก {n} ตัว · เสีย {broken}', { n: s.count, broken: s.broken }) : word('จาก {n} ตัว', { n: s.count }),
  }
}

// jobs = งานในขอบเขตของตำแหน่ง · allJobs = ทั้งโรงงาน (คิวเย็บต้องรู้ว่าจักรถูกใช้กับงานไหน)
export function roleSummary(kind: SummaryKind, jobs: Job[], allJobs: Job[], machines: Machine[], now: Date): SummaryTile[] {
  switch (kind) {
    case 'phase1':
      return [
        { key: 'inScope', label: 'งานในเฟส 1', value: active(jobs).length, tone: 'brand', icon: 'factory', tab: 'board', note: 'พิมพ์ · รีด · ตัด · รีด DTF' },
        { key: 'doing', label: 'กำลังทำ', value: doing(jobs).length, tone: 'info', icon: 'clock', tab: 'board' },
        urgentTile(jobs, now),
        { key: 'film', label: 'รอฟิล์ม DTF', value: jobs.filter(isWaitingFilm).length, tone: 'warn', icon: 'film', tab: 'todo', note: 'เริ่มรีด DTF ไม่ได้จนกว่าจะได้ฟิล์ม' },
      ]
    case 'phase2': {
      const sewing = active(jobs).filter(j => j.station === 'sew' && j.status === 'doing').length
      const waiting = sewQueue(allJobs, machines).length
      const qc = active(jobs).filter(j => columnOf(j) === 'qc_pack').length
      return [
        { key: 'sewing', label: 'กำลังเย็บ', value: sewing, tone: 'info', icon: 'sewing', tab: 'sewing', sewingView: 'work' },
        { key: 'waitingSew', label: 'รอเย็บ', value: waiting, tone: 'warn', icon: 'clock', tab: 'sewing', sewingView: 'work', note: 'ถึงสถานีเย็บแล้ว ยังไม่เริ่ม' },
        machineTile(machines),
        { key: 'qc', label: 'รอ QC + Packing', value: qc, tone: 'brand', icon: 'clipboard', tab: 'board' },
      ]
    }
    case 'allPhases':
      return [
        { key: 'inScope', label: 'งานทุกสถานี', value: active(jobs).length, tone: 'brand', icon: 'factory', tab: 'board' },
        { key: 'doing', label: 'กำลังทำ', value: doing(jobs).length, tone: 'info', icon: 'clock', tab: 'board' },
        urgentTile(jobs, now),
        machineTile(machines),
      ]
    case 'qc': {
      const waitingQc = active(jobs).filter(atQc)
      return [
        { key: 'qc', label: 'รอ QC + Packing', value: waitingQc.length, tone: 'brand', icon: 'clipboard', tab: 'board',
          note: word('{n} ชิ้น', { n: waitingQc.reduce((n, j) => n + j.qty, 0).toLocaleString('th-TH') }) },
        { key: 'qcDoing', label: 'กำลังตรวจ', value: waitingQc.filter(j => j.status === 'doing').length, tone: 'info', icon: 'clock', tab: 'board' },
        { key: 'rework', label: 'งานแก้', value: active(allJobs).filter(j => j.rework).length, tone: 'danger', icon: 'alert', tab: 'board', note: 'ส่งกลับไปแก้ที่สถานีต้นเหตุ' },
        { key: 'done', label: 'เสร็จวันนี้', value: allJobs.filter(j => isDoneToday(j, now)).length, tone: 'ok', icon: 'check', tab: 'board' },
      ]
    }
    case 'staff':
      return [
        { key: 'inScope', label: 'งานที่สถานีของฉัน', value: active(jobs).length, tone: 'brand', icon: 'factory', tab: 'board' },
        { key: 'doing', label: 'กำลังทำ', value: doing(jobs).length, tone: 'info', icon: 'clock', tab: 'board' },
        urgentTile(jobs, now),
        { key: 'done', label: 'เสร็จวันนี้', value: allJobs.filter(j => isDoneToday(j, now)).length, tone: 'ok', icon: 'check', tab: 'board' },
      ]
    case 'production':
      return [
        { key: 'inScope', label: 'งานในโรงงาน', value: active(jobs).length, tone: 'brand', icon: 'factory', tab: 'board' },
        urgentTile(jobs, now),
        { key: 'doing', label: 'กำลังทำ', value: doing(jobs).length, tone: 'info', icon: 'clock', tab: 'board' },
        { key: 'broken', label: 'จักรเสีย', value: machines.filter(m => m.status === 'broken').length, tone: 'danger', icon: 'sewing', tab: 'sewing', sewingView: 'machines', note: 'แจ้งเสีย / กำหนดเวลาซ่อม' },
      ]
    default:
      return [
        { key: 'inScope', label: 'งานในโรงงาน', value: active(jobs).length, tone: 'brand', icon: 'factory', tab: 'board' },
        { key: 'doing', label: 'กำลังทำ', value: doing(jobs).length, tone: 'info', icon: 'clock', tab: 'board' },
        urgentTile(jobs, now),
        machineTile(machines),
      ]
  }
}
