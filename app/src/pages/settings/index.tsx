import { Card, CardHeader } from '../../components/ui'
import { IconSliders } from '../../components/icons'

// หน้าตั้งค่า (เจ้าของระบบ) · Codex ทำตามใบสั่งงาน docs/codex/C2.md
// เส้นทาง #/settings และเมนูต่อไว้แล้วใน App.tsx (ห้ามแก้ App.tsx) · แทนที่เนื้อหาไฟล์นี้ได้ทั้งหมด
export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">ตั้งค่า</h1>
      <Card>
        <CardHeader icon={IconSliders} title="กำลังพัฒนา" sub="ผู้ใช้และบทบาท · สถานีและขั้นย่อย · เวลามาตรฐาน · แม่แบบวัตถุดิบ · รหัสสาเหตุ" />
        <p className="px-5 pb-5 text-sm text-muted">หน้านี้จะใช้ได้ก่อนทดลองจริงวันเสาร์ 21 พ.ย.</p>
      </Card>
    </div>
  )
}
