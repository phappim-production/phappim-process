import { Card, CardHeader } from '../../components/ui'
import { IconChart } from '../../components/icons'

// หน้ารายงาน (ผู้บริหาร / เจ้าของ) · Codex ทำตามใบสั่งงาน docs/codex/C4.md
// เส้นทาง #/reports และเมนูต่อไว้แล้วใน App.tsx (ห้ามแก้ App.tsx) · แทนที่เนื้อหาไฟล์นี้ได้ทั้งหมด
export default function ReportsPage() {
  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">รายงาน</h1>
      <Card>
        <CardHeader icon={IconChart} title="กำลังพัฒนา" sub="เวลาเฉลี่ยต่อสถานี · คอขวด · % ทันกำหนด · งานแก้ · สาเหตุงานช้า" />
        <p className="px-5 pb-5 text-sm text-muted">ตัวเลขจะเริ่มมีเมื่อมีงานจริงเดินครบในระบบ</p>
      </Card>
    </div>
  )
}
