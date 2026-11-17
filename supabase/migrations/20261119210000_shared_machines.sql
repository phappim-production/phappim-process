-- จักรใช้ร่วม (เจ้าของโปรเจกต์ตัดสินใจ 17 พ.ย. หลังจำลอง 30 งาน · docs/qa/จำลอง-30-งาน.md)
-- จักรลามี 1 ตัวแต่เสื้อทุกแบบต้องใช้ ถ้าผูกกับงานแบบจักรประจำไลน์ จะเย็บเสื้อได้ทีละงาน
-- หน้างานจริงใช้จักรลาตัวเดียวสลับกันหลายไลน์ "ถ้าว่าง" → จักรใช้ร่วมไม่จ่าย/ไม่จองให้งาน
-- เริ่มเย็บได้เมื่อมีจักรใช้ร่วมชนิดนั้นที่ใช้ได้อย่างน้อย 1 ตัว · โพ้ง / เข็มเดี่ยว ยังประจำไลน์เหมือนเดิม
-- ติดกระดุม / เจาะรังดุม มีชนิดละ 1 ตัวและใช้แค่ปลายงาน จึงใช้ร่วมเหมือนจักรลา · เจ้าของระบบเปลี่ยนได้ที่ machine_types.shared

alter table public.machine_types add column shared boolean not null default false;
comment on column public.machine_types.shared is 'true = จักรใช้ร่วมหลายไลน์ ไม่จ่าย/ไม่จองให้งาน (ต้องมีตัวที่ใช้ได้อย่างน้อย 1 ตัว)';
update public.machine_types set shared = true where code in ('cover', 'button', 'buttonhole');
-- จักรใช้ร่วมที่ผูกกับงานอยู่ตอนนี้ ปล่อยคืน (ประวัติยังอยู่) ให้ทุกไลน์ใช้ได้ทันที
update public.machine_assignments a set released_at = now()
  from public.sewing_machines m join public.machine_types t on t.code = m.type_code
  where a.machine_id = m.id and t.shared and a.released_at is null;

create or replace function private.machines_short(p_job uuid) returns table (type_code text, short int)
language sql stable security definer set search_path = '' as $$
  select n.type_code, n.qty - coalesce((
    select count(*)::int from public.machine_assignments a join public.sewing_machines m on m.id = a.machine_id
    where a.job_id = p_job and a.released_at is null and m.type_code = n.type_code), 0)
  from public.jobs j join public.product_machine_needs n on n.product_type_code = j.product_type_code
  join public.machine_types mt on mt.code = n.type_code and not mt.shared   -- จักรใช้ร่วมไม่ผูกกับงาน
  where j.id = p_job
$$;

create or replace function public.start_sewing(p_job uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; n record; got bigint[]; picked text[] := '{}'; why text; problems text[] := '{}';
begin
  perform private.require_sewing_supervisor();
  select * into j from public.jobs where id = p_job;
  if found and (j.phase not in ('sample', 'production') or private.station_at(j.route_code, j.station_seq) is distinct from 'sew') then
    raise exception 'งานนี้ยังไม่ถึงสถานีเย็บ' using errcode = 'P0001';
  end if;
  j := private.lock_job(p_job);
  if j.station_status = 'hold' then raise exception 'งานนี้พักอยู่ กด "แก้แล้ว" ก่อนเริ่มต่อ' using errcode = 'P0001'; end if;
  if j.station_status = 'doing' then perform private.stale('เริ่มเย็บไปแล้ว'); end if;
  if not exists (select 1 from public.product_machine_needs where product_type_code = j.product_type_code) then
    raise exception 'ยังไม่มีข้อมูลว่าสินค้านี้ใช้จักรอะไร ให้เจ้าของระบบใส่ในหน้าตั้งค่า' using errcode = 'P0001';
  end if;

  for n in select pmn.type_code, pmn.qty, mt.name from public.product_machine_needs pmn
           join public.machine_types mt on mt.code = pmn.type_code
           where pmn.product_type_code = j.product_type_code and not mt.shared order by mt.sort loop
    select array_agg(id order by code) into got from (
      select m.id, m.code from public.sewing_machines m
      where m.type_code = n.type_code and m.status = 'ready'
        and not exists (select 1 from public.machine_assignments a where a.machine_id = m.id and a.released_at is null)
        and private.booked_by_other(m.id, now(), now() + interval '1 minute', p_job) is null
      -- จักรที่งานนี้จองไว้มาก่อน
      order by exists (select 1 from public.machine_bookings b where b.machine_id = m.id and b.job_id = p_job
                       and b.cancelled_at is null and b.ends_at > now()) desc, m.code
      limit n.qty for update of m) free;
    if coalesce(cardinality(got), 0) < n.qty then
      select string_agg(m.code || case when m.status = 'broken' then ' เสีย' when m.status = 'off' then ' ปิด'
                                       when a.id is not null then ' ใช้กับ ' || coalesce(jb.confirmation_no, 'งานอื่น')
                                       else ' จองให้ ' || private.booked_by_other(m.id, now(), now() + interval '1 minute', p_job) end,
                        ', ' order by m.code)
        into why
        from public.sewing_machines m
        left join public.machine_assignments a on a.machine_id = m.id and a.released_at is null
        left join public.jobs jb on jb.id = a.job_id
        where m.type_code = n.type_code
          and (m.status <> 'ready' or a.id is not null
               or private.booked_by_other(m.id, now(), now() + interval '1 minute', p_job) is not null);
      problems := problems || format('%s ขาด %s ตัว%s', n.name, n.qty - coalesce(cardinality(got), 0),
                                     case when why is null then ' (ยังไม่มีจักรประเภทนี้)' else ' (' || why || ')' end);
    else
      insert into public.machine_assignments (machine_id, job_id, assigned_by)
        select unnest(got), p_job, (select auth.uid());
      picked := picked || (select array_agg(code order by code) from public.sewing_machines where id = any (got));
    end if;
  end loop;

  -- จักรใช้ร่วม: ไม่จ่ายให้งาน · ขอแค่มีตัวที่ใช้ได้ (เสีย/ปิดหมด = ยังเย็บสินค้านี้ไม่ได้)
  for n in select mt.name from public.product_machine_needs pmn join public.machine_types mt on mt.code = pmn.type_code
           where pmn.product_type_code = j.product_type_code and mt.shared
             and not exists (select 1 from public.sewing_machines m where m.type_code = pmn.type_code and m.status = 'ready')
           order by mt.sort loop
    problems := problems || format('%s ใช้ไม่ได้ทุกตัว (เสีย / ปิด / ยังไม่มีในระบบ)', n.name);
  end loop;

  if cardinality(problems) > 0 then
    raise exception 'จักรไม่ว่าง เริ่มเย็บไม่ได้: %', array_to_string(problems, ' · ') using errcode = 'P0001';
  end if;
  picked := (select array_agg(c order by c) from unnest(picked) c);
  perform private.log(p_job, 'machines_assigned', j.phase, 'sew', jsonb_build_object('machines', picked));
  perform public.start_station(p_job);
  return picked;
end $$;

create or replace function public.book_machines(p_job uuid, p_starts timestamptz, p_ends timestamptz) returns text[]
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; n record; got bigint[]; picked text[] := '{}'; why text; problems text[] := '{}'; now_start boolean;
begin
  perform private.require_role('production');
  -- ล็อกแถวงานตรงๆ (ไม่ใช้ lock_job) เพราะงานที่จองล่วงหน้ามักยังอยู่สถานีเฟส 1
  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'ไม่พบงานนี้' using errcode = 'P0002'; end if;
  if j.phase in ('done', 'cancelled') then raise exception 'งานนี้เสร็จแล้ว จองจักรไม่ได้' using errcode = 'P0001'; end if;
  -- ผลิตจริงที่ผ่านเย็บไปแล้ว (อยู่ QC) ไม่ต้องใช้จักรอีก · ตัวอย่างที่อยู่ QC ยังต้องเย็บตอนผลิตจริง จึงจองได้
  if j.phase = 'production' and private.station_at(j.route_code, j.station_seq) = 'qc_pack' then
    raise exception 'งานนี้เย็บเสร็จแล้ว จองจักรไม่ได้' using errcode = 'P0001';
  end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts then
    raise exception 'เวลาจบต้องหลังเวลาเริ่ม' using errcode = '23514';
  end if;
  if p_ends <= now() then raise exception 'ช่วงเวลานี้ผ่านไปแล้ว เลือกเวลาใหม่' using errcode = '23514'; end if;
  if p_ends - p_starts > interval '14 days' then raise exception 'จองได้ครั้งละไม่เกิน 14 วัน' using errcode = '23514'; end if;
  if extract(isodow from p_starts at time zone 'Asia/Bangkok') = 7 then
    raise exception 'วันอาทิตย์โรงงานหยุด เลือกวันเริ่มใหม่' using errcode = '23514';
  end if;
  if exists (select 1 from public.machine_bookings where job_id = p_job and cancelled_at is null and ends_at > now()) then
    raise exception 'งานนี้จองจักรไว้แล้ว ยกเลิกการจองเดิมก่อนจองใหม่' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.product_machine_needs where product_type_code = j.product_type_code) then
    raise exception 'ยังไม่มีข้อมูลว่าสินค้านี้ใช้จักรอะไร ให้เจ้าของระบบใส่ในหน้าตั้งค่า' using errcode = 'P0001';
  end if;
  now_start := p_starts <= now();

  for n in select pmn.type_code, pmn.qty, mt.name from public.product_machine_needs pmn
           join public.machine_types mt on mt.code = pmn.type_code
           where pmn.product_type_code = j.product_type_code and not mt.shared order by mt.sort loop
    select array_agg(id order by code) into got from (
      select m.id, m.code from public.sewing_machines m
      where m.type_code = n.type_code and m.status = 'ready'
        and private.booked_by_other(m.id, p_starts, p_ends, null) is null
        -- จองเริ่มทันที: จักรต้องไม่ติดงานอื่นอยู่ตอนนี้
        and not (now_start and exists (select 1 from public.machine_assignments a
                                      where a.machine_id = m.id and a.released_at is null and a.job_id <> p_job))
      order by m.code limit n.qty for update of m) free;
    if coalesce(cardinality(got), 0) < n.qty then
      select string_agg(m.code || ' ' || coalesce(
               case when m.status = 'broken' then 'เสีย' when m.status = 'off' then 'ปิด' end,
               'จองให้ ' || private.booked_by_other(m.id, p_starts, p_ends, null),
               'ใช้กับ ' || (select jb.confirmation_no from public.machine_assignments a join public.jobs jb on jb.id = a.job_id
                             where a.machine_id = m.id and a.released_at is null)), ', ' order by m.code)
        into why
        from public.sewing_machines m
        where m.type_code = n.type_code
          and (m.status <> 'ready' or private.booked_by_other(m.id, p_starts, p_ends, null) is not null
               or (now_start and exists (select 1 from public.machine_assignments a where a.machine_id = m.id and a.released_at is null and a.job_id <> p_job)));
      problems := problems || format('%s ขาด %s ตัว%s', n.name, n.qty - coalesce(cardinality(got), 0),
                                     case when why is null then ' (ยังไม่มีจักรประเภทนี้)' else ' (' || why || ')' end);
    else
      insert into public.machine_bookings (machine_id, job_id, starts_at, ends_at, booked_by)
        select unnest(got), p_job, p_starts, p_ends, (select auth.uid());
      picked := picked || (select array_agg(code order by code) from public.sewing_machines where id = any (got));
    end if;
  end loop;

  if cardinality(problems) > 0 then
    raise exception 'จองไม่ได้ ช่วงเวลานี้จักรไม่พอ: %', array_to_string(problems, ' · ') using errcode = 'P0001';
  end if;
  picked := (select array_agg(c order by c) from unnest(picked) c);
  perform private.log(p_job, 'machines_booked', j.phase, 'sew',
    jsonb_build_object('machines', picked, 'starts_at', p_starts, 'ends_at', p_ends));
  return picked;
exception when exclusion_violation then
  -- ฐานข้อมูลกันการจองชน แม้สองคำขอผ่านการตรวจพร้อมกัน
  perform private.stale('มีคนจองจักรช่วงนี้ไปก่อน');
end $$;
