import { useEffect, useId, type ComponentType, type ReactNode } from 'react'
import { IconX } from './icons'

export function Dialog({ title, icon: Icon, onClose, children, wide }: {
  title: string; icon?: ComponentType<{ className?: string }>; onClose: () => void; children: ReactNode; wide?: boolean
}) {
  const id = useId()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={id} onClick={e => e.stopPropagation()}
        className={`max-h-full w-full overflow-y-auto rounded-2xl bg-card p-5 shadow-lift ${wide ? 'max-w-xl' : 'max-w-md'}`}>
        <div className="flex items-start gap-2">
          <h3 id={id} className="flex min-w-0 items-center gap-2 text-xl font-bold text-brand">
            {Icon && <Icon className="size-6 shrink-0" />}{title}
          </h3>
          <button type="button" onClick={onClose} aria-label="ปิด" className="ml-auto grid size-12 shrink-0 place-items-center rounded-full hover:bg-paper">
            <IconX className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export const fieldClass = 'min-h-12 w-full min-w-0 rounded-xl border border-line bg-card px-3 text-base focus-visible:outline-2 focus-visible:outline-brand'
export const primaryBtn = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand px-5 font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted'
export const secondaryBtn = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-card px-5 font-semibold text-brand hover:bg-brand-soft disabled:opacity-60'
export const dangerBtn = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-danger/40 bg-card px-5 font-semibold text-danger hover:bg-danger-soft disabled:opacity-60'
export const okBtn = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-ok px-5 font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted'
