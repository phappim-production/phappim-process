import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Card, ViewSwitch } from '../../components/ui'
import { Dialog, primaryBtn, secondaryBtn } from '../../components/Dialog'
import { AssignTab, InboxTab, ReasonsTab, UsersTab } from './accounts'
import { MachinesTab, MaterialsTab } from './inventory'
import { SegmentsTab, StationsTab } from './stations'
import { loaders, loadOwnUserId, tabOptions, type Tab } from './data'
import { SelectField, type Controls } from './editor'

type LoadState<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error'; message: string }

export default function SettingsContent({ initialTab = 'users' }: { initialTab?: Tab }) {
  const request = useRef<Promise<string> | null>(null)
  const [identity, setIdentity] = useState<LoadState<string>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    request.current ??= loadOwnUserId()
    void request.current.then(
      value => { if (active) setIdentity({ status: 'ready', value }) },
      error => { if (active) setIdentity({ status: 'error', message: error.message }) },
    )
    return () => { active = false }
  }, [attempt])

  return (
    <>
      {identity.status === 'ready'
        ? <SettingsView userId={identity.value} initialTab={initialTab} />
        : <LoadingCard state={identity} retry={() => {
          request.current = null
          setIdentity({ status: 'loading' })
          setAttempt(n => n + 1)
        }} />}
    </>
  )
}

export function SettingsView({ userId, initialTab = 'users' }: { userId: string; initialTab?: Tab }) {
  const single = initialTab === 'users' || initialTab === 'assign'
  const options = single ? tabOptions.filter(([key]) => key === initialTab) : tabOptions.filter(([key]) => key !== 'users' && key !== 'assign')
  const [tab, setTab] = useState<Tab>(initialTab)
  const [editor, setEditor] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [discard, setDiscard] = useState<{ run: () => void } | null>(null)

  function close() {
    setEditor(null)
    setDirty(false)
  }

  function confirmDiscard(run: () => void) {
    if (busy) return
    if (dirty) setDiscard({ run })
    else run()
  }

  function selectTab(next: Tab) {
    if (next === tab) return
    confirmDiscard(() => {
      close()
      setTab(next)
    })
  }

  const controls: Omit<Controls, 'refresh'> = { editor, busy, open: setEditor, close, setDirty, setBusy, confirmDiscard }

  return (
    <>
      {options.length > 1 && <>
        <div className="min-w-0 sm:hidden">
          <SelectField label="หมวดตั้งค่า" value={tab} options={options} onChange={selectTab} disabled={busy} />
        </div>
        <div className={`hidden min-w-0 sm:block ${busy ? 'opacity-60' : ''}`} inert={busy}>
          <ViewSwitch label="หมวดตั้งค่า" value={tab} options={options} onChange={selectTab} variant="sub" />
        </div>
      </>}
      {busy && <p role="status" className="sr-only">กำลังบันทึกและโหลดข้อมูลล่าสุด</p>}
      {tab === 'users' && <Section load={loaders.users} controls={controls}>{(data, actions) =>
        <UsersTab data={data} controls={actions} userId={userId} />}</Section>}
      {tab === 'assign' && <Section load={loaders.assign} controls={controls}>{(data, actions) =>
        <AssignTab data={data} controls={actions} />}</Section>}
      {tab === 'stations' && <Section load={loaders.stations} controls={controls}>{(data, actions) =>
        <StationsTab data={data} controls={actions} />}</Section>}
      {tab === 'segments' && <Section load={loaders.segments} controls={controls}>{(data, actions) =>
        <SegmentsTab data={data} controls={actions} />}</Section>}
      {tab === 'materials' && <Section load={loaders.materials} controls={controls}>{(data, actions) =>
        <MaterialsTab data={data} controls={actions} />}</Section>}
      {tab === 'reasons' && <Section load={loaders.reasons} controls={controls}>{(data, actions) =>
        <ReasonsTab data={data} controls={actions} />}</Section>}
      {tab === 'machines' && <Section load={loaders.machines} controls={controls}>{(data, actions) =>
        <MachinesTab data={data} controls={actions} />}</Section>}
      {tab === 'inbox' && <Section load={loaders.inbox} controls={controls}>{(data, actions) =>
        <InboxTab data={data} controls={actions} />}</Section>}
      {discard && (
        <Dialog title="ละทิ้งการแก้ไขหรือไม่" onClose={() => setDiscard(null)}>
          <p className="mt-2">รายการนี้ยังไม่ได้บันทึก</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={primaryBtn} onClick={() => {
              setDiscard(null)
              discard.run()
            }}>ละทิ้งการแก้ไข</button>
            <button type="button" className={secondaryBtn} onClick={() => setDiscard(null)}>แก้ไขต่อ</button>
          </div>
        </Dialog>
      )}
    </>
  )
}

function Section<T>({ load, controls, children }: {
  load: () => Promise<T>
  controls: Omit<Controls, 'refresh'>
  children: (value: T, controls: Controls) => ReactNode
}) {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' })
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    void load().then(
      value => { if (active) setState({ status: 'ready', value }) },
      error => { if (active) setState({ status: 'error', message: error.message }) },
    )
    return () => { active = false }
  }, [load, attempt])

  async function refresh(done: string) {
    setMessage(done)
    try {
      setState({ status: 'ready', value: await load() })
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : 'โหลดข้อมูลล่าสุดไม่สำเร็จ' })
    }
  }

  return (
    <>
      {message && <p role="status" className="rounded-xl border border-ok/25 bg-ok-soft px-4 py-3 font-medium text-ok">{message}</p>}
      {state.status === 'ready' ? children(state.value, { ...controls, refresh }) :
        <LoadingCard state={state} retry={() => {
          setState({ status: 'loading' })
          setAttempt(n => n + 1)
        }} />}
    </>
  )
}

function LoadingCard({ state, retry }: {
  state: { status: 'loading' } | { status: 'error'; message: string }; retry: () => void
}) {
  if (state.status === 'loading') {
    return <Card className="p-5"><p role="status" className="text-muted">กำลังโหลดข้อมูล…</p></Card>
  }

  return (
    <Card className="grid justify-items-start gap-3 p-5">
      <p role="alert" className="break-words font-medium text-danger">{state.message}</p>
      <button type="button" className={secondaryBtn} onClick={retry}>ลองอีกครั้ง</button>
    </Card>
  )
}
