import { Card, CardHeader } from '../../components/ui'
import { IconClipboard } from '../../components/icons'

// ใบปะงาน + QR (S12) · Codex ทำตามใบสั่งงาน C5 ใน docs/แบ่งงาน-Codex-Antigravity.md ข้อ 4.2
// เส้นทาง #/label?id=<job id> ต่อไว้แล้วใน App.tsx (ห้ามแก้ App.tsx) · แทนที่เนื้อหาไฟล์นี้ได้ทั้งหมด
export default function JobLabel({ jobId }: { jobId: string }) {
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <Card>
        <CardHeader icon={IconClipboard} title="ใบปะงาน" sub="กำลังพัฒนา · พิมพ์ใบปะงานพร้อม QR ได้เร็วๆ นี้" />
        <p className="break-all px-5 pb-5 text-sm text-muted">{jobId ? `งาน ${jobId}` : 'ไม่ได้ระบุงาน'}</p>
      </Card>
    </div>
  )
}
