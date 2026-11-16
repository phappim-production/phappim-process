import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isConfigured, supabase } from './lib/supabase'

type Station = { code: string; name: string; is_draft: boolean }
type Route = { code: string; name: string; route_stations: { seq: number; stations: { name: string } | null }[] }
type ProductType = { code: string; name: string; category: string; unit: string }

// เฟส 0: หน้าตรวจการเชื่อมต่อ + ข้อมูลตั้งค่า (master) · หน้าจอจริงเริ่มในเฟส 1–2
export default function App() {
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  return (
    <div className="min-h-screen bg-[#f4f5f2] text-[#1d2420]">
      <header className="flex items-center gap-3 border-b border-[#dfe3dd] bg-white px-4 py-3">
        <img src="/logo.webp" alt="ภาพพิมพ์ 142" className="h-9" />
        <h1 className="text-lg font-semibold">ระบบติดตามการผลิต</h1>
        <span className="ml-auto rounded-full bg-[#e3efec] px-3 py-1 text-xs font-semibold text-[#0f4a42]">เฟส 0 · ทดสอบการเชื่อมต่อ</span>
      </header>
      <main className="mx-auto max-w-3xl p-4">
        {!isConfigured ? <NotConfigured /> : !session ? <Login /> : <MasterCheck session={session} />}
      </main>
    </div>
  )
}

function NotConfigured() {
  return (
    <Card title="ยังไม่ได้ตั้งค่า Supabase">
      <p>สร้างไฟล์ <code>app/.env.local</code> จาก <code>.env.example</code> แล้วใส่ <code>VITE_SUPABASE_URL</code> และ <code>VITE_SUPABASE_ANON_KEY</code></p>
      <p className="mt-2 text-sm text-[#5f6a63]">ดูขั้นตอนใน SETUP.md</p>
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
        <input className="rounded-lg border border-[#dfe3dd] px-3 py-2" type="email" placeholder="อีเมล" value={email} onChange={e => setEmail(e.target.value)} required />
        <input className="rounded-lg border border-[#dfe3dd] px-3 py-2" type="password" placeholder="รหัสผ่าน" value={password} onChange={e => setPassword(e.target.value)} required />
        <button disabled={busy} className="rounded-lg bg-[#0f4a42] px-4 py-2 font-semibold text-white disabled:opacity-60">{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
        {error && <p className="text-sm text-[#b4231b]">{error}</p>}
        <p className="text-xs text-[#5f6a63]">บัญชีผู้ใช้สร้างโดยเจ้าของระบบใน Supabase (ยังไม่เปิดให้สมัครเอง)</p>
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
        <p>{profile ? <>บทบาท <b>{profile.role}</b> ({profile.name})</> : <span className="text-[#b4231b]">ยังไม่มี profile ของผู้ใช้นี้ (ดู SETUP.md ขั้นตอนสร้างผู้ใช้)</span>}</p>
        {error && <p className="text-[#b4231b]">ผิดพลาด: {error}</p>}
        <button className="mt-2 text-sm underline" onClick={() => supabase!.auth.signOut()}>ออกจากระบบ</button>
      </Card>
      <Card title={`สถานี (${stations.length})`}>
        <ul className="list-disc pl-5">{stations.map(s => <li key={s.code}>{s.name} <code className="text-xs">{s.code}</code>{s.is_draft && <span className="ml-2 text-xs text-[#c08a3e]">ร่าง</span>}</li>)}</ul>
      </Card>
      <Card title={`เส้นทางการผลิต (${routes.length})`}>
        <ul className="list-disc pl-5">{routes.map(r => <li key={r.code}><b>{r.name}</b>: {[...r.route_stations].sort((a, b) => a.seq - b.seq).map(x => x.stations?.name).join(' → ')}</li>)}</ul>
      </Card>
      <Card title={`ประเภทสินค้า (${products.length})`}>
        <ul className="columns-1 pl-5 sm:columns-2">{products.map(p => <li key={p.code} className="list-disc">{p.name} <span className="text-xs text-[#5f6a63]">({p.unit})</span></li>)}</ul>
      </Card>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#dfe3dd] bg-white p-4">
      <h2 className="mb-2 font-semibold">{title}</h2>
      {children}
    </section>
  )
}
