import type { PickGroup, PickTile } from '../proto/machinePick'
import { MACHINE_TYPE_NAME, type MachineType } from '../proto/sewing'

const TILE: Record<PickTile['state'], string> = {
  mine: 'border-brand bg-brand text-white',
  free: 'border-ok bg-ok-soft text-ok hover:border-brand',
  busy: 'border-info/40 bg-info-soft text-info',
  broken: 'border-danger/40 bg-danger-soft text-danger',
  booked: 'border-warn/40 bg-warn-soft text-warn',
}

export function MachinePicker({ groups, picked, onToggle, jobNo, shared, disabled, manage }: {
  groups: PickGroup[]
  picked: readonly string[]
  onToggle: (code: string, tile: PickTile) => void
  jobNo: (id?: string) => string
  shared: readonly MachineType[]
  disabled?: boolean
  manage?: boolean
}) {
  return (
    <div className="grid gap-4">
      {groups.map(g => {
        const chosen = g.tiles.filter(t => manage ? t.state === 'mine' : picked.includes(t.code)).length
        return (
          <section key={g.type} className="grid gap-2">
            <h4 className="flex flex-wrap items-baseline gap-x-2 font-semibold">
              {MACHINE_TYPE_NAME[g.type]}
              <span className={`text-sm font-medium ${chosen < g.need ? 'text-warn' : 'text-ok'}`}>
                {g.need > 0 ? `ต้องใช้ ${g.need} ตัว · ` : ''}{manage ? 'ใช้อยู่' : 'เลือกแล้ว'} {chosen} ตัว
              </span>
            </h4>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {g.tiles.map(t => {
                const on = manage ? t.state === 'mine' : picked.includes(t.code)
                const tappable = t.state === 'free' || t.state === 'mine'
                const label = on ? (manage ? 'ของงานนี้' : '✓ เลือก')
                  : t.state === 'free' ? 'ว่าง'
                  : t.state === 'busy' ? jobNo(t.jobId)
                  : t.state === 'booked' ? `จอง ${jobNo(t.jobId)}`
                  : 'เสีย'
                return (
                  <li key={t.code}>
                    <button type="button" disabled={disabled || !tappable} aria-pressed={on}
                      onClick={() => onToggle(t.code, t)}
                      className={`flex min-h-16 w-full flex-col items-center justify-center rounded-xl border-2 px-1 py-1.5 text-center disabled:cursor-not-allowed ${on ? 'border-brand bg-brand text-white' : TILE[t.state]}`}>
                      <span className="font-mono text-base font-bold">{t.code}</span>
                      <span className="max-w-full truncate text-sm">{label}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      {shared.length > 0 && (
        <p className="rounded-xl bg-paper px-3 py-2 text-sm text-muted">
          ใช้ร่วมทุกไลน์ ไม่ต้องเลือก: {shared.map(t => MACHINE_TYPE_NAME[t]).join(' · ')}
        </p>
      )}
    </div>
  )
}
