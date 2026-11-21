// ฟอนต์เว็บโหลดเมื่อมีตัวอักษรใช้จริง · ถ้าพิมพ์ก่อนโหลดเสร็จ PDF จะออกเป็นฟอนต์สำรอง
export async function printWhenFontsReady(timeoutMs = 4000) {
  if (typeof document !== 'undefined' && document.fonts) {
    const loads = ['400', '600', '700'].map(w => document.fonts.load(`${w} 12px "Noto Sans Thai"`, 'ใบงาน'))
    await Promise.race([Promise.all(loads).catch(() => undefined), new Promise(r => setTimeout(r, timeoutMs))])
  }
  window.print()
}
