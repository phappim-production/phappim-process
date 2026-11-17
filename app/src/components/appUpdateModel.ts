// กฎตัดสินใจโหลดหน้าเว็บรุ่นใหม่อัตโนมัติ (G5):
// โหลดเองเมื่อมีรุ่นใหม่ค้าง >= 2 นาที และผู้ใช้ไม่ได้เปิดฟอร์ม/พิมพ์ข้อมูลอยู่
export const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000
export const AUTO_UPDATE_DELAY_MS = 2 * 60 * 1000
export const AUTO_UPDATE_POLL_MS = 15 * 1000

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export function isEditingElement(tagName: string | null | undefined, isContentEditable = false): boolean {
  if (isContentEditable) return true
  if (!tagName) return false
  return EDITABLE_TAGS.has(tagName.toUpperCase())
}

export type AutoUpdateState = {
  needRefresh: boolean
  elapsedMs: number
  hasOpenDialog: boolean
  isEditing: boolean
  updating?: boolean
}

export function canAutoUpdate(state: AutoUpdateState): boolean {
  if (!state.needRefresh || state.updating) return false
  if (state.elapsedMs < AUTO_UPDATE_DELAY_MS) return false
  if (state.hasOpenDialog || state.isEditing) return false
  return true
}

export function canCheckForUpdate(online: boolean, visibilityState: string): boolean {
  if (!online) return false
  return visibilityState === 'visible'
}
