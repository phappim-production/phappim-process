import { supabase } from '../lib/supabase'
import { thaiError } from './live'
import { formDataFromJob } from './confirmationDrafts'
import { specMockups } from './jobMockups'
import { signedUrls } from './mockups'

export async function loadFormData(jobId: string): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; reason: string }> {
  if (!supabase) return { ok: false, reason: 'ยังไม่ได้ตั้งค่า Supabase' }
  const { data, error } = await supabase.from('jobs').select('spec, mockup_path').eq('id', jobId).single()
  if (error) return { ok: false, reason: thaiError(error.message) }
  const row = data as { spec: unknown; mockup_path: string | null }
  // ลิงก์รูปใช้ได้ 1 ชั่วโมง พอสำหรับแก้แล้วพิมพ์ PDF
  const form = formDataFromJob(row.spec, row.mockup_path, await signedUrls(specMockups(row.spec, row.mockup_path).map(m => m.path)))
  return form ? { ok: true, data: form } : { ok: false, reason: 'งานนี้รับเข้าโดยไม่ได้ใช้ฟอร์มใบยืนยัน จึงไม่มีข้อมูลให้เปิดในฟอร์ม' }
}
