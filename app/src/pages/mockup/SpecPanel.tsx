import { useState } from 'react'
import { fieldClass, dangerBtn, secondaryBtn } from '../../components/Dialog'
import { STATION_NAME, type StationCode } from '../../proto/model'
import {
  SPEC_KIND_NAME, UNIT_NAME, blankSpec, calloutWords, confirmationRefs, parseSize, refLabel, refValue, specLine, specOf,
  type Callout, type Draft, type Edit, type Spec, type SpecKind, type Unit,
} from '../../proto/annotation'
import { newKey } from '../../data/mockupSheets'
import { Tr } from '../../i18n/Tr'
import { useT } from '../../i18n/lang'

const label = 'grid gap-1 text-sm font-semibold text-muted'

type Edit2 = (e: Edit, tag?: string) => void

function Text({ label: name, value, onCommit, area, disabled, placeholder }: {
  label: string; value: string; onCommit: (v: string) => void; area?: boolean; disabled?: boolean; placeholder?: string
}) {
  const common = { value, disabled, placeholder, 'aria-label': name, onChange: (e: { target: { value: string } }) => onCommit(e.target.value) }
  return (
    <label className={label}>
      {name}
      {area
        ? <textarea {...common} rows={3} className={`${fieldClass} py-2 font-normal text-ink`} />
        : <input {...common} className={`${fieldClass} font-normal text-ink`} />}
    </label>
  )
}

function Num({ label: name, value, onCommit, disabled }: { label: string; value: number | null; onCommit: (v: number | null) => void; disabled?: boolean }) {
  const [typing, setTyping] = useState<string | null>(null)
  const shown = typing ?? (value === null ? '' : String(value))
  const bad = typing !== null && parseSize(typing) === undefined
  return (
    <label className={label}>
      {name}
      <input value={shown} disabled={disabled} inputMode="decimal" aria-label={name} aria-invalid={bad}
        className={`${fieldClass} font-normal text-ink aria-invalid:border-danger`}
        onFocus={() => setTyping(shown)} onBlur={() => { if (!bad) setTyping(null) }}
        onChange={e => {
          setTyping(e.target.value)
          const n = parseSize(e.target.value)
          if (n !== undefined) onCommit(n)
        }} />
      {bad && <span role="alert" className="text-sm font-normal text-danger">ใส่ตัวเลขมากกว่า 0 (ค่านี้ยังไม่ถูกบันทึก)</span>}
    </label>
  )
}

function StationPick({ value, options, onChange, disabled }: {
  value: StationCode[]; options: StationCode[]; onChange: (v: StationCode[]) => void; disabled?: boolean
}) {
  const all = [...options, ...value.filter(s => !options.includes(s))]
  return (
    <fieldset className="grid gap-1">
      <legend className="text-sm font-semibold text-muted">สถานีที่เกี่ยวข้อง <span className="font-normal">(ไม่เลือก = ทุกสถานีเห็น)</span></legend>
      <div className="flex flex-wrap gap-2">
        {all.map(s => {
          const on = value.includes(s)
          return (
            <button key={s} type="button" disabled={disabled} aria-pressed={on}
              onClick={() => onChange(on ? value.filter(x => x !== s) : [...value, s])}
              className={`min-h-12 rounded-xl border px-3 font-semibold ${on ? 'border-brand bg-brand text-white' : 'border-line bg-card text-ink hover:border-brand'} disabled:opacity-60`}>
              {STATION_NAME[s]}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

function SpecEditor({ spec, used, stations, edit, disabled }: {
  spec: Spec; used: number[]; stations: StationCode[]; edit: Edit2; disabled?: boolean
}) {
  const set = (patch: Partial<Omit<Spec, 'key'>>) => edit({ type: 'update_spec', key: spec.key, patch }, `${spec.key}:${Object.keys(patch).join()}`)
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-xl border border-gold/50 bg-gold-soft/40 p-3" aria-label={`สเปก ${spec.code}`}>
      <p className="text-sm text-muted">สเปก <b className="text-ink">{spec.code}</b> · ใช้กับ Callout {used.join(', ') || '—'} {used.length > 1 && '(แก้ที่นี่ = แก้ทุกจุดที่ใช้)'}</p>
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
        <Text label="รหัส" value={spec.code} onCommit={v => set({ code: v.replace(/\s/g, '') })} disabled={disabled} />
        <Text label="ชื่อสเปก" value={spec.name} onCommit={v => set({ name: v })} disabled={disabled} placeholder="เช่น โลโก้อกซ้าย" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className={label}>ประเภท
          <select value={spec.kind} disabled={disabled} onChange={e => set({ kind: e.target.value as SpecKind })} className={`${fieldClass} font-normal text-ink`}>
            {Object.entries(SPEC_KIND_NAME).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
        </label>
        <Text label="ตำแหน่งการผลิต" value={spec.position} onCommit={v => set({ position: v })} disabled={disabled} placeholder="เช่น อกซ้าย ห่างคอ 8 ซม." />
      </div>
      <Text label="รายละเอียด" area value={spec.detail} onCommit={v => set({ detail: v })} disabled={disabled} />
      <div className="grid grid-cols-3 gap-2">
        <Num label="กว้าง" value={spec.width} onCommit={v => set({ width: v })} disabled={disabled} />
        <Num label="สูง" value={spec.height} onCommit={v => set({ height: v })} disabled={disabled} />
        <label className={label}>หน่วย
          <select value={spec.unit} disabled={disabled} onChange={e => set({ unit: e.target.value as Unit })} className={`${fieldClass} font-normal text-ink`}>
            {Object.entries(UNIT_NAME).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Text label="สี" value={spec.color} onCommit={v => set({ color: v })} disabled={disabled} placeholder="เช่น ดำ" />
        <Text label="รหัสสี" value={spec.colorCode} onCommit={v => set({ colorCode: v })} disabled={disabled} placeholder="เช่น Pantone 7727 C" />
        <Text label="วัสดุ" value={spec.material} onCommit={v => set({ material: v })} disabled={disabled} />
        <Text label="วิธีการผลิต" value={spec.method} onCommit={v => set({ method: v })} disabled={disabled} placeholder="เช่น DTF · ปัก" />
      </div>
      <Text label="ไฟล์ Artwork อ้างอิง (ชื่อไฟล์ / ที่อยู่บน NAS)" value={spec.artworkRef} onCommit={v => set({ artworkRef: v })} disabled={disabled}
        placeholder="เช่น \\192.168.1.119\PP-production\SC-6911\logo-A.ai" />
      <Text label="หมายเหตุ" value={spec.note} onCommit={v => set({ note: v })} disabled={disabled} />
      <StationPick value={spec.stations} options={stations} onChange={v => set({ stations: v })} disabled={disabled} />
      {!disabled && <button type="button" className={dangerBtn} onClick={() => edit({ type: 'remove_spec', key: spec.key })}>ลบสเปก {spec.code}</button>}
    </section>
  )
}

export function SpecPanel({ draft, callout, jobSpec, stations, edit, editable }: {
  draft: Draft; callout: Callout | null; jobSpec: unknown; stations: StationCode[]; edit: Edit2; editable: boolean
}) {
  const t = useT()
  if (!callout) {
    return <p className="rounded-xl border border-dashed border-line p-4 text-muted">
      {editable ? 'กดบนภาพเพื่อเพิ่มจุด · กดจุดหรือกล่องข้อความเพื่อแก้รายละเอียดที่นี่' : <Tr th="กดจุดบนภาพเพื่ออ่านสเปก" />}
    </p>
  }
  const c = callout
  const set = (patch: Partial<Omit<Callout, 'key' | 'no'>>) => edit({ type: 'update_callout', key: c.key, patch }, `${c.key}:${Object.keys(patch).join()}`)
  const refs = confirmationRefs(jobSpec)
  const spec = specOf(draft, c)
  const used = (key: string) => draft.callouts.filter(x => x.specKey === key).map(x => x.no).sort((a, b) => a - b)

  if (!editable) {
    return (
      <section className="grid grid-cols-[minmax(0,1fr)] gap-3" aria-label={`รายละเอียด Callout ${c.no}`}>
        <h3 className="text-xl font-bold"><span className="text-brand">{c.no}</span> {c.title}</h3>
        {calloutWords(c, draft, jobSpec).map((l, i) => <p key={i} className="rounded-xl bg-paper px-3 py-2 break-words">{t(l.th, l.vars)}</p>)}
        {spec && (
          <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-xl border border-line p-3">
            {([['ประเภท', t(SPEC_KIND_NAME[spec.kind])], ['ตำแหน่ง', spec.position], ['รายละเอียด', specLine(spec)], ['ไฟล์ Artwork', spec.artworkRef], ['หมายเหตุ', spec.note]] as const)
              .filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{t(k)}</dt><dd className="break-all">{v}</dd></div>)}
          </dl>
        )}
        <p className="text-sm text-muted">{t('สถานี: {list}', { list: c.stations.length ? c.stations.map(s => ({ th: STATION_NAME[s] })) : [{ th: 'ทุกสถานี' }] })}</p>
      </section>
    )
  }

  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-3" aria-label={`แก้ Callout ${c.no}`}>
      <h3 className="text-lg font-bold">Callout {c.no}</h3>
      <Text label="ชื่อจุด" value={c.title} onCommit={v => set({ title: v })} placeholder="เช่น คอเสื้อ อกซ้าย แขนซ้าย" />
      <label className={label}>อ้างข้อมูลจากใบยืนยัน (ไม่ต้องกรอกซ้ำ)
        <select value={c.specRef ?? ''} onChange={e => set({ specRef: e.target.value || null })} className={`${fieldClass} font-normal text-ink`}>
          <option value="">— ไม่อ้าง —</option>
          {refs.map(r => <option key={r.ref} value={r.ref}>{r.label}: {r.value}</option>)}
          {c.specRef && !refs.some(r => r.ref === c.specRef) && <option value={c.specRef}>{refLabel(c.specRef)} (ใบยืนยันไม่มีข้อมูลแล้ว)</option>}
        </select>
      </label>
      {c.specRef && <p className={`rounded-xl px-3 py-2 ${refValue(jobSpec, c.specRef) ? 'bg-paper' : 'bg-danger-soft text-danger'}`}>
        {refValue(jobSpec, c.specRef) ?? 'ใบยืนยันไม่มีข้อมูลช่องนี้แล้ว เลือกช่องอื่นหรือใช้สเปกเพิ่มเติม'}
      </p>}
      <label className={label}>สเปกเพิ่มเติม (สิ่งที่ใบยืนยันไม่มี)
        <select value={c.specKey ?? ''} onChange={e => set({ specKey: e.target.value || null })} className={`${fieldClass} font-normal text-ink`}>
          <option value="">— ไม่ใช้ —</option>
          {draft.specs.map(s => <option key={s.key} value={s.key}>{s.code} {s.name || '(ยังไม่ตั้งชื่อ)'}</option>)}
        </select>
      </label>
      {!spec && (
        <button type="button" className={secondaryBtn} onClick={() => edit({
          type: 'add_spec', linkTo: c.key,
          spec: blankSpec(newKey(), draft.specs, { name: c.title, position: c.title, stations: c.stations }),
        })}>+ สร้างสเปกใหม่จากจุดนี้</button>
      )}
      {spec && <SpecEditor spec={spec} used={used(spec.key)} stations={stations} edit={edit} />}
      <Text label="ข้อความเพิ่มเติม" area value={c.body} onCommit={v => set({ body: v })} placeholder="เช่น ระวังตะเข็บ ห้ามพิมพ์ทับ" />
      <StationPick value={c.stations} options={stations} onChange={v => set({ stations: v })} />
      <button type="button" className={dangerBtn} onClick={() => edit({ type: 'remove_callout', key: c.key })}>ลบ Callout {c.no}</button>
    </section>
  )
}
