import { useEffect, type ReactNode } from 'react'
import { LangAllowed, hasBurmese, setLang, translate, useLang, type Lang, type Vars } from './lang'

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

export function LangToggle({ className = '' }: { className?: string }) {
  const lang = useLang()
  const next: Lang = lang === 'my' ? 'th' : 'my'
  return (
    <button type="button" onClick={() => setLang(next)} lang={next}
      aria-label={next === 'my' ? 'ပြောင်းရန် မြန်မာဘာသာ (เปลี่ยนเป็นภาษาพม่า)' : 'เปลี่ยนเป็นภาษาไทย'}
      className={`min-h-12 shrink-0 rounded-xl border border-line bg-card px-3 font-semibold text-brand hover:border-brand ${className}`}>
      {next === 'my' ? 'မြန်မာ' : 'ไทย'}
    </button>
  )
}
