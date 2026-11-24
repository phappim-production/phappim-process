import { unreadBadge } from './format'
import { useT } from '../../i18n/lang'

export function InboxBell({ unreadCount }: { unreadCount: number }) {
  const badge = unreadBadge(unreadCount)
  const t = useT()

  return (
    <a
      href="#/inbox"
      aria-label={unreadCount > 0 ? t('กล่องจดหมาย ยังไม่อ่าน {n} รายการ', { n: unreadCount }) : t('กล่องจดหมาย')}
      className="relative grid size-12 shrink-0 place-items-center rounded-xl hover:bg-white/10"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-6"
        aria-hidden
      >
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {badge && (
        <span className="absolute top-1.5 right-1.5 grid min-w-5 place-items-center rounded-full bg-danger px-1.5 py-0.5 text-xs leading-none font-bold text-white tabular-nums">
          {badge}
        </span>
      )}
    </a>
  )
}
