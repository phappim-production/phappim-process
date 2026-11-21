-- บัญชีที่ปิดแล้วอ่านบริษัทภายนอก/รอบส่งออกไม่ได้ (เหมือนตารางอื่น)
-- อนุมัติม็อคอัพฉบับรออนุมัติต้องส่งเลขเวอร์ชันที่ผู้อนุมัติเห็น · ไม่ตรง = ให้โหลดใหม่ (กันอนุมัติเนื้อหาที่ยังไม่ได้ตรวจ)

drop policy vendors_read on public.vendors;
create policy vendors_read on public.vendors for select to authenticated using ((select private.my_role()) is not null);
drop policy outsource_runs_read on public.outsource_runs;
create policy outsource_runs_read on public.outsource_runs for select to authenticated using ((select private.my_role()) is not null);

create or replace function public.approve_mockup_sheet(p_sheet uuid, p_note text default null, p_version int default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.mockup_sheets; j public.jobs; prev public.mockup_sheets; started boolean; bad text; snap jsonb; r text;
begin
  r := private.require_role('admin', 'manager', 'production');
  select * into j from public.jobs where id = (select job_id from public.mockup_sheets where id = p_sheet) for update;
  s := private.mockup_lock_sheet(p_sheet);
  if s.status = 'draft' then
    if r not in ('admin', 'owner') then
      raise exception 'ม็อคอัพฉบับ % ยังเป็นร่าง แอดมินเป็นคนอนุมัติใช้ผลิต', s.rev using errcode = '42501';
    end if;
    if not exists (select 1 from public.mockup_views where sheet_id = p_sheet and view = 'front') then
      raise exception 'ต้องมีภาพหลัก (ด้านหน้า) ก่อนอนุมัติ' using errcode = '23514';
    end if;
    select string_agg(no::text, ', ' order by no) into bad from public.mockup_callouts
    where sheet_id = p_sheet and spec_ref is null and spec_id is null and nullif(trim(body), '') is null;
    if bad is not null then
      raise exception 'Callout % ยังไม่มีสเปกหรือข้อความ ใส่ก่อนอนุมัติ', bad using errcode = '23514';
    end if;
  elsif s.status <> 'pending' then
    raise exception 'ม็อคอัพฉบับ % อนุมัติไปแล้ว', s.rev using errcode = '42501';
  end if;
  if exists (select 1 from public.mockup_sheets where job_id = s.job_id and status in ('approved', 'superseded') and rev > s.rev) then
    raise exception 'ม็อคอัพฉบับ % เก่ากว่าฉบับที่อนุมัติแล้ว อนุมัติทับไม่ได้', s.rev using errcode = 'P0001';
  end if;
  select * into prev from public.mockup_sheets where job_id = s.job_id and status = 'approved';
  started := j.phase in ('production', 'done')
    or exists (select 1 from public.events e where e.job_id = j.id and e.type = 'station_start');
  if prev.id is not null and started and r = 'production' then
    raise exception 'งานนี้เริ่มผลิตแล้ว ฉบับแก้ไขต้องให้แอดมิน ผู้บริหาร หรือเจ้าของอนุมัติ' using errcode = '42501';
  end if;
  perform private.mockup_check_version(s, p_version);
  select string_agg(c.no::text, ', ' order by c.no) into bad from public.mockup_callouts c
  where c.sheet_id = p_sheet and c.spec_ref is not null and private.mockup_ref_value(j.spec, c.spec_ref) is null;
  if bad is not null then
    raise exception 'Callout % อ้างช่องในใบยืนยันที่ไม่มีข้อมูลแล้ว ให้แก้จุดนั้นก่อนอนุมัติ', bad using errcode = '23514';
  end if;
  update public.mockup_callouts c set ref_value = private.mockup_ref_value(j.spec, c.spec_ref)
  where c.sheet_id = p_sheet and c.spec_ref is not null;

  if prev.id is not null then
    update public.mockup_sheets set status = 'superseded' where id = prev.id;
  end if;
  update public.mockup_sheets set status = 'approved', version = version + 1, approved_by = (select auth.uid()),
    approved_at = now(), approve_note = nullif(trim(p_note), ''), confirmation_rev = j.confirmation_rev,
    return_reason = null
  where id = p_sheet;

  select jsonb_build_object(
    'job', jsonb_build_object('id', j.id, 'confirmation_no', j.confirmation_no, 'confirmation_rev', j.confirmation_rev,
      'customer_name', j.customer_name, 'job_name', j.job_name, 'qty', j.qty, 'unit', j.unit, 'due_date', j.due_date),
    'rev', s.rev, 'approved_by', (select auth.uid()), 'approved_at', now(), 'note', nullif(trim(p_note), ''),
    'views', coalesce((select jsonb_agg(to_jsonb(v) order by v.view) from public.mockup_views v where v.sheet_id = p_sheet), '[]'),
    'specs', coalesce((select jsonb_agg(to_jsonb(sp) order by sp.code) from public.mockup_specs sp where sp.sheet_id = p_sheet), '[]'),
    'callouts', coalesce((select jsonb_agg(to_jsonb(c) order by c.no) from public.mockup_callouts c where c.sheet_id = p_sheet), '[]'))
  into snap;
  insert into public.mockup_snapshots (sheet_id, data) values (p_sheet, snap);
  insert into public.events (job_id, type, phase, station_code, payload, by)
  values (j.id, 'mockup_approved', j.phase, null,
    jsonb_build_object('rev', s.rev, 'sheet_id', p_sheet, 'replaced_rev', prev.rev, 'note', nullif(trim(p_note), ''),
      'from_draft', s.status = 'draft'),
    (select auth.uid()));
end $$;
