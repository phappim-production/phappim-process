import { lazy, Suspense } from 'react'
import { Card } from '../../components/ui'
import type { SettingsTab } from '../../auth/menus'

const SettingsContent = lazy(() => import('./view'))

export default function SettingsPage({ tab }: { tab?: SettingsTab }) {
  return (
    <div className="mx-auto grid max-w-6xl min-w-0 gap-4 p-4 sm:p-6">
      <IconHeading users={tab === 'users'} />
      <Suspense fallback={<Card className="p-5"><p role="status" className="text-muted">กำลังโหลดข้อมูล…</p></Card>}>
        <SettingsContent initialTab={tab} />
      </Suspense>
    </div>
  )
}

import { IconSliders } from '../../components/icons'

function IconHeading({ users }: { users: boolean }) {
  return (
    <header className="flex items-start gap-3">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
        <IconSliders className="size-6" />
      </span>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{users ? 'ผู้ใช้งาน' : 'ตั้งค่าระบบ'}</h1>
        <p className="mt-1 text-muted">{users ? 'เพิ่มบัญชี · ปิดบัญชี · เปลี่ยนบทบาท' : 'สถานี · เวลามาตรฐาน · วัตถุดิบ · เหตุผล · จักร · การแจ้งเตือน'}</p>
      </div>
    </header>
  )
}
