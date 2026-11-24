import { useMemo, useState } from 'react'
import { Card, CardHeader, Pill, ViewSwitch } from '../../components/ui'
import { TONE } from '../../components/tone'
import { IconCheck, IconInbox } from '../../components/icons'
import { secondaryBtn } from '../../components/Dialog'
import { filterInbox, groupByDay, kindLabel, kindTone, relativeWord, type InboxItem } from './format'
import type { Inbox } from './useInbox'
import { Tr } from '../../i18n/Tr'
import { useT } from '../../i18n/lang'

type Filter = 'unread' | 'all'

export default function InboxPage({ inbox }: { inbox: Inbox }) {
  const { state, unreadCount, busy, actionError, markRead, markAllRead, refresh } = inbox
  const [filter, setFilter] = useState<Filter>('all')
  const [now] = useState(() => new Date())
  const t = useT()

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
          <h1 className="text-2xl font-bold text-ink"><Tr inline th="กล่องจดหมาย" /></h1>
          <p className="text-base text-muted">
            {unreadCount > 0 ? t('ยังไม่อ่าน {n} รายการ', { n: unreadCount }) : t('อ่านครบทุกรายการแล้ว')}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void markAllRead()}
          disabled={busy || unreadCount === 0 || state.status !== 'ready'}
          className={secondaryBtn}
        >
          <IconCheck className="size-5 shrink-0" />
          <Tr th="อ่านแล้วทั้งหมด" />
        </button>
      </div>

      <ViewSwitch
        label={t('กรองข้อความ')}
        value={filter}
        onChange={setFilter}
        options={[
          ['all', t('ทั้งหมด')],
          ['unread', unreadCount > 0 ? t('ยังไม่อ่าน ({n})', { n: unreadCount }) : t('ยังไม่อ่าน')],
        ]}
      />

      {actionError && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-base text-danger">
          <Tr th={actionError} />
        </p>
      )}

      {state.status === 'loading' && (
        <Card>
          <div className="p-6 text-center text-base text-muted">
            <p role="status"><Tr th="กำลังโหลดกล่องจดหมาย…" /></p>
          </div>
        </Card>
      )}

      {state.status === 'error' && (
        <Card>
          <CardHeader icon={IconInbox} title={<Tr inline th="โหลดกล่องจดหมายไม่สำเร็จ" />} tone="danger" />
          <div className="space-y-4 px-5 pb-5">
            <p role="alert" className="text-base text-danger"><Tr th={state.message} /></p>
            <button type="button" onClick={() => void refresh()} className={secondaryBtn}>
              <Tr th="ลองอีกครั้ง" />
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
              <Tr th={filter === 'unread' ? 'ไม่มีข้อความที่ยังไม่อ่าน' : 'ยังไม่มีการแจ้งเตือน'} />
            </p>
            <p className="text-base text-muted">
              {t('เมื่อมีงานติดปัญหา เกินเวลา หรือใกล้กำหนดส่ง ระบบจะแจ้งเตือนที่นี่ทันที')}
            </p>
          </div>
        </Card>
      )}

      {state.status === 'ready' &&
        groups.map(group => (
          <section key={group.label} aria-label={t(group.label)} className="grid gap-2">
            <h2 className="px-1 text-base font-bold text-muted"><Tr inline th={group.label} /></h2>
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
                      {unread && <span className={`size-2.5 rounded-full ${TONE[tone].dot}`} aria-label={t('ยังไม่อ่าน')} />}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Pill tone={tone}>{t(kindLabel(item.kind))}</Pill>
                        <span className="text-sm text-muted">{(w => t(w.th, w.vars))(relativeWord(item.createdAt, now))}</span>
                      </div>
                      <p className={`break-words text-base ${unread ? 'font-bold text-ink' : 'font-medium text-ink/80'}`}>
                        <Tr th={item.title} />
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
