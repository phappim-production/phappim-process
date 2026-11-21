import { MY } from './my.ts'

export type Lang = 'th' | 'my'
export type When = { at: Date; time?: boolean }
export type Word = { th: string; vars?: Vars }
export type Vars = Record<string, string | number | When | Word | Word[]>

export const word = (th: string, vars?: Vars): Word => ({ th, vars })

function when(lang: Lang, { at, time }: When): string {
  if (Number.isNaN(at.getTime())) return ''
  const clock = time ? { hour: '2-digit', minute: '2-digit' } as const : {}
  // พม่าใช้ วัน/เดือน ตัวเลข ให้ตรงกับป้ายกำหนดส่งบนจอ
  return lang === 'my'
    ? at.toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'numeric', ...clock }).replace(',', '')
    : at.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', ...clock })
}

export function translate(lang: Lang, th: string, vars?: Vars): string {
  // ชื่อสถานีที่เว้นวรรคไว้ต่อคำไทย ("QC + Packing ") ยังต้องหาคำแปลเจอ
  const text = lang === 'my' ? MY[th] ?? MY[th.trim()] ?? th : th
  return text.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars?.[key]
    if (v === undefined) return ''
    if (Array.isArray(v)) return v.map(x => translate(lang, x.th, x.vars)).join(' · ')
    if (typeof v !== 'object') return String(v)
    return 'at' in v ? when(lang, v) : translate(lang, v.th, v.vars)
  })
}

export const thai = (w: Word) => translate('th', w.th, w.vars)

export const hasBurmese = (th: string) => th in MY || th.trim() in MY
