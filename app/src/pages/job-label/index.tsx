
import { lazy, Suspense } from 'react'

const LabelPage = lazy(() => import('./LabelPage'))

export default function JobLabel({ jobId }: { jobId: string }) {
  return (
    <Suspense fallback={<p role="status" className="p-5 text-muted">กำลังโหลดใบปะงาน…</p>}>
      <LabelPage key={jobId} jobId={jobId} />
    </Suspense>
  )
}
