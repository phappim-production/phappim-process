import type { ComponentType, ReactNode } from 'react'
import { Card } from '../components/ui'
import { TONE, type Tone } from '../components/tone'
import { StationIcon } from '../components/StationNav'
import { IconAlert, IconBook, IconCheck, IconClock, IconFlag, IconPause, IconPlay, IconPrinter, IconUsers } from '../components/icons'
import { STATION_NAME, STATION_ORDER } from '../proto/model'
import { translate } from '../i18n/lang'
import { GLOSSARY_ACTIONS, GLOSSARY_STATUS, GLOSSARY_WORDS } from '../i18n/glossary'

type Icon = ComponentType<{ className?: string }>
const ICON: Record<string, Icon> = { play: IconPlay, pause: IconPause, check: IconCheck, flag: IconFlag, alert: IconAlert, clock: IconClock, users: IconUsers }
const my = (th: string) => translate('my', th)

// ตารางเดียวกันสำหรับคนไทยและคนพม่า · พิมพ์ติดหน้างานหรือใช้ตอนอบรม (ไม่ขึ้นกับปุ่มสลับภาษา)
export default function WordsPage() {
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4 p-4 sm:p-6 print:max-w-none print:p-0">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand print:hidden"><IconBook className="size-6" /></span>
          <div>
            <h1 className="text-2xl font-bold">คำศัพท์หน้างาน ไทย – พม่า</h1>
            <p className="tr-my text-lg text-muted" lang="my">လုပ်ငန်းခွင် ဝေါဟာရ ထိုင်း – မြန်မာ</p>
          </div>
        </div>
        <button type="button" onClick={() => window.print()}
          className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line bg-card px-4 font-semibold text-brand hover:border-brand print:hidden">
          <IconPrinter className="size-5" />พิมพ์ / <span className="tr-my" lang="my">ပုံနှိပ်</span>
        </button>
      </header>
      <p className="rounded-xl bg-brand-soft px-4 py-3 text-base print:bg-transparent print:p-0">
        เรียกสถานีด้วย <b>เลข 1–7</b> และดู <b>สีกับไอคอน</b> บนปุ่มเหมือนกันทุกจอ · <span className="tr-my" lang="my">ဌာနကို <b>နံပါတ် 1–7</b> ဖြင့် ခေါ်ပါ · ခလုတ်၏ <b>အရောင်နှင့် ပုံ</b> သည် စခရင်တိုင်းတွင် တူညီသည်</span>
      </p>

      <Section title="สถานี" my="ဌာန">
        {STATION_ORDER.map((s, i) => (
          <Row key={s} mark={<span className="flex items-center gap-2"><Num n={i + 1} /><StationIcon station={s} className="size-6 text-brand" /></span>}
            th={STATION_NAME[s]} />
        ))}
      </Section>

      <Section title="ปุ่มที่กด" my="နှိပ်ရမည့် ခလုတ်">
        {GLOSSARY_ACTIONS.map(a => (
          <Row key={a.th} th={a.th} note={a.note} mark={<Swatch tone={a.tone} solid={a.solid} icon={ICON[a.icon]} />} />
        ))}
      </Section>

      <Section title="สถานะและสี" my="အခြေအနေနှင့် အရောင်">
        {GLOSSARY_STATUS.map(a => (
          <Row key={a.th} th={a.th} note={a.note} mark={<Swatch tone={a.tone} icon={ICON[a.icon]} />} />
        ))}
      </Section>

      <Section title="คำที่ใช้บ่อย" my="မကြာခဏ သုံးသော စကားလုံး">
        {GLOSSARY_WORDS.map(w => <Row key={w.th} th={w.th} note={w.note} />)}
      </Section>
    </div>
  )
}

function Section({ title, my: titleMy, children }: { title: string; my: string; children: ReactNode }) {
  return (
    <Card className="overflow-hidden break-inside-avoid">
      <h2 className="flex flex-wrap items-baseline gap-x-3 border-b border-line bg-paper px-4 py-2.5 text-lg font-bold">
        {title}<span className="tr-my font-semibold text-muted" lang="my">{titleMy}</span>
      </h2>
      <ul className="divide-y divide-line">{children}</ul>
    </Card>
  )
}

function Row({ th, note, mark }: { th: string; note?: string; mark?: ReactNode }) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1fr)]">
      <span className="row-span-2 flex items-center sm:row-span-1">{mark}</span>
      <span className="font-semibold">{th}{note && <span className="block text-sm font-normal text-muted">{note}</span>}</span>
      <span className="tr-my font-semibold text-brand sm:text-ink" lang="my">{my(th)}{note && <span className="block text-sm font-normal text-muted">{my(note)}</span>}</span>
    </li>
  )
}

function Num({ n }: { n: number }) {
  return <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand font-bold text-white">{n}</span>
}

function Swatch({ tone, icon: Icon, solid }: { tone: Tone; icon?: Icon; solid?: boolean }) {
  return (
    <span className={`grid size-10 place-items-center rounded-xl ${solid ? `${TONE[tone].dot} text-white` : TONE[tone].soft}`}>
      {Icon && <Icon className="size-6" />}
    </span>
  )
}
