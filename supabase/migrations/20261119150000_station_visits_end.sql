-- จบรอบจากเหตุการณ์ที่ยืนยันว่างานออกจากสถานี เมื่อไม่มี station_done
create or replace view public.station_visits with (security_invoker = true) as
with visits as (
  select e.job_id, e.station_code, e.phase, (e.payload->>'visit')::int as visit,
         min(e.at) filter (where e.type = 'station_start') as started_at,
         (array_agg(e.id order by e.at, e.id) filter (where e.type = 'station_start'))[1] as start_id,
         max(e.at) filter (where e.type = 'station_done') as done_at,
         bool_or((e.payload->>'rework')::boolean) as rework
  from public.events e
  where e.type in ('station_start', 'station_done')
  group by e.job_id, e.station_code, e.phase, (e.payload->>'visit')::int
)
select v.job_id, v.station_code, v.phase, v.visit, v.started_at,
       coalesce(v.done_at, next_event.at) as done_at, v.rework
from visits v
left join lateral (
  select e.at
  from public.events e
  where v.done_at is null and v.started_at is not null
    and e.job_id = v.job_id and (e.at, e.id) > (v.started_at, v.start_id)
    and (
      e.type in ('rework', 'sample_sent', 'done')
      or (e.type = 'station_start' and (e.payload->>'visit')::int > v.visit)
    )
  order by e.at, e.id
  limit 1
) next_event on true;
