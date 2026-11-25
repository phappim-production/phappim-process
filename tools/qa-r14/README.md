# QA รอบ 14 — หลังบ้านจำลองในเครื่อง (PGlite + R2 Worker)

ชุดนี้รันระบบทั้งหมดบน `127.0.0.1` เท่านั้น ใช้ migration จริงของ `supabase/migrations/*.sql` บน PGlite และ Worker จริงใน `workers/files/src/index.js` กับที่เก็บไฟล์ในหน่วยความจำ ไม่แตะระบบจริง

## วิธีเตรียมและรัน

1. ติดตั้งแพ็กเกจ (ถ้ายังไม่ได้ติดตั้งใน worktree):
   ```powershell
   npm.cmd --prefix app ci
   npm.cmd --prefix supabase\tests ci
   ```
2. Build หน้าเว็บให้ชี้ที่เครื่องตัวเองเท่านั้น:
   ```powershell
   $env:VITE_SUPABASE_URL = 'http://127.0.0.1:5214'
   $env:VITE_SUPABASE_ANON_KEY = 'r14-local-anon-key'
   $env:VITE_FILES_URL = 'http://127.0.0.1:5215'
   npm.cmd --prefix app run build
   ```
3. รันเซิร์ฟเวอร์จำลอง:
   ```powershell
   node tools/qa-r14/server.mjs
   ```
   - หน้าเว็บและ API จำลอง: `http://127.0.0.1:5214`
   - หน้าสลับ 15 บัญชีจำลองใน 1 คลิก + ปุ่มล้างข้อมูล: `http://127.0.0.1:5214/__qa/switch`
   - ฟอร์มใบยืนยันการผลิต: `http://127.0.0.1:5214/confirmation`
   - R2 Worker จำลอง: `http://127.0.0.1:5215`
   - รหัสผ่านเริ่มต้นทุกบัญชีจำลอง (`.invalid`): `r14-local-pass`

## ล้างข้อมูลและทดสอบ

- ล้างฐานข้อมูล + ไฟล์ R2 กลับค่าเริ่มต้นด้วยคำสั่งเดียว:
  ```powershell
  Invoke-RestMethod -Method Post http://127.0.0.1:5214/__qa/reset
  ```
- งานตัวอย่างที่สถานีตัด (ดูหน้าจอพนักงาน / ภาษาพม่า) · ล้างข้อมูลเดิมก่อน:
  ```powershell
  node tools/qa-r14/seed-station.mjs
  ```
  หรือเปิดผ่าน Claude ด้วย `.claude/launch.json` ชื่อ `qa-local` (build แบบ loopback ก่อน)
- ทดสอบ Part 0 (หลังบ้าน PGlite + RLS + R2):
  ```powershell
  node --test tools/qa-r14/server.test.mjs
  ```
- รันชุดทดสอบเบราว์เซอร์อัตโนมัติ (ต้อง build ด้วย loopback env ก่อน):
  ```powershell
  node tools/qa-r14/qa-part-a.mjs
  node tools/qa-r14/qa-part-b.mjs
  node tools/qa-r14/qa-part-c.mjs
  node tools/qa-r14/boot-recovery.mjs
  node tools/qa-r14/qa-mobile.mjs
  ```
  - `qa-part-a` ทั้ง flow ทุกบทบาท (ใบยืนยัน → รับงาน → ฟิล์ม → แบ่ง/ส่งนอก → ตัวอย่าง → ม็อคอัพ → ทุกสถานี → เย็บ/จักร → เกินเวลาผลิต → QC) · `qa-part-b` ทุกหน้า × ทุกบทบาทที่ 375 / 412 / 768 / 1440 px + โหลด/ว่าง/ผิดพลาด + เน็ตช้า + PDF · `qa-part-c` ข้อมูลผิดรูปแบบ (ตัวเลข วันที่ ไฟล์ผิดชนิด XSS) + ลืมกดบันทึก
  - `boot-recovery` หลังขึ้นรุ่นใหม่ไฟล์เก่าหาย ต้องไม่จอขาว (กู้เอง 1 ครั้ง แล้วขึ้นปุ่มโหลดใหม่)
  - `qa-mobile` ปุ่มติดตั้งแอป Android / iPhone / เปิดจากไอคอนแล้ว · กันจอดับที่หน้าสถานี/QC · ล็อกอินค้างหลังโหลดใหม่
- รูปยืนยันงานสถานี ปลายทางถึงปลายทาง (ชิ้นแรก → แอดมินอนุมัติ → รูปงานเสร็จ):
  ```powershell
  node tools/qa-r14/e2e-photos.mjs
  ```
- พอร์ต 5214 ถูกใช้อยู่ (เช่น อีก session เปิดระบบจำลองค้างไว้): ตั้ง `$env:QA_PORT` / `$env:QA_FILES_PORT` เป็นพอร์ตอื่น แล้ว build ใหม่ให้ `VITE_SUPABASE_URL` / `VITE_FILES_URL` ชี้พอร์ตเดียวกัน · ก่อนรัน `npm test` ใน `app/` ให้ล้าง `VITE_*` ออกจาก env
- ใบยืนยันครบทุกสินค้า (กรอกทุกช่องบังคับ + ตาราง + ตำแหน่ง + ม็อคอัพ 1 จุด แล้วพิมพ์ PDF + ข้อความ + `report.json`):
  ```powershell
  node tools/qa-r14/confirmation-all.mjs <โฟลเดอร์ผลลัพธ์> [tshirt,elephant]
  ```
  ภาพและ PDF ลง `docs/qa/img/` · ตั้ง `$env:QA_IMG_DIR` เป็นโฟลเดอร์อื่นถ้าไม่อยากทับหลักฐานเดิม

## ข้อจำกัดของสภาพแวดล้อมจำลอง

- ไม่มี Supabase Realtime WebSocket push (หน้าเว็บกดโหลดใหม่ หรือระบบโหลดซ้ำอัตโนมัติหลังเรียก RPC สำเร็จ)
- ข้อมูลฐานข้อมูลและไฟล์ R2 อยู่ในหน่วยความจำทั้งหมด ปิดเซิร์ฟเวอร์แล้วหาย
- ไม่ได้จำลองการส่งคำขอพร้อมกันแบบหลาย Postgres connection แข่งกันระดับ transaction (`PGlite` รันคำสั่งผ่านคิวทีละธุรกรรม)
- ไม่มี pg_cron รัน `inbox_scan` ทุก 5 นาที (หน้าเว็บเรียก `inbox_scan` เองเมื่อเปิดกล่องจดหมาย/โหลดแอป)
