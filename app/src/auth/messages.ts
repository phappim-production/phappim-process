// แยกเป็น pure function เพื่อทดสอบได้โดยไม่ต้องต่อ Supabase

export type AuthFailure = { code?: string; status?: number; name?: string } | null | undefined

export const MIN_PASSWORD_LENGTH = 8

// status 0 / AuthRetryableFetchError = ส่งคำขอไม่ถึงเซิร์ฟเวอร์ (เน็ตหลุด) ไม่ใช่รหัสผิด
function isNetworkFailure(error: NonNullable<AuthFailure>): boolean {
  return error.status === 0 || error.name === 'AuthRetryableFetchError'
}

export function signInErrorMessage(error: AuthFailure): string | null {
  if (!error) return null
  if (isNetworkFailure(error)) return 'เชื่อมต่อระบบไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่'
  switch (error.code) {
    case 'invalid_credentials':
      return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบแล้วลองอีกครั้ง'
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 5 นาทีแล้วลองใหม่'
    case 'email_not_confirmed':
      return 'บัญชีนี้ยังไม่ได้ยืนยัน กรุณาติดต่อเจ้าของระบบ'
    case 'user_banned':
      return 'บัญชีนี้ถูกระงับ กรุณาติดต่อเจ้าของระบบ'
    default:
      return 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่หรือติดต่อเจ้าของระบบ'
  }
}

export function newPasswordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `รหัสผ่านใหม่ต้องยาวอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`
  if (password.trim() !== password) return 'รหัสผ่านใหม่ต้องไม่ขึ้นต้นหรือลงท้ายด้วยช่องว่าง'
  if (password !== confirm) return 'รหัสผ่านใหม่ทั้ง 2 ช่องไม่ตรงกัน กรุณาพิมพ์ใหม่'
  return null
}

export function passwordChangeErrorMessage(error: AuthFailure): string | null {
  if (!error) return null
  if (isNetworkFailure(error)) return 'เชื่อมต่อระบบไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่'
  switch (error.code) {
    case 'same_password':
      return 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม'
    case 'weak_password':
      return 'รหัสผ่านใหม่ง่ายเกินไป กรุณาใช้ตัวอักษรผสมตัวเลขให้ยาวขึ้น'
    case 'reauthentication_needed':
    case 'session_not_found':
    case 'session_expired':
      return 'กรุณาออกจากระบบแล้วเข้าใหม่ก่อนเปลี่ยนรหัสผ่าน'
    case 'over_request_rate_limit':
      return 'ลองหลายครั้งเกินไป กรุณารอ 5 นาทีแล้วลองใหม่'
    default:
      return 'เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาลองใหม่หรือติดต่อเจ้าของระบบ'
  }
}
