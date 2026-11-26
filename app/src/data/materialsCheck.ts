// ตรงกับ public.set_job_materials / add_material_photos / release_job ในฐานข้อมูล
export const MAX_MATERIAL_ITEMS = 30
export const MAX_MATERIAL_NAME = 80
export const MAX_MATERIAL_PHOTOS = 12

export type MaterialItem = { id: number; name: string; checked_at: string | null }
export type MaterialPhoto = { id: number; path: string }

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function withItem(names: readonly string[], typed: string): { ok: true; names: string[] } | { ok: false; reason: string } {
  const name = typed.trim().slice(0, MAX_MATERIAL_NAME)
  if (!name) return { ok: false, reason: 'พิมพ์ชื่อวัตถุดิบก่อนกดเพิ่ม' }
  if (names.some(n => sameName(n, name))) return { ok: false, reason: `มี "${name}" ในรายการแล้ว` }
  if (names.length >= MAX_MATERIAL_ITEMS) return { ok: false, reason: `รายการวัตถุดิบไม่เกิน ${MAX_MATERIAL_ITEMS} รายการ · รวมของที่เป็นชุดเดียวกันไว้ในรายการเดียว` }
  return { ok: true, names: [...names, name] }
}

export const withoutItem = (names: readonly string[], name: string) => names.filter(n => n !== name)

export function releaseBlocker(items: readonly MaterialItem[], photos: number): string | null {
  if (!items.length) return 'เพิ่มรายการวัตถุดิบที่ต้องเช็คอย่างน้อย 1 รายการก่อนปล่อยเข้าไลน์'
  const left = items.filter(m => !m.checked_at).map(m => m.name)
  if (left.length) return `ยังไม่ได้ติ๊กวัตถุดิบ: ${left.join(', ')} · เช็คของให้ครบก่อนปล่อยเข้าไลน์`
  if (photos < 1) return 'ถ่ายรูปวัตถุดิบอย่างน้อย 1 รูปก่อนปล่อยเข้าไลน์'
  return null
}
