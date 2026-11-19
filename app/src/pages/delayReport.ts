export const DELAY_REPORT_ID = 'delay-report'

// รายละเอียดงานโหลดทีละส่วน (รูป · PDF) ดันฟอร์มลง จึงรอให้ฟอร์มขึ้นแล้วเลื่อนซ้ำจนตำแหน่งนิ่ง (ไม่เกิน 4 วิ)
export function scrollToDelayReport() {
  const until = Date.now() + 4000
  let lastTop: number | null = null
  const tick = () => {
    const el = document.getElementById(DELAY_REPORT_ID)
    if (el) {
      el.scrollIntoView({ block: 'start' })
      const top = Math.round(el.getBoundingClientRect().top)
      if (top === lastTop) return
      lastTop = top
    }
    if (Date.now() < until) setTimeout(tick, 250)
  }
  setTimeout(tick, 150)
}
