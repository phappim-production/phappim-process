export const SWIPE_THRESHOLD = 50
const EDGE_RESISTANCE = 0.35
const SPLIT_MIN = 4
const SPLIT_MAX = 96

export function clampIndex(i: number, count: number): number {
  if (count <= 0) return 0
  return Math.max(0, Math.min(count - 1, Math.trunc(i)))
}

// ลากเกินรูปแรก/รูปสุดท้ายให้หนืด ผู้ใช้รู้ว่าไม่มีรูปต่อแล้ว
export function dragOffset(index: number, count: number, dx: number): number {
  const atStart = index <= 0 && dx > 0
  const atEnd = index >= count - 1 && dx < 0
  return atStart || atEnd ? dx * EDGE_RESISTANCE : dx
}

export function swipeTarget(index: number, count: number, dx: number, threshold = SWIPE_THRESHOLD): number {
  if (dx <= -threshold) return clampIndex(index + 1, count)
  if (dx >= threshold) return clampIndex(index - 1, count)
  return clampIndex(index, count)
}

export function splitFromPointer(clientX: number, left: number, width: number): number {
  if (width <= 0) return 50
  const pct = Math.round(((clientX - left) / width) * 100)
  return Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, pct))
}

export function zoomOrigin(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): string {
  const x = rect.width > 0 ? Math.round(((clientX - rect.left) / rect.width) * 100) : 50
  const y = rect.height > 0 ? Math.round(((clientY - rect.top) / rect.height) * 100) : 50
  const clamp = (v: number) => Math.max(0, Math.min(100, v))
  return `${clamp(x)}% ${clamp(y)}%`
}

export type ApproveBlock = 'loading' | 'no_photos' | 'broken' | null

// แอดมินต้องเห็นรูปครบทุกรูปก่อนกดผ่าน · รูปที่เปิดไม่ได้ = ยังไม่ได้ตรวจ
export function approveBlock(state: { loading: boolean; count: number; broken: number }): ApproveBlock {
  if (state.loading) return 'loading'
  if (state.count === 0) return 'no_photos'
  if (state.broken > 0) return 'broken'
  return null
}
