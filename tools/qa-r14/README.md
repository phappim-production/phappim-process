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
- ทดสอบ Part 0 (หลังบ้าน PGlite + RLS + R2):
  ```powershell
  node --test tools/qa-r14/server.test.mjs
  ```
- รันชุดทดสอบเบราว์เซอร์อัตโนมัติ (ต้อง build ด้วย loopback env ก่อน):
  ```powershell
  node tools/qa-r14/qa-part-a.mjs
  node tools/qa-r14/qa-part-b.mjs
  node tools/qa-r14/qa-part-c.mjs
  ```
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
