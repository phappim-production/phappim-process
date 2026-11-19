-- จัดจักรแบบ "ตั้งจำนวน" (เจ้าของ 19 พ.ย.: หน้างานคิดเป็นจำนวน "งานนี้ใช้ 4 ตัว" ไม่ได้เลือกจักรทีละรหัส)
-- ปุ่ม − / + ส่งจำนวนที่ต้องการ (ไม่ใช่ +1/−1) → กดซ้ำ / 2 เครื่องกดพร้อมกัน ได้ผลเดียว ไม่จ่ายเกิน
-- ระบบหยิบจักรว่างให้เอง (ที่งานนี้จองไว้ก่อน แล้วเรียงรหัส) · ลดจำนวน = คืนตัวที่ได้มาล่าสุด
-- กฎเดียวกับ assign_machines / release_machines (20261120080000): งานกำลังเย็บ/พัก · ไม่ใช่จักรใช้ร่วม
-- · กำลังเย็บ ลดต่ำกว่าที่สินค้าต้องใช้ไม่ได้ · ข้ามการจองของงานอื่นไม่ได้

create function public.set_job_machines(p_job uuid, p_type text, p_qty int) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs; t public.machine_types; have int; need int; got bigint[]; codes text[]; free_count int;
begin
  perform private.require_sewing_supervisor();
  select * into j from public.jobs where id = p_job;
  if found and (j.phase not in ('sample', 'production') or private.station_at(j.route_code, j.station_seq) is distinct from 'sew') then
    raise exception 'จัดจักรได้เฉพาะงานที่อยู่สถานีเย็บ' using errcode = 'P0001';
  end if;
  j := private.lock_job(p_job);
  if j.phase not in ('sample', 'production') or private.station_at(j.route_code, j.station_seq) is distinct from 'sew' then
    perform private.stale('งานออกจากสถานีเย็บแล้ว');
  end if;
  if j.station_status is distinct from 'doing' and j.station_status is distinct from 'hold' then
    raise exception 'งานนี้ยังไม่เริ่มเย็บ กด "เริ่มเย็บ" ก่อน' using errcode = 'P0001';
  end if;
  select * into t from public.machine_types where code = p_type;
  if not found then raise exception 'ไม่พบชนิดจักรนี้' using errcode = 'P0002'; end if;
  if t.shared then
    raise exception '% ทุกไลน์ใช้ร่วมกันอยู่แล้ว ไม่ต้องจ่ายให้งาน', t.name using errcode = 'P0001';
  end if;
  if p_qty is null or p_qty < 0 then raise exception 'จำนวนจักรต้องเป็น 0 ขึ้นไป' using errcode = '23514'; end if;

  select count(*)::int into have from public.machine_assignments a join public.sewing_machines m on m.id = a.machine_id
    where a.job_id = p_job and a.released_at is null and m.type_code = p_type;
  if p_qty = have then
    perform private.stale(format('%s ของงานนี้มี %s ตัวอยู่แล้ว', t.name, have));
  end if;
  select coalesce(sum(n.qty), 0)::int into need from public.product_machine_needs n
    where n.product_type_code = j.product_type_code and n.type_code = p_type;
  if j.station_status = 'doing' and p_qty < need then
    raise exception 'กำลังเย็บอยู่ ต้องมี% อย่างน้อย % ตัว · ถ้าจะหยุดเย็บให้กด "รายงานปัญหา" แล้วพักงานก่อน', t.name, need
      using errcode = 'P0001';
  end if;

  if p_qty > have then
    select array_agg(id order by code) into got from (
      select m.id, m.code from public.sewing_machines m
      where m.type_code = p_type and m.status = 'ready'
        and not exists (select 1 from public.machine_assignments a where a.machine_id = m.id and a.released_at is null)
        and private.booked_by_other(m.id, now(), now() + interval '1 minute', p_job) is null
      order by exists (select 1 from public.machine_bookings b where b.machine_id = m.id and b.job_id = p_job
                       and b.cancelled_at is null and b.ends_at > now()) desc, m.code
      limit p_qty - have for update of m) free;
    free_count := coalesce(cardinality(got), 0);
    if free_count < p_qty - have then
      raise exception '% ว่างอยู่ % ตัว เพิ่มเป็น % ตัวไม่ได้ (ตัวอื่นใช้กับงานอื่น / เสีย / จองไว้)', t.name, free_count, p_qty
        using errcode = 'P0001';
    end if;
    insert into public.machine_assignments (machine_id, job_id, assigned_by)
      select unnest(got), p_job, (select auth.uid());
    select array_agg(code order by code) into codes from public.sewing_machines where id = any (got);
    perform private.log(p_job, 'machines_assigned', j.phase, 'sew', jsonb_build_object('machines', codes));
  else
    with picked as (
      select a.id from public.machine_assignments a join public.sewing_machines m on m.id = a.machine_id
      where a.job_id = p_job and a.released_at is null and m.type_code = p_type
      order by a.assigned_at desc, a.id desc limit have - p_qty
    ), released as (
      update public.machine_assignments a set released_at = now(), released_by = (select auth.uid())
      from picked, public.sewing_machines m
      where a.id = picked.id and m.id = a.machine_id
      returning m.code
    )
    select array_agg(code order by code) into codes from released;
    perform private.log(p_job, 'machines_released', j.phase, 'sew', jsonb_build_object('machines', codes));
  end if;
  return codes;
end $$;

revoke all on function public.set_job_machines(uuid, text, int) from public, anon;
grant execute on function public.set_job_machines(uuid, text, int) to authenticated;
