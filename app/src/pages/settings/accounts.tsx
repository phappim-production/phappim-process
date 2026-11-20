import { ROLE_LABELS, SECTION_LABELS, type EmployeeRole, type Section } from '../../auth/access'
import { Pill } from '../../components/ui'
import { kindLabel, type InboxKind } from '../inbox/format'
import { saveAssignment, saveInbox, saveProfile, saveReason, type Loaded } from './data'
import { Collection, EnabledField, SelectField, TextField, type Controls } from './editor'
import { integer, readProfile, requireText, ROLE_OPTIONS, type ProfileDraft, type ReasonDraft } from './model'

type TabProps<T extends 'users' | 'assign' | 'reasons' | 'inbox'> = { data: Loaded<T>; controls: Controls }

export function UsersTab({ data, controls, userId }: TabProps<'users'> & { userId: string }) {
  const users = [...data.users].sort((a, b) => Number(a.role !== null) - Number(b.role !== null))

  return (
    <Collection controls={controls} group="users" title="ผู้ใช้และบทบาท"
      subtitle="สร้างบัญชีใหม่ใน Supabase → Authentication → Add user จากนั้นกลับมาหน้านี้เพื่อกำหนดบทบาท"
      list={users} identify={user => user.user_id} editLabel={user => user.role ? 'แก้ไข' : 'กำหนดบทบาท'}
      row={user => (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{user.name || user.email || 'บัญชีไม่มีอีเมล'}</span>
            <Pill tone={user.role ? (user.active ? 'ok' : 'neutral') : 'warn'}>
              {user.role ? (user.active ? 'เปิดใช้งาน' : 'ปิดใช้งาน') : 'ยังไม่มีบทบาท'}
            </Pill>
            {user.user_id === userId && <Pill tone="brand">บัญชีของคุณ</Pill>}
          </div>
          {user.role && (
            <p className="mt-1 text-muted [overflow-wrap:anywhere]">
              {ROLE_LABELS[user.role]}{user.role === 'supervisor' && ` · ${user.section ? SECTION_LABELS[user.section] : 'ทุกเฟส'}`}
              {user.email && ` · ${user.email}`}
            </p>
          )}
        </>
      )}
      draft={(user): ProfileDraft => ({
        name: user?.name ?? '', role: user?.role ?? '', active: user?.active ?? true, section: user?.section ?? null,
      })}
      fields={(draft, change, user) => {
        const own = user?.user_id === userId
        const roles: (readonly [EmployeeRole | '', string])[] = [['', 'เลือกบทบาท'], ...ROLE_OPTIONS.map(role => [role, ROLE_LABELS[role]] as const)]
        if (user?.role === 'supervisor') roles.push(['supervisor', ROLE_LABELS.supervisor])
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="ชื่อผู้ใช้" value={draft.name} onChange={name => change({ ...draft, name })} />
              <SelectField label="บทบาท" options={roles} value={draft.role} disabled={own}
                onChange={role => change({ ...draft, role, section: role === 'supervisor' ? user?.section ?? null : null })} />
              {draft.role === 'supervisor' && (
                <SelectField label="เฟสของผู้ควบคุมงาน" options={[['', 'ทุกเฟส'], ['1', SECTION_LABELS[1]], ['2', SECTION_LABELS[2]]]}
                  value={String(draft.section ?? '')} onChange={section => change({
                    ...draft, section: section ? Number(section) as Section : null,
                  })} />
              )}
            </div>
            <EnabledField label="เปิดใช้งานบัญชี" checked={draft.active} disabled={own} onChange={active => change({ ...draft, active })} />
            {own && <p className="text-muted">บัญชีของคุณแก้ชื่อได้ บทบาทและการเปิดใช้งานถูกล็อกไว้</p>}
          </>
        )
      }}
      save={async (user, draft) => {
        if (!user) throw new Error('ไม่พบบัญชีผู้ใช้')
        await saveProfile(user.user_id, readProfile(draft, user.user_id === userId, user.role))
      }} />
  )
}

export function AssignTab({ data, controls }: TabProps<'assign'>) {
  const stationName = (code: string) => data.stations.find(s => s.code === code)?.name ?? code
  return (
    <Collection controls={controls} group="assign" title="จับคู่พนักงานกับสถานี"
      subtitle="พนักงานสถานีกดเริ่ม / เสร็จ / พักงาน ได้เฉพาะสถานีที่ติ๊กไว้ · เพิ่มพนักงานโดยตั้งบทบาท พนักงานสถานี ที่เมนูผู้ใช้งาน"
      list={data.staff} identify={user => user.user_id} editLabel={() => 'เลือกสถานี'}
      row={user => (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{user.name || user.email || 'บัญชีไม่มีอีเมล'}</span>
            {!user.active && <Pill tone="neutral">ปิดใช้งาน</Pill>}
            {user.stations.length === 0 && <Pill tone="warn">ยังไม่จับคู่สถานี</Pill>}
          </div>
          {user.stations.length > 0 && <p className="mt-1 text-muted">{user.stations.map(stationName).join(' · ')}</p>}
        </>
      )}
      draft={user => user?.stations ?? []}
      fields={(picked, change) => (
        <div className="grid gap-1 sm:grid-cols-2">
          {data.stations.map(s => (
            <EnabledField key={s.code} label={s.name} checked={picked.includes(s.code)}
              onChange={on => change(on ? [...picked, s.code] : picked.filter(c => c !== s.code))} />
          ))}
        </div>
      )}
      save={async (user, picked) => {
        if (!user) throw new Error('ไม่พบบัญชีผู้ใช้')
        await saveAssignment(user.user_id, user.stations, picked)
      }} />
  )
}

export function ReasonsTab({ data, controls }: TabProps<'reasons'>) {
  return (
    <Collection controls={controls} group="reasons" title="รหัสสาเหตุ"
      subtitle="ใช้รหัสเดิมต่อในรายงานย้อนหลัง รหัสที่เลิกใช้ให้ปิดการใช้งาน"
      list={data.reasons} identify={reason => reason.code} createLabel="เพิ่มรหัสสาเหตุ"
      row={reason => (
        <>
          <p className="font-semibold">{reason.code} · {reason.name}</p>
          <p className="mt-1 text-muted">{reason.grp} · ลำดับ {reason.sort} · {reason.active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</p>
        </>
      )}
      draft={(reason): ReasonDraft => ({
        code: reason?.code ?? '', grp: reason?.grp ?? '', name: reason?.name ?? '', active: reason?.active ?? true, sort: String(reason?.sort ?? 0),
      })}
      fields={(draft, change, reason) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="รหัสสาเหตุ" value={draft.code} placeholder="เช่น M4" disabled={!!reason}
              onChange={code => change({ ...draft, code: code.toUpperCase() })} />
            <TextField label="กลุ่มสาเหตุ" value={draft.grp} onChange={grp => change({ ...draft, grp })} />
            <TextField label="ชื่อสาเหตุ" value={draft.name} onChange={name => change({ ...draft, name })} />
            <TextField label="ลำดับ" value={draft.sort} mode="numeric" onChange={sort => change({ ...draft, sort })} />
          </div>
          <EnabledField label="เปิดใช้งานรหัสสาเหตุ" checked={draft.active} onChange={active => change({ ...draft, active })} />
        </>
      )}
      save={async (reason, draft) => {
        const code = draft.code.trim()
        if (!/^[A-Z]+[0-9]+$/.test(code)) throw new Error('รหัสต้องขึ้นต้นด้วยตัวอักษร A–Z ตามด้วยตัวเลข เช่น M4')
        if (!reason && data.reasons.some(item => item.code === code)) throw new Error('รหัสสาเหตุนี้มีอยู่แล้ว')
        await saveReason(reason?.code ?? null, {
          code, grp: requireText(draft.grp, 'กลุ่มสาเหตุ'), name: requireText(draft.name, 'ชื่อสาเหตุ'),
          active: draft.active, sort: integer(draft.sort, 'ลำดับ', 0),
        })
      }} />
  )
}

const inboxDescriptions: Record<InboxKind, string> = {
  hold: 'เมื่อมีการพักงาน · ฝ่ายผลิต แอดมิน ผู้บริหาร',
  delay_report: 'เมื่อมีรายงานงานล่าช้า · ฝ่ายผลิต แอดมิน ผู้บริหาร',
  rework: 'เมื่อ QC ส่งงานกลับแก้ · ฝ่ายผลิต ฝ่าย QC แอดมิน',
  sewing_issue: 'เมื่อมีรายงานปัญหาระหว่างเย็บ · ฝ่ายผลิต',
  machine_broken: 'เมื่อแจ้งจักรเสีย · ฝ่ายผลิต',
  sample_failed: 'เมื่อตัวอย่างไม่ผ่าน · ฝ่ายผลิต แอดมิน',
  sla_over: 'เมื่อเกินเวลามาตรฐานและยังไม่ได้รายงาน · ฝ่ายผลิต แอดมิน ผู้บริหาร',
  film_late: 'เมื่อเลยวันนัดรับฟิล์มหรือชิ้นงานที่สั่ง · แอดมิน ฝ่ายผลิต',
  materials_late: 'เมื่อรอวัตถุดิบเกิน 2 วันทำงาน · ฝ่ายที่ยังยืนยันไม่ครบ',
  due_soon: 'เมื่องานยังไม่เสร็จและกำหนดส่งวันนี้หรือพรุ่งนี้ · ฝ่ายผลิต แอดมิน ผู้บริหาร',
  mockup_pending: 'เมื่อแอดมินส่งม็อคอัพกำกับสเปกให้อนุมัติ · ฝ่ายผลิต ผู้บริหาร',
  mockup_returned: 'เมื่อม็อคอัพถูกส่งกลับให้แก้ · แอดมิน',
  mockup_approved: 'เมื่ออนุมัติม็อคอัพ · แอดมิน ฝ่ายผลิต (ฉบับแก้ไข: ทุกฝ่ายต้องรับทราบใหม่ รวม QC ผู้บริหาร)',
}

export function InboxTab({ data, controls }: TabProps<'inbox'>) {
  return (
    <Collection controls={controls} group="inbox" title="การแจ้งเตือน"
      subtitle="เมื่อปิด ระบบจะหยุดสร้างข้อความใหม่สำหรับเรื่องนั้น ข้อความเดิมยังอยู่ เจ้าของระบบเห็นทุกข้อความ"
      list={data.settings} identify={item => item.kind}
      row={item => (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{kindLabel(item.kind)}</span>
            <Pill tone={item.enabled ? 'ok' : 'neutral'}>{item.enabled ? 'เปิด' : 'ปิด'}</Pill>
          </div>
          <p className="mt-1 text-muted">{inboxDescriptions[item.kind]}</p>
        </>
      )}
      draft={item => ({ enabled: item?.enabled ?? false })}
      fields={(draft, change, item) => (
        <EnabledField label={`เปิดการแจ้งเตือน${item ? kindLabel(item.kind) : ''}`} checked={draft.enabled}
          onChange={enabled => change({ enabled })} />
      )}
      save={async (item, draft) => {
        if (!item) throw new Error('ไม่พบการตั้งค่าการแจ้งเตือน')
        await saveInbox({ kind: item.kind, enabled: draft.enabled })
      }} />
  )
}
