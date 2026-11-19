import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ROLE_LABELS } from '../../auth/access'
import { cell, PERMISSIONS, ROLE_ORDER } from '../../auth/permissions'
import { Card, CardHeader, Pill, StatTile, ViewSwitch } from '../../components/ui'
import { secondaryBtn } from '../../components/Dialog'
import { IconAlert, IconCheck, IconClipboard, IconSewing, IconShield, IconUsers } from '../../components/icons'
import { eventLine } from '../../data/history'
import { auditChanges, auditTitle, roleCounts, type AuditRow } from '../../proto/admin'
import { STATION_NAME, type StationCode } from '../../proto/model'
import { loadAudit, loadSystemOverview } from './data'

type Load<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T }

function useLoad<T>(load: () => Promise<T>): [Load<T>, () => void] {
  const [state, setState] = useState<{ load: () => Promise<T>; value: Load<T> }>({ load, value: { status: 'loading' } })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    load().then(
      data => { if (alive) setState({ load, value: { status: 'ready', data } }) },
      (e: unknown) => { if (alive) setState({ load, value: { status: 'error', message: e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ' } }) },
    )
    return () => { alive = false }
  }, [load, attempt])
  const value: Load<T> = state.load === load ? state.value : { status: 'loading' }
  return [value, () => { setState({ load, value: { status: 'loading' } }); setAttempt(n => n + 1) }]
}

function Page({ title, sub, icon: Icon, children }: { title: string; sub: string; icon: typeof IconUsers; children: ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-6xl min-w-0 gap-4 p-4 sm:p-6">
      <header className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><Icon className="size-6" /></span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-muted">{sub}</p>
        </div>
      </header>
      {children}
    </div>
  )
}

function Loading<T>({ state, retry, children }: { state: Load<T>; retry: () => void; children: (data: T) => ReactNode }) {
  if (state.status === 'loading') return <Card className="p-5"><p role="status" className="text-muted">กำลังโหลดข้อมูล…</p></Card>
  if (state.status === 'error') {
    return (
      <Card className="grid gap-3 p-5">
        <p role="alert" className="text-danger">โหลดข้อมูลไม่สำเร็จ · {state.message}</p>
        <button type="button" className={secondaryBtn} onClick={retry}>ลองอีกครั้ง</button>
      </Card>
    )
  }
  return <>{children(state.data)}</>
}

const when = (at: string) => new Date(at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function AuditLine({ row, name }: { row: AuditRow; name: (id: string) => string }) {
  const changes = auditChanges(row)
  return (
    <li className="grid gap-0.5 rounded-xl border border-line p-3">
      <span className="flex flex-wrap items-center gap-2">
        <b className="min-w-0 [overflow-wrap:anywhere]">{auditTitle(row, name)}</b>
        <span className="ml-auto text-sm text-muted">{when(row.at)} · {row.by ? name(row.by) : 'ระบบ'}</span>
      </span>
      {changes.map(c => <span key={c} className="text-sm text-muted [overflow-wrap:anywhere]">{c}</span>)}
    </li>
  )
}

export function SystemOverviewPage() {
  const [state, retry] = useLoad(loadSystemOverview)
  return (
    <Page title="ภาพรวมระบบ" sub="บัญชีผู้ใช้ · สิ่งที่ยังตั้งค่าไม่ครบ · การเปลี่ยนแปลงล่าสุด" icon={IconShield}>
      <Loading state={state} retry={retry}>{d => {
        const name = (id: string) => d.names.get(id) ?? 'ไม่ทราบชื่อ'
        const active = d.users.filter(u => u.role && u.active).length
        return (
          <>
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
              <StatTile icon={IconUsers} label="ผู้ใช้ที่เปิดใช้งาน" value={active} note={`ทั้งหมด ${d.users.length} บัญชี`} tone="brand" onClick={() => { window.location.hash = '#/users' }} />
              <StatTile icon={IconAlert} label="พนักงานยังไม่จับคู่สถานี" value={d.unassigned.length} tone={d.unassigned.length ? 'warn' : 'ok'} onClick={() => { window.location.hash = '#/assign' }} />
              <StatTile icon={IconSewing} label="จักรเสีย" value={d.broken.length} tone={d.broken.length ? 'danger' : 'ok'} />
              <StatTile icon={IconAlert} label="บัญชียังไม่มีบทบาท" value={d.noRole.length} tone={d.noRole.length ? 'warn' : 'ok'} onClick={() => { window.location.hash = '#/users' }} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader icon={IconUsers} title="ผู้ใช้ตามบทบาท" />
                <ul className="grid gap-1 px-4 pb-4">
                  {roleCounts(d.users).map(r => (
                    <li key={r.role} className="flex min-h-10 items-center justify-between border-b border-line last:border-0">
                      <span>{ROLE_LABELS[r.role]}</span><b className="tabular-nums">{r.n}</b>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card>
                <CardHeader icon={IconAlert} title="ต้องตั้งค่าเพิ่ม" tone={d.unassigned.length || d.noRecipe.length ? 'warn' : 'ok'} />
                <ul className="grid gap-2 px-4 pb-4">
                  {d.unassigned.map(u => <li key={u.user_id}><Pill tone="warn">ยังไม่จับคู่สถานี</Pill> {u.name || u.email}</li>)}
                  {d.broken.map(m => <li key={m.code}><Pill tone="danger">จักรเสีย</Pill> {m.code}{m.note ? ` · ${m.note}` : ''}</li>)}
                  {d.noRecipe.length > 0 && (
                    <li>
                      <Pill tone="neutral">ยังไม่มีสูตรจักร {d.noRecipe.length} สินค้า</Pill>
                      <span className="mt-1 block text-sm text-muted">ถ้าต้องเย็บ ให้ใส่ที่ ตั้งค่าระบบ → จักรเย็บ · {d.noRecipe.map(p => p.name).join(' · ')}</span>
                    </li>
                  )}
                  {!d.unassigned.length && !d.broken.length && !d.noRecipe.length && <li className="text-muted">ตั้งค่าครบแล้ว</li>}
                </ul>
              </Card>
            </div>
            <Card>
              <CardHeader icon={IconClipboard} title="การเปลี่ยนแปลงล่าสุด" right={<a href="#/audit" className="text-sm font-semibold text-brand">ดู Audit Log</a>} />
              <ul className="grid gap-2 px-4 pb-4">
                {d.audit.length ? d.audit.map(r => <AuditLine key={r.id} row={r} name={name} />) : <li className="text-muted">ยังไม่มีการแก้ตั้งค่า</li>}
              </ul>
            </Card>
          </>
        )
      }}</Loading>
    </Page>
  )
}

export function RolesPage() {
  return (
    <Page title="Roles & Permissions" sub="แต่ละบทบาททำอะไรได้ · ฐานข้อมูลบังคับสิทธิ์จริง เปลี่ยนบทบาทของคนที่เมนูผู้ใช้งาน" icon={IconShield}>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left">
          <thead>
            <tr className="border-b border-line">
              <th className="p-3 font-semibold">สิ่งที่ทำ</th>
              {ROLE_ORDER.map(r => <th key={r} className="p-3 text-center text-sm font-semibold">{ROLE_LABELS[r]}</th>)}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map(p => (
              <tr key={p.key} className="border-b border-line last:border-0">
                <td className="p-3">{p.name}</td>
                {ROLE_ORDER.map(r => {
                  const c = cell(p, r)
                  return (
                    <td key={r} className="p-3 text-center text-sm">
                      {c === true ? <IconCheck className="mx-auto size-5 text-ok" aria-label="ทำได้" />
                        : c === false ? <span className="text-muted" aria-label="ทำไม่ได้">–</span>
                        : <span className="font-medium text-warn">{c}</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-sm text-muted">ส้ม = ทำได้บางส่วน · เจ้าของระบบทำแทนได้ทุกอย่าง</p>
    </Page>
  )
}

const AUDIT_VIEWS = [['settings', 'ตั้งค่า / ผู้ใช้'], ['events', 'การกดงาน']] as const
const AUDIT_DAYS = [['7', '7 วัน'], ['30', '30 วัน']] as const

export function AuditPage() {
  const [view, setView] = useState<(typeof AUDIT_VIEWS)[number][0]>('settings')
  const [days, setDays] = useState<(typeof AUDIT_DAYS)[number][0]>('7')
  const [person, setPerson] = useState('')
  const load = useMemo(() => () => loadAudit(Number(days)), [days])
  const [state, retry] = useLoad(load)
  return (
    <Page title="Audit Log" sub="ใครทำอะไรเมื่อไร · แก้หรือลบบันทึกไม่ได้" icon={IconClipboard}>
      <div className="flex flex-wrap gap-2">
        <ViewSwitch variant="sub" label="ชนิดบันทึก" value={view} onChange={setView} options={AUDIT_VIEWS} />
        <ViewSwitch variant="sub" label="ช่วงเวลา" value={days} onChange={setDays} options={AUDIT_DAYS} />
      </div>
      <Loading state={state} retry={retry}>{d => {
        const name = (id: string) => d.names.get(id) ?? 'ไม่ทราบชื่อ'
        const people = [...new Set([...d.settings, ...d.events].map(r => r.by).filter((b): b is string => !!b))]
        const mine = <T extends { by: string | null }>(list: T[]) => person ? list.filter(r => r.by === person) : list
        const stationName = (code: string) => STATION_NAME[code as StationCode] ?? code
        return (
          <>
            <label className="grid max-w-sm gap-1 font-medium">คนที่ทำ
              <select value={person} onChange={e => setPerson(e.target.value)} className="min-h-12 rounded-xl border border-line bg-card px-3">
                <option value="">ทุกคน</option>
                {people.map(id => <option key={id} value={id}>{name(id)}</option>)}
              </select>
            </label>
            <Card>
              <ul className="grid gap-2 p-4">
                {view === 'settings'
                  ? (mine(d.settings).length ? mine(d.settings).map(r => <AuditLine key={r.id} row={r} name={name} />) : <li className="text-muted">ไม่มีรายการในช่วงนี้</li>)
                  : (mine(d.events).length ? mine(d.events).map(e => {
                      const line = eventLine(e, { station: stationName, step: (_s, k) => k }, e.jobs?.unit)
                      return (
                        <li key={e.id} className="grid gap-0.5 rounded-xl border border-line p-3">
                          <span className="flex flex-wrap items-center gap-2">
                            <a href={`#/board?job=${e.job_id}`} className="font-bold text-brand">{e.jobs?.confirmation_no ?? 'งาน'}</a>
                            <span className="min-w-0">{line.title}</span>
                            <span className="ml-auto text-sm text-muted">{when(e.at)} · {e.by ? name(e.by) : 'ระบบ'}</span>
                          </span>
                          {line.detail && <span className="text-sm text-muted [overflow-wrap:anywhere]">{line.detail}</span>}
                        </li>
                      )
                    }) : <li className="text-muted">ไม่มีรายการในช่วงนี้</li>)}
              </ul>
            </Card>
            <p className="text-sm text-muted">แสดงล่าสุดไม่เกิน 500 รายการต่อชนิด</p>
          </>
        )
      }}</Loading>
    </Page>
  )
}

