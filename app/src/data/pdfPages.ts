export type PdfDoc = { pages: number; render: (page: number) => Promise<Blob | null>; close: () => void }

export const PDF_RENDER_LONG_SIDE = 2400

export const isPdfFile = (file: { name: string; type: string }) => file.type === 'application/pdf' || (!file.type && /\.pdf$/i.test(file.name))

export function renderScale(width: number, height: number, longSide = PDF_RENDER_LONG_SIDE): number {
  const side = Math.max(width, height)
  return side > 0 ? Math.min(6, longSide / side) : 1
}

// pdf.js ใหญ่ราว 1.7 MB จึงโหลดเฉพาะตอนเปิด PDF ในหน้าตัดลายเซ็น ไม่ให้เครื่องหน้างานโหลดทุกครั้ง
export async function openPdf(data: ArrayBuffer): Promise<{ ok: true; doc: PdfDoc } | { ok: false; reason: string }> {
  try {
    const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    const task = pdfjs.getDocument({ data, disableWorkerRendering: true })
    const pdf = await task.promise
    const render = async (n: number): Promise<Blob | null> => {
      const page = await pdf.getPage(Math.min(Math.max(1, n), pdf.numPages))
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: renderScale(base.width, base.height) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, viewport, background: '#ffffff' }).promise
      page.cleanup()
      return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/png'))
    }
    return { ok: true, doc: { pages: pdf.numPages, render, close: () => { void task.destroy() } } }
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    if (name === 'PasswordException') return { ok: false, reason: 'PDF นี้ตั้งรหัสผ่านไว้ เปิดไม่ได้ · แคปหน้าจอหน้าที่มีลายเซ็นแทน' }
    if (name === 'InvalidPDFException') return { ok: false, reason: 'ไฟล์นี้ไม่ใช่ PDF หรือไฟล์เสีย · เลือกไฟล์ใหม่' }
    return { ok: false, reason: 'เปิด PDF ไม่ได้ (เน็ตหลุดหรือเครื่องไม่รองรับ) · ลองอีกครั้ง หรือแคปหน้าจอหน้าที่มีลายเซ็นแทน' }
  }
}
