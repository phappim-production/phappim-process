// กดซ้ำ / เน็ตช้าแล้วกดใหม่ส่งรหัสเดิม → ฐานข้อมูลไม่บันทึกซ้ำ · บันทึกสำเร็จแล้วค่อยขอรหัสใหม่
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export type RequestSlot = { idFor: (content: string) => string; clear: () => void }

// รหัสเดิมใช้กับการส่งซ้ำของเนื้อหาเดิมเท่านั้น · ครั้งก่อนหมดเวลาแต่บันทึกแล้ว ถ้าแก้ค่าแล้วส่งรหัสเดิม ฐานข้อมูลจะทิ้งค่าที่แก้
export function requestSlot(make: () => string = newRequestId): RequestSlot {
  let content: string | null = null
  let id = ''
  return {
    idFor(next) {
      if (next !== content) { content = next; id = make() }
      return id
    },
    clear() { content = null },
  }
}
