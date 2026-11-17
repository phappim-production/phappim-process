import { useMemo, useState } from 'react'
import { Card, CardHeader, Pill, ViewSwitch } from '../../components/ui'
import { TONE } from '../../components/tone'
import { IconCheck, IconInbox } from '../../components/icons'
import { secondaryBtn } from '../../components/Dialog'
import { filterInbox, groupByDay, kindLabel, kindTone, relativeTime, type InboxItem } from './format'
import { useInbox } from './useInbox'

type Filter = 'unread' | 'all'

export default function InboxPage() {
  const { state, unreadCount, busy, actionError, markRead, markAllRead, refresh } = useInbox()
  const [filter, setFilter] = useState<Filter>('all')
  const [now] = useState(() => new Date())

  const groups = useMemo(() => {
    if (state.status !== 'ready') return []
    return groupByDay(filterInbox(state.items, filter), now)
  }, [state, filter, now])

  const handleOpen = (item: InboxItem) => {
    if (!item.read) {
      void markRead(item.id)
    }
    if (item.jobId) {
      window.location.hash = `#/board?job=${encodeURIComponent(item.jobId)}`
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink">กล่องจดหมาย</h1>
          <p className="text-base text-muted">
            {unreadCount > 0 ? `ยังไม่อ่าน ${unreadCount} รายการ` : 'อ่านครบทุกรายการแล้ว'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void markAllRead()}
          disabled={busy || unreadCount === 0 || state.status !== 'ready'}
          className={secondaryBtn}
        >
          <IconCheck className="size-5 shrink-0" />
          อ่านแล้วทั้งหมด
        </button>
      </div>

      <ViewSwitch
        label="กรองข้อความ"
        value={filter}
        onChange={setFilter}
        options={[
          ['all', 'ทั้งหมด'],
          ['unread', unreadCount > 0 ? `ยังไม่อ่าน (${unreadCount})` : 'ยังไม่อ่าน'],
        ]}
      />

      {actionError && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-base text-danger">
          {actionError}
        </p>
      )}

      {state.status === 'loading' && (
        <Card>
          <div className="p-6 text-center text-base text-muted">
            <p role="status">กำลังโหลดกล่องจดหมาย…</p>
          </div>
        </Card>
      )}

      {state.status === 'error' && (
        <Card>
          <CardHeader icon={IconInbox} title="โหลดกล่องจดหมายไม่สำเร็จ" tone="danger" />
          <div className="space-y-4 px-5 pb-5">
            <p role="alert" className="text-base text-danger">{state.message}</p>
            <button type="button" onClick={() => void refresh()} className={secondaryBtn}>
              ลองอีกครั้ง
            </button>
          </div>
        </Card>
      )}

      {state.status === 'ready' && groups.length === 0 && (
        <Card>
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-paper text-muted">
              <IconInbox className="size-6" />
            </span>
            <p className="text-base font-semibold text-ink">
              {filter === 'unread' ? 'ไม่มีข้อความที่ยังไม่อ่าน' : 'ยังไม่มีการแจ้งเตือน'}
            </p>
            <p className="text-base text-muted">
              เมื่อมีงานติดปัญหา เกินเวลา หรือใกล้กำหนดส่ง ระบบจะแจ้งเตือนที่นี่ทันที
            </p>
          </div>
        </Card>
      )}

      {state.status === 'ready' &&
        groups.map(group => (
          <section key={group.label} aria-label={group.label} className="grid gap-2">
            <h2 className="px-1 text-base font-bold text-muted">{group.label}</h2>
            <Card className="divide-y divide-line overflow-hidden">
              {group.items.map(item => {
                const tone = kindTone(item.kind)
                const unread = !item.read
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleOpen(item)}
                    className={`flex min-h-12 w-full min-w-0 items-start gap-3 p-4 text-left transition-colors hover:bg-paper ${
                      unread ? 'bg-card' : 'bg-paper/40'
                    }`}
                  >
                    <span className="mt-2 flex size-2.5 shrink-0 items-center justify-center">
                      {unread && <span className={`size-2.5 rounded-full ${TONE[tone].dot}`} aria-label="ยังไม่อ่าน" />}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Pill tone={tone}>{kindLabel(item.kind)}</Pill>
                        <span className="text-sm text-muted">{relativeTime(item.createdAt, now)}</span>
                      </div>
                      <p className={`break-words text-base ${unread ? 'font-bold text-ink' : 'font-medium text-ink/80'}`}>
                        {item.title}
                      </p>
                      <p className="break-words text-base text-muted">{item.body}</p>
                    </div>
                  </button>
                )
              })}
            </Card>
          </section>
        ))}
    </div>
  )
}
