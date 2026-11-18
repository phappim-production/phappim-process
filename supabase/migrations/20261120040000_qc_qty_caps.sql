-- QA รอบ 5 (Codex C9) บั๊กระดับ 1: QC บันทึกยอดผ่านสะสม / ยอดส่งกลับแก้ เกินจำนวนงานได้
-- ยอดผ่านเกินทำให้รายงาน % ผ่านผิด · ยอดแก้เกินทำให้งานแก้ไปทำชิ้นที่ไม่มีอยู่จริง
-- เพดานทั้งคู่ = จำนวนงาน − ยอดผ่านสะสม (ตรวจหลัง lock งาน กันกดพร้อมกันสองเครื่อง)
-- คัดลอกจาก 20261117000001_workflow.sql แล้วเพิ่มเฉพาะการตรวจเพดาน

create or replace function public.record_qc(p_job uuid, p_passed int) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text; done int;
begin
  perform private.require_role('supervisor', 'qc');
  j := private.lock_job(p_job);
  cur := private.station_at(j.route_code, j.station_seq);
  if j.phase <> 'production' or cur is distinct from 'qc_pack' then perform private.stale('งานไม่ได้อยู่ที่ QC'); end if;
  if j.station_status is distinct from 'doing' then raise exception 'ต้องกด "เริ่ม" สถานี QC ก่อน' using errcode = 'P0001'; end if;
  if p_passed is null or p_passed <= 0 then raise exception 'จำนวนที่ผ่านต้องมากกว่า 0' using errcode = '23514'; end if;
  done := coalesce((select sum(q.passed) from public.qc_results q where q.job_id = p_job), 0);
  if done >= j.qty then
    raise exception 'ผ่านครบ %/% ชิ้นแล้ว · กด "QC + Packing เสร็จ" ได้เลย', done, j.qty using errcode = '23514';
  end if;
  if done + p_passed > j.qty then
    raise exception 'บันทึกผ่านได้อีกไม่เกิน % ชิ้น (ผ่านแล้ว %/% ชิ้น) · ตรวจจำนวนแล้วกรอกใหม่', j.qty - done, done, j.qty using errcode = '23514';
  end if;
  insert into public.qc_results (job_id, passed, failed, by) values (p_job, p_passed, 0, auth.uid());
  perform private.log(p_job, 'qc_result', j.phase, cur, jsonb_build_object('passed', p_passed));
end $$;

create or replace function public.send_rework(p_job uuid, p_qty int, p_reason text, p_source_station text) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text; src_seq int; qc_seq int; done int;
begin
  perform private.require_role('supervisor', 'qc');
  j := private.lock_job(p_job);
  cur := private.station_at(j.route_code, j.station_seq);
  if j.phase <> 'production' or cur is distinct from 'qc_pack' then perform private.stale('งานไม่ได้อยู่ที่ QC'); end if;
  if j.station_status is distinct from 'doing' then raise exception 'ต้องกด "เริ่ม" สถานี QC ก่อน' using errcode = 'P0001'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'ส่งแก้ต้องระบุจำนวนมากกว่า 0' using errcode = '23514'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'ส่งแก้ต้องระบุสาเหตุ' using errcode = '23514'; end if;
  done := coalesce((select sum(q.passed) from public.qc_results q where q.job_id = p_job), 0);
  if done >= j.qty then
    raise exception 'ผ่านครบ %/% ชิ้นแล้ว ไม่มีชิ้นให้ส่งแก้ · กด "QC + Packing เสร็จ" ได้เลย', done, j.qty using errcode = '23514';
  end if;
  if p_qty > j.qty - done then
    raise exception 'ส่งแก้ได้ไม่เกิน % ชิ้น (ทั้งหมด % · ผ่านแล้ว %) · ตรวจจำนวนแล้วกรอกใหม่', j.qty - done, j.qty, done using errcode = '23514';
  end if;
  select seq into src_seq from public.route_stations where route_code = j.route_code and station_code = p_source_station;
  qc_seq := j.station_seq;
  if src_seq is null or src_seq >= qc_seq then
    raise exception 'ต้องเลือกสถานีต้นเหตุที่อยู่ก่อน QC ในเส้นทางของงานนี้' using errcode = '23514';
  end if;
  insert into public.qc_results (job_id, passed, failed, reasons, source_station, by)
  values (p_job, 0, p_qty, jsonb_build_array(trim(p_reason)), p_source_station, auth.uid());
  update public.jobs set is_rework = true, rework_qty = p_qty where id = p_job;
  perform private.enter_station(p_job, src_seq);
  perform private.log(p_job, 'rework', j.phase, p_source_station,
    jsonb_build_object('qty', p_qty, 'reason', trim(p_reason), 'from', cur));
end $$;
