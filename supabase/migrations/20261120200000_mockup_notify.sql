-- ม็อคอัพกำกับสเปก: แจ้งกล่องจดหมายเมื่อส่งอนุมัติ / ส่งกลับ / อนุมัติ (ฉบับแก้ไข = ทุกฝ่ายหน้างานต้องรับทราบใหม่)
-- เพิ่มชนิดข้อความ 3 แบบ · trigger แค่เพิ่มแถว พังไม่กระทบการอนุมัติ (เก็บลง inbox_errors)

alter table public.inbox_messages drop constraint inbox_messages_kind_check;
alter table public.inbox_messages add constraint inbox_messages_kind_check check (kind in (
  'hold', 'delay_report', 'rework', 'sewing_issue', 'machine_broken',
  'sample_failed', 'sla_over', 'film_late', 'materials_late', 'due_soon',
  'mockup_pending', 'mockup_returned', 'mockup_approved'
));
insert into public.inbox_settings (kind, enabled) values
  ('mockup_pending', true), ('mockup_returned', true), ('mockup_approved', true)
on conflict (kind) do nothing;

create or replace function private.on_mockup_status_inbox() returns trigger
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  if new.status = old.status then return new; end if;
  select * into j from public.jobs where id = new.job_id;
  if new.status = 'pending' then
    perform private.inbox_emit('mockup_pending', j.id, format('mockup:%s:pending:%s', new.id, new.version),
      format('ม็อคอัพ %s ฉบับ %s รออนุมัติ', j.confirmation_no, new.rev),
      format('%s · ตรวจจุดและสเปกแล้วกดอนุมัติ หรือส่งกลับให้แอดมินแก้', j.customer_name),
      array['production', 'manager']);
  elsif new.status = 'draft' and old.status = 'pending' then
    perform private.inbox_emit('mockup_returned', j.id, format('mockup:%s:returned:%s', new.id, new.version),
      format('ม็อคอัพ %s ฉบับ %s ถูกส่งกลับให้แก้', j.confirmation_no, new.rev),
      coalesce(new.return_reason, 'ดูเหตุผลในหน้าม็อคอัพ'),
      array['admin']);
  elsif new.status = 'approved' then
    perform private.inbox_emit('mockup_approved', j.id, format('mockup:%s:approved', new.id),
      case when new.based_on is null
        then format('ม็อคอัพ %s ฉบับ %s อนุมัติแล้ว', j.confirmation_no, new.rev)
        else format('สเปก %s เปลี่ยนเป็นฉบับ %s · ทุกสถานีต้องรับทราบใหม่', j.confirmation_no, new.rev) end,
      case when new.based_on is null
        then format('%s · ใช้ผลิตตามฉบับนี้ เปิดดูสเปกแล้วกดรับทราบที่สถานีของคุณ', j.customer_name)
        else format('%s · แก้เพราะ %s · เปิดดูสเปกแล้วกดรับทราบที่สถานีของคุณ', j.customer_name, coalesce(new.change_reason, '-')) end,
      case when new.based_on is null then array['admin', 'production', 'supervisor']
        else array['admin', 'production', 'supervisor', 'qc', 'manager'] end);
  end if;
  return new;
exception when others then
  perform private.inbox_log_error('on_mockup_status_inbox', sqlerrm);
  return new;
end $$;
revoke all on function private.on_mockup_status_inbox() from public, anon;

create trigger mockup_sheets_inbox after update of status on public.mockup_sheets
  for each row execute function private.on_mockup_status_inbox();
