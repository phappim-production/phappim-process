-- รีดฟิล์มที่บริษัทภายนอกทำแล้วไม่เตือนฟิล์มเลยกำหนดอีก · ร้านขายวัตถุดิบรับงานส่งออกไม่ได้ · เพิ่มบริษัทชื่อเดิมไม่ลบงานที่รับอยู่
-- ใบที่ลูกค้าเซ็นแนบครั้งเดียวได้ทุกส่วนที่แบ่งงาน

create or replace function private.past_film_press(p_route text, p_phase text, p_seq int, p_rework boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_rework, false) or (p_phase in ('sample', 'production') and exists (
    select 1 from public.route_stations where route_code = p_route and station_code = 'dtf_press' and seq < p_seq))
$$;
revoke all on function private.past_film_press(text, text, int, boolean) from public, anon, authenticated;

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

    if private.uses_film(j.route_code) and j.dtf_film_received_at is null and j.dtf_film_eta is not null and v_today > j.dtf_film_eta
       and not private.past_film_press(j.route_code, j.phase, j.station_seq, j.is_rework) then
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

create or replace function private.outsource_vendor_only() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.vendors where id = new.vendor_id and kind = 'supplier') then
    raise exception 'บริษัทนี้เป็นร้านขายวัตถุดิบ/ฟิล์ม รับงานส่งออกไม่ได้ เลือกบริษัทที่รับงานไปทำแทน' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.outsource_vendor_only() from public, anon, authenticated;
drop trigger if exists outsource_vendor_only on public.outsource_runs;
create trigger outsource_vendor_only before insert or update of vendor_id on public.outsource_runs
  for each row execute function private.outsource_vendor_only();

create or replace function public.add_vendor(p_name text, p_stations text[] default '{}', p_contact text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  perform private.require_role('admin');
  if coalesce(btrim(p_name), '') = '' then raise exception 'ใส่ชื่อบริษัท' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(coalesce(p_stations, '{}')) s where not private.outsourceable(s)) then
    raise exception 'งานที่บริษัทรับต้องเป็น พิมพ์ · รีด · ตัด · รีดฟิล์ม · เย็บ · ปัก' using errcode = 'P0001';
  end if;
  insert into public.vendors (name, stations, contact) values (btrim(p_name), coalesce(p_stations, '{}'), nullif(btrim(p_contact), ''))
  on conflict (name) do update set active = true,
    stations = array(select distinct s from unnest(public.vendors.stations || excluded.stations) s order by s),
    contact = coalesce(excluded.contact, public.vendors.contact)
  returning id into v;
  return v;
end $$;

create or replace function public.attach_confirmation_pdf(p_job uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; t public.jobs; v_root uuid;
begin
  perform private.require_role('admin');
  perform pg_advisory_xact_lock(hashtext('pp142.job_queue'));
  select * into t from public.jobs where id = p_job;
  if not found then raise exception 'ไม่พบงานนี้' using errcode = 'P0002'; end if;
  if t.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว' using errcode = 'P0001'; end if;
  v_root := private.split_root(p_job);
  select * into j from public.jobs where id = v_root for update;
  perform private.check_confirmation_pdf(p_path);
  update public.jobs set confirmation_pdf_path = p_path where id in (select private.split_family(j.id));
  perform private.log(p_job, 'confirmation_pdf', t.phase, null,
    jsonb_build_object('path', p_path, 'replaced', t.confirmation_pdf_path is not null));
end $$;
revoke all on function public.attach_confirmation_pdf(uuid, text) from public, anon;
grant execute on function public.attach_confirmation_pdf(uuid, text) to authenticated;
