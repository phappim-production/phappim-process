import { useState } from 'react'
import { primaryButton } from '../auth/EmployeeLogin'
import { Tr } from '../i18n/Tr'
import { ANDROID_STEPS, IOS_STEPS, externalBrowserUrl, inAppBrowser, isIos, promptInstall, useInstallMode } from '../lib/install'
import { Card, CardHeader } from './ui'
import { IconCheck, IconDownload, IconExternal } from './icons'

export function InstallApp() {
  const mode = useInstallMode()
  const [busy, setBusy] = useState(false)
  if (mode === 'installed' || mode === 'none') return null

  async function install() {
    setBusy(true)
    try { await promptInstall() } finally { setBusy(false) }
  }

  const steps = mode === 'ios' ? IOS_STEPS : mode === 'android' ? ANDROID_STEPS : null
  return (
    <Card aria-labelledby="install-app">
      <CardHeader icon={IconDownload} title={<span id="install-app"><Tr th="ติดตั้งแอปบนเครื่องนี้" /></span>}
        sub={<Tr th="เปิดจากไอคอนบนหน้าจอหลัก เต็มจอ ไม่ต้องพิมพ์ที่อยู่เว็บ" />} />
      <div className="grid gap-3 px-4 pb-5 sm:px-5">
        {mode === 'prompt' && (
          <button type="button" className={`inline-flex items-center justify-center gap-2 ${primaryButton}`} disabled={busy} onClick={install}>
            <IconDownload className="size-5" /><Tr th="ติดตั้งแอป" />
          </button>
        )}
        {mode === 'inapp' && <OpenInBrowser inCard />}
        {mode === 'done' && (
          <p role="status" className="flex items-start gap-2 rounded-xl bg-ok-soft px-3 py-2 text-ok">
            <IconCheck className="mt-0.5 size-5 shrink-0" /><Tr th="ติดตั้งแล้ว · ปิดหน้านี้ แล้วกดไอคอน PP142 บนหน้าจอหลัก" />
          </p>
        )}
        {steps && (
          <ol className="grid gap-2">
            {steps.map((step, i) => (
              <li key={step} className="flex items-start gap-3">
                <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-white">{i + 1}</span>
                <span className="min-w-0 pt-0.5"><Tr th={step} /></span>
              </li>
            ))}
          </ol>
        )}
        <p className="text-sm text-muted"><Tr th="หลังติดตั้ง เข้าระบบครั้งเดียว เครื่องจำไว้จนกว่าจะกดออกจากระบบ" /></p>
      </div>
    </Card>
  )
}

export function OpenInBrowser({ inCard = false }: { inCard?: boolean }) {
  const kind = inAppBrowser(navigator.userAgent)
  if (!kind) return null
  const browser = isIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints) ? 'Safari' : 'Chrome'
  return (
    <div role="note" className={`grid gap-3 rounded-xl border border-warn/40 bg-warn-soft p-3 text-ink ${inCard ? '' : 'mb-4'}`}>
      <p className="font-semibold text-warn">
        <Tr th={kind === 'line' ? 'เปิดอยู่ใน LINE · ติดตั้งแอปไม่ได้ ให้เปิดในเบราว์เซอร์ก่อน' : 'เปิดอยู่ในแอปแชต · ติดตั้งแอปไม่ได้ ให้เปิดในเบราว์เซอร์ก่อน'} />
      </p>
      {kind === 'line' ? (
        <a href={externalBrowserUrl(location.href)} className={`inline-flex items-center justify-center gap-2 ${primaryButton}`}>
          <IconExternal className="size-5" /><Tr th={browser === 'Safari' ? 'เปิดใน Safari' : 'เปิดใน Chrome'} />
        </a>
      ) : (
        <p><Tr th="กด ⋮ หรือ ⋯ มุมขวาบน แล้วเลือก เปิดในเบราว์เซอร์" /></p>
      )}
    </div>
  )
}
