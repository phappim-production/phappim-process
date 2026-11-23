import assert from 'node:assert/strict'
import { waitFor } from '../qa-r14/chrome.mjs'

export function routeLedger(stack, checkpoints) {
  const counts = new Map()
  return async (id, label, condition) => {
    const state = await waitFor(async () => {
      const { rows } = await stack.db.execSuper(
        'select j.confirmation_no, j.route_code, j.phase, j.station_status, private.station_at(j.route_code,j.station_seq) as station, ' +
        'j.delivered_at, l.qc_passed, j.phase = l.phase and j.station_seq is not distinct from l.station_seq and j.station_status is not distinct from l.station_status as view_matches, ' +
        '(select count(*)::int from events e where e.job_id=j.id) as events from jobs j join job_live l on l.id=j.id where j.id=$1',
        [id],
      )
      const row = rows[0]
      if (!row || row.events <= (counts.get(id) ?? 0) || !condition(row)) return false
      assert.equal(row.view_matches, true, label)
      return row
    }, label)
    counts.set(id, state.events)
    checkpoints.push({ label, ...state })
  }
}
