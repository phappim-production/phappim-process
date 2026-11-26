# ระบบทดสอบถาวร (`tools/qa-suite`) — ภาพพิมพ์ 142

ชุดทดสอบอัตโนมัติแบบใช้ซ้ำได้ในเครื่อง (`127.0.0.1:5244` / `5245`) ไม่แตะระบบจริงและไม่เพิ่ม dependency ใหม่ เปิดขั้นรอผลิต (`materials_check = true`) เป็นค่าเริ่มต้น

## คำสั่งรันด่วน

```powershell
# 1. รันแบบเร็ว (~1-3 นาที · เหมาะก่อนเปิดทุก PR)
node tools/qa-suite/run.mjs --quick

# 2. รันแบบเต็ม (จำลอง 20 วันทำงาน · ทุกบทบาท · 375/768/1440 px)
node tools/qa-suite/run.mjs --full --seed 101 --days 20

# 3. รันเฉพาะส่วน (security | sim | confirmation | ui | invariants-selftest)
node tools/qa-suite/run.mjs --only sim --seed 42 --days 10 --skip-build

# 4. เทียบผลกับรอบก่อนหน้าและเก็บผลไว้นอก repo
node tools/qa-suite/run.mjs --quick --out "$env:TEMP\qa-suite\curr" --compare "$env:TEMP\qa-suite\prev\report.json"
```

## ตัวเลือก CLI
| ตัวเลือก | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `--quick` / `--full` | `--quick` | โหมดเร็ว (5 วัน · 2 ขนาดจอ) หรือเต็ม (20 วัน · 3 ขนาดจอ · ทุกบทบาท) |
| `--only <ส่วน>` | ทั้งหมด | รันเฉพาะ `security`, `sim`, `confirmation`, `ui`, หรือ `invariants-selftest` |
| `--seed <เลข>` | `1` | กำหนด seed สำหรับสุ่ม (ใส่เลขเดิมเพื่อทำซ้ำเหตุการณ์เดิม 100%) |
| `--days <จำนวน>` | `5` / `20` | จำนวนวันทำงานจำลอง (จันทร์–เสาร์) |
| `--out <โฟลเดอร์>` | `$TEMP/qa-suite/...` | โฟลเดอร์เก็บ `report.md`, `report.json`, `actions.jsonl`, ภาพหน้าจอ (อยู่นอก repo เสมอ) |
| `--skip-build` | ปิด | ข้ามขั้นตอน `npm run build` เมื่อ build แบบ loopback ไว้แล้ว |
| `--compare <ไฟล์>` | ไม่มี | เทียบผลกับ `report.json` รอบก่อน (บอกข้อที่เพิ่งล้ม / เพิ่งหาย) |

## โครงสร้างและการขยายระบบ
- `checks/invariants.mjs`: ข้อตรวจความถูกต้องของข้อมูล 10 ข้อ (B1–B10) + `runInvariantSelfTests`
  - **วิธีเพิ่มข้อตรวจ:** เพิ่ม SQL/การตรวจใน `checkInvariants` พร้อมใส่รหัส `Bxx:` และเพิ่มกรณีทดสอบใน `runInvariantSelfTests`
- `checks/rpc-policy.mjs`: ตารางสิทธิ์คำตอบของ RPC ทุกตัวใน `public` (ส่วน E จะตรวจอัตโนมัติว่าไม่มี RPC ใหม่ตกหล่นจากตารางนี้)
  - **วิธีเพิ่ม RPC ใหม่:** เพิ่มชื่อฟังก์ชันและบทบาทที่อนุญาตใน `RPC_POLICY`
- `parts/sim.mjs`: จำลองการใช้งานทั้งโรงงาน (รวมใบงานบริการ 4 แบบ, ส่งออกจากรอผลิต, วัตถุดิบ + ETA, 2 คนกดพร้อมกัน)
- `parts/ui.mjs`: ตัวไล่หน้าจอ 375/768/1440 px, สิทธิ์เปิด URL ตรง, ออฟไลน์, ข้อความผิดปกติ
- `parts/security.mjs`: ตรวจ RPC ครบทุกตัวจาก `pg_proc`, เขียน/ลบตารางตรงผ่าน REST, XSS
- `parts/confirmation.mjs`: สุ่มตรวจฟอร์มใบยืนยัน (ปกสำเร็จ+สีปก, ผ้าเพิ่ม+จำนวน+หน่วย, เลขซ้ำ, ใบงานบริการ)

## ข้อจำกัดที่รู้
- ใช้ PGlite และ R2 จำลองในหน่วยความจำ (ไม่มี Realtime WebSocket push และไม่จำลอง multi-connection transaction ระดับ OS จริง)
- ใช้ `--skip-build` ได้เฉพาะเมื่อ build `app/dist` ด้วย loopback `127.0.0.1:5244` / `5245` แล้วเท่านั้น
