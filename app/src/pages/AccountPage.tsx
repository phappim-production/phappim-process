import { ChangePasswordForm, SignOutButton } from '../auth/EmployeeLogin'
import { ROLE_CAN, type EmployeeRole } from '../auth/access'
import { Card, CardHeader } from '../components/ui'
import { InstallApp } from '../components/InstallApp'
import { IconAlert, IconBook, IconCheck, IconLock, IconLogOut } from '../components/icons'
import { Tr } from '../i18n/Tr'

// เครื่องหน้างานใช้ร่วมกันได้ จึงให้ชื่อผู้ใช้และปุ่มออกจากระบบเด่นที่สุด
export default function AccountPage({ name, role, roleLabel, email }: { name: string; role: EmployeeRole; roleLabel: string; email?: string }) {
  const initial = [...name.trim()][0] ?? '?'
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 p-4 sm:p-6 lg:grid-cols-2 lg:items-start">
      <Card className="overflow-hidden">
        <div className="flex items-center gap-4 bg-brand px-5 py-6 text-white">
          <span aria-hidden className="grid size-16 shrink-0 place-items-center rounded-full bg-gold text-3xl font-bold text-brand-700">{initial}</span>
          <div className="min-w-0">
            <h1 className="break-words text-2xl leading-tight font-bold">{name}</h1>
            <p className="mt-1 inline-block rounded-full bg-white/15 px-3 py-0.5 text-base font-semibold">{roleLabel}</p>
            {email && <p className="mt-1 break-all text-sm text-white/80">{email}</p>}
          </div>
        </div>

        <div className="grid gap-4 p-5">
          {(role === 'staff' || role === 'qc') && (
            <a href="#/words" className="inline-flex min-h-14 items-center gap-3 rounded-xl border-2 border-brand bg-brand-soft px-4 font-semibold text-brand hover:bg-brand hover:text-white">
              <IconBook className="size-6 shrink-0" /><Tr th="คำศัพท์หน้างาน ไทย – พม่า" />
            </a>
          )}
          <section aria-labelledby="role-can">
            <h2 id="role-can" className="mb-2 font-semibold text-muted"><Tr th="บัญชีนี้ทำอะไรได้" /></h2>
            <ul className="grid gap-2">
              {ROLE_CAN[role].map(t => (
                <li key={t} className="flex items-start gap-2">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-ok-soft text-ok"><IconCheck className="size-4" /></span>
                  <span><Tr th={t} /></span>
                </li>
              ))}
            </ul>
          </section>

          <div className="grid gap-2 border-t border-line pt-4">
            <SignOutButton className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-danger/40 bg-card px-5 font-semibold text-danger hover:bg-danger-soft disabled:opacity-60">
              <IconLogOut className="size-5" /><Tr th="ออกจากระบบ" />
            </SignOutButton>
            <p className="flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
              <IconAlert className="mt-0.5 size-4 shrink-0" />
              <Tr th="ใช้เครื่องร่วมกับคนอื่น ให้กดออกจากระบบทุกครั้งก่อนส่งเครื่องต่อ · ทุกการกดในระบบบันทึกชื่อผู้กด" />
            </p>
          </div>
        </div>
      </Card>

      <InstallApp />

      <Card>
        <CardHeader icon={IconLock} title="เปลี่ยนรหัสผ่าน" sub="รหัสที่ได้จากเจ้าของระบบ ควรเปลี่ยนเป็นรหัสของตัวเอง" />
        <div className="grid gap-4 px-5 pb-5">
          <ul className="grid gap-1 rounded-xl bg-paper px-4 py-3 text-sm text-muted">
            <li>• อย่างน้อย 8 ตัว ยาวกว่านี้ยิ่งปลอดภัย</li>
            <li>• อย่าใช้รหัสเดียวกับคนอื่น และอย่าบอกรหัสให้เพื่อนกดแทน</li>
            <li>• ลืมรหัส ให้แจ้งเจ้าของระบบตั้งใหม่ให้</li>
          </ul>
          <ChangePasswordForm />
        </div>
      </Card>
    </div>
  )
}
