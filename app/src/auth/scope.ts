// ไม่ได้ปิดบังข้อมูล แค่ไม่ให้คนหน้างานงง · ทุกบทบาทกดดูทั้งโรงงานได้ และสิทธิ์จริงบังคับที่ฐานข้อมูล
import { columnOf, type ColumnKey, type Dept, type Job, type StationCode } from '../proto/model.ts'
import type { SummaryKind } from '../proto/summary.ts'
import { SECTION_LABELS, type EmployeeRole, type PageKey, type Section } from './access.ts'

// ตรงกับ stations.section ในฐานข้อมูล
export const STATION_SECTION: Record<StationCode, Section> = {
  print: 1, press: 1, cut: 1, dtf_press: 1, emb: 1, sew: 2, qc_pack: 2,
}

const ALL_STATIONS: StationCode[] = ['print', 'press', 'cut', 'dtf_press', 'emb', 'sew', 'qc_pack']

export type BoardScope = {
  title: string
  sub: string
  columns: ColumnKey[] | null   // null = ทุกคอลัมน์ (ทั้งโรงงาน)
  sampleStations?: StationCode[] // คอลัมน์ "ขึ้นตัวอย่าง" แสดงเฉพาะงานที่อยู่สถานีเหล่านี้
  materialsDept?: Dept           // คอลัมน์ "รอวัตถุดิบ" แสดงเฉพาะงานที่ยังรอฝ่ายนี้
  showFilm: boolean              // ฟิล์ม DTF เกี่ยวกับแอดมินและคนที่ดูแลรีด DTF เท่านั้น
  tabs: DashTab[]                // แท็บแรก = เปิดมาเจอ
  allowFactory: boolean
  canSew: boolean
  canReportMachines: boolean
  canSetRepairEta?: boolean      // ฝ่ายผลิต · owner ทำแทนได้
  canBook?: boolean              // ฝ่ายผลิตเท่านั้น · owner ทำแทนได้
  summary: SummaryKind
}

export type DashTab = 'todo' | 'board' | 'sewing'
export const DASH_TAB_NAME: Record<DashTab, string> = { todo: 'ต้องทำตอนนี้', board: 'บอร์ด', sewing: 'จักรเย็บ' }

export const FACTORY_SCOPE: BoardScope = {
  title: 'หน้างานทั้งโรงงาน',
  sub: 'งานทุกงานเรียงตามสถานี · กดการ์ดเพื่อดูรายละเอียด',
  columns: null,
  showFilm: true,
  // คนตัดสินใจรับงานต้องเห็นว่าจักรเย็บพอหรือไม่
  tabs: ['board', 'sewing'],
  allowFactory: true,
  canSew: false,
  canReportMachines: false,
  summary: 'factory',
}

export function boardScope(role: EmployeeRole, section: Section | null): BoardScope {
  switch (role) {
    case 'supervisor': {
      const stations = section ? ALL_STATIONS.filter(s => STATION_SECTION[s] === section) : ALL_STATIONS
      return {
        title: section ? `งาน${SECTION_LABELS[section]}` : 'งานทุกสถานี',
        sub: 'งานที่อยู่สถานีที่คุณดูแล · กดการ์ดเพื่อดูรายละเอียด',
        // เฟส 2 ต้องเห็นงานที่เพิ่งเสร็จ เพื่อตรวจว่าแพ็กส่งครบ
        columns: ['sample', ...stations, ...(section === 1 ? [] : ['done' as const])],
        sampleStations: stations,
        showFilm: stations.includes('dtf_press'),
        // เฟส 2 เปิดมาเจอจักรเย็บก่อน เพราะงานหลักคือเลือกงานขึ้นจักร
        tabs: stations.includes('sew') ? ['sewing', 'todo', 'board'] : ['todo', 'board'],
        // เฟส 2 ดูเฉพาะงานที่ส่งถึงเฟส 2 แล้ว ไม่ดูงานรวมของโรงงาน
        allowFactory: section !== 2,
        canSew: section !== 1,
        canReportMachines: section !== 1,
        summary: section === 1 ? 'phase1' : section === 2 ? 'phase2' : 'allPhases',
      }
    }
    case 'qc':
      return {
        title: 'งาน QC + Packing',
        sub: 'งานรอตรวจ · งานเสร็จล่าสุด',
        columns: ['qc_pack', 'done'],
        materialsDept: 'qc',
        summary: 'qc',
        showFilm: false,
        // คนหน้างานเปิดมาเจอคิวสถานีที่เครื่องจำไว้
        tabs: ['board', 'todo'],
        allowFactory: true,
        canSew: false,
        canReportMachines: false,
      }
    // ฝ่ายผลิตดูแลงานตั้งแต่รับใบสั่งจนส่งของ จึงเห็นทุกขั้น (แบ่งเฟสใช้กับผู้ควบคุมงานเท่านั้น)
    // owner ทำแทนผู้ควบคุมงานเฟส 2 ได้ในวันที่ไม่มีคนคุม
    case 'owner':
      return { ...FACTORY_SCOPE, canSew: true, canReportMachines: true, canSetRepairEta: true, canBook: true }
    case 'production':
      return {
        ...FACTORY_SCOPE,
        title: 'งานฝ่ายผลิต · พิมพ์ถึง QC',
        sub: 'ฝ่ายผลิตคุมทุกสถานี ตั้งแต่รับงาน พิมพ์ รีด ตัด เย็บ จนถึง QC + Packing',
        tabs: ['board', 'todo', 'sewing'],
        summary: 'production',
        // ฝ่ายผลิตทำแทนผู้ควบคุมงานทั้ง 2 เฟสได้
        canSew: true,
        canReportMachines: true,
        canSetRepairEta: true,
        canBook: true,
      }
    default:
      return FACTORY_SCOPE
  }
}

export function jobInScope(job: Job, scope: BoardScope): boolean {
  if (!scope.columns) return true
  const column = columnOf(job)
  if (!scope.columns.includes(column)) return false
  if (column === 'sample' && scope.sampleStations) return !!job.station && scope.sampleStations.includes(job.station)
  if (column === 'materials' && scope.materialsDept) return !job.materials[scope.materialsDept]
  return true
}

// หน้าแรกหลังล็อกอิน: คนที่ต้องดูภาพรวมไปภาพรวม · คนหน้างานไปงานของตัวเองทันที
export function homePage(role: EmployeeRole): PageKey {
  return role === 'owner' || role === 'admin' || role === 'manager' ? 'overview' : 'board'
}
