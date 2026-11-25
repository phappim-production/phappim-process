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
export const IconPlay = icon(<><circle cx="12" cy="12" r="10" /><path d="m10 8 6 4-6 4z" /></>)
export const IconBook = icon(<><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></>)
export const IconGlobe = icon(<><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>)
export const IconLayers = icon(<><path d="m12 2 10 5-10 5L2 7z" /><path d="m2 17 10 5 10-5M2 12l10 5 10-5" /></>)
export const IconChevronRight = icon(<path d="m9 18 6-6-6-6" />)
export const IconLock = icon(<><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>)
export const IconLogOut = icon(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>)
export const IconUser = icon(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>)
export const IconTrendingUp = icon(<><path d="m22 7-8.5 8.5-5-5L2 17" /><path d="M16 7h6v6" /></>)

export const IconSewing = icon(<>
  <path d="M5 11V7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v11" />
  <path d="M5 11h10a1 1 0 0 1 1 1v6" />
  <path d="M7 11v3.5" />
  <path d="M10.5 5V3.2h3V5" />
  <circle cx="17.5" cy="8" r="1.2" />
  <rect x="2" y="18" width="20" height="3" rx="1" />
  <path d="M3.5 16h2M8.5 16h2" />
</>)
export const IconList = icon(<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />)
export const IconFlag = icon(<><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><path d="M4 22v-7" /></>)
export const IconUsers = icon(<><circle cx="9" cy="7" r="4" /><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><path d="M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.85" /></>)
export const IconShield = icon(<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />)
export const IconPrinter = icon(<><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></>)
export const IconFlame = icon(<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" />)
export const IconScissors = icon(<><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" /></>)
export const IconSparkles = icon(<><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" /></>)
export const IconImage = icon(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" /></>)
export const IconCamera = icon(<><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" /><circle cx="12" cy="13" r="3" /></>)

// ไอคอนประจำสถานี วาดจากเครื่องมือจริงของแต่ละสถานี
export const IconStPrint = icon(<><path d="M7 8V3.5h10V8" /><rect x="3" y="8" width="18" height="8.5" rx="2" /><path d="M7 14h10v6.5H7z" /><path d="M12 15.4c-.9 1-1.3 1.8-1.3 2.4a1.3 1.3 0 0 0 2.6 0c0-.6-.4-1.4-1.3-2.4z" /><path d="M17.5 11h.01" /></>)
export const IconStPress = icon(<><rect x="3" y="4" width="14" height="4" rx="1.2" /><path d="M17 6h4M10 8v1.5" /><rect x="3" y="16" width="18" height="4" rx="1.2" /><path d="M7 11c.9.8.9 1.7 0 2.5M11 11c.9.8.9 1.7 0 2.5M15 11c.9.8.9 1.7 0 2.5" /></>)
export const IconStEmb = icon(<><circle cx="10.5" cy="13.5" r="7" /><circle cx="10.5" cy="13.5" r="4.6" /><path d="M9 6.5V4h3v2.5M15 9l6-6" /><path d="m8 14.6 1.25-2 1.25 2 1.25-2 1.25 2" /></>)
export const IconStSew = icon(<><path d="M3 20.5h18" /><path d="M5 20.5V8.5A3.5 3.5 0 0 1 8.5 5H18a2 2 0 0 1 2 2v4h-5V9.5H9v11" /><path d="M17 11v4M15.5 15h3M7.5 8.5h.01" /></>)
export const IconStQc = icon(<><path d="M20 8 12 4 4 8v8.5l8 4 8-4z" /><path d="m4 8 8 4 8-4M12 12v8.5" /><path d="m14.6 15.4 1.4 1.4 2.6-2.9" /></>)
export const IconTruck = icon(<><path d="M2.5 6.5h11v10h-11z" /><path d="M13.5 10h4l3 3.5v3h-7z" /><circle cx="6.5" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>)
export const IconCompare = icon(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 2v20M7.5 10l-2 2 2 2M16.5 10l2 2-2 2" /></>)
export const IconZoom = icon(<><circle cx="11" cy="11" r="7" /><path d="m20.5 20.5-4.5-4.5M11 8v6M8 11h6" /></>)
export const IconChevronLeft = icon(<path d="m15 18-6-6 6-6" />)
