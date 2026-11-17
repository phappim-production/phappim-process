import type { Dept, Job } from './model'
import { applyBooking, machineCode, SEW_NEEDS, type Booking, type Machine, type MachineType } from './sewing'

const PRODUCT_CODE: Record<string, string> = {
  'เสื้อยืด': 'tshirt', 'เสื้อกีฬา': 'sport', 'เสื้อวิ่ง': 'running', 'เสื้อโปโล': 'polo', 'ถุงผ้า': 'bag', 'ป้ายผ้า': 'banner',
  'ผ้าเชียร์': 'cheer', 'เสื้อคนงาน': 'worker', 'หมวกแก๊ป': 'hat', 'ผ้ากันเปื้อน': 'apron', 'เสื้อพละ': 'pe', 'ผ้ายันต์': 'yan',
}

// ข้อมูลจำลองสำหรับต้นแบบเฟส 1 · ชื่อลูกค้าสมมติ · เวลาคำนวณจาก "ตอนนี้" เพื่อให้เห็นงานเลยกำหนด / รอฟิล์ม / เสร็จวันนี้ได้ทุกครั้งที่เปิด
export function makeMockJobs(now: Date): Job[] {
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000)
  const inDays = (d: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, 17)
  const allOk: Record<Dept, boolean> = { admin: true, qc: true, production: true }

  const jobs: Omit<Job, 'id'>[] = [
    // ── รอวัตถุดิบ
    { no: 'SC691501', customer: 'โรงเรียนบ้านหนองบัว', product: 'เสื้อยืด', unit: 'ตัว', qty: 300, due: inDays(9), route: 'normal', phase: 'materials', since: hoursAgo(20), sampleRound: 1, materials: { admin: true, qc: false, production: true } },
    { no: 'SC691503', customer: 'อบต.ท่าข้าม', product: 'ถุงผ้า', unit: 'ใบ', qty: 500, due: inDays(12), route: 'plain', phase: 'materials', since: hoursAgo(4), sampleRound: 1, materials: { admin: false, qc: true, production: false } },
    { no: 'SC691505', customer: 'ชมรมวิ่งริมน้ำ', product: 'เสื้อกีฬา', unit: 'ตัว', qty: 120, due: inDays(10), route: 'dtf', phase: 'materials', since: hoursAgo(30), sampleRound: 1, materials: { admin: true, qc: true, production: false }, film: { eta: inDays(2), received: false } },

    // ── ขึ้นตัวอย่าง
    { no: 'SC691507', customer: 'บริษัท สยามอีเวนท์', product: 'ป้ายผ้า', unit: 'ผืน', qty: 2, due: inDays(4), route: 'normal', phase: 'sample', station: 'print', status: 'doing', since: hoursAgo(1.5), sampleRound: 1, materials: allOk },
    { no: 'SC691509', customer: 'ร้านกาแฟบ้านสวน', product: 'เสื้อโปโล', unit: 'ตัว', qty: 80, due: inDays(6), route: 'dtf', phase: 'sample', station: 'dtf_press', status: 'queued', since: hoursAgo(26), sampleRound: 2, materials: allOk, film: { eta: inDays(-1), received: false } },

    // ── รอผลตัวอย่าง
    { no: 'SC691511', customer: 'งานวิ่งการกุศลเมืองเก่า', product: 'เสื้อวิ่ง', unit: 'ตัว', qty: 450, due: inDays(8), route: 'normal', phase: 'sample_review', since: hoursAgo(28), sampleRound: 1, materials: allOk },

    // ── ผลิตจริง
    { no: 'SC691513', customer: 'สมาคมศิษย์เก่าเชียงราย', product: 'ผ้าเชียร์', unit: 'ผืน', qty: 40, due: inDays(3), route: 'normal', phase: 'production', station: 'print', status: 'doing', since: hoursAgo(3), sampleRound: 1, materials: allOk },
    { no: 'SC691515', customer: 'บริษัท ไทยเฟรช ฟู้ดส์', product: 'เสื้อยืด', unit: 'ตัว', qty: 250, due: inDays(5), route: 'normal', phase: 'production', station: 'press', status: 'queued', since: hoursAgo(6), sampleRound: 1, materials: allOk },
    { no: 'SC691517', customer: 'หจก. เกษตรรุ่งเรือง', product: 'เสื้อคนงาน', unit: 'ตัว', qty: 600, due: inDays(-1), route: 'plain', phase: 'production', station: 'cut', status: 'doing', since: hoursAgo(9), sampleRound: 1, materials: allOk },
    { no: 'SC691526', customer: 'ทีมฟุตบอลบางแสน', product: 'เสื้อกีฬา', unit: 'ตัว', qty: 60, due: inDays(4), route: 'dtf', phase: 'production', station: 'cut', status: 'queued', since: hoursAgo(2), sampleRound: 1, materials: allOk, film: { eta: inDays(1), received: false } },
    { no: 'SC691519', customer: 'สโมสรแบดมินตันลาดพร้าว', product: 'เสื้อกีฬา', unit: 'ตัว', qty: 200, due: inDays(2), route: 'dtf', phase: 'production', station: 'dtf_press', status: 'doing', since: hoursAgo(2.5), sampleRound: 1, materials: allOk, film: { eta: inDays(-2), received: true } },
    { no: 'SC691520', customer: 'บริษัท เซอร์ราวด์', product: 'เสื้อยืด', unit: 'ตัว', qty: 300, due: inDays(3), route: 'normal', phase: 'production', station: 'sew', status: 'doing', since: hoursAgo(7), sampleRound: 1, materials: allOk, sewCount: 120 },
    { no: 'SC691533', customer: 'ร้านกาแฟบ้านสวน', product: 'เสื้อโปโล', unit: 'ตัว', qty: 80, due: inDays(5), route: 'plain', phase: 'production', station: 'sew', status: 'doing', since: hoursAgo(0.7), sampleRound: 1, materials: allOk },
    { no: 'SC691521', customer: 'มูลนิธิรักษ์ป่า', product: 'ถุงผ้า', unit: 'ใบ', qty: 1000, due: inDays(1), route: 'plain', phase: 'production', station: 'sew', status: 'hold', since: hoursAgo(5), sampleRound: 1, materials: allOk, sewCount: 640, holdReason: 'จักรเสีย รอช่างซ่อม' },
    { no: 'SC691523', customer: 'โรงพยาบาลบ้านโป่ง', product: 'เสื้อโปโล', unit: 'ตัว', qty: 150, due: inDays(2), route: 'dtf', phase: 'production', station: 'sew', status: 'doing', since: hoursAgo(1), sampleRound: 1, materials: allOk, film: { eta: inDays(-5), received: true }, sewCount: 150, rework: { qty: 5, reason: 'ตะเข็บหลุด' } },
    { no: 'SC691535', customer: 'ร้านอาหารครัวคุณยาย', product: 'ผ้ากันเปื้อน', unit: 'ผืน', qty: 120, due: inDays(3), route: 'plain', phase: 'production', station: 'sew', status: 'queued', since: hoursAgo(0.5), sampleRound: 1, materials: allOk },
    { no: 'SC691537', customer: 'ชมรมจักรยานริมโขง', product: 'เสื้อยืด', unit: 'ตัว', qty: 180, due: inDays(2), route: 'plain', phase: 'production', station: 'sew', status: 'queued', since: hoursAgo(1), sampleRound: 1, materials: allOk },
    { no: 'SC691525', customer: 'ทีมจักรยานภูเขาทอง', product: 'หมวกแก๊ป', unit: 'ใบ', qty: 300, due: inDays(1), route: 'plain', phase: 'production', station: 'qc_pack', status: 'doing', since: hoursAgo(3.5), sampleRound: 1, materials: allOk },
    { no: 'SC691527', customer: 'คาเฟ่ลมทะเล', product: 'ผ้ากันเปื้อน', unit: 'ผืน', qty: 60, due: inDays(0), route: 'normal', phase: 'production', station: 'qc_pack', status: 'queued', since: hoursAgo(1.2), sampleRound: 2, materials: allOk },

    // ── เสร็จ
    { no: 'SC691530', customer: 'โรงเรียนวัดสระแก้ว', product: 'เสื้อพละ', unit: 'ตัว', qty: 400, due: inDays(1), route: 'normal', phase: 'done', since: hoursAgo(2), sampleRound: 1, materials: allOk, doneAt: hoursAgo(2) },
    { no: 'SC691531', customer: 'วัดป่าสันติธรรม', product: 'ผ้ายันต์', unit: 'ผืน', qty: 100, due: inDays(0), route: 'normal', phase: 'done', since: hoursAgo(26), sampleRound: 1, materials: allOk, doneAt: hoursAgo(26) },
  ]
  return jobs.map((j, i) => ({ ...j, productCode: PRODUCT_CODE[j.product], id: String(i + 1) }))
}

// จักรเย็บจำลอง 24 ตัว รหัสตามประเภท (OL4-001 …) · จ่ายให้งานที่กำลังเย็บอยู่ในข้อมูลจำลอง
// ตั้งใจให้งานรอเย็บมีทั้งที่ "เริ่มได้" (ผ้ากันเปื้อน) และ "จักรไม่ว่าง" (เสื้อยืด) เพื่อเห็นการบังคับ
export function makeMockMachines(jobs: Job[]): Machine[] {
  const idOf = (no: string) => jobs.find(j => j.no === no)?.id
  const plan: [MachineType, number][] = [
    ['ovl4', 6], ['cover', 2], ['flat', 1], ['single', 5], ['double', 3], ['ovl3', 1],
    ['button', 2], ['buttonhole', 2], ['elastic', 1], ['binding', 1],
  ]
  const use: Record<string, string[]> = {
    SC691520: ['ovl4', 'ovl4', 'cover', 'flat', 'single'],              // เสื้อยืด กำลังเย็บ
    SC691533: ['ovl4', 'single', 'double', 'button', 'buttonhole'],    // โปโล กำลังเย็บ
    SC691521: ['ovl4', 'single', 'double'],                            // ถุงผ้า พักงาน (จักรเสีย)
    SC691523: ['ovl4', 'single', 'double', 'button', 'buttonhole'],    // โปโล งานแก้
  }
  const machines: Machine[] = []
  for (const [type, n] of plan) {
    for (let i = 1; i <= n; i++) {
      machines.push({ id: `m${machines.length + 1}`, code: machineCode(type, i), type, status: 'ready' })
    }
  }
  for (const [jobNo, types] of Object.entries(use)) {
    for (const t of types) {
      const m = machines.find(x => x.type === t && !x.jobId && x.status === 'ready')
      if (m) m.jobId = idOf(jobNo)
    }
  }
  // โพ้ง 4 เส้นตัวสุดท้ายเสีย (ตรงกับงานถุงผ้าที่พักเพราะจักรเสีย)
  const broken = machines.filter(m => m.type === 'ovl4' && !m.jobId).at(-1)
  if (broken) Object.assign(broken, { status: 'broken', note: 'มอเตอร์ไม่หมุน', repairEta: new Date(Date.now() + 4 * 3_600_000) })
  return machines
}

// การจองจำลอง: งานที่กำลังมาถึงเย็บ จองวันทำงานถัดไปและวันถัดจากนั้น
export function makeMockBookings(jobs: Job[], machines: Machine[], now: Date): Booking[] {
  const workday = (offset: number, h: number) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h)
    let left = offset
    while (left > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0) left-- }
    return d
  }
  let bookings: Booking[] = []
  for (const [no, day] of [['SC691517', 1], ['SC691513', 1], ['SC691519', 2]] as const) {
    const job = jobs.find(j => j.no === no)
    if (!job) continue
    const r = applyBooking(job, machines, bookings, workday(day, 8), workday(day, 17), SEW_NEEDS, now)
    if (r.ok) bookings = r.bookings
  }
  return bookings
}
