import { useState, type FormEvent, type ReactNode } from 'react'
import { Card } from '../components/ui'
import { supabase } from '../lib/supabase'

export const primaryButton = 'min-h-12 rounded-xl bg-brand px-4 py-2.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-60'
export const secondaryButton = 'min-h-12 rounded-xl border border-line px-4 py-2.5 font-semibold text-brand hover:bg-brand-soft disabled:opacity-60'
const inputClass = 'min-h-12 w-full rounded-xl border border-line bg-white px-3 text-ink focus-visible:outline-2 focus-visible:outline-brand'

export function AccountScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-8">
      <Card className="w-full max-w-sm p-6 sm:p-8">
        <img src="/logo.webp" alt="ภาพพิมพ์ 142" className="mb-5 h-11 rounded-lg" />
        <p className="mb-1 text-sm font-medium text-muted">ระบบติดตามการผลิต</p>
        <h1 className="mb-4 text-2xl font-bold text-brand">{title}</h1>
        {children}
      </Card>
    </main>
  )
}

export function SignOutButton() {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function signOut() {
    if (!supabase || busy) return
    setBusy(true)
    setFailed(false)
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      setFailed(Boolean(error))
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className={secondaryButton} disabled={busy} onClick={signOut}>
        {busy ? 'กำลังออกจากระบบ…' : 'ออกจากระบบ'}
      </button>
      {failed && <p role="alert" className="mt-2 text-danger">ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง</p>}
    </>
  )
}

export default function EmployeeLogin() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || busy) return
    const values = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: String(values.get('email')).trim(),
        password: String(values.get('password')),
      })
      if (authError?.code === 'invalid_credentials') {
        setError('อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบแล้วลองอีกครั้ง')
      } else if (authError) {
        setError('เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่หรือติดต่อเจ้าของระบบ')
      }
    } catch {
      setError('เชื่อมต่อระบบไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AccountScreen title="เข้าสู่ระบบพนักงาน">
      <form onSubmit={submit} className="grid gap-4" aria-busy={busy}>
        <label className="grid gap-1 font-medium">
          อีเมล
          <input className={inputClass} type="email" name="email" autoComplete="username" required />
        </label>
        <label className="grid gap-1 font-medium">
          รหัสผ่าน
          <input className={inputClass} type="password" name="password" autoComplete="current-password" required />
        </label>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
        </button>
        <p className="text-sm text-muted">หากยังไม่มีบัญชีหรือลืมรหัสผ่าน ให้ติดต่อเจ้าของระบบ</p>
      </form>
    </AccountScreen>
  )
}
