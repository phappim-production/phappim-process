// ใครเห็นข้อมูลแค่ไหน (docs/แผน-1-สัปดาห์.md หัวข้อ 1.4)
// เป้าหมายคือไม่ให้คนหน้างานงงกับงานที่ไม่เกี่ยวกับตัวเอง ไม่ใช่การปิดบังข้อมูล:
// ทุกบทบาทยังกด "ดูทั้งโรงงาน" ได้ และสิทธิ์กดจริงบังคับที่ฐานข้อมูลอยู่แล้ว
import { columnOf, type ColumnKey, type Dept, type Job, type StationCode } from '../proto/model.ts'
import type { SummaryKind } from '../proto/summary.ts'
import { SECTION_LABELS, type EmployeeRole, type PageKey, type Section } from './access.ts'

// ตรงกับ stations.section ใน supabase/migrations/20261118000001_supervisor_sections.sql
// A5 จะอ่านจากฐานข้อมูลแทน (เจ้าของระบบแก้เฟสของสถานีได้ที่หน้าตั้งค่า)
export const STATION_SECTION: Record<StationCode, Section> = {
  print: 1, press: 1, cut: 1, dtf_press: 1, sew: 2, qc_pack: 2,
}

const ALL_STATIONS: StationCode[] = ['print', 'press', 'cut', 'dtf_press', 'sew', 'qc_pack']

export type BoardScope = {
  title: string
  sub: string
  columns: ColumnKey[] | null   // null = ทุกคอลัมน์ (ทั้งโรงงาน)
  sampleStations?: StationCode[] // คอลัมน์ "ขึ้นตัวอย่าง" แสดงเฉพาะงานที่อยู่สถานีเหล่านี้
  materialsDept?: Dept           // คอลัมน์ "รอวัตถุดิบ" แสดงเฉพาะงานที่ยังรอฝ่ายนี้
  showFilm: boolean              // ฟิล์ม DTF เกี่ยวกับแอดมินและคนที่ดูแลรีด DTF เท่านั้น
  tabs: DashTab[]                // แท็บของแดชบอร์ด · แท็บแรก = เปิดมาเจอ
  allowFactory: boolean          // มีปุ่ม "ทั้งโรงงาน" ไหม
  canSew: boolean                // กดเริ่มเย็บได้ไหม (ฐานข้อมูลตรวจซ้ำ)
  canReportMachines: boolean     // แจ้งจักรเสีย / ซ่อมเสร็จได้ไหม (ฐานข้อมูลตรวจซ้ำ)
  canSetRepairEta?: boolean      // กำหนดกรอบเวลาซ่อม = ฝ่ายผลิต (ตัดสินใจ 16 พ.ย.) · owner ทำแทนได้
  canBook?: boolean              // จอง / ยกเลิกจองจักร = ฝ่ายผลิตเท่านั้น (ตัดสินใจ 16 พ.ย.) · owner ทำแทนได้
  summary: SummaryKind           // ตัวเลขสรุปบนสุดของแดชบอร์ดตามตำแหน่ง (proto/summary.ts)
}

// ต้องทำตอนนี้ (รายการงานเรียงด่วน) · บอร์ด (คอลัมน์ตามสถานี) · จักรเย็บ (S14)
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
        // เฟส 2 ดูเฉพาะงานที่ส่งถึงเฟส 2 แล้ว ไม่ดูงานรวมของโรงงาน (ตัดสินใจ 16 พ.ย.)
        allowFactory: section !== 2,
        canSew: section !== 1,
        canReportMachines: section !== 1,
        summary: section === 1 ? 'phase1' : section === 2 ? 'phase2' : 'allPhases',
      }
    }
    case 'qc':
      return {
        title: 'งาน QC + Packing',
        sub: 'งานรอตรวจ · วัตถุดิบที่รอฝ่าย QC ติ๊ก · งานเสร็จล่าสุด',
        columns: ['materials', 'qc_pack', 'done'],
        materialsDept: 'qc',
        summary: 'qc',
        showFilm: false,
        tabs: ['todo', 'board'],
        allowFactory: true,
        canSew: false,
        canReportMachines: false,
      }
    // ฝ่ายผลิตรับผิดชอบงานตั้งแต่รับใบสั่งงานจนส่งของ จึงต้องเห็นทุกขั้นของกระบวนการผลิต ไม่ตัดเหลือแค่วัตถุดิบ
    // (การแบ่งเฟส 1 / เฟส 2 ใช้กับผู้ควบคุมงานที่กดสถานะเท่านั้น เพราะสถานีอยู่คนละเฟส)
    // owner ทำแทนผู้ควบคุมงานเฟส 2 ได้ (วันที่ไม่มีคนคุม) · ฐานข้อมูลอนุญาต owner อยู่แล้ว
    case 'owner':
      return { ...FACTORY_SCOPE, canSew: true, canReportMachines: true, canSetRepairEta: true, canBook: true }
    case 'production':
      return {
        ...FACTORY_SCOPE,
        title: 'งานฝ่ายผลิต · พิมพ์ถึง QC',
        sub: 'ฝ่ายผลิตคุมทุกสถานี ตั้งแต่รับงาน พิมพ์ รีด ตัด เย็บ จนถึง QC + Packing',
        tabs: ['todo', 'board', 'sewing'],
        summary: 'production',
        // ฝ่ายผลิตแทนผู้ควบคุมงานทั้ง 2 เฟส (ตัดสินใจ 16 พ.ย. บ่าย · migration 20261118000004)
        // จึงเริ่มเย็บ / รายงานปัญหา / เย็บเสร็จ ได้เอง และยังจองจักร แจ้งเสีย กำหนดเวลาซ่อมได้เหมือนเดิม
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
