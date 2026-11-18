import { secondaryBtn } from './Dialog'

// ปุ่มเลือกไฟล์ของเบราว์เซอร์แสดงภาษาของเครื่อง (มักเป็นอังกฤษ "Choose File") จึงซ่อนแล้วใช้ปุ่มภาษาไทยแทน
export function FilePick({ accept, chosen, label, onPick }: { accept: string; chosen: string; label?: string; onPick: (f: File | undefined) => void }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <span className={`${secondaryBtn} relative cursor-pointer focus-within:outline-2 focus-within:outline-brand`}>
        {chosen ? 'เปลี่ยนไฟล์' : 'เลือกไฟล์'}
        <input type="file" accept={accept} aria-label={label} className="absolute inset-0 cursor-pointer opacity-0" onChange={e => { onPick(e.target.files?.[0]); e.target.value = '' }} />
      </span>
      <span className={`min-w-0 break-all text-sm ${chosen ? 'text-ink' : 'text-muted'}`}>{chosen || 'ยังไม่ได้เลือกไฟล์'}</span>
    </span>
  )
}
