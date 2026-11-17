-- โพ้ง 4 เส้นเป็นจักรใช้ร่วม + เจ้าของระบบตั้ง "ใช้ร่วม" เองได้ในหน้าตั้งค่า (เจ้าของโปรเจกต์ตอบ 17 พ.ย.)
-- เสื้อยืดใช้โพ้ง 2 ตัวจริง แต่โพ้งทำเร็วกว่าเข็มเดี่ยว จึงสลับใช้หลายไลน์ได้ · จักรใช้ร่วมต้องมีตัวที่ใช้ได้ครบจำนวนที่สินค้าต้องใช้
-- ตั้งชนิดจักรเป็นใช้ร่วม → ปล่อยจักรชนิดนั้นที่ผูกกับงาน และยกเลิกการจองที่ยังไม่เริ่ม (ใช้ร่วมไม่ต้องจอง)
-- เปลี่ยนกลับเป็นประจำไลน์ → งานที่เย็บอยู่ได้จักรเพิ่มตอน "เย็บต่อ" (machines_short) · งานใหม่ต้องได้ครบตอนเริ่มเย็บ

create or replace function private.release_on_shared() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.shared and not old.shared then
    update public.machine_assignments a set released_at = now()
      from public.sewing_machines m
      where a.machine_id = m.id and m.type_code = new.code and a.released_at is null;
    -- ช่วงที่ยังไม่เริ่ม (หรือเริ่มตรงเวลานี้) ยกเลิก · ช่วงที่กำลังใช้ตัดจบที่ตอนนี้ (ไม่ให้เกิดช่วงยาวศูนย์)
    update public.machine_bookings b set cancelled_at = now()
      from public.sewing_machines m
      where b.machine_id = m.id and m.type_code = new.code and b.cancelled_at is null and b.starts_at >= now();
    update public.machine_bookings b set ends_at = now()
      from public.sewing_machines m
      where b.machine_id = m.id and m.type_code = new.code and b.cancelled_at is null
        and b.starts_at < now() and b.ends_at > now();
  end if;
  return new;
end $$;
revoke all on function private.release_on_shared() from public, anon;
create trigger machine_types_release_on_shared after update of shared on public.machine_types
  for each row execute function private.release_on_shared();

update public.machine_types set shared = true where code = 'ovl4';

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
