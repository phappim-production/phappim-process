-- audit_log: บันทึกทุกการแก้ตั้งค่า/ผู้ใช้/สถานีของเจ้าของ (ค่าเดิม → ค่าใหม่) แก้/ลบไม่ได้
-- manager_acks: ผู้บริหารกด "รับทราบ" รายงานเกินเวลามาตรฐาน และการแทรกคิว/เริ่มข้ามคิว (ไม่หยุดงาน)

create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  by         uuid references auth.users(id) on delete set null,
  table_name text not null,
  row_key    text not null,
  action     text not null check (action in ('insert', 'update', 'delete')),
  old_row    jsonb,
  new_row    jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_by_idx on public.audit_log (by);
alter table public.audit_log enable row level security;
create policy audit_log_owner_read on public.audit_log for select to authenticated using ((select private.is_owner()));
revoke all on public.audit_log from anon;
grant select on public.audit_log to authenticated;

create or replace function private.audit_log_no_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log เป็นบันทึกแบบเพิ่มอย่างเดียว ห้ามแก้หรือลบ';
end $$;
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function private.audit_log_no_change();

-- บันทึกเฉพาะที่เจ้าของแก้ผ่านหน้าตั้งค่า · การกดงานของคนหน้างานมีใน events / machine_status_log อยู่แล้ว
create or replace function private.audit_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_j jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  new_j jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  key_text text;
begin
  if private.my_role() is distinct from 'owner' then return null; end if;
  if tg_op = 'UPDATE' and old_j = new_j then return null; end if;
  select string_agg(coalesce(new_j, old_j) ->> col, ':' order by n) into key_text
  from unnest(tg_argv) with ordinality as k(col, n);
  insert into public.audit_log (by, table_name, row_key, action, old_row, new_row)
  values ((select auth.uid()), tg_table_name, coalesce(key_text, ''), lower(tg_op), old_j, new_j);
  return null;
end $$;

do $$
declare t record;
begin
  for t in select * from (values
    ('profiles', array['user_id']), ('staff_stations', array['user_id', 'station_code']),
    ('stations', array['code']), ('route_stations', array['route_code', 'seq']), ('sla_segments', array['code']),
    ('material_templates', array['id']), ('reason_codes', array['code']), ('sewing_machines', array['id']),
    ('machine_types', array['code']), ('product_machine_needs', array['product_type_code', 'type_code']),
    ('inbox_settings', array['kind']), ('product_types', array['code']), ('routes', array['code'])
  ) as v(tbl, keys)
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_settings(%s)',
      t.tbl || '_audit', t.tbl, (select string_agg(quote_literal(k), ', ') from unnest(t.keys) k));
  end loop;
end $$;

create table public.manager_acks (
  kind   text not null check (kind in ('delay_report', 'queue_event')),
  ref_id bigint not null,
  job_id uuid not null references public.jobs(id) on delete cascade,
  by     uuid references auth.users(id) on delete set null,
  at     timestamptz not null default now(),
  primary key (kind, ref_id)
);
create index manager_acks_job_idx on public.manager_acks (job_id);
create index manager_acks_by_idx on public.manager_acks (by);
alter table public.manager_acks enable row level security;
create policy manager_acks_read on public.manager_acks for select to authenticated using ((select private.my_role()) is not null);
revoke all on public.manager_acks from anon;
grant select on public.manager_acks to authenticated;

create or replace function public.ack_review(p_kind text, p_ref bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare j uuid;
begin
  perform private.require_role('manager');
  if p_kind = 'delay_report' then
    select d.job_id into j from public.delay_reports d where d.id = p_ref;
  elsif p_kind = 'queue_event' then
    select e.job_id into j from public.events e where e.id = p_ref and e.type in ('queue_insert', 'queue_skip');
  else
    raise exception 'ชนิดรายการไม่ถูกต้อง' using errcode = '22023';
  end if;
  if j is null then raise exception 'ไม่พบรายการนี้ กรุณาโหลดหน้าใหม่' using errcode = 'P0002'; end if;
  insert into public.manager_acks (kind, ref_id, job_id, by) values (p_kind, p_ref, j, (select auth.uid()))
  on conflict (kind, ref_id) do nothing;
end $$;
revoke all on function public.ack_review(text, bigint) from public, anon;
grant execute on function public.ack_review(text, bigint) to authenticated;
