import { SECTION_LABELS, type Section } from '../../auth/access'
import { secondaryBtn } from '../../components/Dialog'
import { Card, CardHeader, Pill } from '../../components/ui'
import { KIND_LABEL, type Substep } from '../../data/stationSteps'
import { saveSegment, saveStation, type Loaded } from './data'
import { Collection, SelectField, TextField, type Controls } from './editor'
import {
  EDITABLE_KINDS, isProtectedStep, moveStep, nextStepKey, readSla, readStation, requireText, slaDraft,
  type Sla, type SlaDraft, type StationDraft,
} from './model'

type TabProps<T extends 'stations' | 'segments'> = { data: Loaded<T>; controls: Controls }

const number = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 })
const labelDays = (value: number | null) => value === null ? 'ไม่จับเวลา' : `${number.format(value)} วันทำงาน`

function SlaSummary({ sla }: { sla: Sla }) {
  return (
    <p className="mt-1 text-muted">
      {labelDays(sla.sla_days)} · เตือนที่ {sla.warn_pct}%
      {sla.big_qty !== null && ` · ตั้งแต่ ${number.format(sla.big_qty)} ชิ้น: ${labelDays(sla.big_sla_days)}`}
    </p>
  )
}

function SlaFields<T extends SlaDraft>({ draft, change, required = false }: {
  draft: T; change: (draft: T) => void; required?: boolean
}) {
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <TextField label="เวลามาตรฐาน (วันทำงาน)" mode="decimal" value={draft.days}
        placeholder={required ? 'เช่น 3' : 'เว้นว่างเพื่อไม่จับเวลา'} onChange={days => change({ ...draft, days })} />
      <TextField label="เตือนเมื่อใช้เวลา (%)" mode="numeric" value={draft.warn}
        onChange={warn => change({ ...draft, warn })} />
      <TextField label="งานใหญ่เริ่มที่ (ชิ้น)" mode="numeric" value={draft.bigQty}
        placeholder="เว้นว่างเมื่อไม่มีเกณฑ์งานใหญ่" onChange={bigQty => change({ ...draft, bigQty })} />
      <TextField label="เวลามาตรฐานงานใหญ่ (วันทำงาน)" mode="decimal" value={draft.bigDays}
        placeholder="เว้นว่างเพื่อไม่จับเวลางานใหญ่" onChange={bigDays => change({ ...draft, bigDays })} />
    </div>
  )
}

export function StationsTab({ data, controls }: TabProps<'stations'>) {
  const stations = new Map(data.stations.map(station => [station.code, station.name]))
  return (
    <>
      <p className="rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-warn">
        แก้ขั้นย่อยมีผลกับงานที่อยู่ในสถานีนั้นทันที (ขั้นที่เพิ่มใหม่จะต้องติ๊กก่อนกดเสร็จ)
      </p>
      <Collection controls={controls} group="stations" title="สถานีและขั้นย่อย"
        subtitle="กำหนดเฟส เวลามาตรฐาน และขั้นย่อยที่ต้องทำในแต่ละสถานี"
        list={data.stations} identify={station => station.code}
        row={station => (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{station.name}</span>
              <Pill tone="neutral">เฟส {station.section}</Pill>
              <Pill tone="neutral">{station.substeps.length} ขั้นย่อย</Pill>
            </div>
            <SlaSummary sla={station} />
          </>
        )}
        draft={(station): StationDraft => ({
          ...slaDraft(station ?? { sla_days: null, warn_pct: 80, big_qty: null, big_sla_days: null }),
          name: station?.name ?? '', section: station?.section ?? 1, substeps: station?.substeps ?? [],
        })}
        fields={(draft, change) => (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="ชื่อสถานี" value={draft.name} onChange={name => change({ ...draft, name })} />
              <SelectField label="เฟสของสถานี" options={[['1', SECTION_LABELS[1]], ['2', SECTION_LABELS[2]]]}
                value={String(draft.section)} onChange={value => change({ ...draft, section: Number(value) as Section })} />
            </div>
            <SlaFields draft={draft} change={change} />
            <StepFields steps={draft.substeps} change={substeps => change({ ...draft, substeps })} />
          </>
        )}
        save={async (station, draft) => {
          if (!station) throw new Error('ไม่พบสถานี')
          await saveStation(station, readStation(draft))
        }} />
      <Card className="min-w-0">
        <CardHeader title="เส้นทางผลิต" sub="แก้ลำดับเส้นทางต้องให้ผู้พัฒนาทำ" />
        {data.routes.length === 0 ? <p className="px-5 pb-5 text-muted">ยังไม่มีเส้นทางผลิต</p> : (
          <ul className="divide-y divide-line border-t border-line">
            {data.routes.map(route => {
              const path = data.routeStations.filter(step => step.route_code === route.code).sort((a, b) => a.seq - b.seq)
              return (
                <li key={route.code} className="px-4 py-3 sm:px-5">
                  <p className="font-semibold">{route.name}</p>
                  <p className="mt-1 break-words text-muted">
                    {path.length ? path.map(step => stations.get(step.station_code) ?? step.station_code).join(' → ') : 'ยังไม่มีสถานีในเส้นทาง'}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </>
  )
}

function StepFields({ steps, change }: { steps: Substep[]; change: (steps: Substep[]) => void }) {
  const kinds = EDITABLE_KINDS.map(kind => [kind, KIND_LABEL[kind]] as const)

  return (
    <div className="grid min-w-0 gap-2">
      <p className="font-semibold">ขั้นย่อย</p>
      <p className="text-sm text-muted">ขั้นที่ระบบใช้แก้ได้เฉพาะชื่อ</p>
      {steps.length === 0 && <p className="text-muted">ยังไม่มีขั้นย่อย</p>}
      {steps.map((step, index) => {
        const locked = isProtectedStep(step)
        const update = (next: Substep) => change(steps.map(item => item.key === step.key ? next : item))

        return (
          <div key={step.key} className="grid min-w-0 gap-2 rounded-lg border border-line bg-card p-3">
            <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <TextField label={`ชื่อขั้นที่ ${index + 1}`} value={step.name} onChange={name => update({ ...step, name })} />
              {locked
                ? <p className="self-center text-muted">{KIND_LABEL[step.kind]} · ขั้นที่ระบบใช้</p>
                : <SelectField label="ชนิดขั้นย่อย" value={step.kind} options={kinds}
                  onChange={kind => update({ ...step, kind })} />}
            </div>
            {!locked && (
              <div className="flex flex-wrap gap-2">
                {index > 0 && !isProtectedStep(steps[index - 1]) && (
                  <button type="button" className={secondaryBtn} aria-label={`เลื่อนขั้นที่ ${index + 1} ขึ้น`}
                    onClick={() => change(moveStep(steps, index, -1))}>ขึ้น</button>
                )}
                {index < steps.length - 1 && !isProtectedStep(steps[index + 1]) && (
                  <button type="button" className={secondaryBtn} aria-label={`เลื่อนขั้นที่ ${index + 1} ลง`}
                    onClick={() => change(moveStep(steps, index, 1))}>ลง</button>
                )}
                <button type="button" className={secondaryBtn} aria-label={`ลบขั้นที่ ${index + 1}`}
                  onClick={() => change(steps.filter(item => item.key !== step.key))}>ลบขั้น</button>
              </div>
            )}
          </div>
        )
      })}
      <button type="button" className={`${secondaryBtn} justify-self-start`}
        onClick={() => change([...steps, { key: nextStepKey(steps, crypto.randomUUID()), name: '', kind: 'req' }])}>เพิ่มขั้นย่อย</button>
    </div>
  )
}

export function SegmentsTab({ data, controls }: TabProps<'segments'>) {
  const routeName = new Map(data.routes.map(route => [route.code, route.name]))
  const stationName = new Map(data.stations.map(station => [station.code, station.name]))

  return (
    <Collection controls={controls} group="segments" title="เวลามาตรฐานของช่วง"
      subtitle="กำหนดเวลารวมของสถานีที่ต่อกันในแต่ละเส้นทางผลิต"
      list={data.segments} identify={segment => segment.code}
      row={segment => (
        <>
          <p className="font-semibold">{segment.name} · {routeName.get(segment.route_code) ?? segment.route_code}</p>
          <p className="mt-1 text-muted">
            {stationName.get(segment.from_station) ?? segment.from_station} → {stationName.get(segment.to_station) ?? segment.to_station}
          </p>
          <SlaSummary sla={segment} />
        </>
      )}
      draft={segment => ({
        ...slaDraft(segment ?? { sla_days: null, warn_pct: 80, big_qty: null, big_sla_days: null }), name: segment?.name ?? '',
      })}
      fields={(draft, change) => (
        <>
          <TextField label="ชื่อช่วง" value={draft.name} onChange={name => change({ ...draft, name })} />
          <SlaFields draft={draft} change={change} required />
        </>
      )}
      save={async (segment, draft) => {
        if (!segment) throw new Error('ไม่พบช่วงการผลิต')
        await saveSegment(segment.code, { name: requireText(draft.name, 'ชื่อช่วง'), ...readSla(draft, true) })
      }} />
  )
}
