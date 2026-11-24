-- งาน Develop: ขึ้นตัวอย่างอย่างเดียว ลูกค้ายืนยันตัวอย่างผ่าน = งานเสร็จ ไม่เข้าผลิตจริง · รายงานแยกนับ
-- jobs.develop + receive_job(p_develop) + record_sample_result + revise_job_spec กันเปลี่ยนชนิดงาน + job_live มีคอลัมน์ใหม่

alter table public.jobs add column if not exists develop boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_develop_needs_sample' and conrelid = 'public.jobs'::regclass) then
    alter table public.jobs add constraint jobs_develop_needs_sample check (not develop or needs_sample);
  end if;
end $$;

drop view if exists public.job_live;
create view public.job_live with (security_invoker = true) as
select j.*,
  rs.station_code                                    as current_station,
  s.name                                             as current_station_name,
  private.last_seq(j.route_code)                     as last_seq,
  (select count(*) from public.job_materials m where m.job_id = j.id and m.checked_at is null)::int as materials_pending,
  (select array_agg(distinct m.dept) from public.job_materials m where m.job_id = j.id and m.checked_at is null) as materials_waiting_depts,
  (select i.reason from public.issues i where i.job_id = j.id and i.closed_at is null order by i.opened_at desc limit 1) as hold_reason,
  coalesce((select sum(q.passed) from public.qc_results q where q.job_id = j.id), 0)::int as qc_passed,
  private.sla_state_api(j.id)                        as sla
from public.jobs j
left join public.route_stations rs on rs.route_code = j.route_code and rs.seq = j.station_seq
left join public.stations s on s.code = rs.station_code;
revoke all on public.job_live from anon;
grant select on public.job_live to authenticated;

drop function if exists public.receive_job(text, text, text, text, int, text, date, text, text, int, int, jsonb, boolean);
create or replace function public.receive_job(
  p_confirmation_no text, p_customer_name text, p_job_name text, p_product_type_code text,
  p_qty int, p_unit text, p_due_date date, p_route_code text, p_confirmation_pdf_path text,
  p_spare_qty int default 0, p_confirmation_rev int default 0, p_spec jsonb default '{}',
  p_needs_sample boolean default true, p_develop boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_pdf text; v_mockup text;
begin
  if private.my_role() in ('production', 'supervisor') then
    raise exception 'แอดมินเป็นคนส่งงานเข้าโรงงาน ให้แจ้งแอดมินส่งใบยืนยันเข้าระบบ' using errcode = '42501';
  end if;
  perform private.require_role('admin');
  v_pdf := nullif(trim(p_confirmation_pdf_path), '');
  if v_pdf is not null then
    perform private.check_confirmation_pdf(v_pdf);
  end if;
  if coalesce(trim(p_confirmation_no), '') = '' then raise exception 'ต้องระบุเลขที่ใบยืนยัน' using errcode = '23514'; end if;
  if coalesce(trim(p_customer_name), '') = '' then raise exception 'ต้องระบุชื่อลูกค้า' using errcode = '23514'; end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'จำนวนต้องมากกว่า 0' using errcode = '23514'; end if;
  if p_due_date is null then raise exception 'ต้องระบุกำหนดส่ง' using errcode = '23514'; end if;
  if coalesce(p_spare_qty, 0) < 0 then raise exception 'จำนวนเผื่อเสียติดลบไม่ได้' using errcode = '23514'; end if;
  if p_needs_sample is null then
    raise exception 'ต้องเลือกว่างานนี้ขึ้นตัวอย่างหรือไม่ (ตามที่ตกลงกับลูกค้าในใบยืนยัน)' using errcode = '23514';
  end if;
  if coalesce(p_develop, false) and not p_needs_sample then
    raise exception 'งาน Develop ต้องขึ้นตัวอย่าง · เลือก "ขึ้นตัวอย่าง (งาน Develop)"' using errcode = '23514';
  end if;
  if not exists (select 1 from public.routes where code = p_route_code and active) then
    raise exception 'ไม่พบเส้นทางผลิต %', p_route_code using errcode = '23503';
  end if;
  if not exists (select 1 from public.product_types where code = p_product_type_code) then
    raise exception 'ไม่พบประเภทสินค้า %', p_product_type_code using errcode = '23503';
  end if;
  if exists (select 1 from public.jobs where confirmation_no = trim(p_confirmation_no)) then
    raise exception 'เลขที่ใบยืนยัน % รับเข้าระบบไปแล้ว', trim(p_confirmation_no) using errcode = '23505';
  end if;

  -- รูปหาย/ผิดชนิด/ไม่ใช่ของใบนี้ = ส่งงานเข้าได้โดยไม่มีรูป ไม่ให้รูปขวางการรับงาน
  select nullif(trim(d.data->>'mockup_path'), '') into v_mockup
  from public.confirmation_drafts d where d.confirmation_no = trim(p_confirmation_no) and d.status = 'draft';
  if v_mockup is not null and (lower(v_mockup) !~ '\.(jpe?g|png|webp)$' or not private.mockup_uploaded(v_mockup)
                               or split_part(v_mockup, '/', 1) <> private.mockup_folder(p_confirmation_no)) then
    v_mockup := null;
  end if;

  insert into public.jobs (confirmation_no, confirmation_rev, customer_name, job_name, product_type_code, qty, spare_qty,
                           unit, due_date, route_code, spec, confirmation_pdf_path, phase, needs_sample, develop, created_by, mockup_path)
  values (trim(p_confirmation_no), coalesce(p_confirmation_rev, 0), trim(p_customer_name), trim(p_job_name), p_product_type_code,
          p_qty, coalesce(p_spare_qty, 0), p_unit, p_due_date, p_route_code, coalesce(p_spec, '{}'), v_pdf,
          'materials', p_needs_sample, coalesce(p_develop, false), auth.uid(), v_mockup)
  returning id into v_id;

  perform private.log(v_id, 'received', 'materials', null,
    jsonb_build_object('route', p_route_code, 'qty', p_qty, 'sample', p_needs_sample, 'develop', coalesce(p_develop, false), 'pdf', v_pdf is not null, 'mockup', v_mockup is not null));
  update public.confirmation_drafts set status = 'received', job_id = v_id, updated_at = now(), updated_by = auth.uid()
    where confirmation_no = trim(p_confirmation_no) and status = 'draft';
  perform private.release_if_ready(v_id);
  return v_id;
end $$;
revoke all on function public.receive_job(text, text, text, text, int, text, date, text, text, int, int, jsonb, boolean, boolean) from public, anon;
grant execute on function public.receive_job(text, text, text, text, int, text, date, text, text, int, int, jsonb, boolean, boolean) to authenticated;

create or replace function public.record_sample_result(p_job uuid, p_pass boolean, p_note text default null,
                                                       p_customer_confirmed_at date default null) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  perform private.require_role('admin');
  j := private.lock_job(p_job);
  if j.phase <> 'sample_review' then perform private.stale('งานไม่ได้รอผลตัวอย่าง'); end if;
  if p_pass is null then raise exception 'ต้องเลือกผล ผ่าน หรือ ไม่ผ่าน' using errcode = '23514'; end if;
  if not p_pass and coalesce(trim(p_note), '') = '' then
    raise exception 'ตัวอย่างไม่ผ่าน ต้องระบุสิ่งที่ต้องแก้' using errcode = '23514';
  end if;
  insert into public.sample_results (job_id, round, result, note, customer_confirmed_at, by)
  values (p_job, j.sample_round, case when p_pass then 'pass' else 'fail' end, nullif(trim(p_note), ''), p_customer_confirmed_at, auth.uid());
  if p_pass and j.develop then
    perform private.log(p_job, 'sample_result', j.phase, null,
      jsonb_build_object('round', j.sample_round, 'pass', true, 'note', nullif(trim(p_note), ''), 'develop', true));
    update public.jobs set phase = 'done', station_seq = null, station_status = null, station_started_at = null,
      is_rework = false, rework_qty = null, finished_at = now(), stage_entered_at = now() where id = p_job;
    -- ตัวอย่างที่ผ่านเย็บแล้วเก็บการจองจักรล่วงหน้าไว้ให้ผลิตจริง · งาน Develop ไม่ผลิตจริง จึงคืนทั้งหมด
    update public.machine_assignments set released_at = now(), released_by = (select auth.uid())
      where job_id = p_job and released_at is null;
    update public.machine_bookings set ends_at = now()
      where job_id = p_job and cancelled_at is null and starts_at < now() and ends_at > now();
    update public.machine_bookings set cancelled_at = now(), cancelled_by = (select auth.uid())
      where job_id = p_job and cancelled_at is null and starts_at >= now();
    perform private.log(p_job, 'done', 'done', null, jsonb_build_object('develop', true));
    return;
  end if;
  if p_pass then
    update public.jobs set phase = 'production', first_piece_ok = false, sew_count = 0 where id = p_job;
  else
    update public.jobs set phase = 'sample', sample_round = sample_round + 1 where id = p_job;
  end if;
  perform private.enter_station(p_job, 1);
  perform private.log(p_job, 'sample_result', j.phase, null,
    jsonb_build_object('round', j.sample_round, 'pass', p_pass, 'note', nullif(trim(p_note), '')));
end $$;

create or replace function public.revise_job_spec(
  p_job uuid, p_spec jsonb, p_rev int, p_customer_name text, p_job_name text,
  p_qty int, p_spare_qty int, p_due_date date, p_needs_sample boolean, p_changes text[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs; v_spec jsonb; v_no text; passed int; summary text[] := '{}'; labels text[];
  sheet public.mockup_sheets; stale int := 0; v_job_name text;
  family uuid[]; v_root uuid; parts text[]; family_qty int; split boolean; m public.jobs;
  volatile_keys constant text[] := array['mockup_path', 'mockup', 'imgs', 'from_job', 'revise_job', 'changes', 'job_img', 'pickOpen', 'summary', 'app', 'v'];
begin
  perform private.require_role('admin');
  v_root := private.split_root(p_job);
  if v_root <> p_job then
    select * into j from public.jobs where id = v_root;
    if j.phase = 'cancelled' then
      raise exception 'งานแม่ % ถูกยกเลิกแล้ว แก้ใบของส่วนที่แบ่งไม่ได้ · ถ้าลูกค้าแก้สเปก ให้รับเป็นใบใหม่', j.confirmation_no
        using errcode = 'P0001';
    end if;
    p_job := v_root;
  end if;
  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'ไม่พบงานนี้' using errcode = 'P0002'; end if;
  if j.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว แก้ใบยืนยันไม่ได้' using errcode = 'P0001'; end if;

  if p_spec is null or jsonb_typeof(p_spec) <> 'object' or jsonb_typeof(p_spec->'h') is distinct from 'object'
     or jsonb_typeof(p_spec->'p') is distinct from 'object' or jsonb_typeof(p_spec->'product') is distinct from 'string' then
    raise exception 'ข้อมูลใบยืนยันไม่ถูกต้อง ให้กดบันทึกจากฟอร์มใบยืนยันการผลิต' using errcode = '22023';
  end if;
  v_no := trim(coalesce(p_spec->'h'->>'doc_no', ''));
  if v_no <> j.confirmation_no then
    raise exception 'เลขที่ใบในฟอร์ม (%) ไม่ตรงกับงาน % · แก้เลขที่ใบกลับเป็น % แล้วบันทึกอีกครั้ง', v_no, j.confirmation_no, j.confirmation_no
      using errcode = '23514';
  end if;
  if p_spec->>'product' is distinct from j.product_type_code then
    raise exception 'เปลี่ยนชนิดสินค้าหลังรับงานไม่ได้ · ถ้าลูกค้าเปลี่ยนสินค้า ให้ผู้บริหารยกเลิกงานนี้แล้วรับใบใหม่' using errcode = '23514';
  end if;
  if p_needs_sample is distinct from j.needs_sample then
    raise exception 'งานนี้รับเข้าแบบ% เปลี่ยนในใบแก้ไม่ได้ · เลือก "ขึ้นตัวอย่าง" ในฟอร์มให้ตรงกับงาน',
      case when j.needs_sample then 'ขึ้นตัวอย่าง' else 'ไม่ขึ้นตัวอย่าง' end using errcode = '23514';
  end if;
  if p_spec->'h' ? 'sample' and ((p_spec->'h'->>'sample') ~ 'Develop') is distinct from j.develop then
    raise exception 'งานนี้รับเข้าแบบ% เปลี่ยนในใบแก้ไม่ได้ · เลือก "ขึ้นตัวอย่าง" ในฟอร์มให้ตรงกับงาน',
      case when j.develop then 'งาน Develop (จบที่ตัวอย่าง)' else 'ผลิตจริง' end using errcode = '23514';
  end if;
  if coalesce(p_rev, 0) < 1 then
    raise exception 'ใส่ "แก้ไขครั้งที่" ในฟอร์มก่อนบันทึกการแก้ (ใบแรกที่รับงานคือครั้งที่ 0)' using errcode = '23514';
  end if;
  if p_rev < j.confirmation_rev then
    raise exception 'งานนี้บันทึกใบแก้ไขครั้งที่ % ไว้แล้ว · ใส่ "แก้ไขครั้งที่" เป็น % ขึ้นไป', j.confirmation_rev, j.confirmation_rev
      using errcode = '23514';
  end if;
  if coalesce(trim(p_customer_name), '') = '' then raise exception 'ต้องระบุชื่อลูกค้า' using errcode = '23514'; end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'จำนวนต้องมากกว่า 0' using errcode = '23514'; end if;
  if coalesce(p_spare_qty, 0) < 0 then raise exception 'จำนวนเผื่อเสียติดลบไม่ได้' using errcode = '23514'; end if;
  if p_due_date is null then raise exception 'ต้องระบุกำหนดส่ง' using errcode = '23514'; end if;

  select array_agg(f.id order by x.confirmation_no), array_agg(x.confirmation_no order by x.confirmation_no), sum(x.qty)
    into family, parts, family_qty
    from private.split_family(p_job) f(id) join public.jobs x on x.id = f.id;
  split := cardinality(family) > 1;
  perform 1 from public.jobs where id = any(family) for update;

  if split and p_qty <> family_qty then
    raise exception 'งาน % ถูกแบ่งเป็น % แล้ว (รวม % ชิ้น) เปลี่ยนจำนวนในใบแก้ไม่ได้ · ใส่จำนวนในฟอร์มกลับเป็น % แล้วบันทึกอีกครั้ง · ถ้าลูกค้าสั่งเพิ่มให้รับเป็นงานใหม่',
      j.confirmation_no, array_to_string(parts, ', '), family_qty, family_qty using errcode = '23514';
  end if;
  if not split and p_qty <> j.qty and j.phase = 'done' then
    raise exception 'งาน % ผลิตเสร็จแล้ว เปลี่ยนจำนวนไม่ได้ · ถ้าลูกค้าสั่งเพิ่มให้รับเป็นงานใหม่', j.confirmation_no using errcode = 'P0001';
  end if;
  passed := coalesce((select sum(q.passed) from public.qc_results q where q.job_id = p_job), 0);
  if not split and p_qty < passed then
    raise exception 'QC ผ่านไปแล้ว % ชิ้น ลดจำนวนต่ำกว่านี้ไม่ได้', passed using errcode = '23514';
  end if;

  v_spec := p_spec - volatile_keys;
  v_job_name := coalesce(nullif(trim(p_job_name), ''), j.job_name);
  if (j.spec - volatile_keys) = v_spec and p_rev = j.confirmation_rev and trim(p_customer_name) = j.customer_name
     and v_job_name = j.job_name and (split or p_qty = j.qty) and coalesce(p_spare_qty, 0) = j.spare_qty and p_due_date = j.due_date then
    return jsonb_build_object('changed', false);
  end if;

  if not split and p_qty <> j.qty then summary := summary || format('จำนวน %s → %s', j.qty, p_qty); end if;
  if coalesce(p_spare_qty, 0) <> j.spare_qty then summary := summary || format('เผื่อเสีย %s → %s', j.spare_qty, coalesce(p_spare_qty, 0)); end if;
  if p_due_date <> j.due_date then
    summary := summary || format('กำหนดส่ง %s → %s', private.thai_date(j.due_date), private.thai_date(p_due_date));
  end if;
  if trim(p_customer_name) <> j.customer_name then summary := summary || 'ชื่อลูกค้า'::text; end if;
  if v_job_name <> j.job_name then summary := summary || 'ชื่องาน'::text; end if;
  select coalesce(array_agg(l order by n), '{}') into labels from (
    select distinct on (l) left(trim(c), 80) as l, n from unnest(coalesce(p_changes, '{}')) with ordinality as t(c, n)
    where trim(coalesce(c, '')) <> '' order by l, n
  ) x;
  labels := labels[1:40];

  update public.jobs set spec = v_spec, confirmation_rev = p_rev, customer_name = trim(p_customer_name), job_name = v_job_name,
    qty = case when split then qty else p_qty end, spare_qty = coalesce(p_spare_qty, 0), due_date = p_due_date
    where id = p_job;
  update public.jobs set spec = v_spec, confirmation_rev = p_rev, customer_name = trim(p_customer_name), job_name = v_job_name,
    due_date = p_due_date
    where id = any(family) and id <> p_job and phase <> 'cancelled';

  select * into sheet from public.mockup_sheets where job_id = p_job and status = 'approved' order by rev desc limit 1;
  if found then
    select count(*) into stale from public.mockup_callouts c
      where c.sheet_id = sheet.id and c.spec_ref is not null
        and c.ref_value is distinct from private.mockup_ref_value(v_spec, c.spec_ref);
  end if;

  for m in select * from public.jobs where id = any(family) and (id = p_job or phase <> 'cancelled') loop
    perform private.log(m.id, 'spec_revised', m.phase, private.station_at(m.route_code, m.station_seq), jsonb_build_object(
      'rev_from', j.confirmation_rev, 'rev', p_rev, 'summary', to_jsonb(summary), 'fields', to_jsonb(labels),
      'qty_from', case when m.id = p_job then j.qty else m.qty end, 'qty_to', m.qty, 'due_from', j.due_date, 'due_to', p_due_date,
      'spare_from', case when m.id = p_job then j.spare_qty else m.spare_qty end, 'spare_to', m.spare_qty,
      'renamed', to_jsonb(array_remove(array[case when trim(p_customer_name) <> j.customer_name then 'ชื่อลูกค้า' end,
                                           case when v_job_name <> j.job_name then 'ชื่องาน' end], null)),
      'mockup_rev', case when m.id = p_job then sheet.rev end, 'mockup_stale', case when m.id = p_job then stale else 0 end,
      'parts', case when split then to_jsonb(parts) end));
  end loop;

  begin
    perform private.inbox_emit('spec_revised', j.id, 'revise:' || j.id || ':' || p_rev || ':' || extract(epoch from clock_timestamp()),
      format('แก้ใบยืนยัน %s ครั้งที่ %s', j.confirmation_no, p_rev),
      concat_ws(' · ', trim(p_customer_name), v_job_name,
        case when split then 'ใช้กับทุกส่วนที่แบ่ง: ' || array_to_string(parts, ', ') end,
        nullif(array_to_string(summary, ' · '), ''),
        case when cardinality(labels) > 0 then 'ช่องที่แก้: ' || array_to_string(labels[1:8], ', ')
          || case when cardinality(labels) > 8 then format(' และอีก %s ช่อง', cardinality(labels) - 8) else '' end end,
        case when stale > 0 then format('ม็อคอัพกำกับสเปกฉบับ %s ยังเป็นค่าเก่า %s จุด รอแอดมินทำฉบับใหม่', sheet.rev, stale) end,
        'ผลิตตามสเปกใหม่ในรายละเอียดงาน'),
      array['admin', 'production', 'supervisor', 'qc', 'manager']);
  exception when others then
    perform private.inbox_log_error('revise_job_spec', sqlerrm);
  end;

  return jsonb_build_object('changed', true, 'rev', p_rev, 'mockup_rev', sheet.rev, 'mockup_stale', stale,
    'parts', case when split then to_jsonb(parts) end);
end $$;

revoke all on function public.revise_job_spec(uuid, jsonb, int, text, text, int, int, date, boolean, text[]) from public, anon;
grant execute on function public.revise_job_spec(uuid, jsonb, int, text, text, int, int, date, boolean, text[]) to authenticated;
