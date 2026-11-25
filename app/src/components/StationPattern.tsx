import { useId, type ReactNode } from 'react'
import type { StationPatternKind } from './stationTheme'

const TILE: Record<StationPatternKind, { w: number; h: number; rotate?: number; art: ReactNode }> = {
  halftone: { w: 10, h: 10, art: <><circle cx="2.5" cy="2.5" r="1.9" fill="white" fillOpacity=".24" /><circle cx="7.5" cy="7.5" r="1.9" fill="white" fillOpacity=".24" /></> },
  heat: { w: 24, h: 11, art: <path d="M0 5.5C6 0 6 11 12 5.5S18 0 24 5.5" fill="none" stroke="white" strokeOpacity=".24" strokeWidth="1.4" /> },
  cut: { w: 18, h: 12, rotate: -24, art: <path d="M0 6h11" stroke="white" strokeOpacity=".26" strokeWidth="1.6" strokeLinecap="round" /> },
  zigzag: { w: 8, h: 12, art: <path d="M0 1.5 4 10.5 8 1.5" fill="none" stroke="white" strokeOpacity=".22" strokeWidth="1.2" strokeLinejoin="round" /> },
  stitch: { w: 16, h: 12, art: <path d="M1 3h6M9 9h6" stroke="white" strokeOpacity=".28" strokeWidth="1.6" strokeLinecap="round" /> },
  tape: { w: 14, h: 14, rotate: 45, art: <rect width="5" height="14" fill="white" fillOpacity=".1" /> },
  corrugated: { w: 12, h: 9, art: <path d="M0 7Q3 0 6 7T12 7" fill="none" stroke="white" strokeOpacity=".22" strokeWidth="1.3" /> },
}

// ลายจากงานจริงของแต่ละสถานี จางลงทางซ้ายเพื่อไม่ให้รบกวนชื่อสถานี
export function StationPattern({ kind, fadeFrom = 0.15 }: { kind: StationPatternKind; fadeFrom?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const t = TILE[kind]
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 size-full">
      <defs>
        <pattern id={`${id}p`} width={t.w} height={t.h} patternUnits="userSpaceOnUse" patternTransform={t.rotate ? `rotate(${t.rotate})` : undefined}>{t.art}</pattern>
        <linearGradient id={`${id}g`} x1="0" x2="1" y1="0" y2="0">
          <stop offset={fadeFrom} stopColor="white" stopOpacity="0" />
          <stop offset="1" stopColor="white" stopOpacity="1" />
        </linearGradient>
        <mask id={`${id}m`}><rect width="100%" height="100%" fill={`url(#${id}g)`} /></mask>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id}p)`} mask={`url(#${id}m)`} />
    </svg>
  )
}

// ตราวงทองขีดเขียวจากโลโก้ · ใช้เป็นตราประทับเท่านั้น
export function BrandMark({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <circle cx="12" cy="12.5" r="8" className="fill-gold" />
      <path d="M22 2.5 7.5 17" className="stroke-brand" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  )
}
