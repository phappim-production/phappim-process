import { useEffect, type ReactNode } from 'react'
import { LangAllowed, hasBurmese, setLang, translate, useLang, type Lang, type Vars } from './lang'
import { IconGlobe } from '../components/icons'

export function LangScope({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  return <LangAllowed.Provider value={allowed}>{children}</LangAllowed.Provider>
}

export function DocumentLang() {
  const lang = useLang()
  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.classList.toggle('lang-my', lang === 'my')
  }, [lang])
  return null
}

// พม่าตัวหลัก ไทยตัวเล็กใต้ ให้หัวหน้างานคนไทยอ่านจอเดียวกันได้
export function Tr({ th, vars, inline }: { th: string; vars?: Vars; inline?: boolean }) {
  const lang = useLang()
  if (lang !== 'my' || !hasBurmese(th)) return <>{translate('th', th, vars)}</>
  return (
    <span className={inline ? 'tr tr-inline' : 'tr'}>
      <span className="tr-my" lang="my">{translate('my', th, vars)}</span>
      <span className="tr-th" lang="th">{translate('th', th, vars)}</span>
    </span>
  )
}

export function LangToggle({ className = '', compact }: { className?: string; compact?: boolean }) {
  const lang = useLang()
  const next: Lang = lang === 'my' ? 'th' : 'my'
  const label = next === 'my' ? 'မြန်မာ' : 'ไทย'
  return (
    <button type="button" onClick={() => setLang(next)} lang={next}
      aria-label={next === 'my' ? 'မြန်မာဘာသာသို့ ပြောင်းရန် (เปลี่ยนเป็นภาษาพม่า)' : 'เปลี่ยนเป็นภาษาไทย'}
      className={compact
        ? `grid size-12 shrink-0 place-items-center content-center gap-0.5 rounded-xl text-xs leading-none font-semibold ${className}`
        : `inline-flex min-h-12 shrink-0 items-center gap-2 rounded-xl border border-line bg-card px-3 font-semibold text-brand hover:border-brand ${className}`}>
      <IconGlobe className={compact ? 'size-5' : 'size-5 shrink-0'} />
      <span>{label}</span>
    </button>
  )
}
