-- start_sewing ตรวจซ้ำหลังล็อกงานว่ายังอยู่สถานีเย็บ (กดเริ่มชนกับกดเย็บเสร็จ = ไปเริ่ม QC)
-- และล็อกการเลือกจักรอัตโนมัติไม่ให้สองงานได้จักรตัวเดียวกัน

create or replace function public.start_sewing(p_job uuid, p_codes text[] default null) returns text[]
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; n record; got bigint[]; picked text[] := '{}'; why text; problems text[] := '{}'; codes text[]; pm public.sewing_machines; pick_code text; t public.machine_types; busy text;
begin
  perform private.require_sewing_supervisor();
  select * into j from public.jobs where id = p_job;
  if found and (j.phase not in ('sample', 'production') or private.station_at(j.route_code, j.station_seq) is distinct from 'sew') then
    raise exception 'งานนี้ยังไม่ถึงสถานีเย็บ' using errcode = 'P0001';
  end if;
  j := private.lock_job(p_job);
  -- อีกเครื่องอาจกดเย็บเสร็จระหว่างรอล็อก · ไม่ตรวจซ้ำแล้วจะไปเริ่มสถานีถัดไปแทน
  if j.phase not in ('sample', 'production') or private.station_at(j.route_code, j.station_seq) is distinct from 'sew' then
    perform private.stale('งานนี้ออกจากสถานีเย็บแล้ว');
  end if;
  -- กันสองงานเลือกจักรว่างตัวเดียวกันตอนให้ระบบเลือกให้
  perform pg_advisory_xact_lock(hashtext('pp142.sewing_machines'));
  if j.station_status = 'hold' then raise exception 'งานนี้พักอยู่ กด "แก้แล้ว" ก่อนเริ่มต่อ' using errcode = 'P0001'; end if;
  if j.station_status = 'doing' then perform private.stale('เริ่มเย็บไปแล้ว'); end if;
  if not exists (select 1 from public.product_machine_needs where product_type_code = j.product_type_code) then
    raise exception 'ยังไม่มีข้อมูลว่าสินค้านี้ใช้จักรอะไร ให้เจ้าของระบบใส่ในหน้าตั้งค่า' using errcode = 'P0001';
  end if;

  if p_codes is not null then
    select array_agg(distinct upper(trim(x))) into codes from unnest(p_codes) x where trim(x) <> '';
    if coalesce(cardinality(codes), 0) = 0 then raise exception 'เลือกจักรอย่างน้อย 1 ตัว' using errcode = '23514'; end if;
    foreach pick_code in array codes loop
      select * into pm from public.sewing_machines where code = pick_code for update;
      if not found then raise exception 'ไม่พบจักรรหัส %', pick_code using errcode = 'P0002'; end if;
      select * into t from public.machine_types where code = pm.type_code;
      if t.shared then raise exception 'จักร % เป็น% ที่ทุกไลน์ใช้ร่วมกัน ไม่ต้องเลือก', pm.code, t.name using errcode = 'P0001'; end if;
      if not exists (select 1 from public.product_machine_needs where product_type_code = j.product_type_code and type_code = pm.type_code) then
        raise exception 'งานนี้ไม่ใช้% (จักร %) เลือกตัวอื่น', t.name, pm.code using errcode = 'P0001';
      end if;
      if pm.status <> 'ready' then
        raise exception 'จักร % % อยู่ เลือกตัวอื่น', pm.code, case pm.status when 'broken' then 'เสีย' else 'ปิดใช้งาน' end using errcode = 'P0001';
      end if;
      select jb.confirmation_no into busy from public.machine_assignments a join public.jobs jb on jb.id = a.job_id
        where a.machine_id = pm.id and a.released_at is null;
      if found then raise exception 'จักร % ใช้กับงาน % อยู่ เลือกตัวอื่น', pm.code, busy using errcode = 'P0001'; end if;
      busy := private.booked_by_other(pm.id, now(), now() + interval '1 minute', p_job);
      if busy is not null then raise exception 'จักร % จองให้ % อยู่ เลือกตัวอื่น', pm.code, busy using errcode = 'P0001'; end if;
    end loop;
    for n in select pmn.type_code, pmn.qty, mt.name from public.product_machine_needs pmn
             join public.machine_types mt on mt.code = pmn.type_code
             where pmn.product_type_code = j.product_type_code and not mt.shared order by mt.sort loop
      if (select count(*) from public.sewing_machines sm where sm.code = any (codes) and sm.type_code = n.type_code) < n.qty then
        problems := problems || format('เลือก%s ไม่ครบ ต้องใช้อย่างน้อย %s ตัว', n.name, n.qty);
      end if;
    end loop;
    if cardinality(problems) = 0 then
      insert into public.machine_assignments (machine_id, job_id, assigned_by)
        select sm.id, p_job, (select auth.uid()) from public.sewing_machines sm where sm.code = any (codes);
      picked := codes;
    end if;
  end if;

  if p_codes is null then
    for n in select pmn.type_code, pmn.qty, mt.name from public.product_machine_needs pmn
             join public.machine_types mt on mt.code = pmn.type_code
             where pmn.product_type_code = j.product_type_code and not mt.shared order by mt.sort loop
      select array_agg(id order by code) into got from (
        select m.id, m.code from public.sewing_machines m
        where m.type_code = n.type_code and m.status = 'ready'
          and not exists (select 1 from public.machine_assignments a where a.machine_id = m.id and a.released_at is null)
          and private.booked_by_other(m.id, now(), now() + interval '1 minute', p_job) is null
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
  end if;

  -- จักรใช้ร่วม: ไม่จ่ายให้งาน · ต้องมีตัวที่ใช้ได้ครบจำนวนที่สินค้าต้องใช้ (เช่น เสื้อยืดใช้โพ้ง 2 ตัว)
  for n in select mt.name, pmn.qty, (select count(*)::int from public.sewing_machines m
                                     where m.type_code = pmn.type_code and m.status = 'ready') as ready
           from public.product_machine_needs pmn join public.machine_types mt on mt.code = pmn.type_code
           where pmn.product_type_code = j.product_type_code and mt.shared
           order by mt.sort loop
    if n.ready = 0 then
      problems := problems || format('%s ใช้ไม่ได้ทุกตัว (เสีย / ปิด / ยังไม่มีในระบบ)', n.name);
    elsif n.ready < n.qty then
      problems := problems || format('%s ใช้ได้ %s ตัว ต้องใช้ %s ตัว (ที่เหลือเสีย / ปิด)', n.name, n.ready, n.qty);
    end if;
  end loop;

  if cardinality(problems) > 0 then
    raise exception 'จักรไม่ว่าง เริ่มเย็บไม่ได้: %', array_to_string(problems, ' · ') using errcode = 'P0001';
  end if;
  picked := (select array_agg(c order by c) from unnest(picked) c);
  perform private.log(p_job, 'machines_assigned', j.phase, 'sew', jsonb_build_object('machines', picked));
  perform public.start_station(p_job);
  return picked;
end $$;
revoke all on function public.start_sewing(uuid, text[]) from public, anon;
grant execute on function public.start_sewing(uuid, text[]) to authenticated;
