import { lazy, Suspense } from 'react'
import { Card } from '../../components/ui'

const SettingsContent = lazy(() => import('./view'))

export default function SettingsPage() {
  return (
    <div className="mx-auto grid max-w-6xl min-w-0 gap-4 p-4 sm:p-6">
      <IconHeading />
      <Suspense fallback={<Card className="p-5"><p role="status" className="text-muted">กำลังโหลดข้อมูล…</p></Card>}>
        <SettingsContent />
      </Suspense>
    </div>
  )
}

import { IconSliders } from '../../components/icons'

function IconHeading() {
  return (
    <header className="flex items-start gap-3">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
        <IconSliders className="size-6" />
      </span>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">ตั้งค่า</h1>
        <p className="mt-1 text-muted">จัดการสิทธิ์ผู้ใช้และค่าที่ใช้ในระบบติดตามการผลิต</p>
      </div>
    </header>
  )
}
