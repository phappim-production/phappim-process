import { Card, CardHeader, Pill, StatTile } from '../../components/ui'
import { IconAlert, IconChart, IconCheck, IconClipboard, IconClock, IconLayers } from '../../components/icons'
import { TONE, type Tone } from '../../components/tone'
import type { Ranked, ReportMetrics } from './metrics'
import { formatReportDate } from './format'

const integer = new Intl.NumberFormat('th-TH')
const decimal = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 })
const percentage = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 })
const HOUR = 3_600_000

function percent(value: number | null) {
  return value === null ? '—' : `${percentage.format(value)}%`
}

function duration(ms: number | null) {
  if (ms === null) return '—'
  if (ms >= 24 * HOUR) return `${decimal.format(ms / (24 * HOUR))} วัน`
  if (ms >= HOUR) return `${decimal.format(ms / HOUR)} ชม.`
  if (ms > 0 && ms < 60_000) return 'น้อยกว่า 1 นาที'
  return `${integer.format(Math.round(ms / 60_000))} นาที`
}

export function ReportView({ data }: { data: ReportMetrics }) {
  const { summary, samples } = data

  return (
    <>
      <section aria-label="สรุปงานเสร็จ" className="grid min-w-0 grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 2xl:grid-cols-5">
        <ReportTile icon={IconCheck} label="งานเสร็จ" value={integer.format(summary.finished)} tone="brand"
          note={summary.develop ? `ไม่รวมงาน Develop ${integer.format(summary.develop)} งาน (นับแยก)` : 'งานผลิต'} />
        <ReportTile icon={IconChart} label="เสร็จทันกำหนด" value={percent(summary.onTimePct)}
          note={summary.finished ? `${integer.format(summary.onTime)} จาก ${integer.format(summary.finished)} งาน` : 'ยังไม่มีงานเสร็จ'}
          tone={summary.onTimePct === 100 ? 'ok' : summary.onTimePct === 0 ? 'danger' : 'brand'} />
        <ReportTile icon={IconClock} label="เสร็จภายในเวลาผลิต" value={percent(summary.withinLeadPct)}
          note={summary.leadJobs ? `${integer.format(summary.withinLead)} จาก ${integer.format(summary.leadJobs)} งาน` : 'ยังไม่มีงานเสร็จ'}
          tone={summary.withinLeadPct === 100 ? 'ok' : summary.withinLeadPct === 0 ? 'danger' : 'brand'} />
        <ReportTile icon={IconClock} label="รับงานถึงเสร็จเฉลี่ย" value={summary.averageLeadDays === null ? '—' : decimal.format(summary.averageLeadDays)}
          note="วันทำงาน · ไม่นับวันอาทิตย์" tone="brand" />
        <div className="col-span-2 grid lg:col-span-1"><StatTile icon={IconAlert} label="งานส่งแก้ (ชิ้น)" value={summary.reworkQty} tone="danger" /></div>
      </section>
      {summary.finished === 0 ? (
        <Card>
          <CardHeader icon={IconClipboard} title="ยังไม่มีงานที่เสร็จในช่วงนี้"
            sub={`เวลาเฉลี่ยต่อสถานี ผลตัวอย่าง และงานส่งแก้จะแสดงเมื่อมีงานเสร็จในช่วงที่เลือก${summary.develop ? ` · งาน Develop เสร็จ ${integer.format(summary.develop)} งาน` : ''}`} />
        </Card>
      ) : (
        <>
          <StationTimes data={data.stations} />
          <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader icon={IconLayers} title="ผลการขึ้นตัวอย่าง" sub="จากงานที่เสร็จในช่วงที่เลือก" />
              <div className="grid grid-cols-2 gap-3 px-4 pb-3 sm:px-5">
                <div className="min-w-0">
                  <p className="text-sm text-muted">รอบเฉลี่ยต่องาน</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{samples.averageRounds === null ? '—' : decimal.format(samples.averageRounds)}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-muted">ผ่านรอบแรก</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{percent(samples.firstPassPct)}</p>
                </div>
              </div>
              <div className="grid gap-1 border-t border-line px-4 py-3 text-sm text-muted sm:px-5">
                <p>งานขึ้นตัวอย่าง {integer.format(samples.required)} งาน · มีผลบันทึก {integer.format(samples.recorded)} งาน</p>
                {samples.firstRoundCount !== samples.required && samples.required > 0 && (
                  <p>มีผลรอบแรก {integer.format(samples.firstRoundCount)} งาน</p>
                )}
                <p>ไม่ขึ้นตัวอย่าง {integer.format(samples.skipped)} งาน</p>
                {summary.develop > 0 && <p>งาน Develop (ตัวอย่างอย่างเดียว ไม่ผลิตจริง) เสร็จ {integer.format(summary.develop)} งาน · นับแยก</p>}
              </div>
            </Card>
            <Card className="min-w-0">
              <CardHeader icon={IconAlert} title="งานส่งกลับแก้" sub="จำนวนชิ้นที่ส่งแก้ จากงานที่เสร็จในช่วงที่เลือก" tone="danger" />
              {summary.reworkQty === 0 ? (
                <p className="px-4 pb-4 text-muted sm:px-5">ไม่มีงานส่งกลับแก้ในช่วงนี้</p>
              ) : (
                <div className="grid gap-4 px-4 pb-4 sm:px-5">
                  <div><h4 className="mb-2 font-semibold">ตามสถานีต้นเหตุ</h4>
                    <Ranking rows={data.rework.byStation} unit="ชิ้น" /></div>
                  <div><h4 className="mb-2 font-semibold">ตามสาเหตุ</h4>
                    <Ranking rows={data.rework.byReason} unit="ชิ้น" />
                    <p className="mt-2 text-sm text-muted">หากระบุหลายสาเหตุ จำนวนชิ้นจะปรากฏในแต่ละสาเหตุ</p></div>
                </div>
              )}
            </Card>
          </div>
          <LateJobs jobs={data.lateJobs} />
        </>
      )}
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader icon={IconAlert} title="สาเหตุงานล่าช้า" sub="นับรายงานปัญหาที่ส่งในช่วงที่เลือก" tone="warn" />
          <div className="px-4 pb-4 sm:px-5">
            <Ranking rows={data.delays} unit="รายงาน" includeKey empty="ไม่มีรายงานความล่าช้าในช่วงนี้" />
          </div>
        </Card>
        <Card className="min-w-0">
          <CardHeader icon={IconClock} title="สาเหตุพักงาน" sub="10 อันดับจากการพักงานที่เริ่มในช่วงที่เลือก" tone="warn" />
          <div className="px-4 pb-4 sm:px-5">
            <Ranking rows={data.holds} unit="ครั้ง" empty="ไม่มีการพักงานในช่วงนี้" />
          </div>
        </Card>
      </div>
    </>
  )
}

function ReportTile({ icon: Icon, label, value, note, tone }: {
  icon: typeof IconClock; label: string; value: string; note: string; tone: Tone
}) {
  return (
    <Card className="min-w-0 p-3 sm:p-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${TONE[tone].soft}`}><Icon className="size-5" /></span>
        <span className="min-w-0 text-sm font-semibold leading-tight text-muted">{label}</span>
      </div>
      <p className={`mt-1.5 break-words text-3xl font-bold leading-tight tabular-nums ${TONE[tone].text}`}>{value}</p>
      <p className="mt-1 text-sm leading-snug text-muted">{note}</p>
    </Card>
  )
}

function StationTimes({ data }: { data: ReportMetrics['stations'] }) {
  const scale = Math.max(1, ...data.items.map(item => Math.max(item.workMs, item.waitMs ?? 0)))
  return (
    <Card className="min-w-0">
      <CardHeader icon={IconClock} title="เวลาเฉลี่ยต่อสถานี"
        sub="เฉพาะรอบผลิตจริง เวลาทำงานหักเวลาพักแล้ว ส่วนเวลารอคิวนับจากสถานีก่อนหน้าตามเส้นทาง" />
      {data.items.length === 0 ? <p className="px-4 pb-4 text-muted sm:px-5">ยังไม่มีรอบสถานีที่มีเวลาเริ่มและเวลาจบ</p> : (
        <ul className="divide-y divide-line border-t border-line">
          {data.items.map(item => (
            <li key={item.code} className="grid min-w-0 gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:px-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-words font-semibold">{item.name}</span>
                  {item.external && <Pill tone="neutral">ร้านนอก</Pill>}
                  {item.code === data.bottleneck && <Pill tone="warn">คอขวด</Pill>}
                </div>
                <p className="mt-1 text-sm text-muted">{integer.format(item.count)} รอบ</p>
              </div>
              <div className="grid min-w-0 content-center gap-2">
                <TimeBar label={item.external ? 'เวลาอยู่ร้านนอก' : 'ทำงาน'} ms={item.workMs} scale={scale} color="bg-info" />
                <TimeBar label="รอคิว" ms={item.waitMs} scale={scale} color="bg-warn" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function TimeBar({ label, ms, scale, color }: { label: string; ms: number | null; scale: number; color: string }) {
  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex justify-between gap-2 text-sm">
        <span className="text-muted">{label}</span>
        <span className="shrink-0 font-semibold tabular-nums">{duration(ms)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-paper" aria-hidden>
        {ms !== null && <div className={`h-full rounded-full ${color}`} style={{ width: `${100 * ms / scale}%` }} />}
      </div>
    </div>
  )
}

function Ranking({ rows, unit, empty, includeKey }: { rows: Ranked[]; unit: string; empty?: string; includeKey?: boolean }) {
  if (rows.length === 0) return <p className="text-muted">{empty ?? 'ไม่มีข้อมูล'}</p>
  return (
    <ol className="divide-y divide-line">
      {rows.map(row => (
        <li key={row.key} className="flex min-w-0 justify-between gap-3 py-2">
          <span className="min-w-0 break-words">
            {includeKey && row.key !== row.label && <span className="font-semibold">{row.key} · </span>}
            {row.label}
          </span>
          <span className="shrink-0 font-semibold tabular-nums">{integer.format(row.count)} {unit}</span>
        </li>
      ))}
    </ol>
  )
}

function LateJobs({ jobs }: { jobs: ReportMetrics['lateJobs'] }) {
  return (
    <Card className="min-w-0">
      <CardHeader icon={IconAlert} title="งานที่เสร็จเกินกำหนด" sub="เรียงตามจำนวนวันที่ล่าช้า กดเลขใบยืนยันเพื่อเปิดรายละเอียด" tone="danger" />
      {jobs.length === 0 ? <p className="px-4 pb-4 text-muted sm:px-5">ไม่มีงานที่เสร็จเกินกำหนดในช่วงนี้</p> : (
        <table className="w-full table-fixed text-left">
          <thead className="hidden border-y border-line bg-paper text-sm text-muted sm:table-header-group">
            <tr>
              <th scope="col" className="w-1/5 px-3 py-2 sm:pl-5">เลขใบยืนยัน</th>
              <th scope="col" className="px-3 py-2">ลูกค้า</th>
              <th scope="col" className="w-[19%] px-3 py-2">กำหนดส่ง</th>
              <th scope="col" className="w-[19%] px-3 py-2">เสร็จจริง</th>
              <th scope="col" className="w-[13%] px-3 py-2 sm:pr-5">ล่าช้า</th>
            </tr>
          </thead>
          <tbody className="block divide-y divide-line border-t border-line sm:table-row-group sm:border-t-0">
            {jobs.map(job => (
              <tr key={job.id} className="grid min-w-0 grid-cols-2 items-start gap-x-3 gap-y-2 px-4 py-3 sm:table-row sm:p-0">
                <td className="col-span-2 min-w-0 sm:px-3 sm:pl-5">
                  <a href={`#/board?job=${encodeURIComponent(job.id)}`}
                    className="inline-flex min-h-12 max-w-full items-center break-all font-semibold text-brand underline decoration-brand/40 underline-offset-4 hover:decoration-brand">
                    {job.confirmation_no}
                  </a>
                </td>
                <td className="col-span-2 min-w-0 break-words sm:px-3 sm:py-2">{job.customer_name}</td>
                <td className="text-sm sm:px-3 sm:py-2">
                  <span className="block text-muted sm:hidden">กำหนดส่ง</span>{formatReportDate(job.due_date)}
                </td>
                <td className="text-sm sm:px-3 sm:py-2">
                  <span className="block text-muted sm:hidden">เสร็จจริง</span>{formatReportDate(job.finished_at)}
                </td>
                <td className="col-span-2 sm:px-3 sm:py-2 sm:pr-5">
                  <Pill tone="danger"><span className="tabular-nums">{integer.format(job.daysLate)} วัน</span></Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
