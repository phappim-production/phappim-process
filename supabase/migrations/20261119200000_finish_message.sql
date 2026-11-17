-- ข้อความตอนกดเสร็จไม่ได้ ไม่ใช้คำว่า "ขั้นย่อย" แล้ว (สถานีเหลือแค่ เริ่ม → เสร็จ ตั้งแต่ 20261119180000)
-- บอกสิ่งที่ต้องทำจริง: QC ผ่านกี่ชิ้นจากทั้งหมด และให้ส่งแก้ชิ้นที่ไม่ผ่าน · ขั้น lock บอกให้รอแอดมินบันทึก
-- พบจากการตรวจ G4 รอบ 3 (docs/qa/รอบ-3.md หัวข้อ 3) · กฎเหมือนเดิมทุกอย่าง เปลี่ยนแค่ข้อความ

create or replace function private.missing_substeps(p_job uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare j public.jobs; cur text; sub jsonb; k text; kind text; passed int; miss text[] := '{}';
begin
  select * into j from public.jobs where id = p_job;
  cur := private.station_at(j.route_code, j.station_seq);
  if cur = 'sew' or (j.is_rework and cur <> 'qc_pack') then return miss; end if;
  for sub in select s from public.stations st, jsonb_array_elements(st.substeps) s where st.code = cur loop
    k := sub->>'key'; kind := sub->>'kind';
    if kind = 'lock' then
      if j.dtf_film_received_at is null then
        miss := miss || format('รอแอดมินบันทึก "%s"', sub->>'name');
      end if;
    elsif cur = 'qc_pack' and k = 'inspect' and j.phase = 'production' then
      passed := coalesce((select sum(q.passed) from public.qc_results q where q.job_id = j.id), 0);
      if passed < j.qty then
        miss := miss || format('QC ตรวจผ่าน %s/%s ชิ้น ยังไม่ครบ (ชิ้นไม่ผ่านให้กด "ส่งแก้")', passed, j.qty);
      end if;
    end if;
  end loop;
  return miss;
end $$;

create or replace function public.finish_station(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text; miss text[]; sla jsonb; v_last int; next_seq int; r text;
begin
  r := private.require_role('supervisor', 'qc');
  j := private.lock_job(p_job);
  if j.station_status is distinct from 'doing' then
    if j.station_status = 'hold' then raise exception 'งานนี้พักอยู่ กด "แก้แล้ว" ก่อน' using errcode = 'P0001'; end if;
    perform private.stale('สถานีนี้ยังไม่ได้เริ่มหรือเสร็จไปแล้ว');
  end if;
  cur := private.station_at(j.route_code, j.station_seq);
  if r = 'qc' and cur <> 'qc_pack' then raise exception 'ฝ่าย QC กดเสร็จได้เฉพาะสถานี QC + Packing' using errcode = '42501'; end if;

  miss := private.missing_substeps(p_job);
  if cardinality(miss) > 0 then
    raise exception 'ยังกดเสร็จไม่ได้: %', array_to_string(miss, ' · ') using errcode = 'P0001';
  end if;

  sla := private.sla_state(p_job);
  if coalesce((sla->>'station_over')::boolean, false) and not coalesce((sla->>'station_reported')::boolean, false) then
    raise exception 'เกินเวลามาตรฐานของสถานีนี้ ต้องส่งรายงานปัญหาก่อนกดเสร็จ' using errcode = 'P0001';
  end if;
  if coalesce((sla->>'segment_over')::boolean, false) and not coalesce((sla->>'segment_reported')::boolean, false) then
    raise exception 'ช่วง % เกินเวลามาตรฐาน ต้องส่งรายงานปัญหาก่อนกดเสร็จ', sla->>'segment_name' using errcode = 'P0001';
  end if;

  perform private.log(p_job, 'station_done', j.phase, cur, jsonb_build_object('visit', j.visit, 'rework', j.is_rework, 'sla', sla));

  v_last := private.last_seq(j.route_code);
  if j.is_rework and cur <> 'qc_pack' then
    next_seq := v_last;                       -- งานแก้เสร็จ กลับ QC ทันที
  elsif j.station_seq < v_last then
    next_seq := j.station_seq + 1;
  end if;

  if next_seq is not null then
    perform private.enter_station(p_job, next_seq);
  elsif j.phase = 'sample' then
    update public.jobs set phase = 'sample_review', station_seq = null, station_status = null,
      station_started_at = null, stage_entered_at = now() where id = p_job;
    perform private.log(p_job, 'sample_sent', 'sample', null, jsonb_build_object('round', j.sample_round));
  else
    update public.jobs set phase = 'done', station_seq = null, station_status = null, station_started_at = null,
      is_rework = false, rework_qty = null, finished_at = now(), stage_entered_at = now() where id = p_job;
    perform private.log(p_job, 'done', 'done', null);
  end if;
end $$;
