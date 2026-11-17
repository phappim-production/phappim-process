# ส่งงาน `antigravity/c3-inbox` — กล่องจดหมายแจ้งเตือนในระบบ (C3 / S10)

## 1. สิ่งที่เปลี่ยน

### ฐานข้อมูล (`supabase/migrations/20261118200000_inbox.sql`)
- สร้างตาราง:
  - `public.inbox_messages`: เก็บข้อความแจ้งเตือน (`kind`, `job_id`, `dedupe_key` unique, `title`, `body`, `audience`, `created_at`) พร้อม index บน `job_id` และ `created_at desc`
  - `public.inbox_reads`: บันทึกการอ่านแยกตาม `user_id` พร้อม index บน `user_id`
  - `public.inbox_errors`: เก็บข้อผิดพลาดจาก trigger เพื่อไม่ให้งานหลักล้มหรือช้า (อ่านได้เฉพาะ `owner`)
  - `public.inbox_settings`: เปิด/ปิดการแจ้งเตือนแต่ละ `kind` (ค่าเริ่มต้น `true` ทั้ง 10 ชนิด · `owner` แก้ได้)
- RLS:
  - `inbox_messages`: อ่านได้เมื่อ `private.is_owner()` หรือ `private.my_role() = any(audience)` · ไม่มี policy เขียนตรง
  - `inbox_reads`: อ่านได้เฉพาะของตัวเอง (`user_id = auth.uid()`) · ไม่มี policy เขียนตรง
  - `inbox_errors`: อ่านได้เฉพาะ `owner`
  - `inbox_settings`: อ่านได้ทุกบทบาท · เขียนได้เฉพาะ `owner` (แยก policy insert/update/delete ไม่ซ้อนกับ select)
- Trigger ทันที (ห่อด้วย `exception when others` + `private.inbox_log_error`):
  - `events_inbox_after_insert` บน `public.events`: `hold`, `delay_report`, `rework`, `sewing_issue_reported`, `sample_result` (เฉพาะ `pass = false`)
  - `machine_status_log_inbox_after_insert` บน `public.machine_status_log`: `machine_broken` เมื่อ `status = 'broken'` โดยข้ามแถวที่สถานะก่อนหน้าเป็น `broken` อยู่แล้ว (`set_repair_eta`)
- ฟังก์ชัน RPC (grant เฉพาะ `authenticated`, revoke จาก `public, anon`):
  - `public.inbox_scan()` → เรียก `private.inbox_scan_all()` ตรวจ `sla_over`, `film_late`, `materials_late` (> 2 วันทำงาน), `due_soon` (วันนี้/พรุ่งนี้ เวลาไทย) · ใช้ `dedupe_key` กันซ้ำ
  - `public.inbox_mark_read(p_ids bigint[])` · `public.inbox_mark_all_read()` · `public.inbox_unread_count()`
- Realtime & Cron: เพิ่ม `inbox_messages`, `inbox_reads` เข้า `supabase_realtime` (ห่อด้วยเงื่อนไข) และตั้ง `pg_cron` ทุก 5 นาที (ห่อด้วยเงื่อนไขมี extension)

### หน้าเว็บ (`app/src/pages/inbox/**`)
- `app/src/pages/inbox/format.ts`: pure functions (`kindTone`, `kindLabel`, `relativeTime`, `filterInbox`, `groupByDay`, `unreadBadge`)
- `app/src/pages/inbox/useInbox.ts`: hook `useInbox()` โหลดข้อความ + อัปเดตสดผ่าน Realtime (`inbox_messages`, `inbox_reads`) + เรียก `inbox_scan()` ตอนเปิดและทุก 5 นาที + `markRead` / `markAllRead` ผ่าน `rpc()`
- `app/src/pages/inbox/InboxBell.tsx`: `export function InboxBell()` ปุ่มกระดิ่งลิงก์ไป `#/inbox` พร้อมตัวเลขยังไม่อ่าน (ซ่อนเมื่อ 0 · เกิน 99 แสดง `99+`)
- `app/src/pages/inbox/index.tsx`: `export default function InboxPage()` หน้ากล่องจดหมาย เรียงใหม่สุดก่อน จัดกลุ่ม วันนี้ / เมื่อวาน / ก่อนหน้า กรอง ยังไม่อ่าน / ทั้งหมด ปุ่ม "อ่านแล้วทั้งหมด" กดข้อความเพื่อทำเครื่องหมายอ่านแล้วและเปิด `#/board?job=<job_id>` พร้อมสถานะกำลังโหลด / ไม่มีข้อความ / ผิดพลาด

### ทดสอบ
- `supabase/tests/inbox.mjs` + เพิ่ม 2 บรรทัดใน `supabase/tests/run.mjs`
- `app/tests/inbox.test.mjs`

---

## 2. ผลทดสอบจริง

- **`cd supabase/tests && npm test`** (PGlite): **ผ่าน 417 · ไม่ผ่าน 0** (รวมชุดทดสอบเดิม 383 ข้อ + `inbox.mjs` 34 ข้อ)
- **`cd app && npm run build`** (`tsc -b && vite build`): **ผ่าน** (0 errors)
- **`cd app && npm run lint`** (`oxlint`): **ผ่าน** (Found 0 warnings and 0 errors, 45 files)
- **`cd app && node --experimental-strip-types --test tests/*.test.mjs`**: **ผ่าน 97 · ไม่ผ่าน 0** (รวม `inbox.test.mjs` 6 ข้อ)

---

## 3. สิ่งที่ยังไม่ได้ทำ / รอ Claude ดำเนินการต่อ

1. **ลง migration เข้าฐานข้อมูลจริง:** `supabase/migrations/20261118200000_inbox.sql` พร้อมให้ Claude ลงแล้ว
2. **เชื่อมเข้า `app/src/App.tsx` (และ `app/src/auth/access.ts` ถ้าจำเป็น):**
   - เพิ่ม `'inbox'` ใน `PageKey` (ให้ทุกบทบาทที่ล็อกอินเปิดได้)
   - เพิ่มเส้นทาง `#/inbox` เพื่อแสดง `<InboxPage />` (จาก `app/src/pages/inbox/index.tsx`)
   - วาง `<InboxBell />` (จาก `app/src/pages/inbox/InboxBell.tsx`) ใน 2 จุด:
     1. **แถบบนจอเล็ก (`<header className="... lg:hidden">`):** วางหน้า `<a href="#/system" ...>` (ชิดขวาคู่กับโปรไฟล์)
     2. **เมนูซ้ายจอใหญ่ (`<aside className="hidden ... lg:flex">`):** วางในแถบหัวโลโก้ด้านบน หรือเป็นรายการใน `<nav aria-label="เมนูหลัก">` คู่กับป้าย `<InboxBell />`
3. **ลองหน้าเว็บจริง:** หลัง Claude ลง migration และเชื่อม `App.tsx` แล้ว จึงทดสอบเปิด `#/inbox` ที่ http://localhost:5174 ด้วยบัญชีทดสอบ `production@` และ `qc@` (ขนาด 375 / 768 / 1440 px)

---

## 4. บั๊กที่เจอนอกขอบเขต
- ไม่มี
