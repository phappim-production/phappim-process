import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import { isConfigured } from './lib/supabase'
import EmployeeLogin, { AccountScreen, SignOutButton, primaryButton } from './auth/EmployeeLogin'
import { useEmployeeAccount } from './auth/useEmployeeAccount'
import { canOpenPage, ROLE_LABELS, type EmployeeRole, type PageKey } from './auth/access'
import ReportsPage from './pages/reports'
import SettingsPage from './pages/settings'
import { Card, CardHeader } from './components/ui'
import { IconChart, IconColumns, IconGauge, IconSliders, IconUser } from './components/icons'

const Dashboard = lazy(() => import('./pages/Dashboard'))

type NavItem = { key: PageKey; hash: string; name: string; short: string; icon: ComponentType<{ className?: string }> }

const NAV: NavItem[] = [
  { key: 'overview', hash: '#/', name: 'ภาพรวมแอดมิน', short: 'ภาพรวม', icon: IconGauge },
  { key: 'board', hash: '#/board', name: 'บอร์ดสถานี', short: 'บอร์ด', icon: IconColumns },
  { key: 'reports', hash: '#/reports', name: 'รายงาน', short: 'รายงาน', icon: IconChart },
  { key: 'settings', hash: '#/settings', name: 'ตั้งค่า', short: 'ตั้งค่า', icon: IconSliders },
  { key: 'system', hash: '#/system', name: 'บัญชี', short: 'บัญชี', icon: IconUser },
]

export default function App() {
  const hash = useHash()
  const { session, result, retry } = useEmployeeAccount()
  const page = NAV.find(item => item.hash === hash.split('?')[0])?.key ?? 'overview'

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

  return <Workspace key={session.user.id} page={page} profile={result.profile} email={session.user.email} />
}

function Workspace({ page, profile, email }: {
  page: PageKey
  profile: { name: string; role: EmployeeRole }
  email?: string
}) {
  const [today] = useState(() => new Date().toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }))
  const visibleNav = NAV.filter(item => canOpenPage(profile.role, item.key))
  const roleLabel = ROLE_LABELS[profile.role]

  return (
    <div className="flex h-dvh">
      <aside className="hidden w-60 shrink-0 flex-col bg-brand text-white lg:flex">
        <div className="px-5 pt-5 pb-6">
          <img src="/logo.webp" alt="ภาพพิมพ์ 142" className="h-10 rounded-lg ring-1 ring-white/15" />
          <div className="mt-3 font-semibold">ระบบติดตามการผลิต</div>
        </div>
        <nav aria-label="เมนูหลัก" className="grid gap-1 px-3 text-sm">
          {visibleNav.map(({ key, name, hash, icon: Icon }) => {
            const active = key === page
            const cls = active ? 'bg-white font-semibold text-brand shadow-card' : 'text-white/80 hover:bg-white/10 hover:text-white'
            return (
              <a key={key} href={hash} aria-current={active ? 'page' : undefined} className={`flex min-h-12 items-center gap-3 rounded-xl px-3 py-2.5 transition ${cls}`}>
                <Icon className="size-[18px]" />{name}
              </a>
            )
          })}
        </nav>
        <div className="mt-auto p-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gold text-brand-700"><IconUser className="size-4" /></span>
            <div className="min-w-0 text-sm">
              <div className="truncate font-semibold">{profile.name}</div>
              <div className="text-white/70">{roleLabel}</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 bg-brand px-4 py-2.5 text-white lg:hidden">
          <img src="/logo.webp" alt="ภาพพิมพ์ 142" className="h-8 rounded-md" />
          <span className="font-semibold">ติดตามการผลิต</span>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {!canOpenPage(profile.role, page) ? (
            <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-4 sm:p-6">
              <Card>
                <CardHeader title={page === 'settings' ? 'หน้านี้สำหรับเจ้าของระบบ' : 'หน้านี้สำหรับผู้บริหาร'} />
                <div className="px-5 pb-5">
                  <a href="#/board" className={`inline-flex items-center ${primaryButton}`}>ไปบอร์ดสถานี</a>
                </div>
              </Card>
            </main>
          ) : page === 'overview' || page === 'board' ? (
            <>
              <p className="border-b border-line bg-gold-soft px-4 py-2 text-sm text-ink">หน้าทดลอง · ใช้ข้อมูลจำลอง</p>
              <Suspense fallback={<main className="p-5"><p role="status">กำลังโหลดหน้าติดตามการผลิต…</p></main>}>
                <Dashboard view={page} today={today} />
              </Suspense>
            </>
          ) : (
            <main className="flex-1 overflow-y-auto">
              {page === 'system' && (
                <div className="mx-auto max-w-3xl p-4 sm:p-6">
                  <Card>
                    <CardHeader icon={IconUser} title="บัญชีของฉัน" />
                    <div className="space-y-4 px-5 pb-5">
                      <div>
                        <p className="break-words font-semibold">{profile.name}</p>
                        <p>{roleLabel}</p>
                        {email && <p className="break-all text-muted">{email}</p>}
                      </div>
                      <SignOutButton />
                    </div>
                  </Card>
                </div>
              )}
              {page === 'reports' && <ReportsPage />}
              {page === 'settings' && <SettingsPage />}
            </main>
          )}
        </div>

        <nav aria-label="เมนูหลัก" className="flex border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
          {visibleNav.map(({ key, short, hash, icon: Icon }) => {
            const active = key === page
            return (
              <a key={key} href={hash} aria-current={active ? 'page' : undefined}
                className={`flex min-h-12 min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-xs ${active ? 'font-semibold text-brand' : 'text-muted'}`}>
                <span className={`grid h-7 w-12 place-items-center rounded-full ${active ? 'bg-brand-soft' : ''}`}><Icon className="size-5" /></span>
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
