import { useState } from 'react'
import { dangerBtn, fieldClass, primaryBtn, secondaryBtn } from '../components/Dialog'
import { IconAlert } from '../components/icons'
import { Tr } from '../i18n/Tr'
import { useT, type Word } from '../i18n/lang'

export function QueueReasonPrompt({ head, placeholder, confirm, danger, busy, onConfirm, onCancel }: {
  head: Word; placeholder: string; confirm: string; danger?: boolean; busy: boolean
  onConfirm: (reason: string) => void; onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  const t = useT()
  return (
    <div className="grid gap-2 rounded-xl bg-warn-soft p-3">
      <p className="flex items-start gap-2 font-semibold text-warn">
        <IconAlert className="mt-0.5 size-5 shrink-0" />
        <Tr th={head.th} vars={head.vars} />
      </p>
      <input value={reason} onChange={e => setReason(e.target.value)} className={fieldClass} aria-label={t('เหตุผล')} placeholder={t(placeholder)} />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy || !reason.trim()} className={danger ? dangerBtn : primaryBtn} onClick={() => onConfirm(reason.trim())}>
          <Tr th={reason.trim() ? confirm : 'ใส่เหตุผลก่อน'} />
        </button>
        <button type="button" disabled={busy} className={secondaryBtn} onClick={onCancel}><Tr th="ยกเลิก" /></button>
      </div>
    </div>
  )
}
