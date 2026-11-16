import { useEffect, useState, type ComponentType, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isConfigured, supabase } from './lib/supabase'
import Dashboard from './pages/Dashboard'
import { IconChart, IconColumns, IconGauge, IconInbox, IconPackage, IconSliders, IconUser } from './components/icons'

type Station = { code: string; name: string; is_draft: boolean }
type Route = { code: string; name: string; route_stations: { seq: number; stations: { name: string } | null }[] }
type ProductType = { code: string; name: string; category: string; unit: string }

type PageKey = 'overview' | 'board' | 'system'
type NavItem = { key: PageKey | null; hash?: string; name: string; short: string; icon: ComponentType<{ className?: string }>; soon?: string }
const NAV: NavItem[] = [
  { key: 'overview', hash: '#/', name: 'ภาพรวมแอดมิน', short: 'ภาพรวม', icon: IconGauge },
  { key: 'board', hash: '#/board', name: 'บอร์ดสถานี', short: 'บอร์ด', icon: IconColumns },
  { key: null, name: 'รับงาน', short: 'รับงาน', icon: IconInbox, soon: 'เฟส 2' },
  { key: null, name: 'เช็ควัตถุดิบ', short: 'วัตถุดิบ', icon: IconPackage, soon: 'เฟส 2' },
  { key: null, name: 'รายงาน', short: 'รายงาน', icon: IconChart, soon: 'เฟส 4' },
  { key: 'system', hash: '#/system', name: 'ระบบ', short: 'ระบบ', icon: IconSliders },
]

// เฟส 1: หน้าจอต้นแบบใช้ข้อมูลจำลอง (เปิดดูได้โดยไม่ต้องล็อกอิน) · หน้า "ระบบ" = ตรวจการเชื่อมต่อจากเฟส 0
export default function App() {
  const hash = useHash()
  const page: PageKey = hash === '#/system' ? 'system' : hash === '#/board' ? 'board' : 'overview'
  const [today] = useState(() => new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))

  return (
    <div className="flex h-dvh">
      {/* แถบเมนูซ้าย (จอใหญ่) */}
      <aside className="hidden w-60 shrink-0 flex-col bg-brand text-white lg:flex">
        <div className="px-5 pt-5 pb-6">
          <img src="/logo.webp" alt="ภาพพิมพ์ 142" className="h-10 rounded-lg ring-1 ring-white/15" />
          <div className="mt-3 leading-tight">
            <div className="font-semibold">ระบบติดตามการผลิต</div>
            <div className="text-xs text-white/60">Production Tracker</div>
          </div>
        </div>
        <nav className="grid gap-1 px-3 text-sm">
          {NAV.map(n => {
            const active = n.key === page
            const Icon = n.icon
            const cls = `flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${active ? 'bg-white text-brand font-semibold shadow-card' : n.soon ? 'text-white/45 cursor-default' : 'text-white/80 hover:bg-white/10 hover:text-white'}`
            return n.hash
              ? <a key={n.name} href={n.hash} aria-current={active ? 'page' : undefined} className={cls}><Icon className="size-[18px]" />{n.name}</a>
              : <span key={n.name} className={cls} title={`มาใน${n.soon}`}><Icon className="size-[18px]" />{n.name}<span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px]">{n.soon}</span></span>
          })}
        </nav>
        <div className="mt-auto p-3">
          <div className="rounded-xl bg-white/10 p-3 text-xs leading-relaxed text-white/80">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-gold"><span className="size-1.5 rounded-full bg-gold" />ต้นแบบเฟส 1</div>
            ข้อมูลในหน้าจอเป็นข้อมูลจำลอง ลองกดดูได้ทุกปุ่ม
          </div>
          <div className="mt-3 flex items-center gap-2.5 px-1">
            <span className="grid size-8 place-items-center rounded-full bg-gold text-brand-700"><IconUser className="size-4" /></span>
            <div className="text-xs leading-tight"><div className="font-semibold">ผู้ทดลองใช้</div><div className="text-white/60">แอดมิน</div></div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* แถบบน (มือถือ / แท็บเล็ต) */}
        <header className="flex items-center gap-3 bg-brand px-4 py-2.5 text-white lg:hidden">
          <img src="/logo.webp" alt="ภาพพิมพ์ 142" className="h-8 rounded-md" />
          <span className="font-semibold">ติดตามการผลิต</span>
          <span className="ml-auto rounded-full bg-gold/90 px-2.5 py-0.5 text-[11px] font-semibold text-brand-700">ต้นแบบ</span>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {page === 'system'
            ? <main className="flex-1 overflow-y-auto"><div className="mx-auto max-w-3xl p-4 sm:p-6"><SystemPage /></div></main>
            : <Dashboard view={page} today={today} />}
        </div>

        {/* แถบเมนูล่าง (มือถือ / แท็บเล็ต) */}
        <nav className="grid grid-cols-3 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
          {NAV.filter(n => n.hash).map(n => {
            const active = n.key === page
            const Icon = n.icon
            return (
              <a key={n.name} href={n.hash} aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${active ? 'font-semibold text-brand' : 'text-muted'}`}>
                <span className={`grid h-7 w-12 place-items-center rounded-full ${active ? 'bg-brand-soft' : ''}`}><Icon className="size-5" /></span>
                {n.short}
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

function SystemPage() {
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  return !isConfigured ? <NotConfigured /> : !session ? <Login /> : <MasterCheck session={session} />
}

function NotConfigured() {
  return (
    <Card title="ยังไม่ได้ตั้งค่า Supabase">
      <p>สร้างไฟล์ <code>app/.env.local</code> จาก <code>.env.example</code> แล้วใส่ <code>VITE_SUPABASE_URL</code> และ <code>VITE_SUPABASE_ANON_KEY</code></p>
      <p className="mt-2 text-sm text-muted">ดูขั้นตอนใน SETUP.md</p>
    </Card>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase!.auth.signInWithPassword({ email, password })
    if (error) setError('เข้าสู่ระบบไม่สำเร็จ: ' + error.message)
    setBusy(false)
  }

  return (
    <Card title="เข้าสู่ระบบ">
      <form onSubmit={submit} className="grid gap-3">
        <input className="rounded-lg border border-line px-3 py-2" type="email" placeholder="อีเมล" value={email} onChange={e => setEmail(e.target.value)} required />
        <input className="rounded-lg border border-line px-3 py-2" type="password" placeholder="รหัสผ่าน" value={password} onChange={e => setPassword(e.target.value)} required />
        <button disabled={busy} className="rounded-lg bg-brand px-4 py-2 font-semibold text-white disabled:opacity-60">{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
        {error && <p className="text-sm text-danger">{error}</p>}
        <p className="text-xs text-muted">บัญชีผู้ใช้สร้างโดยเจ้าของระบบใน Supabase (ยังไม่เปิดให้สมัครเอง)</p>
      </form>
    </Card>
  )
}

function MasterCheck({ session }: { session: Session }) {
  const [profile, setProfile] = useState<{ name: string; role: string } | null>(null)
  const [stations, setStations] = useState<Station[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [products, setProducts] = useState<ProductType[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    const db = supabase!
    Promise.all([
      db.from('profiles').select('name, role').eq('user_id', session.user.id).maybeSingle(),
      db.from('stations').select('code, name, is_draft').order('sort'),
      db.from('routes').select('code, name, route_stations(seq, stations(name))').order('code'),
      db.from('product_types').select('code, name, category, unit').order('sort'),
    ]).then(([p, s, r, pt]) => {
      const err = [p, s, r, pt].find(x => x.error)?.error
      if (err) setError(err.message)
      setProfile(p.data)
      setStations(s.data ?? [])
      setRoutes((r.data as unknown as Route[]) ?? [])
      setProducts(pt.data ?? [])
    })
  }, [session.user.id])

  return (
    <div className="grid gap-4">
      <Card title="การเชื่อมต่อ">
        <p>✓ เชื่อมต่อ Supabase แล้ว · ผู้ใช้ <b>{session.user.email}</b></p>
        <p>{profile ? <>บทบาท <b>{profile.role}</b> ({profile.name})</> : <span className="text-danger">ยังไม่มี profile ของผู้ใช้นี้ (ดู SETUP.md ขั้นตอนสร้างผู้ใช้)</span>}</p>
        {error && <p className="text-danger">ผิดพลาด: {error}</p>}
        <button className="mt-2 text-sm underline" onClick={() => supabase!.auth.signOut()}>ออกจากระบบ</button>
      </Card>
      <Card title={`สถานี (${stations.length})`}>
        <ul className="list-disc pl-5">{stations.map(s => <li key={s.code}>{s.name} <code className="text-xs">{s.code}</code>{s.is_draft && <span className="ml-2 text-xs text-warn">ร่าง</span>}</li>)}</ul>
      </Card>
      <Card title={`เส้นทางการผลิต (${routes.length})`}>
        <ul className="list-disc pl-5">{routes.map(r => <li key={r.code}><b>{r.name}</b>: {[...r.route_stations].sort((a, b) => a.seq - b.seq).map(x => x.stations?.name).join(' → ')}</li>)}</ul>
      </Card>
      <Card title={`ประเภทสินค้า (${products.length})`}>
        <ul className="columns-1 pl-5 sm:columns-2">{products.map(p => <li key={p.code} className="list-disc">{p.name} <span className="text-xs text-muted">({p.unit})</span></li>)}</ul>
      </Card>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line/80 bg-white p-5 shadow-card">
      <h2 className="mb-2 font-semibold">{title}</h2>
      {children}
    </section>
  )
}
