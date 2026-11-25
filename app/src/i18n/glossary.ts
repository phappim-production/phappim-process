import type { Tone } from '../components/tone'

// ทุกคำในหน้านี้ต้องมีคำแปลใน my.ts (ทดสอบใน glossary.test.ts)
type Entry = { th: string; note?: string; tone: Tone; icon: string; solid?: boolean }

export const GLOSSARY_ACTIONS: Entry[] = [
  { th: 'เริ่ม', note: 'เริ่มทำงานคิวแรก', tone: 'brand', icon: 'play', solid: true },
  { th: 'พักงาน', note: 'ต้องใส่สาเหตุ · เวลาผลิตทั้งงานยังนับต่อ', tone: 'neutral', icon: 'pause' },
  { th: 'เสร็จ', note: 'ส่งต่อสถานีถัดไป', tone: 'ok', icon: 'check', solid: true },
  { th: 'แก้แล้ว ทำต่อ', note: 'หัวหน้ากดหลังแก้ปัญหา', tone: 'brand', icon: 'play', solid: true },
  { th: 'รายงานปัญหา', note: 'ของเสีย เครื่องเสีย ของไม่ครบ', tone: 'danger', icon: 'flag' },
]

export const GLOSSARY_STATUS: Entry[] = [
  { th: 'กำลังทำ', tone: 'info', icon: 'play' },
  { th: 'รอคิว', tone: 'neutral', icon: 'clock' },
  { th: 'พักงาน', note: 'ติดปัญหา รอหัวหน้า', tone: 'danger', icon: 'pause' },
  { th: 'ใกล้ครบเวลาผลิต', note: 'ใช้เวลาผลิตทั้งงานไปแล้ว 80%', tone: 'warn', icon: 'alert' },
  { th: 'เกินเวลาผลิต', note: 'ต้องรายงานสาเหตุก่อนกด QC + Packing เสร็จ', tone: 'danger', icon: 'alert' },
  { th: 'ข้างนอก', note: 'ส่งบริษัทภายนอกทำ', tone: 'info', icon: 'users' },
  { th: 'เสร็จ', tone: 'ok', icon: 'check' },
]

export const GLOSSARY_WORDS: { th: string; note?: string }[] = [
  { th: 'งาน', note: 'เรียกด้วยเลขใบงาน เช่น SC690001' },
  { th: 'คิว', note: 'ลำดับงาน' },
  { th: 'สาเหตุ' },
  { th: 'กำหนดส่ง' },
  { th: 'ตัวอย่าง' },
  { th: 'งานแก้' },
  { th: 'สเปก' },
  { th: 'ม็อคอัพ' },
  { th: 'รับทราบ' },
  { th: 'หัวหน้า' },
]
