import { useEffect } from 'react'

type Sentinel = { release: () => Promise<void> }
type WakeLockApi = { request: (type: 'screen') => Promise<Sentinel> }
type VisibilityDoc = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>

// เบราว์เซอร์ปล่อยล็อกเองทุกครั้งที่สลับแอป/ปิดจอ · ขอใหม่เมื่อกลับมาเห็นหน้า
export function keepScreenOn(api: WakeLockApi | undefined, doc: VisibilityDoc): () => void {
  if (!api) return () => {}
  let sentinel: Sentinel | null = null
  let stopped = false

  const request = async () => {
    if (stopped || doc.visibilityState !== 'visible') return
    try {
      const next = await api.request('screen')
      if (stopped) void next.release().catch(() => {})
      else sentinel = next
    } catch {
      sentinel = null
    }
  }
  const onVisibility = () => { void request() }

  doc.addEventListener('visibilitychange', onVisibility)
  void request()
  return () => {
    stopped = true
    doc.removeEventListener('visibilitychange', onVisibility)
    void sentinel?.release().catch(() => {})
    sentinel = null
  }
}

export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    const api = 'wakeLock' in navigator ? navigator.wakeLock : undefined
    return keepScreenOn(api, document)
  }, [active])
}
