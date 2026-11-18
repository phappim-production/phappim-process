import type { ReactNode } from 'react'

// ไอคอนเส้น (สไตล์ Lucide) วาดเองเป็น SVG เพื่อไม่ต้องเพิ่ม dependency
type Props = { className?: string }
const icon = (paths: ReactNode) => function Icon({ className = 'size-5' }: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {paths}
    </svg>
  )
}

export const IconGauge = icon(<><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></>)
export const IconColumns = icon(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v18" /></>)
export const IconInbox = icon(<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>)
export const IconPackage = icon(<><path d="m7.5 4.27 9 5.15" /><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></>)
export const IconChart = icon(<><path d="M3 3v18h18" /><path d="M18 17V9M13 17V5M8 17v-3" /></>)
export const IconSliders = icon(<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />)
export const IconClock = icon(<><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>)
export const IconAlert = icon(<><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4M12 17h.01" /></>)
export const IconPause = icon(<><circle cx="12" cy="12" r="10" /><path d="M10 15V9M14 15V9" /></>)
export const IconFilm = icon(<><rect x="2" y="2" width="20" height="20" rx="2.18" /><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5" /></>)
export const IconCheck = icon(<><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>)
export const IconSearch = icon(<><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>)
export const IconX = icon(<path d="M18 6 6 18M6 6l12 12" />)
export const IconCalculator = icon(<><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M8 6h8M16 14v4M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01" /></>)
export const IconFactory = icon(<><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /><path d="M17 18h1M12 18h1M7 18h1" /></>)
export const IconClipboard = icon(<><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01" /></>)
export const IconCalendar = icon(<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>)
export const IconLayers = icon(<><path d="m12 2 10 5-10 5L2 7z" /><path d="m2 17 10 5 10-5M2 12l10 5 10-5" /></>)
export const IconChevronRight = icon(<path d="m9 18 6-6-6-6" />)
export const IconLock = icon(<><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>)
export const IconLogOut = icon(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>)
export const IconUser = icon(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>)
export const IconTrendingUp = icon(<><path d="m22 7-8.5 8.5-5-5L2 17" /><path d="M16 7h6v6" /></>)

// จักรเย็บผ้า: แขนจักร · หัวเข็ม · หลอดด้ายด้านบน · ฐาน · ตะเข็บใต้เข็ม
export const IconSewing = icon(<>
  <path d="M5 11V7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v11" />
  <path d="M5 11h10a1 1 0 0 1 1 1v6" />
  <path d="M7 11v3.5" />
  <path d="M10.5 5V3.2h3V5" />
  <circle cx="17.5" cy="8" r="1.2" />
  <rect x="2" y="18" width="20" height="3" rx="1" />
  <path d="M3.5 16h2M8.5 16h2" />
</>)
