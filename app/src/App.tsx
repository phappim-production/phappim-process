import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from 'react'
import { isConfigured } from './lib/supabase'
import EmployeeLogin, { AccountScreen, SignOutButton, primaryButton } from './auth/EmployeeLogin'
import { useEmployeeAccount } from './auth/useEmployeeAccount'
import { canOpenPage, roleLabel as labelFor, type EmployeeRole, type PageKey, type Section } from './auth/access'
import { boardScope, homePage } from './auth/scope'
import ReportsPage from './pages/reports'
import SettingsPage from './pages/settings'
import InboxPage from './pages/inbox'
import { InboxBell } from './pages/inbox/InboxBell'
import { unreadBadge } from './pages/inbox/format'
import { useInbox } from './pages/inbox/useInbox'
import JobLabel from './pages/job-label'
import AccountPage from './pages/AccountPage'
import { Card, CardHeader } from './components/ui'
import { AppUpdate } from './components/AppUpdate'
import { ErrorBoundary } from './components/ErrorBoundary'
import { IconChart, IconColumns, IconGauge, IconInbox, IconSliders, IconUser } from './components/icons'

const Dashboard = lazy(() => import('./pages/Dashboard'))

type NavItem = { key: PageKey; hash: string; name: string; short: string; icon: ComponentType<{ className?: string }> }

const NAV: NavItem[] = [
  { key: 'overview', hash: '#/', name: 'ภาพรวมแอดมิน', short: 'ภาพรวม', icon: IconGauge },
  { key: 'board', hash: '#/board', name: 'หน้างาน', short: 'หน้างาน', icon: IconColumns },
  { key: 'inbox', hash: '#/inbox', name: 'กล่องจดหมาย', short: 'กล่องจดหมาย', icon: IconInbox },
  { key: 'reports', hash: '#/reports', name: 'รายงาน', short: 'รายงาน', icon: IconChart },
  { key: 'settings', hash: '#/settings', name: 'ตั้งค่า', short: 'ตั้งค่า', icon: IconSliders },
  { key: 'system', hash: '#/system', name: 'บัญชี', short: 'บัญชี', icon: IconUser },
]

// ใบปะงานเปิดจากรายละเอียดงาน โดยไม่มีรายการในเมนู
const HIDDEN: Partial<Record<string, PageKey>> = { '#/label': 'label' }

export default function App() {
  return (
    <div className="flex h-dvh flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto"><AppContent /></div>
      <AppUpdate />
    </div>
  )
}

function AppContent() {
  const hash = useHash()
  const { session, result, retry } = useEmployeeAccount()
  const path = hash.split('?')[0]
  const page = NAV.find(item => item.hash === path)?.key ?? HIDDEN[path] ?? 'overview'
  const labelId = new URLSearchParams(hash.split('?')[1] ?? '').get('id') ?? ''

  if (!isConfigured) {
    return (
      <AccountScreen title="ระบบยังไม่พร้อมใช้งาน">
        <p>กรุณาติดต่อเจ้าของระบบเพื่อตรวจการตั้งค่า Supabase</p>
      </AccountScreen>
    )
  }
  if (session === null) return <EmployeeLogin />
  if (!session || !result) {
    return <AccountScreen title="กำลังตรวจสอบบัญชี"><p role="status">กรุณารอสักครู่</p></AccountScreen>
  }
  if (result.status !== 'ready') {
    const messages = {
      unassigned: 'บัญชีนี้ยังไม่ได้รับบทบาท กรุณาติดต่อเจ้าของระบบ',
      inactive: 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อเจ้าของระบบ',
      error: 'ตรวจสอบสิทธิ์เข้าใช้งานไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง',
    }
    return (
      <AccountScreen title="ยังเข้าใช้งานไม่ได้">
        <p role="alert" className="mb-4 text-danger">{messages[result.status]}</p>
        <div className="grid gap-2">
          <button type="button" className={primaryButton} onClick={retry}>ตรวจสอบอีกครั้ง</button>
          <SignOutButton />
        </div>
      </AccountScreen>
    )
  }

  return <Workspace key={session.user.id} page={page} labelId={labelId} profile={result.profile} email={session.user.email} />
}

function Workspace({ page: requested, labelId, profile, email }: {
  page: PageKey
  labelId: string
  profile: { name: string; role: EmployeeRole; section: Section | null }
  email?: string
}) {
  const [today] = useState(() => new Date().toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }))
  // เปิดเว็บมาที่ #/ แล้วบทบาทนั้นไม่ใช้ภาพรวม → ไปหน้างานของตัวเองแทน ไม่ขึ้นหน้า "ไม่มีสิทธิ์"
  const page = requested === 'overview' && !canOpenPage(profile.role, 'overview') ? homePage(profile.role) : requested
  const scope = useMemo(() => boardScope(profile.role, profile.section), [profile.role, profile.section])
  const visibleNav = NAV
    .filter(item => canOpenPage(profile.role, item.key))
    .map(item => item.key === 'board' && scope.columns ? { ...item, name: 'งานของฉัน', short: 'งานของฉัน' } : item)
  const roleLabel = labelFor(profile.role, profile.section)
  const { unreadCount } = useInbox()
  const inboxBadge = unreadBadge(unreadCount)

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 flex-col bg-brand text-white lg:flex">
        <div className="flex items-center gap-3 px-5 pt-5 pb-6">
          <img src="/logo.webp" alt="ภาพพิมพ์ 142" className="h-10 rounded-lg ring-1 ring-white/20" />
          <span className="text-lg font-bold leading-tight">ติดตาม<br />การผลิต</span>
        </div>
        <nav aria-label="เมนูหลัก" className="grid gap-1 px-3">
          {visibleNav.map(({ key, name, hash, icon: Icon }) => {
            const active = key === page
            const badge = key === 'inbox' ? inboxBadge : null
            return (
              <a key={key} href={hash} aria-current={active ? 'page' : undefined}
                aria-label={badge ? `${name} ยังไม่อ่าน ${unreadCount} รายการ` : undefined}
                className={`flex min-h-12 items-center gap-3 rounded-xl px-4 text-base font-semibold ${active ? 'bg-white text-brand' : 'text-white/90 hover:bg-white/10'}`}>
                <Icon className="size-5 shrink-0" />{name}
                {badge && (
                  <span aria-hidden className="ml-auto min-w-5 shrink-0 rounded-full bg-danger px-1.5 py-0.5 text-center text-xs leading-none font-bold text-white tabular-nums">
                    {badge}
                  </span>
                )}
              </a>
            )
          })}
        </nav>
        <a href="#/system" className="m-3 mt-auto flex min-h-12 items-center gap-3 rounded-xl bg-white/10 p-3 hover:bg-white/15">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gold text-brand-700"><IconUser className="size-5" /></span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate font-semibold">{profile.name}</span>
            <span className="block truncate text-sm text-white/80">{roleLabel}</span>
          </span>
        </a>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 bg-brand px-4 py-2 text-white lg:hidden">
          <img src="/logo.webp" alt="ภาพพิมพ์ 142" className="h-9 rounded-md" />
          <span className="hidden font-bold whitespace-nowrap sm:inline">ติดตามการผลิต</span>
          {/* แท็บเล็ตใช้ร่วมกันหลายคน ต้องเห็นตลอดว่าใครล็อกอินอยู่ เพราะทุกการกดบันทึกชื่อผู้กด */}
          <span className="ml-auto"><InboxBell /></span>
          <a href="#/system" className="flex min-h-12 min-w-0 items-center gap-2 rounded-xl px-2 hover:bg-white/10">
            <span className="min-w-0 text-right leading-tight">
              <span className="block truncate font-semibold">{profile.name}</span>
              <span className="block truncate text-sm text-white/80">{roleLabel}</span>
            </span>
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gold text-brand-700"><IconUser className="size-5" /></span>
          </a>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {/* หน้าใดพัง (รวมโหลดไฟล์หน้าไม่ขึ้นหลัง deploy) ต้องไม่ทำให้จอขาวทั้งแอป · เมนูยังกดได้ · เปลี่ยนหน้าแล้วเริ่มใหม่ (key) */}
          <ErrorBoundary key={page}>
          {!canOpenPage(profile.role, page) ? (
            <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-4 sm:p-6">
              <Card>
                <CardHeader title={page === 'settings' ? 'หน้านี้สำหรับเจ้าของระบบ' : 'หน้านี้สำหรับผู้บริหาร'} />
                <div className="px-5 pb-5">
                  <a href="#/board" className={`inline-flex items-center ${primaryButton}`}>ไปหน้างาน</a>
                </div>
              </Card>
            </main>
          ) : page === 'overview' || page === 'board' ? (
            <Suspense fallback={<main className="p-5"><p role="status">กำลังโหลดหน้าติดตามการผลิต…</p></main>}>
              <Dashboard view={page} today={today} role={profile.role} scope={scope} />
            </Suspense>
          ) : (
            <main className="flex-1 overflow-y-auto">
              {page === 'system' && <AccountPage name={profile.name} role={profile.role} roleLabel={roleLabel} email={email} />}
              {page === 'reports' && <ReportsPage />}
              {page === 'settings' && <SettingsPage />}
              {page === 'inbox' && <InboxPage />}
              {page === 'label' && <JobLabel jobId={labelId} />}
            </main>
          )}
          </ErrorBoundary>
        </div>

        <nav aria-label="เมนูหลัก" className="flex border-t border-line bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
          {visibleNav.filter(({ key }) => key !== 'inbox').map(({ key, short, hash, icon: Icon }) => {
            const active = key === page
            return (
              <a key={key} href={hash} aria-current={active ? 'page' : undefined}
                className={`flex min-h-14 min-w-0 flex-1 flex-col items-center gap-0.5 py-1.5 text-sm ${active ? 'font-bold text-brand' : 'text-muted'}`}>
                <span className={`grid h-8 w-14 place-items-center rounded-full ${active ? 'bg-brand text-white' : ''}`}><Icon className="size-5" /></span>
                {short}
              </a>
            )
          })}
        </nav>
      </div>
    </div>
  )
}

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash || '#/')
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}
