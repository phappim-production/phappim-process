-- รายการวัตถุดิบมีวันเวลาที่คาดว่าได้รับ · เพิ่มทีละรายการต้องใส่วันคาดว่าได้รับหรือมีของแล้ว
-- set_job_materials ใช้ลบรายการเท่านั้น · ยกเลิกติ๊กของที่ไม่มีวันที่ = เลยกำหนด · เลยกำหนดรับแต่ยังไม่ติ๊ก = เตือนแอดมินทุกวัน

alter table public.job_materials add column if not exists eta timestamptz;
drop trigger if exists job_materials_ce_year on public.job_materials;
create trigger job_materials_ce_year before insert or update of eta on public.job_materials
  for each row execute function private.guard_ce_year('eta');

create or replace function private.material_time(p_at timestamptz) returns text
language sql stable set search_path = '' as $$
  select private.thai_date((p_at at time zone 'Asia/Bangkok')::date) || ' ' || to_char(p_at at time zone 'Asia/Bangkok', 'HH24:MI') || ' น.'
$$;
revoke all on function private.material_time(timestamptz) from public, anon, authenticated;

create or replace function public.add_job_material(p_job uuid, p_name text, p_eta timestamptz default null, p_have boolean default false)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; v_name text := left(btrim(regexp_replace(coalesce(p_name, ''), '[[:space:]]+', ' ', 'g')), 80); v_have boolean := coalesce(p_have, false); v_id bigint;
begin
  perform private.require_role('admin');
  j := private.lock_job(p_job);
  if j.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว' using errcode = 'P0001'; end if;
  if j.phase <> 'materials' then perform private.stale('งานนี้ปล่อยเข้าไลน์การผลิตแล้ว แก้รายการวัตถุดิบไม่ได้'); end if;
  if v_name = '' then raise exception 'พิมพ์ชื่อวัตถุดิบก่อนกดเพิ่ม' using errcode = '23514'; end if;
  if not v_have and p_eta is null then
    raise exception 'ใส่วันเวลาที่คาดว่าจะได้รับ "%" หรือติ๊ก "มีของแล้ว"', v_name using errcode = '23514';
  end if;
  if exists (select 1 from public.job_materials m where m.job_id = p_job and lower(btrim(m.name)) = lower(v_name)) then
    raise exception 'มี "%" ในรายการแล้ว', v_name using errcode = '23514';
  end if;
  if (select count(*) from public.job_materials where job_id = p_job) >= 30 then
    raise exception 'รายการวัตถุดิบไม่เกิน 30 รายการ · รวมของที่เป็นชุดเดียวกันไว้ในรายการเดียว' using errcode = '23514';
  end if;
  insert into public.job_materials (job_id, name, dept, eta, checked_at, checked_by)
    values (p_job, v_name, 'admin', p_eta, case when v_have then now() end, case when v_have then auth.uid() end)
    returning id into v_id;
  perform private.log(p_job, 'material_added', 'materials', null, jsonb_build_object('name', v_name, 'eta', p_eta, 'have', v_have));
  return v_id;
end $$;
revoke all on function public.add_job_material(uuid, text, timestamptz, boolean) from public, anon;
grant execute on function public.add_job_material(uuid, text, timestamptz, boolean) to authenticated;

create or replace function public.set_material_eta(p_material_id bigint, p_eta timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.job_materials; j public.jobs;
begin
  perform private.require_role('admin');
  select * into m from public.job_materials where id = p_material_id;
  if not found then perform private.stale('รายการนี้ถูกลบไปแล้ว'); end if;
  j := private.lock_job(m.job_id);
  select * into m from public.job_materials where id = p_material_id;
  if not found then perform private.stale('รายการนี้ถูกลบไปแล้ว'); end if;
  if j.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว' using errcode = 'P0001'; end if;
  if j.phase <> 'materials' then perform private.stale('งานนี้ปล่อยเข้าไลน์การผลิตแล้ว แก้รายการวัตถุดิบไม่ได้'); end if;
  if m.checked_at is not null then perform private.stale(format('"%s" ติ๊กว่าได้รับแล้ว · ยกเลิกติ๊กก่อนถ้าของยังไม่มา', m.name)); end if;
  if p_eta is null then raise exception 'เลือกวันเวลาที่คาดว่าจะได้รับ "%"', m.name using errcode = '23514'; end if;
  if m.eta is not distinct from p_eta then return; end if;
  update public.job_materials set eta = p_eta where id = p_material_id;
  perform private.log(m.job_id, 'material_eta', 'materials', null, jsonb_build_object('name', m.name, 'eta', p_eta, 'from', m.eta));
end $$;
revoke all on function public.set_material_eta(bigint, timestamptz) from public, anon;
grant execute on function public.set_material_eta(bigint, timestamptz) to authenticated;

create or replace function public.set_job_materials(p_job uuid, p_items text[], p_base text[] default null) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; v_items text[];
begin
  perform private.require_role('admin');
  j := private.lock_job(p_job);
  if j.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว' using errcode = 'P0001'; end if;
  if j.phase <> 'materials' then perform private.stale('งานนี้ปล่อยเข้าไลน์การผลิตแล้ว แก้รายการวัตถุดิบไม่ได้'); end if;
  if p_base is not null and p_base is distinct from
     (select coalesce(array_agg(m.name order by m.id), '{}') from public.job_materials m where m.job_id = p_job) then
    perform private.stale('รายการวัตถุดิบเพิ่งถูกแก้จากเครื่องอื่น · ดูรายการล่าสุดแล้วลองอีกครั้ง');
  end if;
  select coalesce(array_agg(x order by n), '{}') into v_items from (
    select distinct on (lower(btrim(t.x))) left(btrim(t.x), 80) as x, t.n
    from unnest(coalesce(p_items, '{}')) with ordinality as t(x, n)
    where btrim(coalesce(t.x, '')) <> ''
    order by lower(btrim(t.x)), t.n
  ) s;
  if cardinality(v_items) > 30 then
    raise exception 'รายการวัตถุดิบไม่เกิน 30 รายการ · รวมของที่เป็นชุดเดียวกันไว้ในรายการเดียว' using errcode = '23514';
  end if;
  -- รายการใหม่ต้องมีวันคาดว่าได้รับ จึงเพิ่มได้ทาง add_job_material เท่านั้น · คำสั่งนี้ใช้ลบรายการ
  if exists (select 1 from unnest(v_items) x where not exists (select 1 from public.job_materials m where m.job_id = p_job and m.name = x)) then
    raise exception 'เพิ่มรายการใหม่ด้วยปุ่ม "เพิ่ม" พร้อมวันเวลาที่คาดว่าจะได้รับ (หรือติ๊ก "มีของแล้ว")' using errcode = '23514';
  end if;
  delete from public.job_materials m where m.job_id = p_job and m.key is null and not (m.name = any (v_items));
  perform private.log(p_job, 'materials_set', 'materials', null, jsonb_build_object('items', to_jsonb(v_items)));
end $$;

create or replace function public.check_material(p_material_id bigint, p_checked boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.job_materials; j public.jobs;
begin
  perform private.require_role('admin');
  select * into m from public.job_materials where id = p_material_id;
  if not found then raise exception 'ไม่พบรายการวัตถุดิบ' using errcode = 'P0002'; end if;
  j := private.lock_job(m.job_id);
  if j.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว' using errcode = 'P0001'; end if;
  if j.phase <> 'materials' then perform private.stale('งานนี้ปล่อยเข้าไลน์การผลิตแล้ว'); end if;
  -- ยกเลิกติ๊กของที่ไม่มีวันคาดว่าได้รับ (เช่น เคยติ๊กมีของแล้ว) = นับว่าเลยกำหนดทันที ให้แอดมินใส่วันใหม่
  update public.job_materials set checked_at = case when p_checked then now() end,
                                  checked_by = case when p_checked then auth.uid() end,
                                  eta = case when p_checked then eta else coalesce(eta, now()) end
  where id = p_material_id;
  perform private.log(j.id, case when p_checked then 'material_checked' else 'material_unchecked' end, 'materials', null,
                      jsonb_build_object('material_id', p_material_id, 'name', m.name));
end $$;

-- วัตถุดิบเลยกำหนดรับเตือนก่อน (ทุกวันจนได้รับ) · ไม่มีของเลยกำหนดแต่รอนาน = เตือนรอผลิตเกิน 2 วันแบบเดิม
create or replace function private.inbox_scan_all() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_added integer := 0;
  j record;
  v_lead jsonb;
  v_left int;
  v_due text;
  v_due_n int;
  v_qty text;
begin
  for j in
    select jb.*, pt.name as product_name
    from public.jobs jb
    join public.product_types pt on pt.code = jb.product_type_code
    where jb.phase not in ('done', 'cancelled')
  loop
    v_qty := to_char(j.qty, 'FM999,999,999');

    v_lead := private.lead_state(j.id);
    if coalesce((v_lead->>'lead_over')::boolean, false) and not coalesce((v_lead->>'lead_reported')::boolean, false) then
      if private.inbox_emit('sla_over', j.id, 'lead:' || j.id,
        'เกินเวลาผลิต ' || j.confirmation_no,
        format('%s · %s %s %s · เริ่มนับ %s · เวลาผลิต %s วันทำงาน ครบ %s · ต้องส่งรายงานสาเหตุก่อนกด QC + Packing เสร็จ',
          j.customer_name, j.product_name, v_qty, j.unit, private.thai_date((v_lead->>'lead_start')::date),
          v_lead->>'lead_days', private.thai_date((v_lead->>'lead_due')::date)),
        array['production', 'admin', 'manager'])
      then v_added := v_added + 1; end if;
    end if;

    if private.uses_film(j.route_code) and j.dtf_film_received_at is null and j.dtf_film_eta is not null and v_today > j.dtf_film_eta then
      if private.inbox_emit('film_late', j.id, 'film:' || j.id || ':' || to_char(v_today, 'YYYY-MM-DD'),
        private.film_label(j.route_code) || ' เลยกำหนด ' || j.confirmation_no,
        format('%s · %s %s %s · กำหนดรับ %s · กรุณาติดตาม%s',
          j.customer_name, j.product_name, v_qty, j.unit, private.thai_date(j.dtf_film_eta), private.film_label(j.route_code)),
        array['admin', 'production'])
      then v_added := v_added + 1; end if;
    end if;

    if j.phase = 'materials' then
      select string_agg(format('%s (กำหนด %s)', m.name, private.material_time(m.eta)), ', ' order by m.eta), count(*)
        into v_due, v_due_n
        from public.job_materials m where m.job_id = j.id and m.checked_at is null and m.eta < now();
      if v_due_n > 0 then
        if private.inbox_emit('materials_late', j.id, 'matdue:' || j.id || ':' || to_char(v_today, 'YYYY-MM-DD'),
          'วัตถุดิบเลยกำหนดรับ ' || j.confirmation_no,
          format('%s · %s %s %s · ยังไม่ได้รับ %s รายการ: %s · ตามของ แล้วติ๊กเมื่อได้รับ หรือแก้วันที่คาดว่าได้รับ',
            j.customer_name, j.product_name, v_qty, j.unit, v_due_n, v_due),
          array['admin'])
        then v_added := v_added + 1; end if;
      elsif private.work_days(j.stage_entered_at, now()) > 2 then
        select count(*) into v_left from public.job_materials m where m.job_id = j.id and m.checked_at is null;
        if private.inbox_emit('materials_late', j.id, 'mat:' || j.id || ':' || to_char(v_today, 'YYYY-MM-DD'),
          'รอผลิตเกิน 2 วันทำงาน ' || j.confirmation_no,
          format('%s · %s %s %s · ยังไม่เข้าไลน์การผลิต%s · เช็ควัตถุดิบ + ถ่ายรูป แล้วกดปล่อยเข้าไลน์',
            j.customer_name, j.product_name, v_qty, j.unit,
            case when v_left > 0 then format(' · ยังไม่ได้ติ๊ก %s รายการ', v_left) else '' end),
          array['admin'])
        then v_added := v_added + 1; end if;
      end if;
    end if;

    if j.due_date in (v_today, v_today + 1) then
      if private.inbox_emit('due_soon', j.id, 'due:' || j.id || ':' || to_char(v_today, 'YYYY-MM-DD'),
        case when j.due_date = v_today then 'ครบกำหนดส่งวันนี้ ' else 'ครบกำหนดส่งพรุ่งนี้ ' end || j.confirmation_no,
        format('%s · %s %s %s · กำหนดส่ง %s',
          j.customer_name, j.product_name, v_qty, j.unit, private.thai_date(j.due_date)),
        array['production', 'admin', 'manager'])
      then v_added := v_added + 1; end if;
    end if;
  end loop;

  return v_added;
end $$;
