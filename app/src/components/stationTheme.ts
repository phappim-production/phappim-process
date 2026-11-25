import type { StationCode } from '../proto/model'

export type StationPatternKind = 'halftone' | 'heat' | 'cut' | 'zigzag' | 'stitch' | 'tape' | 'corrugated'

export type StationTheme = {
  solid: string
  soft: string
  text: string
  border: string
  pattern: StationPatternKind
}

// Tailwind อ่านชื่อคลาสจากโค้ดตรงๆ จึงต้องเขียนเต็มทุกคลาส ห้ามประกอบจากตัวแปร
export const STATION_THEME: Record<StationCode, StationTheme> = {
  print: { solid: 'bg-st-print', soft: 'bg-st-print-soft', text: 'text-st-print', border: 'border-st-print', pattern: 'halftone' },
  press: { solid: 'bg-st-press', soft: 'bg-st-press-soft', text: 'text-st-press', border: 'border-st-press', pattern: 'heat' },
  dtf_press: { solid: 'bg-st-press', soft: 'bg-st-press-soft', text: 'text-st-press', border: 'border-st-press', pattern: 'heat' },
  cut: { solid: 'bg-st-cut', soft: 'bg-st-cut-soft', text: 'text-st-cut', border: 'border-st-cut', pattern: 'cut' },
  emb: { solid: 'bg-st-emb', soft: 'bg-st-emb-soft', text: 'text-st-emb', border: 'border-st-emb', pattern: 'zigzag' },
  sew: { solid: 'bg-st-sew', soft: 'bg-st-sew-soft', text: 'text-st-sew', border: 'border-st-sew', pattern: 'stitch' },
  qc_pack: { solid: 'bg-st-qc', soft: 'bg-st-qc-soft', text: 'text-st-qc', border: 'border-st-qc', pattern: 'tape' },
  outside: { solid: 'bg-st-outside', soft: 'bg-st-outside-soft', text: 'text-st-outside', border: 'border-st-outside', pattern: 'corrugated' },
}

export function stationTheme(station: StationCode | null | undefined): StationTheme | null {
  return station ? STATION_THEME[station] ?? null : null
}
