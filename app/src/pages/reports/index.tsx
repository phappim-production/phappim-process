import { lazy, Suspense } from 'react'

const ReportPage = lazy(() => import('./ReportPage'))

export default function ReportsPage() {
  return (
    <Suspense fallback={<p role="status" className="p-5 text-muted">กำลังโหลดหน้ารายงาน…</p>}>
      <ReportPage />
    </Suspense>
  )
}
