import { useCallback, useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import {
  AUTO_UPDATE_POLL_MS,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_STALL_MS,
  canAutoUpdate,
  canCheckForUpdate,
  isEditingElement,
} from './appUpdateModel'

// ไม่ทำงานตอน dev
export function AppUpdate() {
  if (import.meta.env.DEV) return null
  return <AppUpdateLive />
}

function AppUpdateLive() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>()
  const [updating, setUpdating] = useState(false)
  const detectedAtRef = useRef<number | null>(null)

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, r) {
      if (r) setRegistration(r)
    },
  })

  const reloadNow = useCallback(async () => {
    if (updating) return
    setUpdating(true)
    // บางครั้งรุ่นใหม่ค้างที่ waiting ไม่เข้าคุมแท็บ ปุ่มจะหมุนตลอด → สั่งข้ามรอเองแล้วโหลดหน้าใหม่
    const stall = window.setTimeout(() => {
      registration?.waiting?.postMessage({ type: 'SKIP_WAITING' })
      window.location.reload()
    }, UPDATE_STALL_MS)
    try {
      await updateServiceWorker(true)
    } catch {
      window.clearTimeout(stall)
      setUpdating(false)
    }
  }, [registration, updateServiceWorker, updating])

  // ตรวจหารุ่นใหม่ทุก 10 นาที และทุกครั้งที่กลับมาที่แท็บ (ข้ามเงียบๆ เมื่อไม่มีเน็ต)
  useEffect(() => {
    if (!registration) return
    const check = () => {
      if (!canCheckForUpdate(navigator.onLine, document.visibilityState)) return
      void registration.update().catch(() => {})
    }
    const timer = window.setInterval(check, UPDATE_CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
      window.removeEventListener('online', check)
    }
  }, [registration])

  // ถ้ามีรุ่นใหม่ค้างเกิน 2 นาที และไม่ได้เปิดฟอร์มหรือพิมพ์อยู่ → โหลดใหม่อัตโนมัติ
  useEffect(() => {
    if (!needRefresh) {
      detectedAtRef.current = null
      return
    }
    detectedAtRef.current ??= Date.now()
    const tryAuto = () => {
      const since = detectedAtRef.current
      if (since === null) return
      const active = document.activeElement as HTMLElement | null
      const hasOpenDialog = document.querySelector('[role=dialog], dialog[open]') !== null
      const isEditing = isEditingElement(active?.tagName, active?.isContentEditable)
      if (canAutoUpdate({ needRefresh, elapsedMs: Date.now() - since, hasOpenDialog, isEditing, updating })) {
        void reloadNow()
      }
    }
    const timer = window.setInterval(tryAuto, AUTO_UPDATE_POLL_MS)
    document.addEventListener('focusout', tryAuto)
    document.addEventListener('visibilitychange', tryAuto)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('focusout', tryAuto)
      document.removeEventListener('visibilitychange', tryAuto)
    }
  }, [needRefresh, updating, reloadNow])

  if (!needRefresh) return null

  return (
    <aside aria-live="polite" className="shrink-0 border-t border-white/20 bg-brand px-4 py-2 text-white">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3">
        <p className="text-base font-medium">มีระบบรุ่นใหม่ · กดเพื่อโหลด</p>
        <button
          type="button"
          disabled={updating}
          onClick={() => void reloadNow()}
          className="min-h-12 shrink-0 rounded-xl bg-gold px-4 py-2 text-base font-bold text-brand-700 transition hover:opacity-90 disabled:opacity-60"
        >
          {updating ? 'กำลังโหลดรุ่นใหม่…' : 'โหลดรุ่นใหม่'}
        </button>
      </div>
    </aside>
  )
}
