import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Card, CardHeader } from '../../components/ui'
import { dangerBtn, Dialog, fieldClass, primaryBtn, secondaryBtn } from '../../components/Dialog'

export type Controls = {
  editor: string | null
  busy: boolean
  open: (id: string) => void
  close: () => void
  setDirty: (value: boolean) => void
  setBusy: (value: boolean) => void
  confirmDiscard: (close: () => void) => void
  refresh: (message: string) => Promise<void>
}

type RowAction<T> = {
  label: string
  detail: string
  run: (row: T) => Promise<void>
  done: string
}

type CollectionProps<Row, Draft> = {
  controls: Controls
  group: string
  title: string
  subtitle?: string
  list: Row[]
  identify: (row: Row) => string
  row: (row: Row) => ReactNode
  draft: (row: Row | null) => Draft
  fields: (value: Draft, change: (value: Draft) => void, row: Row | null) => ReactNode
  save: (row: Row | null, value: Draft) => Promise<void>
  createLabel?: string
  editLabel?: (row: Row) => string
  action?: (row: Row) => RowAction<Row> | undefined
}

export function Collection<Row, Draft>(props: CollectionProps<Row, Draft>) {
  const { controls, group, title, subtitle, list, identify, createLabel, editLabel, action } = props
  const [pending, setPending] = useState<{ row: Row; action: RowAction<Row> } | null>(null)
  const selected = list.find(item => controls.editor === `${group}:${identify(item)}`)
  const adding = controls.editor === `${group}:new`
  const locked = controls.editor !== null || controls.busy
  const id = useId()

  return (
    <Card className="min-w-0" >
      <CardHeader title={title} sub={subtitle} />
      {createLabel && (
        <div className="px-4 pb-4 sm:px-5">
          <button type="button" className={primaryBtn} disabled={locked}
            onClick={() => controls.open(`${group}:new`)}>{createLabel}</button>
        </div>
      )}
      {(selected || adding) && (
        <RecordEditor key={controls.editor} controls={controls} initial={props.draft(selected ?? null)}
          fields={(value, change) => props.fields(value, change, selected ?? null)}
          save={value => props.save(selected ?? null, value)} />
      )}
      {list.length === 0 ? <p className="px-4 pb-5 text-muted sm:px-5">ยังไม่มีรายการ</p> : (
        <ul className="divide-y divide-line border-t border-line">
          {list.map(item => (
            <li key={identify(item)} className="flex min-w-0 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="min-w-0 break-words">{props.row(item)}</div>
              <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto">
                <button type="button" className={secondaryBtn} disabled={locked}
                  aria-describedby={locked ? id : undefined}
                  onClick={() => controls.open(`${group}:${identify(item)}`)}>{editLabel?.(item) ?? 'แก้ไข'}</button>
                {(() => {
                  const available = action?.(item)
                  return available && (
                    <button type="button" className={dangerBtn} disabled={locked}
                      aria-describedby={locked ? id : undefined}
                      onClick={() => setPending({ row: item, action: available })}>{available.label}</button>
                  )
                })()}
              </div>
            </li>
          ))}
        </ul>
      )}
      {locked && <p id={id} className="sr-only">บันทึกหรือยกเลิกรายการที่กำลังแก้ไขก่อน</p>}
      {pending && (
        <ConfirmAction key={identify(pending.row)} controls={controls} action={pending.action}
          row={pending.row} close={() => setPending(null)} />
      )}
    </Card>
  )
}

function RecordEditor<Draft>({ controls, initial, fields, save }: {
  controls: Controls
  initial: Draft
  fields: (draft: Draft, change: (draft: Draft) => void) => ReactNode
  save: (draft: Draft) => Promise<void>
}) {
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState('')
  const saving = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)

  function change(next: Draft) {
    setDraft(next)
    setError('')
    controls.setDirty(JSON.stringify(next) !== JSON.stringify(initial))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving.current) return
    saving.current = true
    controls.setBusy(true)
    setError('')
    try {
      await save(draft)
      controls.close()
      await controls.refresh('บันทึกแล้ว')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      controls.setBusy(false)
      saving.current = false
    }
  }

  return (
    <form ref={node => {
      if (node && formRef.current !== node) {
        formRef.current = node
        node.focus({ preventScroll: true })
        node.scrollIntoView({ block: 'nearest' })
      }
    }} tabIndex={-1} noValidate onSubmit={event => void submit(event)}
      className="mx-4 mb-4 rounded-xl border border-brand/25 bg-brand-soft p-3 outline-none sm:mx-5 sm:p-4">
      <fieldset disabled={controls.busy} className="grid min-w-0 gap-4">
        {fields(draft, change)}
        {error && <p role="alert" className="break-words text-danger">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={primaryBtn}>{controls.busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
          <button type="button" className={secondaryBtn} onClick={() => controls.confirmDiscard(controls.close)}>ยกเลิก</button>
        </div>
      </fieldset>
    </form>
  )
}

function ConfirmAction<Row>({ controls, action, row, close }: {
  controls: Controls; action: RowAction<Row>; row: Row; close: () => void
}) {
  const busy = useRef(false)
  const [error, setError] = useState('')

  async function confirm() {
    if (busy.current) return
    busy.current = true
    controls.setBusy(true)
    setError('')
    try {
      await action.run(row)
      close()
      await controls.refresh(action.done)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      controls.setBusy(false)
      busy.current = false
    }
  }

  return (
    <Dialog title={action.label} onClose={() => { if (!busy.current) close() }}>
      <p className="mt-2 break-words">{action.detail}</p>
      {error && <p role="alert" className="mt-3 text-danger">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={dangerBtn} disabled={controls.busy}
          onClick={() => void confirm()}>{controls.busy ? 'กำลังบันทึก…' : 'ยืนยัน'}</button>
        <button type="button" className={secondaryBtn} disabled={controls.busy} onClick={close}>ยกเลิก</button>
      </div>
    </Dialog>
  )
}

export function TextField({ label, value, onChange, mode, disabled, placeholder }: {
  label: string; value: string; onChange: (value: string) => void
  mode?: 'numeric' | 'decimal'; disabled?: boolean; placeholder?: string
}) {
  return (
    <label className="grid min-w-0 content-start gap-1 font-medium">
      {label}
      <input className={fieldClass} value={value} disabled={disabled} inputMode={mode} placeholder={placeholder}
        onChange={event => onChange(event.target.value)} />
    </label>
  )
}

export function SelectField<T extends string>({ label, value, onChange, options, disabled }: {
  label: string; value: T; onChange: (value: T) => void
  options: readonly (readonly [T, string])[]; disabled?: boolean
}) {
  return (
    <label className="grid min-w-0 content-start gap-1 font-medium">
      {label}
      <select className={fieldClass} value={value} disabled={disabled}
        onChange={event => {
          const choice = options.find(([key]) => key === event.target.value)
          if (choice) onChange(choice[0])
        }}>
        {options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </select>
    </label>
  )
}

export function EnabledField({ label, checked, onChange, disabled }: {
  label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean
}) {
  return (
    <label className="flex min-h-12 items-center gap-3 font-medium">
      <input type="checkbox" className="size-5 accent-brand" checked={checked} disabled={disabled}
        onChange={event => onChange(event.target.checked)} />
      {label}
    </label>
  )
}
