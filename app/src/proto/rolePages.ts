import { byQueue, STATION_NAME, waitingAt, type Job, type StationCode } from './model.ts'

const atStation = (j: Job) => (j.phase === 'sample' || j.phase === 'production') && !!j.station

export function inStations(jobs: Job[], stations: readonly StationCode[] | null): Job[] {
  return stations ? jobs.filter(j => atStation(j) && stations.includes(j.station!)) : jobs
}

export function problemLists(jobs: Job[], stations: readonly StationCode[] | null) {
  const mine = inStations(jobs.filter(j => j.phase !== 'done'), stations)
  const held = mine.filter(j => j.status === 'hold').sort((a, b) => (a.heldSince ?? a.since).getTime() - (b.heldSince ?? b.since).getTime())
  const rework = mine.filter(j => j.rework && j.status !== 'hold').sort(byQueue)
  const overSla = mine.filter(j => (j.sla === 'over' || j.sla === 'report') && j.status !== 'hold').sort(byQueue)
  return { held, rework, overSla }
}

// แจ้งปัญหา = พักงาน จึงแจ้งได้เฉพาะงานที่กำลังทำหรือรอคิวอยู่ที่สถานีของตัวเอง · เย็บใช้รายงานปัญหาเย็บของฝ่ายผลิต
export function reportable(jobs: Job[], stations: readonly StationCode[]): Job[] {
  return jobs
    .filter(j => atStation(j) && stations.includes(j.station!) && j.station !== 'sew' && (j.status === 'doing' || j.status === 'queued'))
    .sort((a, b) => Number(b.status === 'doing') - Number(a.status === 'doing') || byQueue(a, b))
}

export type StationQueueRow = { station: StationCode; name: string; doing: Job[]; waiting: Job[]; hold: Job[]; out: Job[] }

export function queueBoard(jobs: Job[], stations: readonly StationCode[] = Object.keys(STATION_NAME) as StationCode[]): StationQueueRow[] {
  return stations.map(station => {
    const here = jobs.filter(j => atStation(j) && j.station === station)
    return {
      station, name: STATION_NAME[station],
      doing: here.filter(j => j.status === 'doing').sort(byQueue),
      waiting: waitingAt(jobs, station),
      hold: here.filter(j => j.status === 'hold').sort(byQueue),
      out: here.filter(j => j.status === 'out').sort(byQueue),
    }
  })
}

export function myStationsOf(role: string, assigned: readonly StationCode[] | undefined): StationCode[] {
  if (role === 'qc') return ['qc_pack']
  return [...(assigned ?? [])]
}
