-- หน้าตั้งค่า: เจ้าของต้องเห็นบัญชีที่สร้างแล้วแต่ยังไม่ได้รับบทบาท
create function public.owner_list_users()
returns table (
  user_id uuid, email text, created_at timestamptz, name text, role text, active boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role('owner');
  return query
    select u.id, u.email::text, u.created_at, p.name, p.role, p.active
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    order by (p.role is not null), u.created_at desc nulls last, u.id;
end;
$$;

revoke all on function public.owner_list_users() from public, anon;
grant execute on function public.owner_list_users() to authenticated;

-- กันเจ้าของล็อกบัญชีตัวเองแม้เรียกฐานข้อมูลจากช่องทางอื่น
create function private.guard_own_owner_profile() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.role = 'owner' and old.user_id = (select auth.uid()) then
    if tg_op = 'DELETE' then
      raise exception 'ลบโปรไฟล์เจ้าของระบบของตัวเองไม่ได้' using errcode = '42501';
    end if;
    if new.role <> 'owner' or not new.active or new.user_id <> old.user_id then
      raise exception 'ปิดบัญชีหรือลดบทบาทเจ้าของระบบของตัวเองไม่ได้' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger profiles_guard_own_owner before update or delete on public.profiles
for each row execute function private.guard_own_owner_profile();

-- รายการที่ระบบใช้ระบุจาก key ต้องคงความหมายเดิมเมื่อตั้งชื่อใหม่
create function private.guard_keyed_material_template() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ลบแม่แบบที่ระบบใช้อัตโนมัติไม่ได้' using errcode = '23514';
  end if;
  if (to_jsonb(old) - 'name') is distinct from (to_jsonb(new) - 'name') then
    raise exception 'แม่แบบที่ระบบใช้อัตโนมัติแก้ได้เฉพาะชื่อ' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger material_templates_guard_keyed before update or delete on public.material_templates
for each row when (old.key is not null) execute function private.guard_keyed_material_template();

-- ตัวตรวจขั้นย่อยและ RPC หน้างานอ้างอิง key และชนิดของขั้นเหล่านี้
create function private.guard_system_substeps() returns trigger
language plpgsql set search_path = '' as $$
declare step jsonb;
begin
  for step in select value from jsonb_array_elements(old.substeps)
    where value->>'kind' = 'lock'
       or value->>'key' in ('sew_count', 'first_piece', 'inspect', 'sort_count')
  loop
    if not exists (
      select 1 from jsonb_array_elements(new.substeps) incoming
      where (incoming.value - 'name') = (step - 'name')
    ) then
      raise exception 'ขั้นย่อยที่ระบบใช้แก้ได้เฉพาะชื่อ' using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;

create trigger stations_guard_system_substeps before update of substeps on public.stations
for each row when (old.substeps is distinct from new.substeps)
execute function private.guard_system_substeps();

-- การจ่ายจักรมี foreign key กันลบอยู่แล้ว ส่วนประวัติจองและสถานะเคยลบตามจักร
create function private.guard_machine_history() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.machine_assignments where machine_id = old.id)
     or exists (select 1 from public.machine_bookings where machine_id = old.id)
     or exists (select 1 from public.machine_status_log where machine_id = old.id) then
    raise exception 'จักรมีประวัติการใช้งาน ให้ปิดใช้งานแทนการลบ' using errcode = '23514';
  end if;
  return old;
end;
$$;

create trigger sewing_machines_guard_history before delete on public.sewing_machines
for each row execute function private.guard_machine_history();

revoke all on function private.guard_own_owner_profile(), private.guard_keyed_material_template(),
  private.guard_system_substeps(), private.guard_machine_history() from public, anon, authenticated;
