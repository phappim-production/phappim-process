import { useEffect, useState } from 'react'
import { secondaryBtn } from '../../components/Dialog'
import { Card, ViewSwitch } from '../../components/ui'
import { IconChart } from '../../components/icons'
import { loadReport } from './data'
import { reportMetrics, reportWindow, type Period, type ReportMetrics, type ReportWindow } from './metrics'
import { formatReportDate } from './format'
import { ReportView } from './ReportView'

const periods: readonly (readonly [Period, string])[] = [
  ['7', '7 วัน'], ['30', '30 วัน'], ['90', '90 วัน'],
]

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; metrics: ReportMetrics }
  | { status: 'error'; message: string }

export default function ReportPage() {
  const [period, setPeriod] = useState<Period>('30')

  return (
    <div className="mx-auto grid max-w-6xl min-w-0 gap-4 p-4 sm:gap-5 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
            <IconChart className="size-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">รายงานการผลิต</h1>
            <p className="mt-1 text-muted">กำหนดส่ง เวลาต่อสถานี และสาเหตุงานล่าช้า</p>
          </div>
        </div>
        <ViewSwitch label="ช่วงรายงาน" value={period} onChange={setPeriod} options={periods} />
      </header>
      <PeriodReport key={period} period={period} />
    </div>
  )
}

function PeriodReport({ period }: { period: Period }) {
  const [window, setWindow] = useState<ReportWindow>(() => reportWindow(period, new Date()))
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    void loadReport(window, controller.signal).then(rows => {
      if (!controller.signal.aborted) setState({ status: 'ready', metrics: reportMetrics(rows, window) })
    }).catch(error => {
      if (!controller.signal.aborted) {
        setState({ status: 'error', message: error instanceof Error ? error.message : 'โหลดรายงานไม่สำเร็จ' })
      }
    })
    return () => controller.abort()
  }, [window])

  return (
    <>
      <p className="text-sm text-muted">
        {formatReportDate(window.start)} – {formatReportDate(window.end - 1)} · เวลาไทย
      </p>
      {state.status === 'loading' && (
        <Card className="p-5"><p role="status" className="text-muted">กำลังโหลดรายงาน…</p></Card>
      )}
      {state.status === 'error' && (
        <Card className="grid justify-items-start gap-3 p-5">
          <p role="alert" className="break-words font-medium text-danger">{state.message}</p>
          <button type="button" className={secondaryBtn} onClick={() => {
            setState({ status: 'loading' })
            setWindow(reportWindow(period, new Date()))
          }}>ลองอีกครั้ง</button>
        </Card>
      )}
      {state.status === 'ready' && <ReportView data={state.metrics} />}
    </>
  )
}
