import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Card } from '../components/ui'
import { supabase } from '../lib/supabase'
import { MIN_PASSWORD_LENGTH, newPasswordProblem, passwordChangeErrorMessage, signInErrorMessage } from './messages'

export const primaryButton = 'min-h-12 rounded-xl bg-brand px-4 py-2.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-60'
export const secondaryButton = 'min-h-12 rounded-xl border border-line px-4 py-2.5 font-semibold text-brand hover:bg-brand-soft disabled:opacity-60'
const inputClass = 'min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base text-ink focus-visible:outline-2 focus-visible:outline-brand'

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

// แท็บเล็ตหน้างานพิมพ์ผิดง่าย ให้กดดูรหัสที่พิมพ์ได้
function PasswordField({ label, name, autoComplete, minLength }: {
  label: string
  name: string
  autoComplete: 'current-password' | 'new-password'
  minLength?: number
}) {
  const [shown, setShown] = useState(false)
  const id = useId()
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="font-medium">{label}</label>
      <div className="flex gap-2">
        <input id={id} className={inputClass} type={shown ? 'text' : 'password'} name={name}
          autoComplete={autoComplete} minLength={minLength} required />
        <button type="button" className="min-h-12 shrink-0 rounded-xl border border-line px-3 text-sm font-semibold text-brand hover:bg-brand-soft"
          aria-controls={id} aria-pressed={shown} onClick={() => setShown(value => !value)}>
          {shown ? 'ซ่อน' : 'แสดง'}
        </button>
      </div>
    </div>
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

// เจ้าของระบบตั้งรหัสแรกให้ พนักงานควรเปลี่ยนเองเพื่อไม่ให้คนอื่นกดแทนในชื่อตัวเอง (ทุกการกดบันทึกชื่อผู้กด)
export function ChangePasswordForm() {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || busy) return
    const form = event.currentTarget
    const values = new FormData(form)
    const password = String(values.get('new-password') ?? '')
    const problem = newPasswordProblem(password, String(values.get('confirm-password') ?? ''))
    if (problem) {
      setMessage({ ok: false, text: problem })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      const failure = passwordChangeErrorMessage(error)
      if (failure) setMessage({ ok: false, text: failure })
      else {
        form.reset()
        setMessage({ ok: true, text: 'เปลี่ยนรหัสผ่านแล้ว ครั้งหน้าให้ใช้รหัสผ่านใหม่' })
      }
    } catch {
      setMessage({ ok: false, text: 'เชื่อมต่อระบบไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" aria-busy={busy}>
      <PasswordField label={`รหัสผ่านใหม่ (อย่างน้อย ${MIN_PASSWORD_LENGTH} ตัว)`} name="new-password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} />
      <PasswordField label="พิมพ์รหัสผ่านใหม่อีกครั้ง" name="confirm-password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} />
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'text-ok' : 'text-danger'}>{message.text}</p>
      )}
      <button type="submit" disabled={busy} className={primaryButton}>
        {busy ? 'กำลังบันทึก…' : 'บันทึกรหัสผ่านใหม่'}
      </button>
    </form>
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
        email: String(values.get('email') ?? '').trim(),
        password: String(values.get('password') ?? ''),
      })
      // สำเร็จแล้ว App จะเปลี่ยนหน้าเองจาก onAuthStateChange
      setError(signInErrorMessage(authError) ?? '')
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
          <input className={inputClass} type="email" name="email" autoComplete="username" inputMode="email"
            autoCapitalize="none" spellCheck={false} required />
        </label>
        <PasswordField label="รหัสผ่าน" name="password" autoComplete="current-password" />
        {error && <p role="alert" className="text-danger">{error}</p>}
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
        </button>
        <p className="text-sm text-muted">หากยังไม่มีบัญชีหรือลืมรหัสผ่าน ให้ติดต่อเจ้าของระบบ</p>
      </form>
    </AccountScreen>
  )
}
