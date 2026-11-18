// สร้างใบเก็บข้อมูล "จักรต่อตัวเลือกของลูกค้า" (ใช้วางระบบ CAP จักรต่องาน) จากตัวเลือกในฟอร์มใบยืนยันจริง
// รัน: node tools/sew-cap/build.mjs → docs/ใบเก็บข้อมูล-จักรต่อตัวเลือก.html แล้วพิมพ์เป็น PDF (A4 แนวนอน)
//   msedge --headless --no-pdf-header-footer --print-to-pdf=docs/ใบเก็บข้อมูล-จักรต่อตัวเลือก.pdf <ไฟล์ html>
// ฟอร์มเปลี่ยนตัวเลือกเมื่อไร รันใหม่ · ชนิดจักรคัดจากตาราง machine_types (18 พ.ย. 2569)
import { readFileSync, writeFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const root = new URL('../../', import.meta.url)
const form = readFileSync(new URL('production-confirmation.html', root), 'utf8')
const start = form.indexOf('const OTHER = ')
const end = form.indexOf("const LS = 'phappim-confirm-v1'")
if (start < 0 || end < start) throw new Error('หา PRODUCTS ในฟอร์มไม่เจอ · โครงฟอร์มเปลี่ยน ต้องแก้สคริปต์นี้')
const ctx = { state: { h: {}, p: {} } }
runInNewContext(`${form.slice(start, end)}\n;this.PRODUCTS = PRODUCTS;`, ctx)

// [รหัส, ชื่อ, จำนวนในระบบ] · หัวตารางใช้ชื่อสั้นให้พอดีหน้ากระดาษ
const MACHINES = [
  ['single', 'เข็มเดี่ยว', 14], ['double', 'สองเข็ม', 0], ['ovl3', 'โพ้ง 3', 0], ['ovl4', 'โพ้ง 4', 4],
  ['ovl5', 'โพ้ง 5', 0], ['cover', 'ลา', 1], ['flat', 'ลาคอ / ฟลัตล็อก', 0], ['binding', 'เข้าขอบ', 0],
  ['elastic', 'ยางยืด', 0], ['button', 'ติดกระดุม', 1], ['buttonhole', 'เจาะรังดุม', 1],
]
// สินค้าที่เย็บในโรงงาน (มีสูตรจักรใน product_machine_needs)
const SEWN = ['tshirt', 'sport', 'running', 'polo', 'worker', 'pe', 'jacket', 'hawaii', 'gown', 'scrub', 'student',
  'mourning', 'kids', 'pajama', 'elephant', 'muaythai', 'pet', 'banner', 'yan', 'scarf', 'cheer', 'glasses',
  'blanket', 'apron', 'wristband', 'lanyard', 'bag', 'spunbond', 'foldable', 'sachet']
// ส่วนที่ไม่เกี่ยวกับการเย็บ (ผ้า สี พิมพ์ ไซซ์ แพ็ค) ตัดออกให้ใบสั้นพอที่หน้างานจะกรอกจบ
const SKIP_SECTION = /^(ผ้า|งานพิมพ์|ไซซ์และจำนวน|ขนาดและจำนวน|จำนวน|แพ็คกิ้ง|แพ็กเกจ|ไส้และกลิ่น|การพิมพ์)/
const SKIP_FIELD = new Set(['fit', 'thread', 'size_sets', 'size_chart', 'set'])

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const label = o => (typeof o === 'string' ? o : o.label ?? o.value ?? '')

const products = []
for (const code of SEWN) {
  const p = ctx.PRODUCTS[code]
  if (!p) throw new Error(`ไม่พบสินค้า ${code} ในฟอร์ม`)
  const groups = []
  for (const s of p.sections || []) {
    if (SKIP_SECTION.test(s.title)) continue
    for (const f of s.fields || []) {
      if (SKIP_FIELD.has(f.id)) continue
      if (f.type === 'radio' || f.type === 'check') {
        const opts = (f.options || []).map(label).filter(o => o && !/^ไม่มี$|^ไม่ใส่/.test(o))
        if (opts.length) groups.push({ title: f.label, opts })
      } else if (f.type === 'itemTable') {
        groups.push({ title: f.label, opts: [`มี${f.label} (ต่อ 1 จุด)`] })
      }
    }
  }
  products.push({ code, name: p.name, groups })
}

const machineHead = MACHINES.map(([, n]) => `<th class="m">${esc(n)}</th>`).join('')
const boxes = MACHINES.map(() => '<td class="m"><span class="box"></span></td>').join('')
const row = (text, cls = '') =>
  `<tr class="${cls}"><td class="opt">${text}</td>${boxes}<td class="num"></td><td class="num"></td><td class="note"></td></tr>`
const tableHead = `<thead><tr><th class="opt">ตัวเลือกที่ลูกค้าสั่ง</th>${machineHead}
  <th class="num">กี่<br>กระบวนการ</th><th class="num">ได้กี่ตัว<br>ต่อ ชม.</th><th class="note">หมายเหตุ</th></tr></thead>`

const productPages = products.map(p => `
<section class="page">
  <h2>${esc(p.name)} <small>${p.code}</small></h2>
  <table class="grid">${tableHead}<tbody>
    ${row('<b>โครงพื้นฐาน</b> ทุกตัวต้องทำ (ประกอบตัวที่ไม่ขึ้นกับตัวเลือก)', 'base')}
    ${p.groups.map(g => g.opts.map((o, i) => row(`<span class="g">${i ? '' : esc(g.title)}</span>${esc(o)}`, i ? '' : 'first')).join('')).join('')}
    ${row('อื่นๆ ____________________')}
  </tbody></table>
</section>`).join('')

const countRows = MACHINES.map(([c, n, k]) =>
  `<tr><td>${esc(n)}</td><td class="num">${k}</td><td class="num"></td><td class="num"></td><td></td></tr>`).join('')
const logRows = Array.from({ length: 10 }, () => '<tr>' + '<td></td>'.repeat(9) + '</tr>').join('')

const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<title>ใบเก็บข้อมูล จักรต่อตัวเลือก</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4 landscape; margin: 9mm 9mm 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 11.5pt/1.35 "Sarabun", "Leelawadee UI", Tahoma, sans-serif; color: #1c2b27; }
  .page { break-after: page; }
  .page:last-child { break-after: auto; }
  h1 { margin: 0 0 2mm; font-size: 19pt; color: #0f4a3d; }
  h2 { margin: 0 0 2mm; font-size: 15pt; color: #0f4a3d; }
  h2 small { font-size: 9pt; color: #7a8783; font-weight: 400; }
  h3 { margin: 4mm 0 1.5mm; font-size: 12.5pt; color: #0f4a3d; }
  p, ol, ul { margin: 1mm 0; }
  .who { display: flex; gap: 8mm; margin: 2mm 0 3mm; font-weight: 600; }
  .who span { flex: 1; border-bottom: 1px solid #555; padding-bottom: 1mm; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #8a9692; padding: 1.2mm 1.5mm; vertical-align: middle; }
  th { background: #e5efec; font-size: 10pt; font-weight: 600; line-height: 1.15; }
  .grid { table-layout: fixed; }
  .grid th.opt, .grid td.opt { width: 74mm; text-align: left; }
  .grid .m { width: 13.5mm; text-align: center; padding: 1mm .5mm; }
  .grid th.m { font-size: 8.5pt; }
  .grid .num { width: 17mm; text-align: center; }
  .grid .note { width: auto; }
  .grid tr { break-inside: avoid; }
  .grid td { height: 6.6mm; padding-top: .4mm; padding-bottom: .4mm; }
  .grid .g { display: inline-block; vertical-align: middle; width: 21mm; margin-right: 1.5mm; font-size: 9pt; font-weight: 700; color: #0f4a3d; line-height: 1.1; }
  .grid tr.first td { border-top: 2px solid #4d5d58; }
  .grid tr.group td { height: auto; background: #f4f7f6; font-weight: 700; font-size: 10.5pt; padding: .8mm 1.5mm; }
  .grid tr.base td.opt { background: #fff8e6; }
  .box { display: inline-block; width: 4.2mm; height: 4.2mm; border: 1.4px solid #333; border-radius: 1mm; }
  .simple td { height: 9mm; }
  .simple .num { width: 26mm; text-align: center; }
  .ex { margin: 2mm 0; padding: 2mm 3mm; border-left: 3px solid #c9a227; background: #fffaf0; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
  .line { display: inline-block; min-width: 30mm; border-bottom: 1px solid #555; }
</style></head><body>

<section class="page">
  <h1>ใบเก็บข้อมูล: ตัวเลือกของลูกค้า → ต้องใช้จักรอะไร</h1>
  <p>ใช้วางระบบ <b>CAP จักรต่องาน</b> (งานนี้ต้องใช้จักรชนิดไหน กี่ตัว ถึงเสร็จทันนัดลูกค้า) · ภาพพิมพ์ 142 · พิมพ์ ${new Date().toISOString().slice(0, 10)}</p>
  <div class="who"><span>ผู้ให้ข้อมูล</span><span>ตำแหน่ง</span><span>วันที่</span></div>
  <div class="cols">
  <div>
    <h3>วิธีกรอก (หน้า 3 เป็นต้นไป · สินค้าละ 1–2 หน้า)</h3>
    <ol>
      <li>แถว <b>โครงพื้นฐาน</b>: งานที่ทุกตัวต้องทำ ไม่ว่าลูกค้าเลือกอะไร (เช่น เข้าไหล่ เย็บข้าง)</li>
      <li>แถวตัวเลือก: ถ้าลูกค้าเลือกข้อนี้ ต้องใช้จักรอะไร <b>ติ๊ก ✓ ทุกชนิดที่ใช้</b> · ไม่ต้องใช้จักรเพิ่มให้เว้นว่าง</li>
      <li><b>กี่กระบวนการ</b>: ตัวเลือกนั้นมีกี่ขั้นตอนเย็บ (ใช้คิดเวลาตั้งจักร 5 นาทีต่อกระบวนการ)</li>
      <li><b>ได้กี่ตัวต่อ ชม.</b>: ช่าง 1 คน + จักร 1 ตัว ทำขั้นนี้ได้ชั่วโมงละประมาณกี่ตัว · ตอบเป็นช่วงได้ (เช่น 40–60) · ไม่แน่ใจเว้นไว้</li>
      <li>สินค้าที่ไม่ได้ทำแล้ว ขีดฆ่าทั้งหน้า · ตัวเลือกที่ไม่มีจริง ขีดฆ่าแถว</li>
    </ol>
    <div class="ex"><b>ตัวอย่าง</b> เสื้อโปโล · ตัวเลือก "กระดุม" → ติ๊ก <b>ติดกระดุม</b> + <b>เจาะรังดุม</b> · 2 กระบวนการ · ได้ 60 ตัวต่อ ชม.</div>
  </div>
  <div>
    <h3>ก. จักรที่มีจริง (ระบบนับได้ตามตาราง · กรุณานับใหม่)</h3>
    <table class="simple"><thead><tr><th>ชนิดจักร</th><th class="num">ในระบบ</th><th class="num">นับจริง</th><th class="num">เสีย / ปิด</th><th>หมายเหตุ</th></tr></thead>
    <tbody>${countRows}</tbody></table>
  </div>
  </div>
</section>

<section class="page">
  <h2>ข. คำถามรวมของสายเย็บ</h2>
  <ol>
    <li>ช่างเย็บทั้งหมดต่อวัน <span class="line"></span> คน · ทำงาน <span class="line"></span> ชม./วัน (ไม่นับพัก)</li>
    <li>ตั้งจักร 5 นาทีต่อกระบวนการ เกิดตอนไหน (ติ๊ก)
      <br><span class="box"></span> ครั้งเดียวตอนเริ่มงาน แต่ละคนทำกระบวนการของตัวเองจนจบ
      <br><span class="box"></span> ทุกครั้งที่ช่างสลับไปทำกระบวนการอื่น
      <br><span class="box"></span> อื่นๆ ______________________________________________</li>
    <li>งานหนึ่งงาน ใส่ช่าง/จักรได้สูงสุดกี่ชุด หรือกี่คน <span class="line"></span> · ทำไมถึงเพิ่มมากกว่านี้ไม่ได้ ______________________________</li>
    <li>มีขั้นตอนที่<b>ต้องทำทีละขั้น</b> แบ่งคนทำพร้อมกันไม่ได้ไหม (เช่น ต้องเข้าไหล่ก่อนติดคอ) ________________________________________</li>
    <li>จักรชนิดไหนที่<b>มักขาด / เป็นคอขวด</b> บ่อยที่สุด ________________________________________________</li>
    <li>ช่าง 1 คน ใช้จักรได้หลายชนิดไหม · ช่างที่ใช้ <b>ลา / ติดกระดุม / เจาะรังดุม</b> ได้มีกี่คน ______________________________</li>
  </ol>

  <h3>ค. ใบบันทึกงานจริง: ฝ่ายผลิตเลือกจักรต่องาน (กรอกทุกงานเย็บ 2–3 สัปดาห์)</h3>
  <p>ช่วงแรก<b>ฝ่ายผลิตเป็นคนเลือกจักรต่องาน</b> · จดว่าเลือกอะไร ใช้เวลาจริงเท่าไร เพื่อเทียบกับตัวเลขในใบนี้</p>
  <table class="simple"><thead><tr>
    <th>วันที่</th><th>เลขงาน (SC)</th><th>สินค้า / ตัวเลือกสำคัญ</th><th>จำนวนตัว</th>
    <th>จักรที่เลือก (ชนิด × ตัว)</th><th>ช่าง (คน)</th><th>เริ่ม (วัน เวลา)</th><th>เสร็จ (วัน เวลา)</th><th>ทัน / ไม่ทัน · หมายเหตุ</th>
  </tr></thead><tbody>${logRows}</tbody></table>
</section>
${productPages}
</body></html>`

const out = new URL('docs/ใบเก็บข้อมูล-จักรต่อตัวเลือก.html', root)
writeFileSync(out, html)
const n = products.reduce((a, p) => a + p.groups.reduce((b, g) => b + g.opts.length, 0), 0)
console.log(`สร้าง docs/ใบเก็บข้อมูล-จักรต่อตัวเลือก.html · ${products.length} สินค้า · ${n} ตัวเลือก`)
