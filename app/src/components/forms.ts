import type { FormEvent } from 'react'

/** ช่องที่ต้องกรอก: ข้อความเตือนของเบราว์เซอร์เป็นภาษาของเครื่อง (มักเป็นอังกฤษ) จึงใส่ข้อความไทยเอง */
export function requiredThai(message: string) {
  type Field = HTMLInputElement | HTMLTextAreaElement
  return {
    required: true,
    onInvalid: (e: FormEvent<Field>) => e.currentTarget.setCustomValidity(message),
    onInput: (e: FormEvent<Field>) => e.currentTarget.setCustomValidity(''),
  }
}
