-- ส่งออกบริษัทภายนอกได้ตั้งแต่ขั้นรอผลิต ไม่ต้องเช็ควัตถุดิบ: ปล่อยเข้าไลน์ (released · outsource) แล้วส่งออกจากสถานีแรก

create or replace function public.send_out(p_job uuid, p_vendor bigint, p_last_station text,
  p_arrive_at timestamptz, p_lead_days numeric, p_back_at timestamptz, p_note text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text; span record; run_id bigint; vname text; n_items int; n_photos int;
begin
  perform private.require_role('admin');
  j := private.lock_job(p_job);
  -- บริษัทภายนอกจัดหาวัตถุดิบเอง จึงส่งออกจากขั้นรอผลิตได้โดยไม่ต้องเช็ค · ปล่อยแบบเดียวกับ release_job · ส่งไม่สำเร็จ = ย้อนกลับไปรอผลิตทั้งหมด
  if j.phase = 'materials' then
    select count(*) into n_items from public.job_materials where job_id = p_job;
    select count(*) into n_photos from public.job_material_photos where job_id = p_job;
    update public.jobs set queue_seq = nextval('public.job_queue_seq'),
      phase = case when j.needs_sample then 'sample' else 'production' end,
      first_piece_ok = case when j.needs_sample then first_piece_ok else false end,
      sew_count = case when j.needs_sample then sew_count else 0 end
      where id = p_job;
    perform private.enter_station(p_job, 1);
    perform private.log(p_job, 'released', case when j.needs_sample then 'sample' else 'production' end, null,
      case when j.needs_sample then jsonb_build_object('round', j.sample_round) else jsonb_build_object('sample', false) end
      || jsonb_build_object('manual', true, 'materials', n_items, 'photos', n_photos, 'outsource', true));
    select * into j from public.jobs where id = p_job;
  end if;
  if j.phase not in ('sample', 'production') then perform private.stale('งานไม่ได้อยู่ในสถานี'); end if;
  if j.station_status = 'out' then raise exception 'งานนี้อยู่ที่บริษัทภายนอกแล้ว' using errcode = 'P0001'; end if;
  if j.station_status is distinct from 'queued' then
    raise exception 'ส่งออกได้เฉพาะงานที่ยังไม่เริ่มสถานีนี้ (ตอนนี้: %)', case j.station_status when 'doing' then 'กำลังทำ' when 'hold' then 'พักงาน' else '-' end using errcode = 'P0001';
  end if;
  cur := private.station_at(j.route_code, j.station_seq);
  if not private.outsourceable(cur) then
    raise exception 'สถานี % ทำที่โรงงานเท่านั้น', private.station_name(cur) using errcode = 'P0001';
  end if;
  select name into vname from public.vendors where id = p_vendor and active;
  if vname is null then raise exception 'ไม่พบบริษัทนี้ เลือกบริษัทจากรายการ' using errcode = 'P0001'; end if;
  perform private.check_out_plan(p_arrive_at, p_lead_days, p_back_at);
  select * into span from private.out_span(j.route_code, j.station_seq, coalesce(p_last_station, cur));
  -- งานแก้ (QC ส่งกลับ) ทำเฉพาะสถานีต้นเหตุแล้วกลับ QC
  if j.is_rework and span.to_seq <> j.station_seq then
    raise exception 'งานแก้ส่งออกได้เฉพาะสถานีต้นเหตุ (%) แล้วกลับมา QC', private.station_name(cur) using errcode = 'P0001';
  end if;

  insert into public.outsource_runs (job_id, vendor_id, from_seq, to_seq, stations, qty, is_rework, arrive_at, lead_days, back_at, note)
  values (p_job, p_vendor, j.station_seq, span.to_seq, span.stations,
          case when j.is_rework then coalesce(j.rework_qty, j.qty) else j.qty end, j.is_rework,
          p_arrive_at, p_lead_days, p_back_at, nullif(btrim(p_note), ''))
  returning id into run_id;
  perform set_config('pp142.outsource', '1', true);
  update public.jobs set station_status = 'out', station_started_at = null, stage_entered_at = now() where id = p_job;
  perform set_config('pp142.outsource', '', true);
  if 'sew' = any (span.stations) then
    perform private.leave_sewing(j.id, j.phase = 'sample' and not j.develop);
  end if;
  perform private.log(p_job, 'outsource_sent', j.phase, cur, jsonb_build_object(
    'run', run_id, 'vendor', vname, 'stations', to_jsonb(span.stations), 'arrive_at', p_arrive_at,
    'lead_days', p_lead_days, 'back_at', p_back_at, 'rework', j.is_rework, 'note', nullif(btrim(p_note), '')));
  return run_id;
end $$;
