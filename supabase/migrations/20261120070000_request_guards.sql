-- กันคำขอซ้ำ / คำขอเก่า (QA รอบ 6 · Codex C10 บั๊ก 1–4 ระดับ 1–2)
-- 1. finish_station รับ p_station = สถานีที่หน้าจอเห็นตอนกด · งานย้ายไปสถานีอื่นแล้ว = ปฏิเสธ
--    (เดิมคำขอ "พิมพ์เสร็จ" ที่ส่งช้า/ซ้ำ จบสถานีรีดที่เพิ่งเริ่ม งานข้ามรีดไปตัด)
-- 2. record_qc / split_job / submit_delay_report รับ p_request = รหัสคำขอที่หน้าจอสร้างครั้งเดียวต่อการกรอก 1 ครั้ง
--    ส่งรหัสเดิมซ้ำ (กดสองที · เน็ตช้าแล้วกดใหม่) = ไม่บันทึกซ้ำ · คืนผลเดิม
--    (เดิม QC ส่งยอด 5 ซ้ำ = นับ 10/10 แล้วปิดงานได้ทั้งที่ตรวจจริง 5 · แบ่งงานซ้ำได้ใบลูก 2 ใบ · รายงานปัญหาซ้ำ 2 แถว)
-- ไม่ส่งพารามิเตอร์ใหม่ = ทำงานแบบเดิม (finish_sewing เรียก finish_station ภายในโดยไม่ส่งสถานี)
-- ฟังก์ชันคัดลอกจากไฟล์ล่าสุด: finish_station (20261119200000) · record_qc (20261120040000) · split_job (20261120020000) · submit_delay_report (20261117000001)

create table private.rpc_requests (
  request_id uuid primary key,
  fn         text not null,
  result     text,
  at         timestamptz not null default now()
);

-- จองรหัสคำขอ: null = คำขอใหม่ (จองแล้ว ทำต่อได้) · ไม่ใช่ null = เคยทำแล้ว คืนผลเดิม ('' = ไม่มีผลให้คืน)
-- จองในธุรกรรมเดียวกับงาน: ถ้างานล้ม การจองหายไปด้วย กดใหม่ได้ · ส่งพร้อมกัน 2 คำขอ คำขอที่ 2 รอจนคำขอแรกจบแล้วเห็นว่าซ้ำ
create function private.claim_request(p_request uuid, p_fn text) returns text
language plpgsql security definer set search_path = '' as $$
declare n int; prev text;
begin
  if p_request is null then return null; end if;
  insert into private.rpc_requests (request_id, fn) values (p_request, p_fn) on conflict (request_id) do nothing;
  get diagnostics n = row_count;
  if n = 1 then return null; end if;
  select coalesce(result, '') into prev from private.rpc_requests where request_id = p_request and fn = p_fn;
  if not found then raise exception 'รหัสคำขอนี้ใช้กับคำสั่งอื่นแล้ว · โหลดหน้าใหม่แล้วกดอีกครั้ง' using errcode = 'P0001'; end if;
  return prev;
end $$;

create function private.finish_request(p_request uuid, p_result text) returns void
language sql security definer set search_path = '' as $$
  update private.rpc_requests set result = p_result where request_id = p_request
$$;

-- ---------- finish_station: ตรวจสถานีที่หน้าจอเห็น ----------
drop function public.finish_station(uuid);
create function public.finish_station(p_job uuid, p_station text default null) returns void
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
  -- คำขอจากหน้าสถานีเดิมที่ส่งช้า/ซ้ำ ต้องไม่จบสถานีถัดไปที่เพิ่งเริ่ม
  if p_station is not null and p_station is distinct from cur then
    perform private.stale('งานนี้ไปอยู่สถานีอื่นแล้ว');
  end if;
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

-- ---------- record_qc: รหัสคำขอ ----------
drop function public.record_qc(uuid, int);
create function public.record_qc(p_job uuid, p_passed int, p_request uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text; done int;
begin
  perform private.require_role('supervisor', 'qc');
  j := private.lock_job(p_job);
  -- ล็อกงานก่อนจองรหัส: คำขอซ้ำที่มาพร้อมกันเข้าคิวที่งานเดียวกัน
  if private.claim_request(p_request, 'record_qc') is not null then return; end if;
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

-- ---------- split_job: รหัสคำขอ · ส่งซ้ำคืนใบลูกเดิม ----------
drop function public.split_job(uuid, int);
create function public.split_job(p_job uuid, p_qty int, p_request uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; new_id uuid := gen_random_uuid(); new_no text; n int; nxt numeric; target numeric; prev text;
begin
  perform private.require_role('admin');
  perform pg_advisory_xact_lock(hashtext('pp142.job_queue'));
  j := private.lock_job(p_job);
  prev := private.claim_request(p_request, 'split_job');
  if prev is not null then return nullif(prev, '')::uuid; end if;
  if j.phase <> 'production' or j.station_status is distinct from 'queued' then
    raise exception 'แบ่งงานได้เฉพาะงานผลิตจริงที่ยังไม่เริ่มสถานีนี้' using errcode = 'P0001';
  end if;
  if j.is_rework then raise exception 'งานแก้แบ่งไม่ได้ (ส่งแก้ตามจำนวนที่ QC ส่งกลับ)' using errcode = 'P0001'; end if;
  if private.station_at(j.route_code, j.station_seq) = 'qc_pack' then raise exception 'งานที่ QC + Packing แบ่งไม่ได้' using errcode = 'P0001'; end if;
  if p_qty is null or p_qty < 1 or p_qty >= j.qty then
    raise exception 'จำนวนที่แบ่งต้องอยู่ระหว่าง 1 ถึง % %', j.qty - 1, j.unit using errcode = 'P0001';
  end if;
  n := 2;
  while exists (select 1 from public.jobs where confirmation_no = j.confirmation_no || '-' || n) loop n := n + 1; end loop;
  new_no := j.confirmation_no || '-' || n;
  -- คิวถัดจากงานเดิมทันที (ไม่ต่อท้ายคิว · ทั้งสองส่วนเป็นงานเดียวกันที่รับเข้ามาพร้อมกัน)
  select min(queue_seq) into nxt from public.jobs where queue_seq > j.queue_seq;
  if nxt is not null and nxt - j.queue_seq < 2 then
    perform private.queue_renumber();
    select queue_seq into j.queue_seq from public.jobs where id = p_job;
    select min(queue_seq) into nxt from public.jobs where queue_seq > j.queue_seq;
  end if;
  target := case when nxt is null then j.queue_seq + 512 else floor((j.queue_seq + nxt) / 2) end;

  insert into public.jobs select (jsonb_populate_record(null::public.jobs, to_jsonb(j) || jsonb_build_object(
    'id', new_id, 'confirmation_no', new_no, 'qty', p_qty, 'spare_qty', 0, 'sew_count', 0,
    'queue_seq', target, 'created_at', now(), 'created_by', auth.uid(), 'stage_entered_at', now()))).*;
  update public.jobs set qty = qty - p_qty where id = p_job;
  perform private.log(p_job, 'job_split', j.phase, private.station_at(j.route_code, j.station_seq),
    jsonb_build_object('child', new_no, 'qty', p_qty, 'left', j.qty - p_qty));
  perform private.log(new_id, 'job_split_from', j.phase, private.station_at(j.route_code, j.station_seq),
    jsonb_build_object('parent', j.confirmation_no, 'qty', p_qty, 'parent_left', j.qty - p_qty));
  perform private.finish_request(p_request, new_id::text);
  return new_id;
end $$;

-- ---------- submit_delay_report: รหัสคำขอ · ส่งซ้ำคืนรายงานเดิม ----------
drop function public.submit_delay_report(uuid, text[], text, timestamptz, text);
create function public.submit_delay_report(p_job uuid, p_reasons text[], p_detail text, p_new_eta timestamptz,
                                           p_need_help text default null, p_request uuid default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text; seg public.sla_segments; bad text[]; v_id bigint; prev text;
begin
  perform private.require_role('supervisor', 'qc', 'admin', 'production');
  j := private.lock_job(p_job);
  prev := private.claim_request(p_request, 'submit_delay_report');
  if prev is not null then return nullif(prev, '')::bigint; end if;
  if j.phase <> 'production' or j.station_seq is null then perform private.stale('งานไม่ได้อยู่ในการผลิต'); end if;
  if p_reasons is null or cardinality(p_reasons) = 0 then raise exception 'ต้องเลือกรหัสสาเหตุอย่างน้อย 1 ข้อ' using errcode = '23514'; end if;
  select array_agg(x) into bad from unnest(p_reasons) x
  where not exists (select 1 from public.reason_codes c where c.code = x and c.active);
  if bad is not null then raise exception 'รหัสสาเหตุไม่ถูกต้อง: %', array_to_string(bad, ', ') using errcode = '23514'; end if;
  if coalesce(trim(p_detail), '') = '' then raise exception 'ต้องอธิบายว่าเกิดอะไรขึ้น' using errcode = '23514'; end if;
  if p_new_eta is null or p_new_eta <= now() then raise exception 'ต้องระบุวันเวลาที่คาดว่าจะเสร็จใหม่ (หลังจากตอนนี้)' using errcode = '23514'; end if;
  cur := private.station_at(j.route_code, j.station_seq);
  seg := private.segment_of(j.route_code, cur);
  insert into public.delay_reports (job_id, visit, station_code, segment_code, reasons, detail, new_eta, need_help, by)
  values (p_job, j.visit, cur, seg.code, p_reasons, trim(p_detail), p_new_eta, nullif(trim(p_need_help), ''), auth.uid())
  returning id into v_id;
  perform private.log(p_job, 'delay_report', j.phase, cur,
    jsonb_build_object('report_id', v_id, 'reasons', p_reasons, 'new_eta', p_new_eta));
  perform private.finish_request(p_request, v_id::text);
  return v_id;
end $$;

-- สิทธิ์: RPC เฉพาะคนที่ล็อกอิน · ตัวช่วย private เรียกตรงไม่ได้
do $$
declare f text;
begin
  foreach f in array array[
    'public.finish_station(uuid,text)', 'public.record_qc(uuid,int,uuid)', 'public.split_job(uuid,int,uuid)',
    'public.submit_delay_report(uuid,text[],text,timestamptz,text,uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.claim_request(uuid, text) from public, anon, authenticated;
revoke all on function private.finish_request(uuid, text) from public, anon, authenticated;
revoke all on private.rpc_requests from public, anon, authenticated;
