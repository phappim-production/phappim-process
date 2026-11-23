-- แอดมินแก้ใบยืนยันหลังรับงาน แล้วบันทึกสเปก/จำนวน/กำหนดส่งใหม่เข้างาน · ลง events + แจ้งกล่องจดหมายทุกฝ่าย
-- เปลี่ยนสินค้า/การขึ้นตัวอย่างไม่ได้ · บอกจำนวนจุดในม็อคอัพฉบับอนุมัติที่ยังอ้างค่าเก่า

alter table public.inbox_messages drop constraint inbox_messages_kind_check;
alter table public.inbox_messages add constraint inbox_messages_kind_check check (kind in (
  'hold', 'delay_report', 'rework', 'sewing_issue', 'machine_broken',
  'sample_failed', 'sla_over', 'film_late', 'materials_late', 'due_soon',
  'mockup_pending', 'mockup_returned', 'mockup_approved', 'job_cancelled', 'spec_revised'
));
insert into public.inbox_settings (kind, enabled) values ('spec_revised', true) on conflict (kind) do nothing;

create or replace function private.thai_date(d date) returns text
language sql immutable set search_path = '' as $$
  select extract(day from d)::int || '/' || extract(month from d)::int || '/' || (extract(year from d)::int + 543)
$$;
revoke all on function private.thai_date(date) from public, anon;

create or replace function public.revise_job_spec(
  p_job uuid, p_spec jsonb, p_rev int, p_customer_name text, p_job_name text,
  p_qty int, p_spare_qty int, p_due_date date, p_needs_sample boolean, p_changes text[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs; v_spec jsonb; v_no text; passed int; summary text[] := '{}'; labels text[];
  sheet public.mockup_sheets; stale int := 0; v_job_name text;
  volatile_keys constant text[] := array['mockup_path', 'mockup', 'imgs', 'from_job', 'revise_job', 'changes', 'job_img', 'pickOpen', 'summary', 'app', 'v'];
begin
  perform private.require_role('admin');
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
  if p_qty <> j.qty and j.phase = 'done' then
    raise exception 'งาน % ผลิตเสร็จแล้ว เปลี่ยนจำนวนไม่ได้ · ถ้าลูกค้าสั่งเพิ่มให้รับเป็นงานใหม่', j.confirmation_no using errcode = 'P0001';
  end if;
  passed := coalesce((select sum(q.passed) from public.qc_results q where q.job_id = p_job), 0);
  if p_qty < passed then
    raise exception 'QC ผ่านไปแล้ว % ชิ้น ลดจำนวนต่ำกว่านี้ไม่ได้', passed using errcode = '23514';
  end if;

  v_spec := p_spec - volatile_keys;
  v_job_name := coalesce(nullif(trim(p_job_name), ''), j.job_name);
  if (j.spec - volatile_keys) = v_spec and p_rev = j.confirmation_rev and trim(p_customer_name) = j.customer_name
     and v_job_name = j.job_name and p_qty = j.qty and coalesce(p_spare_qty, 0) = j.spare_qty and p_due_date = j.due_date then
    return jsonb_build_object('changed', false);
  end if;

  if p_qty <> j.qty then summary := summary || format('จำนวน %s → %s', j.qty, p_qty); end if;
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
    qty = p_qty, spare_qty = coalesce(p_spare_qty, 0), due_date = p_due_date
    where id = p_job;

  select * into sheet from public.mockup_sheets where job_id = p_job and status = 'approved' order by rev desc limit 1;
  if found then
    select count(*) into stale from public.mockup_callouts c
      where c.sheet_id = sheet.id and c.spec_ref is not null
        and c.ref_value is distinct from private.mockup_ref_value(v_spec, c.spec_ref);
  end if;

  perform private.log(p_job, 'spec_revised', j.phase, private.station_at(j.route_code, j.station_seq), jsonb_build_object(
    'rev_from', j.confirmation_rev, 'rev', p_rev, 'summary', to_jsonb(summary), 'fields', to_jsonb(labels),
    'qty_from', j.qty, 'qty_to', p_qty, 'due_from', j.due_date, 'due_to', p_due_date,
    'spare_from', j.spare_qty, 'spare_to', coalesce(p_spare_qty, 0),
    'renamed', to_jsonb(array_remove(array[case when trim(p_customer_name) <> j.customer_name then 'ชื่อลูกค้า' end,
                                         case when v_job_name <> j.job_name then 'ชื่องาน' end], null)),
    'mockup_rev', sheet.rev, 'mockup_stale', stale));

  begin
    perform private.inbox_emit('spec_revised', j.id, 'revise:' || j.id || ':' || p_rev || ':' || extract(epoch from clock_timestamp()),
      format('แก้ใบยืนยัน %s ครั้งที่ %s', j.confirmation_no, p_rev),
      concat_ws(' · ', trim(p_customer_name), v_job_name,
        nullif(array_to_string(summary, ' · '), ''),
        case when cardinality(labels) > 0 then 'ช่องที่แก้: ' || array_to_string(labels[1:8], ', ')
          || case when cardinality(labels) > 8 then format(' และอีก %s ช่อง', cardinality(labels) - 8) else '' end end,
        case when stale > 0 then format('ม็อคอัพกำกับสเปกฉบับ %s ยังเป็นค่าเก่า %s จุด รอแอดมินทำฉบับใหม่', sheet.rev, stale) end,
        'ผลิตตามสเปกใหม่ในรายละเอียดงาน'),
      array['admin', 'production', 'supervisor', 'qc', 'manager']);
  exception when others then
    perform private.inbox_log_error('revise_job_spec', sqlerrm);
  end;

  return jsonb_build_object('changed', true, 'rev', p_rev, 'mockup_rev', sheet.rev, 'mockup_stale', stale);
end $$;

revoke all on function public.revise_job_spec(uuid, jsonb, int, text, text, int, int, date, boolean, text[]) from public, anon;
grant execute on function public.revise_job_spec(uuid, jsonb, int, text, text, int, int, date, boolean, text[]) to authenticated;
