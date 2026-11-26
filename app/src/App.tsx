import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from 'react'
import { isConfigured } from './lib/supabase'
import EmployeeLogin, { AccountScreen, SignOutButton, primaryButton } from './auth/EmployeeLogin'
import { useEmployeeAccount } from './auth/useEmployeeAccount'
import { canOpenPage, FACTORY_VIEWS, roleLabel as labelFor, type FactoryView, type PageKey, type EmployeeRole, type Section } from './auth/access'
import { boardScope, homePage } from './auth/scope'
import type { StationCode } from './proto/model'
import { bottomBar, roleMenu, routeOf, type MenuIcon, type Route } from './auth/menus'
import ReportsPage from './pages/reports'
import SettingsPage from './pages/settings'
import { InboxBell } from './pages/inbox/InboxBell'
import { unreadBadge } from './pages/inbox/format'
import { useInbox } from './pages/inbox/useInbox'
import JobLabel from './pages/job-label'
import { Card, CardHeader } from './components/ui'
import { AppUpdate } from './components/AppUpdate'
import { ErrorBoundary } from './components/ErrorBoundary'
import { DocumentLang, LangScope, LangToggle, Tr } from './i18n/Tr'
import { useT } from './i18n/lang'
import { useWakeLock } from './lib/wakeLock'
import { useFormRelink } from './data/formRelink'
import {
  IconChart, IconClipboard, IconClock, IconColumns, IconFactory, IconFlag, IconGauge, IconInbox, IconLayers, IconList, IconShield,
  IconBook, IconSliders, IconTruck, IconUser, IconUsers,
} from './components/icons'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const MockupPage = lazy(() => import('./pages/mockup/MockupPage'))
const ArtworkSheet = lazy(() => import('./pages/mockup/ArtworkSheet'))
const InboxPage = lazy(() => import('./pages/inbox'))
const AccountPage = lazy(() => import('./pages/AccountPage'))
const WordsPage = lazy(() => import('./pages/WordsPage'))
const AuditPage = lazy(() => import('./pages/admin').then(m => ({ default: m.AuditPage })))
const RolesPage = lazy(() => import('./pages/admin').then(m => ({ default: m.RolesPage })))
const SystemOverviewPage = lazy(() => import('./pages/admin').then(m => ({ default: m.SystemOverviewPage })))

const MENU_ICON: Record<MenuIcon, ComponentType<{ className?: string }>> = {
  gauge: IconGauge, list: IconList, columns: IconColumns, chart: IconChart, queue: IconLayers, users: IconUsers,
  sliders: IconSliders, inbox: IconInbox, flag: IconFlag, clock: IconClock, shield: IconShield, pin: IconFactory, log: IconClipboard, truck: IconTruck,
}

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
  const route = routeOf(path)
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
    return <AccountScreen title="กำลังตรวจสอบบัญชี"><p role="status"><Tr th="กรุณารอสักครู่" /></p></AccountScreen>
  }
  if (result.status !== 'ready') {
    const messages = {
      unassigned: 'บัญชีนี้ยังไม่ได้รับบทบาท กรุณาติดต่อเจ้าของระบบ',
      inactive: 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อเจ้าของระบบ',
      error: 'ตรวจสอบสิทธิ์เข้าใช้งานไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง',
    }
    return (
      <AccountScreen title="ยังเข้าใช้งานไม่ได้">
        <p role="alert" className="mb-4 text-danger"><Tr th={messages[result.status]} /></p>
        <div className="grid gap-2">
          <button type="button" className={primaryButton} onClick={retry}><Tr th="ตรวจสอบอีกครั้ง" /></button>
          <SignOutButton />
        </div>
      </AccountScreen>
    )
  }

  return <Workspace key={session.user.id} path={path} route={route} labelId={labelId} profile={result.profile} email={session.user.email} />
}

type WorkspaceProps = {
  path: string
  route: Route
  labelId: string
  profile: { name: string; role: EmployeeRole; section: Section | null; stations: StationCode[] }
  email?: string
}

// แปลเฉพาะหน้าจอพนักงานสถานีและ QC · บทบาทอื่นเห็นไทยเสมอแม้เครื่องตั้งพม่าไว้
const TRANSLATED_ROLES: EmployeeRole[] = ['staff', 'qc']

function Workspace(props: WorkspaceProps) {
  const translated = TRANSLATED_ROLES.includes(props.profile.role)
  return (
    <LangScope allowed={translated}>
      <DocumentLang />
      <WorkspaceBody {...props} translated={translated} />
    </LangScope>
  )
}

function WorkspaceBody({ path: requestedPath, route: requested, labelId, profile, email, translated }: WorkspaceProps & { translated: boolean }) {
  const t = useT()
  const [today] = useState(() => new Date().toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }))
  // เปิดเว็บมาที่ #/ แล้วบทบาทนั้นไม่ใช้ภาพรวม → ไปหน้างานของตัวเองแทน ไม่ขึ้นหน้า "ไม่มีสิทธิ์"
  const ownerHome = requestedPath === '#/' && profile.role === 'owner'
  const redirected = requested.page === 'overview' && !canOpenPage(profile.role, 'overview')
  const route: Route = ownerHome ? { page: 'sysOverview' } : redirected ? { page: homePage(profile.role) } : requested
  const page = route.page
  // พนักงานวางเครื่องไว้ข้างงาน มือเปื้อนหมึก/ผ้า · จอดับระหว่างทำต้องปลดล็อกใหม่ทุกครั้ง
  useWakeLock(translated && page === 'board')
  useFormRelink()
  // ผู้ควบคุมงานเปิดมาเจอแท็บงานที่ต้องทำ (เฟส 2 = จักรเย็บ) จึงไฮไลต์เมนู "คิวงาน" ไม่ใช่ "สถานี"
  const path = ownerHome ? '#/admin' : redirected ? (profile.role === 'supervisor' ? '#/queue' : '#/board') : requestedPath
  const scope = useMemo(() => boardScope(profile.role, profile.section, profile.stations), [profile.role, profile.section, profile.stations])
  const menu = roleMenu(profile.role)
  // แท็บจักรเย็บไม่มีเมนูของตัวเอง ไฮไลต์ "คิวงาน" แทน
  const menuPath = path === '#/sewing' ? '#/queue' : path
  const bar = bottomBar(menu, menuPath)
  const [moreOpen, setMoreOpen] = useState(false)
  const roleLabel = t(labelFor(profile.role, profile.section))
  const inbox = useInbox()
  const { unreadCount } = inbox
  const inboxBadge = unreadBadge(unreadCount)

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 flex-col bg-brand text-white lg:flex print:hidden">
        <div className="mx-5 mt-6 mb-4 border-b border-white/15 pb-5">
          <img src="/logo.webp" alt="ภาพพิมพ์ 142" className="h-12 w-auto rounded-lg ring-1 ring-white/25" />
          <p className="mt-3 text-sm font-semibold tracking-wide whitespace-nowrap text-white/75"><Tr th="ระบบติดตามการผลิต" /></p>
          {translated && (
            <div className="mt-3 flex flex-wrap gap-2">
              <LangToggle />
              <a href="#/words" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-white/10 px-3 font-semibold hover:bg-white/15"><IconBook className="size-5" /><Tr th="คำศัพท์" /></a>
            </div>
          )}
        </div>
        <nav aria-label={t('เมนูหลัก')} className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-3 pb-3 [scrollbar-color:rgb(255_255_255/0.25)_transparent] [scrollbar-width:thin]">
          {menu.map(group => (
            <div key={group.title} className="grid gap-1">
              <p className="px-4 pb-1 text-xs font-semibold tracking-widest text-white/60"><Tr th={group.title} /></p>
              {group.items.map(({ name, hash, icon }) => {
                const Icon = MENU_ICON[icon]
                const active = hash === menuPath
                const badge = hash === '#/inbox' ? inboxBadge : null
                return (
                  <a key={hash} href={hash} aria-current={active ? 'page' : undefined}
                    aria-label={badge ? `${t(name)} ${t('ยังไม่อ่าน {n} รายการ', { n: unreadCount })}` : undefined}
                    className={`relative flex min-h-12 items-center gap-3 rounded-xl px-4 text-base font-semibold ${active ? 'bg-white text-brand' : 'text-white/90 hover:bg-white/10'}`}>
                    {active && <span aria-hidden className="absolute top-2 bottom-2 -left-3 w-1 rounded-r-full bg-gold" />}
                    <Icon className="size-5 shrink-0" /><Tr th={name} />
                    {badge && (
                      <span aria-hidden className="ml-auto min-w-5 shrink-0 rounded-full bg-danger px-1.5 py-0.5 text-center text-xs leading-none font-bold text-white tabular-nums">
                        {badge}
                      </span>
                    )}
                  </a>
                )
              })}
            </div>
          ))}
        </nav>
        <a href="#/system" className="m-3 flex min-h-12 shrink-0 items-center gap-3 rounded-xl bg-white/10 p-3 hover:bg-white/15">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gold text-brand-700"><IconUser className="size-5" /></span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate font-semibold">{profile.name}</span>
            <span className="block truncate text-sm text-white/80">{roleLabel}</span>
          </span>
        </a>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b-2 border-gold bg-brand px-3 py-2 text-white sm:gap-3 sm:px-4 lg:hidden print:hidden">
          <img src="/logo.webp" alt="ภาพพิมพ์ 142" className="h-8 w-auto shrink-0 rounded-md ring-1 ring-white/25 sm:h-9" />
          <span className="hidden text-sm font-semibold whitespace-nowrap text-white/75 sm:inline">{t('ระบบติดตามการผลิต')}</span>
          {/* แท็บเล็ตใช้ร่วมกันหลายคน ต้องเห็นตลอดว่าใครล็อกอินอยู่ เพราะทุกการกดบันทึกชื่อผู้กด */}
          {translated && <LangToggle compact className="ml-auto text-white hover:bg-white/10" />}
          <span className={translated ? '' : 'ml-auto'}><InboxBell unreadCount={unreadCount} /></span>
          <a href="#/system" className="flex min-h-12 min-w-0 items-center gap-2 rounded-xl px-2 hover:bg-white/10">
            <span className="min-w-0 text-right leading-tight">
              <span className="block truncate font-semibold">{profile.name}</span>
              <span className="block truncate text-sm text-white/80">{roleLabel}</span>
            </span>
            {/* มือถือแคบ ชื่อผู้ใช้สำคัญกว่าไอคอน (คำพม่ายาวกว่าไทย) */}
            <span className="hidden size-10 shrink-0 place-items-center rounded-full bg-gold text-brand-700 sm:grid"><IconUser className="size-5" /></span>
          </a>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {/* หน้าใดพัง (รวมโหลดไฟล์หน้าไม่ขึ้นหลัง deploy) ต้องไม่ทำให้จอขาวทั้งแอป · เมนูยังกดได้ · เปลี่ยนหน้าแล้วเริ่มใหม่ (key) */}
          <ErrorBoundary key={page}>
          {!canOpenPage(profile.role, page) ? (
            <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-4 sm:p-6">
              <Card>
                <CardHeader title={['settings', 'sysOverview', 'roles', 'audit'].includes(page) ? 'หน้านี้สำหรับเจ้าของระบบ' : 'บทบาทของคุณเปิดหน้านี้ไม่ได้'} />
                <div className="px-5 pb-5">
                  <a href="#/board" className={`inline-flex items-center ${primaryButton}`}>ไปหน้างาน</a>
                </div>
              </Card>
            </main>
          ) : isFactoryView(page) ? (
            <Suspense fallback={<main className="p-5"><p role="status">กำลังโหลดหน้าติดตามการผลิต…</p></main>}>
              <Dashboard view={page} routeKey={path} tab={route.tab} overviewView={route.overviewView} today={today} role={profile.role} scope={scope} />
            </Suspense>
          ) : (
            <main className="flex-1 overflow-y-auto">
              <Suspense fallback={<p role="status" className="p-5 text-muted"><Tr th="กำลังโหลด…" /></p>}>
                {page === 'system' && <AccountPage name={profile.name} role={profile.role} roleLabel={roleLabel} email={email} />}
                {page === 'reports' && <ReportsPage />}
                {page === 'settings' && <SettingsPage key={path} tab={route.settingsTab} />}
                {page === 'inbox' && <InboxPage inbox={inbox} />}
                {page === 'sysOverview' && <SystemOverviewPage />}
                {page === 'roles' && <RolesPage />}
                {page === 'audit' && <AuditPage />}
                {page === 'label' && <JobLabel jobId={labelId} />}
                {page === 'words' && <WordsPage />}
                {page === 'mockup' && <MockupPage key={labelId} jobId={labelId} role={profile.role} myStations={profile.stations} />}
                {page === 'artwork' && <ArtworkSheet key={labelId} jobId={labelId} role={profile.role} />}
              </Suspense>
            </main>
          )}
          </ErrorBoundary>
        </div>

        {moreOpen && bar.more.length > 0 && (
          <div id="more-menu" className="grid gap-1 border-t border-line bg-card p-2 lg:hidden">
            {bar.more.map(({ name, hash, icon }) => {
              const Icon = MENU_ICON[icon]
              return (
                <a key={hash} href={hash} onClick={() => setMoreOpen(false)} aria-current={hash === menuPath ? 'page' : undefined}
                  className={`flex min-h-12 items-center gap-3 rounded-xl px-4 text-base font-semibold ${hash === menuPath ? 'bg-brand text-white' : 'hover:bg-brand-soft'}`}>
                  <Icon className="size-5 shrink-0" /><Tr th={name} />
                </a>
              )
            })}
          </div>
        )}
        <nav aria-label={t('เมนูหลัก')} className="flex border-t border-line bg-card pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden">
          {bar.shown.map(({ short, hash, icon }) => {
            const Icon = MENU_ICON[icon]
            const active = hash === menuPath
            return (
              <a key={hash} href={hash} aria-current={active ? 'page' : undefined} onClick={() => setMoreOpen(false)}
                className={`flex min-h-14 min-w-0 flex-1 flex-col items-center gap-0.5 py-1.5 text-sm ${active ? 'font-bold text-brand' : 'text-muted'}`}>
                <span className={`grid h-8 w-12 place-items-center rounded-full ${active ? 'bg-brand text-white' : ''}`}><Icon className="size-5" /></span>
                <span className="line-clamp-2 max-w-full px-0.5 text-center leading-tight break-words"><Tr th={short} /></span>
              </a>
            )
          })}
          {bar.more.length > 0 && (
            <button type="button" aria-expanded={moreOpen} aria-controls="more-menu" onClick={() => setMoreOpen(open => !open)}
              className={`flex min-h-14 min-w-0 flex-1 flex-col items-center gap-0.5 py-1.5 text-sm ${moreOpen ? 'font-bold text-brand' : 'text-muted'}`}>
              <span className={`grid h-8 w-12 place-items-center rounded-full ${moreOpen ? 'bg-brand text-white' : ''}`}><IconList className="size-5" /></span>
              {t('เพิ่มเติม')}
            </button>
          )}
        </nav>
      </div>
    </div>
  )
}

function isFactoryView(page: PageKey): page is FactoryView {
  return FACTORY_VIEWS.includes(page)
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
