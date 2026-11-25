import { ROUTES, type RouteCode, type StationCode } from '../proto/model'

export type TrackStep = { station: StationCode; state: 'done' | 'now' | 'todo' }

export function routeSteps(route: RouteCode, current: StationCode | null | undefined): TrackStep[] {
  const stations = ROUTES[route]?.stations ?? []
  const at = current ? stations.indexOf(current) : -1
  return stations.map((station, i) => ({ station, state: at < 0 ? 'todo' : i < at ? 'done' : i === at ? 'now' : 'todo' }))
}
