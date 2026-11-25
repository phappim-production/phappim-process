# ตั้งค่าระบบออนไลน์ (เฟส 0)

> ขั้นตอนที่ **เจ้าของระบบต้องทำเอง** (สมัครบัญชี ตั้งรหัสผ่าน ใส่คีย์) · ใช้แผนฟรีทั้งหมด
> โค้ดและฐานข้อมูลเตรียมไว้แล้วในโฟลเดอร์นี้ · ทดสอบฐานข้อมูลในเครื่องผ่านแล้ว
> ใช้เวลาประมาณ 30–60 นาที

## โครงสร้างโฟลเดอร์

| โฟลเดอร์ / ไฟล์ | คืออะไร |
|---|---|
| `app/` | หน้าเว็บ (React + Vite + TypeScript + Tailwind, PWA) |
| `supabase/migrations/` | โครงสร้างฐานข้อมูล + ข้อมูลตั้งค่าเริ่มต้น (รันตามลำดับชื่อไฟล์) |
| `supabase/tests/` | ทดสอบฐานข้อมูลในเครื่อง (`npm test`) |
| `.github/workflows/` | งานอัตโนมัติ: ตรวจโค้ด (ci) · กันระบบพัก (keep-alive) · สำรองข้อมูล (db-backup) |
| `production-confirmation.html` | ฟอร์มใบยืนยันการผลิต (ใช้ได้แล้ว แยกจากระบบหลัก) |

---

## 1. GitHub (เก็บโค้ด)
1. สมัคร/เข้าสู่ระบบที่ github.com
2. สร้าง repository ใหม่ ชื่อเช่น `phappim-process` · **เลือก Private** (ไฟล์สำรองข้อมูลมีข้อมูลลูกค้า) · ไม่ต้องติ๊กสร้าง README
3. ส่งลิงก์ repo ให้ Claude เพื่ออัปโหลดโค้ด (หรือ push เองตามคำสั่งที่ GitHub แสดง)

## 2. Supabase (ฐานข้อมูล + ล็อกอิน)
1. สมัครที่ supabase.com (เข้าด้วยบัญชี GitHub ได้)
2. **New project** · ชื่อ `pp142-production` · Region **Southeast Asia (Singapore)** · ตั้ง Database password (เก็บในที่ปลอดภัย ห้ามส่งในแชต) · Plan **Free**
3. สร้างตาราง: เมนู **SQL Editor** → New query → คัดลอกเนื้อหาไฟล์ทีละไฟล์ แล้วกด Run ตามลำดับ
   1. `supabase/migrations/20261116000001_schema.sql`
   2. `supabase/migrations/20261116000002_master_data.sql`
   3. `supabase/migrations/20261116000003_hardening.sql` (ปรับตามคำเตือนความปลอดภัยของ Supabase)
   - ตรวจ: เมนู **Table Editor** ต้องเห็นตาราง `product_types` 37 แถว, `stations` 8 แถว, `routes` 3 แถว
4. ปิดการสมัครเอง: **Authentication → Sign In / Providers → Email** → ปิด *Allow new users to sign up* (ผู้ใช้ทุกคนสร้างโดยเจ้าของระบบ)
5. สร้างผู้ใช้คนแรก (เจ้าของระบบ): **Authentication → Users → Add user → Create new user** · ใส่อีเมล + รหัสผ่าน · ติ๊ก *Auto Confirm User*
6. ให้สิทธิ์ owner: คัดลอก **User UID** ของผู้ใช้นั้น แล้วรันใน SQL Editor:
   ```sql
   insert into public.profiles (user_id, name, role)
   values ('วาง-User-UID-ที่นี่', 'ชื่อเจ้าของระบบ', 'owner');
   ```
   บทบาทที่ใช้ได้: `owner` · `supervisor` (ผู้ควบคุมงาน) · `admin` · `qc` · `production` · `manager`
7. จดค่า 2 ค่าจาก **Project Settings → API** (หรือปุ่ม Connect): **Project URL** และ **anon public key**
   - ⚠️ **ห้ามใช้ / ห้ามเผยแพร่ `service_role` key** · anon key เปิดเผยในหน้าเว็บได้ เพราะสิทธิ์ถูกคุมด้วย Row Level Security

## 3. ทดลองบนเครื่องตัวเอง
```bash
cd app
```
```bash
cp .env.example .env.local
```
แก้ `app/.env.local` ใส่ Project URL และ anon key แล้วรัน
```bash
npm run dev
```
เปิด http://localhost:5173 แล้วเข้าสู่ระบบด้วยผู้ใช้ข้อ 2.5 ไปที่ **บัญชี** เพื่อตรวจชื่อและบทบาท **เจ้าของระบบ**

### เปิดบัญชีให้พนักงาน

1. ให้เจ้าของระบบสร้างผู้ใช้ที่ **Supabase → Authentication → Users → Add user** ตามข้อ 2.5
2. นำ User UID ไปสร้างแถวใน `public.profiles` ตามข้อ 2.6 ใช้ชื่อพนักงานและบทบาทตามหน้าที่ ตั้ง `active` เป็น `true`
3. ให้พนักงานเข้า URL ของระบบด้วยอีเมลและรหัสผ่านที่ได้รับจากเจ้าของระบบ ตรวจชื่อและบทบาทที่หน้า **บัญชี** แล้ว**เปลี่ยนรหัสผ่านเป็นของตัวเอง**ที่หน้าเดียวกัน (อย่างน้อย 8 ตัว) · พนักงานลืมรหัสผ่าน → เจ้าของระบบตั้งรหัสใหม่ที่ Supabase → Authentication → Users → เลือกผู้ใช้ → Reset/Update password
4. เมื่อพนักงานพ้นหน้าที่ ให้ตั้ง `profiles.active` เป็น `false` สำหรับบัญชีนั้น

พนักงานที่ยังไม่มีบทบาทหรือบัญชีถูกปิดจะแจ้งให้ติดต่อเจ้าของระบบ ผู้บริหารและเจ้าของระบบเห็นเมนู **รายงาน** ส่วนเมนู **ตั้งค่า** เปิดได้เฉพาะเจ้าของระบบ

ตรวจสิทธิ์เมนูในเครื่องจากโฟลเดอร์ `app/` ด้วย `node --experimental-strip-types --test tests/auth.test.mjs`

## 4. Cloudflare Pages (เว็บออนไลน์)
1. สมัครที่ dash.cloudflare.com
2. **Workers & Pages → Create → Pages → Connect to Git** → เชื่อม GitHub → เลือก repo จากข้อ 1
3. Build settings:
   | ช่อง | ค่า |
   |---|---|
   | Framework preset | None (หรือ Vite) |
   | Root directory | `app` |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
4. Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (ค่าจากข้อ 2.7) (เวอร์ชัน Node กำหนดไว้แล้วในไฟล์ `app/.node-version` = 22 ไม่ต้องตั้ง `NODE_VERSION`)
5. Deploy → ได้ลิงก์ `https://<ชื่อ>.pages.dev` · ทุกครั้งที่ push โค้ดขึ้น GitHub จะ deploy ใหม่อัตโนมัติ
6. กลับไป Supabase **Authentication → URL Configuration** ใส่ Site URL เป็นลิงก์ `.pages.dev`

## 5. งานอัตโนมัติใน GitHub
1. ใน repo: **Settings → Secrets and variables → Actions → New repository secret** สร้าง 4 ค่า:
   | Secret | ค่า |
   |---|---|
   | `SUPABASE_URL` | Project URL |
   | `SUPABASE_ANON_KEY` | anon public key |
   | `SUPABASE_DB_URL` | Supabase → Connect → **Session pooler** connection string (ใส่ Database password แทน `[YOUR-PASSWORD]`) |
   | `BACKUP_PASSPHRASE` | รหัสเข้ารหัสไฟล์สำรอง (สุ่มยาว 16 ตัวขึ้นไป · เก็บสำเนานอก GitHub · หายแล้วกู้ไฟล์สำรองไม่ได้) |
2. แท็บ **Actions** → เลือก `keep-alive` → Run workflow → ต้องขึ้นสีเขียว · ทำซ้ำกับ `db-backup` → ดาวน์โหลดไฟล์ `.dump.gpg` ได้จากหน้าผลการรัน (ถอดรหัสด้วย `BACKUP_PASSPHRASE` · ดู `docs/สำรองและกู้ข้อมูล.md`)
3. ตั้งเตือนตัวเอง: ดาวน์โหลดไฟล์สำรองเก็บไว้นอก GitHub เดือนละครั้ง (Artifact อยู่ได้ 90 วัน)

> ใช้ Session pooler เพราะเครื่องของ GitHub Actions ต่อแบบ IPv4 · การต่อตรง (Direct connection) ของ Supabase เป็น IPv6

---

## เฟส 0 เสร็จเมื่อ
- [x] repo บน GitHub เป็น Private และมีโค้ดครบ · แท็บ Actions → `ci` เป็นสีเขียว
- [x] Supabase มีตารางและข้อมูลตั้งค่าครบ (37 สินค้า, 8 สถานี, 3 เส้นทาง)
- [x] ล็อกอินบนลิงก์ `.pages.dev` แล้วเห็นบทบาท owner และรายการตั้งค่า
- [x] `keep-alive` และ `db-backup` รันผ่าน
- [ ] ตอบเช็คลิสต์ยืนยันหน้างาน ([`docs/เช็คลิสต์ยืนยันหน้างาน.md`](docs/เช็คลิสต์ยืนยันหน้างาน.md)) แล้วแก้ข้อมูลตั้งค่าตามจริง

## ทดสอบฐานข้อมูลในเครื่อง (สำหรับผู้พัฒนา)
```bash
cd supabase/tests && npm install && npm test
```
ใช้ PGlite (Postgres ใน Node) ไม่ต้องมี Docker · ตรวจ migrations, จำนวนข้อมูลตั้งค่า, สิทธิ์ (RLS) และกฎข้อมูล
