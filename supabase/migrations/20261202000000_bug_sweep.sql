-- ตรวจปี ค.ศ. เฉพาะช่องที่เปลี่ยนจริง · ใบแก้จากฟอร์มที่เปิดไว้ก่อนมีใบแก้ใหม่กว่า บันทึกทับไม่ได้
-- รับทราบม็อคอัพ: ผู้ควบคุมงานรับทราบได้เฉพาะสถานีในเฟสตัวเอง · งานที่ยกเลิกแล้วรับทราบไม่ได้

create or replace function private.guard_ce_year() returns trigger
language plpgsql set search_path = '' as $$
declare col text; y int; rec jsonb := to_jsonb(new); prev jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
begin
  foreach col in array tg_argv loop
    continue when prev is not null and prev -> col is not distinct from rec -> col;
    y := (regexp_match(rec ->> col, '^(\d+)-'))[1]::int;
    if y is not null and y not between 2000 and 2399 then
      raise exception 'ปี % ไม่ถูกต้อง · ระบบใช้ปี ค.ศ. (พ.ศ. 2569 = ค.ศ. 2026) เลือกวันจากปฏิทินใหม่', y using errcode = '23514';
    end if;
  end loop;
  return new;
end $$;
revoke all on function private.guard_ce_year() from public, anon, authenticated;

create or replace function public.ack_mockup_sheet(p_sheet uuid, p_station text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.mockup_sheets; j public.jobs; r text; my_section smallint; st public.stations;
begin
  r := private.require_role('production', 'supervisor', 'qc');
  select * into s from public.mockup_sheets where id = p_sheet;
  if not found then raise exception 'ไม่พบม็อคอัพฉบับนี้' using errcode = 'P0002'; end if;
  if s.status <> 'approved' then
    raise exception 'รับทราบได้เฉพาะม็อคอัพฉบับที่อนุมัติและใช้ผลิตอยู่' using errcode = '42501';
  end if;
  select * into j from public.jobs where id = s.job_id;
  if j.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว ไม่ต้องรับทราบม็อคอัพ' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.route_stations rs where rs.route_code = j.route_code and rs.station_code = p_station) then
    raise exception 'งาน % ไม่ผ่านสถานีนี้' , j.confirmation_no using errcode = '23514';
  end if;
  if r = 'staff' and not exists (select 1 from public.staff_stations ss where ss.user_id = (select auth.uid()) and ss.station_code = p_station) then
    raise exception 'รับทราบได้เฉพาะสถานีที่จับคู่กับบัญชีคุณ' using errcode = '42501';
  end if;
  if r = 'qc' and p_station <> 'qc_pack' then
    raise exception 'ฝ่าย QC รับทราบได้เฉพาะสถานี QC + Packing' using errcode = '42501';
  end if;
  if private.my_role() = 'supervisor' then
    select p.section into my_section from public.profiles p where p.user_id = (select auth.uid());
    select * into st from public.stations where code = p_station;
    if my_section is not null and st.section is distinct from my_section then
      raise exception 'สถานี% อยู่เฟส % ให้ผู้ควบคุมงานเฟส % เป็นคนกดรับทราบ', st.name, st.section, st.section using errcode = '42501';
    end if;
  end if;
  insert into public.mockup_acks (sheet_id, job_id, rev, user_id, station_code)
  values (p_sheet, j.id, s.rev, (select auth.uid()), p_station)
  on conflict (sheet_id, user_id, station_code) do nothing;
end $$;

create or replace function public.revise_job_spec(
  p_job uuid, p_spec jsonb, p_rev int, p_customer_name text, p_job_name text,
  p_qty int, p_spare_qty int, p_due_date date, p_needs_sample boolean, p_changes text[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs; v_spec jsonb; v_no text; passed int; summary text[] := '{}'; labels text[];
  sheet public.mockup_sheets; stale int := 0; v_job_name text;
  family uuid[]; v_root uuid; parts text[]; family_qty int; split boolean; m public.jobs; v_rework int;
  volatile_keys constant text[] := array['mockup_path', 'mockup', 'imgs', 'from_job', 'revise_job', 'changes', 'job_img', 'pickOpen', 'summary', 'app', 'v', 'base_rev', 'sent_sig', 'sys'];
begin
  perform private.require_role('admin');
  -- ล็อกเดียวกับ split_job: ไม่ให้มีส่วนใหม่เกิดระหว่างหาครอบครัวงาน แล้วค้างสเปกเก่า
  perform pg_advisory_xact_lock(hashtext('pp142.job_queue'));
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
  -- ฟอร์มส่งเลขครั้งที่แก้ของงานตอนเปิดใบมา · มีใบแก้ใหม่กว่าบันทึกหลังจากนั้น = ใบนี้จะทับการแก้ล่าสุดเงียบๆ
  if p_spec->>'base_rev' ~ '^[0-9]+$' and (p_spec->>'base_rev')::int <> j.confirmation_rev then
    raise exception 'มีการบันทึกใบแก้ไขครั้งที่ % ของงาน % หลังจากเปิดใบนี้ · ปิดฟอร์มนี้ แล้วกด "แก้ใบยืนยัน" ที่งานเพื่อเปิดใบล่าสุดแล้วแก้ใหม่',
      j.confirmation_rev, j.confirmation_no using errcode = 'P0001';
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
  -- ที่ QC จำนวนส่งแก้เป็นประวัติของรอบที่กลับมาแล้ว จึงตรวจเฉพาะตอนงานยังอยู่สถานีแก้
  if not split and p_qty < j.qty and j.is_rework and j.rework_qty > p_qty - passed
     and private.station_at(j.route_code, j.station_seq) is distinct from 'qc_pack' then
    if p_qty - passed < 1 then
      raise exception 'งาน % กำลังแก้ % ชิ้น (QC ผ่านแล้ว % ชิ้น) ลดจำนวนเหลือ % ไม่ได้ เพราะไม่เหลือชิ้นที่กำลังแก้ · ใส่จำนวนอย่างน้อย % หรือให้งานแก้กลับถึง QC ก่อนแล้วบันทึกใบแก้อีกครั้ง',
        j.confirmation_no, j.rework_qty, passed, p_qty, passed + 1 using errcode = '23514';
    end if;
    v_rework := p_qty - passed;
  end if;

  v_spec := p_spec - volatile_keys;
  v_job_name := coalesce(nullif(trim(p_job_name), ''), j.job_name);
  if (j.spec - volatile_keys) = v_spec and p_rev = j.confirmation_rev and trim(p_customer_name) = j.customer_name
     and v_job_name = j.job_name and (split or p_qty = j.qty) and coalesce(p_spare_qty, 0) = j.spare_qty and p_due_date = j.due_date then
    return jsonb_build_object('changed', false);
  end if;

  if not split and p_qty <> j.qty then summary := summary || format('จำนวน %s → %s', j.qty, p_qty); end if;
  if v_rework is not null then summary := summary || format('จำนวนส่งแก้ %s → %s', j.rework_qty, v_rework); end if;
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
    qty = case when split then qty else p_qty end, rework_qty = coalesce(v_rework, rework_qty), spare_qty = coalesce(p_spare_qty, 0), due_date = p_due_date
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
