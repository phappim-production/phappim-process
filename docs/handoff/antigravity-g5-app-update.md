# ส่งงาน G5 (`antigravity/g5-app-update`)

## เปลี่ยนอะไร
- **[`app/vite.config.ts`](../../app/vite.config.ts)**: ตั้งค่า PWA เป็น `registerType: 'prompt'` และ `injectRegister: false` เพื่อลงทะเบียน Service Worker ผ่าน React เอง
- **[`app/tsconfig.app.json`](../../app/tsconfig.app.json)**: เพิ่ม `vite-plugin-pwa/react` ใน `compilerOptions.types`
- **[`app/src/components/appUpdateModel.ts`](../../app/src/components/appUpdateModel.ts)** + **[`appUpdateModel.test.ts`](../../app/src/components/appUpdateModel.test.ts)**:
  - แยก pure functions ตัดสินใจตรวจ/โหลดรุ่นใหม่อัตโนมัติ (`UPDATE_CHECK_INTERVAL_MS = 10 นาที`, `AUTO_UPDATE_DELAY_MS = 2 นาที`, `canCheckForUpdate`, `canAutoUpdate`, `isEditingElement`) พร้อมชุดทดสอบ 6 ข้อ
- **[`app/src/components/AppUpdate.tsx`](../../app/src/components/AppUpdate.tsx)**:
  - ไม่ทำงานใน `DEV` · ใช้ `useRegisterSW` ตรวจหารุ่นใหม่ทุก 10 นาที, เมื่อกลับมาที่แท็บ (`visibilitychange`), เมื่อหน้าต่างได้รับโฟกัส (`focus`), และเมื่อเน็ตกลับมา (`online`) โดยข้ามเงียบๆ เมื่อออฟไลน์
  - แสดงแถบแจ้งด้านล่างจอ `"มีระบบรุ่นใหม่ · กดเพื่อโหลด"` + ปุ่ม `"โหลดรุ่นใหม่"` (สูง `48px` · ใช้สี `bg-brand` / `bg-gold` / `text-brand-700` จาก theme · แสดงสถานะ `"กำลังโหลดรุ่นใหม่…"` ระหว่างโหลด)
  - โหลดเองอัตโนมัติเมื่อมีรุ่นใหม่ค้าง >= 2 นาที, ไม่มี `[role=dialog]` / `dialog[open]` เปิดอยู่, และไม่ได้โฟกัสในช่องกรอก (`input`/`textarea`/`select`/`contentEditable`)
- **[`app/src/App.tsx`](../../app/src/App.tsx)**: วาง `<AppUpdate />` ไว้ใน layout หลัก (`flex h-dvh flex-col`) ด้านล่างสุดใน flex flow เพื่อไม่ให้บังปุ่มหลักหรือแถบเมนูล่างบนมือถือ

## ทดสอบอะไร (ผลจริงหลังแก้โค้ดขั้นสุดท้าย)
- `cd app && npm run lint`: **ผ่าน** (0 warnings, 0 errors, 77 files)
- `cd app && npm test`:
  - Vitest: **ผ่าน 11 ไฟล์ · 149 ข้อ** (รวม `appUpdateModel.test.ts` 6 ข้อ)
  - `node --experimental-strip-types --test tests/*.test.mjs`: **ผ่าน 112 ข้อ · 0 fail**
- `cd app && npm run build`: **ผ่าน** (`tsc -b && vite build`, precache 19 entries)
- `cd supabase/tests && npm test`: **ผ่าน 493 ข้อ · 0 fail**
- **ทดสอบแบบ production (`npm run build && npm run preview` ที่ `http://localhost:4174/`, บัญชี `admin@pp142.test`):**
  - เปิดหน้าที่มีข้อความทดสอบ `(รุ่นใหม่)` ให้ Service Worker ทำงานเต็มที่แล้ว ย้อน `App.tsx` กลับเป็นข้อความจริง (`ติดตามการผลิต`) และ `npm run build` ใหม่โดยไม่ปิด preview → สลับแท็บไปมาเพื่อกระตุ้น `focus`/`visibilitychange` → แถบ `"มีระบบรุ่นใหม่ · กดเพื่อโหลด"` และปุ่ม `"โหลดรุ่นใหม่"` ขึ้นทันทีโดยไม่ต้องรีเฟรชหน้า
  - ตรวจขนาด `375x812` ([ภาพ 375](antigravity-g5-375.png)), `768x900` ([ภาพ 768](antigravity-g5-768.png)), `1440x900` ([ภาพ 1440](antigravity-g5-1440.png)): ไม่พบหน้าล้นด้านข้าง (`scrollWidth <= innerWidth`), ปุ่ม `"โหลดรุ่นใหม่"` สูง `48px`, แถบแจ้งไม่ทับแถบ `<nav>` ล่าง (`nav.bottom === banner.top` ที่ `747px` บนจอ `375px` และ `835px` บนจอ `768px`) และไม่บังปุ่มหลัก
  - เปิด Modal งาน `TEST-G2-SCR` (`[role="dialog"]`) ค้างไว้ 2 วินาทีขณะแถบขึ้น → หน้าเว็บไม่โหลดซ้ำเองระหว่างเปิด Modal → ปิด Modal แล้วกด `"โหลดรุ่นใหม่"` → รีโหลดเข้ารุ่นใหม่ (`ติดตามการผลิต`) แถบหายไป และ console error = `0`

## ยังไม่ได้ทำ
- ใน preview จริงไม่ได้รอครบ 2 นาทีตามนาฬิกาจริงเพื่อดูการ auto-reload หลังปิดฟอร์ม (logic เวลา 2 นาที + guard ของ dialog/input ทดสอบครบใน unit test `appUpdateModel.test.ts` 6 ข้อแล้ว)

## บั๊กที่เจอนอกขอบเขต
- ไม่พบบั๊กใหม่ระหว่างพัฒนาและทดสอบ G5
