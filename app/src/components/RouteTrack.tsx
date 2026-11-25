import { STATION_NAME, type RouteCode, type StationCode } from '../proto/model'
import { routeSteps } from '../data/routeSteps'
import { useT } from '../i18n/lang'
import { Tr } from '../i18n/Tr'
import { IconCheck } from './icons'
import { StationIcon } from './StationNav'
import { STATION_THEME } from './stationTheme'
import { BrandMark } from './StationPattern'

// เส้นทางงานทั้งเส้นด้วยสีสถานี · บอกชื่อเฉพาะสถานีปัจจุบัน ที่เหลือบอกด้วยไอคอน (ชื่อเต็มอยู่ใน title/aria)
export function RouteTrack({ route, station }: { route: RouteCode; station: StationCode | null | undefined }) {
  const t = useT()
  const steps = routeSteps(route, station)
  if (steps.length < 2) return null
  return (
    <ol aria-label={t('เส้นทาง')} className="grid items-start" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map(({ station: s, state }, i) => {
        const th = STATION_THEME[s]
        const name = t(STATION_NAME[s])
        return (
          <li key={s} className="relative flex flex-col items-center gap-1" title={name} aria-label={name} aria-current={state === 'now' ? 'step' : undefined}>
            {i < steps.length - 1 && <span aria-hidden className={`absolute top-[17px] right-[calc(-50%+18px)] left-[calc(50%+18px)] h-0.5 rounded ${state === 'done' ? th.solid : 'bg-line'}`} />}
            {state === 'now'
              ? <span className={`rounded-full border-2 p-0.5 ${th.border}`}><span className={`grid size-7 place-items-center rounded-full text-white ${th.solid}`}><StationIcon station={s} className="size-4" /></span></span>
              : state === 'done'
                ? <span className={`grid size-9 place-items-center rounded-full ${th.soft} ${th.text}`}><IconCheck className="size-4" /></span>
                : <span className="grid size-9 place-items-center rounded-full border-[1.5px] border-line bg-card text-muted"><StationIcon station={s} className="size-4" /></span>}
            {state === 'now' && <span className={`max-w-full text-center text-xs leading-tight font-bold ${th.text}`}><Tr th={STATION_NAME[s]} /></span>}
          </li>
        )
      })}
    </ol>
  )
}

// รอยปรุของใบงาน คั่นข้อมูลงานกับปุ่มกด
export function Perforation() {
  return (
    <div aria-hidden className="relative -mx-4 my-1 border-t-2 border-dashed border-line">
      <span className="absolute top-0 left-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-card"><BrandMark className="size-5" /></span>
    </div>
  )
}
