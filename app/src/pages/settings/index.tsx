import { lazy, Suspense } from 'react'
import { Card } from '../../components/ui'
import type { SettingsTab } from '../../auth/menus'

const SettingsContent = lazy(() => import('./view'))

export default function SettingsPage({ tab }: { tab?: SettingsTab }) {
  return (
    <div className="mx-auto grid max-w-6xl min-w-0 gap-4 p-4 sm:p-6">
      <IconHeading tab={tab} />
      <Suspense fallback={<Card className="p-5"><p role="status" className="text-muted">กำลังโหลดข้อมูล…</p></Card>}>
        <SettingsContent initialTab={tab} />
      </Suspense>
    </div>
  )
}

import { IconSliders } from '../../components/icons'

const HEADINGS: Record<SettingsTab, [string, string]> = {
  users: ['ผู้ใช้งาน', 'เพิ่มบัญชี · ปิดบัญชี · เปลี่ยนบทบาท'],
  assign: ['จับคู่สถานี', 'จับคู่พนักงานสถานีกับสถานีที่ทำงาน'],
  stations: ['ตั้งค่าระบบ', 'สถานี · เวลามาตรฐาน · วัตถุดิบ · เหตุผล · จักร · การแจ้งเตือน'],
}

function IconHeading({ tab = 'stations' }: { tab?: SettingsTab }) {
  const [title, sub] = HEADINGS[tab]
  return (
    <header className="flex items-start gap-3">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
        <IconSliders className="size-6" />
      </span>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-muted">{sub}</p>
      </div>
    </header>
  )
}
