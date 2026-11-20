export const STALE_RELOAD_GUARD_MS = 60 * 1000
const STALE_RELOAD_KEY = 'pp142-stale-build-reload'

// ข้อความต่างกันตามเบราว์เซอร์: Chrome / Safari / Firefox
const STALE_BUILD_MESSAGE = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError/i

export function isStaleBuildError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : typeof error === 'string' ? error : ''
  return STALE_BUILD_MESSAGE.test(message)
}

export function canReloadForStaleBuild(lastReloadAt: number | null, now: number): boolean {
  return lastReloadAt === null || !Number.isFinite(lastReloadAt) || now - lastReloadAt >= STALE_RELOAD_GUARD_MS
}

type ReloadDeps = { storage: Pick<Storage, 'getItem' | 'setItem'> | null; now: number; reload: () => void }

// โหลดซ้ำได้ครั้งเดียวต่อนาที กันวนไม่จบถ้าไฟล์หายจริง · เบราว์เซอร์ที่ปิด storage ไม่โหลดเอง (กันวน)
export function reloadForStaleBuild({ storage, now, reload }: ReloadDeps): boolean {
  if (!storage) return false
  try {
    const last = storage.getItem(STALE_RELOAD_KEY)
    if (!canReloadForStaleBuild(last === null ? null : Number(last), now)) return false
    storage.setItem(STALE_RELOAD_KEY, String(now))
  } catch {
    return false
  }
  reload()
  return true
}

export function browserReloadDeps(): ReloadDeps {
  let storage: Storage | null = null
  try {
    storage = window.sessionStorage
  } catch {
    storage = null
  }
  return { storage, now: Date.now(), reload: () => window.location.reload() }
}
