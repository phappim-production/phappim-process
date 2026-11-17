# ส่งงาน C7 (`antigravity/c7-json-import`)

## เปลี่ยนอะไร
- **`app/src/data/confirmation.ts`**:
  - อ่านคำตอบของสินค้าจาก `d.p[d.product]` (พร้อมรองรับไฟล์รุ่นเก่าที่เก็บคำตอบไว้ที่ `d.p` ชั้นบนสุด)
  - `totalQty()`: รองรับลำดับ `sizes` → `items` (คอลัมน์ `qty`) → `qty` ตรงกับ `totalQty()` ในฟอร์ม
  - `suggestRoute()`: รองรับ `print_method` ทั้ง string และ array, แทนค่า `'อื่นๆ'` ด้วย `print_method__other`, และปรับ regex เป็น `/ซับ|ดิจิทัล/` ให้ตรงกับ `route()` ในฟอร์ม
  - `draftFromConfirmation()`: ใช้ `d.summary.qty` (> 0) และ `d.summary.route` (เมื่อเป็นรหัสเส้นทางที่รู้จัก ไม่ใช่ `'custom'` หรือว่าง) ก่อนคำนวณเอง และอ่าน `spare` จากคำตอบของสินค้า
- **`production-confirmation.html`**:
  - แก้เฉพาะบรรทัด `act==='savefile'` ให้บันทึก `summary: { qty: totalQty(), route: route().code }` ลงในไฟล์ `.json`
- **`app/tests/receive.test.mjs`** + **`app/tests/fixtures/*.json`**:
  - อัปเดต `form()` ให้ใช้รูปแบบจริง (`p: { polo: { ... } }`)
  - เพิ่มทดสอบกรณีบั๊ก G1 รอบ 2 (`เสื้อยืด` + `['งานปัก', 'ซับลิเมชั่น พิมพ์ทั้งตัว (All-over)']` + `M=20` → `print_emb` · `20`)
  - เพิ่มทดสอบเส้นทางครบ 7 แบบ, `อื่นๆ` + `print_method__other`, `print_method` แบบ string, ตาราง `items`, ไฟล์รุ่นเก่า, การใช้ `summary` และกรณี `summary.route` เป็น `'custom'` / ว่าง
  - สร้างและทดสอบไฟล์ `.json` จริงจากฟอร์ม 3 แบบใน `app/tests/fixtures/` (`tshirt-print-emb.json`, `polo-dtf.json`, `banner-items.json` — ลบ `imgs` แล้ว)

## ทดสอบอะไร (ผลจริง)
- `cd app && npm run lint`: **ผ่าน** (0 warnings, 0 errors, 74 files)
- `cd app && npm test`:
  - Vitest: **ผ่าน 10 ไฟล์ · 143 ข้อ**
  - `node --experimental-strip-types --test tests/*.test.mjs`: **ผ่าน 112 ข้อ · 0 fail**
- `cd app && npm run build`: **ผ่าน** (`tsc -b && vite build`)
- `cd supabase/tests && npm test`: **ผ่าน 493 ข้อ · 0 fail**
- **ทดสอบบนหน้าเว็บจริง (`http://localhost:5173/#/board`, บัญชี `production@pp142.test`, ไม่กด `"รับงาน"`):**
  - แนบ `tshirt-print-emb.json` → `TEST-C7-1`, `tshirt`, `qty = 20`, `spare = 2`, `due = 2026-11-25`, `route = print_emb (พิมพ์ + ปัก)`, `ขึ้นตัวอย่าง = เลือก` ([ภาพ](antigravity-c7-tshirt.png))
  - แนบ `polo-dtf.json` → `TEST-C7-2`, `polo`, `qty = 25`, `spare = 1`, `due = 2026-11-26`, `route = dtf (DTF)`, `ไม่ขึ้นตัวอย่าง = เลือก` ([ภาพ](antigravity-c7-polo.png))
  - แนบ `banner-items.json` → `TEST-C7-3`, `banner`, `qty = 15`, `spare = 1`, `due = 2026-11-27`, `route = normal (ปกติ)`, `ขึ้นตัวอย่าง = เลือก` ([ภาพ](antigravity-c7-banner.png))
  - ตรวจหน้าจอที่ `375x812`, `768x900`, `1440x900`: ไม่มีล้นด้านข้าง · console error = `0`

## ยังไม่ได้ทำ
- ไม่มี (ครบตามใบสั่งงาน C7 ทุกข้อ)

## บั๊กที่เจอนอกขอบเขต
- ไม่พบบั๊กใหม่เพิ่มเติมระหว่างการทดสอบ C7
