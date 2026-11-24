
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Card } from '../../components/ui'
import { IconClipboard } from '../../components/icons'
import { dueDate, thaiError, type JobRow } from '../../data/live'
import { isJobId } from '../../data/useFactoryData'
import { signMockups } from '../../data/mockups'
import { supabase } from '../../lib/supabase'
import { qrMatrix, qrSvgPath } from './qr'
import { sampleText } from './sampleText'
import { printWhenFontsReady } from '../../lib/printFonts'
import './label.css'

type LabelJob = Pick<JobRow, 'id' | 'confirmation_no' | 'customer_name' | 'job_name' | 'product_type_code' |
  'qty' | 'unit' | 'due_date' | 'route_code' | 'needs_sample' | 'develop' | 'sample_round' | 'phase' | 'mockup_path'>
type Station = { seq: number; station_code: string }
type Label = {
  job: LabelJob
  product: string
  route: string
  stations: (Station & { name: string })[]
  qr: { size: number; path: string }
  mockupUrl?: string | undefined
}
type LoadState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; label: Label }

const day = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' })
const quantity = new Intl.NumberFormat('th-TH')
const columns = 'id, confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date, route_code, needs_sample, develop, sample_round, phase, mockup_path'

async function loadLabel(jobId: string, signal: AbortSignal): Promise<Label | null> {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่า Supabase')
  const { data, error } = await supabase.from('job_live').select(columns).eq('id', jobId).abortSignal(signal).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const job = data as LabelJob
  const [product, route, steps] = await Promise.all([
    supabase.from('product_types').select('name').eq('code', job.product_type_code).abortSignal(signal).maybeSingle(),
    supabase.from('routes').select('name').eq('code', job.route_code).abortSignal(signal).maybeSingle(),
    supabase.from('route_stations').select('seq, station_code').eq('route_code', job.route_code).order('seq').abortSignal(signal),
  ])
  const failed = [product, route, steps].find(result => result.error)
  if (failed?.error) throw new Error(failed.error.message)

  const rows = (steps.data ?? []) as Station[]
  const names = new Map<string, string>()
  if (rows.length > 0) {
    const result = await supabase.from('stations').select('code, name').in('code', rows.map(row => row.station_code)).abortSignal(signal)
    if (result.error) throw new Error(result.error.message)
    for (const row of result.data) names.set(row.code, row.name)
  }
  // ขอลิงก์รูปไม่ได้ = พิมพ์ใบได้โดยไม่มีรูป
  const mockupUrl = job.mockup_path ? (await signMockups([job.mockup_path])).get(job.mockup_path) : undefined
  const matrix = qrMatrix('https://pp142.pages.dev/#/board?job=' + encodeURIComponent(job.id))
  return {
    job,
    product: product.data?.name ?? job.product_type_code,
    route: route.data?.name ?? job.route_code,
    stations: rows.map(row => ({ ...row, name: names.get(row.station_code) ?? row.station_code })),
    qr: { size: matrix.length + 8, path: qrSvgPath(matrix) },
    mockupUrl,
  }
}

function LabelSheet({ label, printedOn }: { label: Label; printedOn: string }) {
  const { job, product, route, stations, qr, mockupUrl } = label
  return (
    <article className="job-label-sheet">
      <header className={`job-label-heading${mockupUrl ? ' has-mockup' : ''}`}>
        <div className="min-w-0">
          <p>ใบปะงาน</p>
          <h1>{job.confirmation_no}</h1>
        </div>
        {mockupUrl && <img className="job-label-mockup" src={mockupUrl} alt={`รูปม็อคอัพงาน ${job.confirmation_no}`} />}
        <svg className="job-label-qr" viewBox={'0 0 ' + qr.size + ' ' + qr.size}
          role="img" aria-label="QR เปิดรายละเอียดงาน" shapeRendering="crispEdges">
          <rect width={qr.size} height={qr.size} fill="white" />
          <path d={qr.path} fill="currentColor" />
        </svg>
      </header>
      <dl className="job-label-details">
        <div><dt>ลูกค้า</dt><dd>{job.customer_name}</dd></div>
        <div><dt>ชื่องาน</dt><dd>{job.job_name || '—'}</dd></div>
        <div><dt>สินค้า</dt><dd>{product}</dd></div>
        <div><dt>จำนวน</dt><dd>{quantity.format(job.qty)} {job.unit}</dd></div>
        <div><dt>กำหนดส่ง</dt><dd>{day.format(dueDate(job.due_date))}</dd></div>
        <div><dt>เส้นทาง</dt><dd>{route}</dd></div>
        <div><dt>ตัวอย่าง</dt><dd>{sampleText(job)}</dd></div>
        <div><dt>วันที่พิมพ์ใบ</dt><dd>{printedOn}</dd></div>
      </dl>
      <table className="job-label-stations" aria-label="ลำดับสถานี">
        <thead><tr>
          <th scope="col">สถานี</th>
          <th scope="col">วันที่</th>
          <th scope="col">ผู้รับ</th>
          <th scope="col">ลายเซ็น</th>
        </tr></thead>
        <tbody>
          {stations.map(({ seq, name }) => (
            <tr key={seq}><th scope="row">{seq}. {name}</th><td /><td /><td /></tr>
          ))}
          {stations.length === 0 && <tr><td colSpan={4}>ยังไม่ได้กำหนดสถานี</td></tr>}
        </tbody>
      </table>
    </article>
  )
}

export default function LabelPage({ jobId }: { jobId: string }) {
  const [state, setState] = useState<LoadState>(() => ({ status: isJobId(jobId) ? 'loading' : 'missing' }))
  const [printedOn, setPrintedOn] = useState(() => day.format(new Date()))
  useEffect(() => {
    if (!isJobId(jobId)) return
    const controller = new AbortController()
    void loadLabel(jobId.toLowerCase(), controller.signal).then(label => {
      if (!controller.signal.aborted) setState(label ? { status: 'ready', label } : { status: 'missing' })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setState({ status: 'error', message: thaiError(error instanceof Error ? error.message : undefined) })
      }
    })
    return () => controller.abort()
  }, [jobId])

  if (state.status !== 'ready') {
    return (
      <div className="mx-auto max-w-xl p-4 sm:p-6">
        <Card className="p-5">
          <h1 className="mb-2 text-xl font-bold">ใบปะงาน</h1>
          {state.status === 'loading' && <p role="status" className="text-muted">กำลังโหลดใบปะงาน…</p>}
          {state.status === 'missing' && <p role="alert" className="text-danger">ไม่พบงานนี้</p>}
          {state.status === 'error' && <p role="alert" className="text-danger">โหลดใบปะงานไม่สำเร็จ · {state.message}</p>}
        </Card>
      </div>
    )
  }

  const sheet = <LabelSheet label={state.label} printedOn={printedOn} />
  return (
    <div className="mx-auto grid max-w-[680px] gap-3 p-4 sm:p-6">
      <button type="button" onClick={() => {
        setPrintedOn(day.format(new Date()))
        // ให้ React อัปเดตวันที่บนใบก่อนเปิดกล่องพิมพ์
        requestAnimationFrame(() => void printWhenFontsReady())
      }} className="inline-flex min-h-12 items-center justify-center gap-2 justify-self-end rounded-xl bg-brand px-5 font-semibold text-white hover:bg-brand-700">
        <IconClipboard /> พิมพ์
      </button>
      <Card>{sheet}</Card>
      {createPortal(<div className="job-label-print">{sheet}</div>, document.body)}
    </div>
  )
}
