// สร้างใบเก็บข้อมูล "สเปกงาน ต้องใช้จักรอะไรเย็บ" (ใช้วางระบบ CAP จักรต่องาน) จากสเปกในฟอร์มใบยืนยันจริง · รวมทุกสินค้าเป็นตารางเดียว
// รัน: node tools/sew-cap/build.mjs → docs/ใบเก็บข้อมูล-จักรต่อตัวเลือก.html แล้วพิมพ์เป็น PDF (A4 แนวนอน)
//   msedge --headless --no-pdf-header-footer --print-to-pdf=docs/ใบเก็บข้อมูล-จักรต่อตัวเลือก.pdf <ไฟล์ html>
// ฟอร์มเปลี่ยนตัวเลือกเมื่อไร รันใหม่ · ชนิดจักรคัดจากตาราง machine_types (18 พ.ย. 2569)
import { readFileSync, writeFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { DRAFT } from './draft.mjs'

const root = new URL('../../', import.meta.url)
const form = readFileSync(new URL('production-confirmation.html', root), 'utf8')
const start = form.indexOf('const OTHER = ')
const end = form.indexOf("const LS = 'phappim-confirm-v1'")
if (start < 0 || end < start) throw new Error('หา PRODUCTS ในฟอร์มไม่เจอ · โครงฟอร์มเปลี่ยน ต้องแก้สคริปต์นี้')
const ctx = { state: { h: {}, p: {} } }
runInNewContext(`${form.slice(start, end)}\n;this.PRODUCTS = PRODUCTS;`, ctx)

// [รหัส, ชื่อ, จำนวนในระบบ] · หัวตารางใช้ชื่อสั้นให้พอดีหน้ากระดาษ
const MACHINES = [
  ['single', 'เข็มเดี่ยว', 14], ['double', 'สองเข็ม', 0], ['ovl3', 'โพ้ง 3 เส้น', 0], ['ovl4', 'โพ้ง 4 เส้น', 4],
  ['ovl5', 'โพ้ง 5 เส้น', 0], ['cover', 'ลา', 1], ['flat', 'ฟลัตล็อก', 0], ['binding', 'เข้าขอบ', 0],
  ['elastic', 'ยางยืด', 0], ['button', 'ติดกระดุม', 1], ['buttonhole', 'เจาะรังดุม', 1],
]
// สินค้าที่เย็บในโรงงาน (มีสูตรจักรใน product_machine_needs)
const SEWN = ['tshirt', 'sport', 'running', 'polo', 'worker', 'pe', 'jacket', 'hawaii', 'gown', 'scrub', 'student',
  'mourning', 'kids', 'pajama', 'elephant', 'muaythai', 'pet', 'banner', 'yan', 'scarf', 'cheer', 'glasses',
  'blanket', 'apron', 'wristband', 'lanyard', 'bag', 'spunbond', 'foldable', 'sachet']
// ส่วนที่ไม่เกี่ยวกับการเย็บ (ผ้า สี พิมพ์ ไซซ์ แพ็ค) ตัดออกให้ใบสั้นพอที่หน้างานจะกรอกจบ
const SKIP_SECTION = /^(ผ้า|งานพิมพ์|ไซซ์และจำนวน|ขนาดและจำนวน|จำนวน|แพ็คกิ้ง|แพ็กเกจ|ไส้และกลิ่น|การพิมพ์)/
const SKIP_FIELD = new Set(['fit', 'thread', 'size_sets', 'size_chart', 'set', 'fabric', 'pattern', 'pattern_match',
  'eyelet', 'eyelet_color', 'animal', 'card', 'ribbon_w', 'width', 'sides', 'material', 'usage', 'owner_set'])
// ตัวเลือกที่ไม่ต้องเย็บ (ไม่มี / พิมพ์แทนป้าย / ตัดร้อน / ป้ายแขวนติดตอนแพ็ค) ไม่ต้องถามเรื่องจักร
const SKIP_OPTION = /^ไม่|^พิมพ์|ไม่เย็บ|ตัดเลเซอร์|^ตัดร้อน|ตัดลุ่ย|Hang tag/

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const label = o => (typeof o === 'string' ? o : o.label ?? o.value ?? '')

// รวมสเปกจากทุกสินค้า · สเปกเดียวกันที่ซ้ำหลายสินค้าเหลือแถวเดียว (เจ้าของต้องการแค่ สเปกนี้ใช้จักรอะไร ไม่แยกสินค้า)
// หัวข้อที่ความหมายเดียวกันแต่ฟอร์มตั้งชื่อต่างกัน รวมเป็นหัวข้อเดียว
const GROUP_ALIAS = { 'คอ': 'คอเสื้อ', 'แบบเสื้อ': 'แบบ / ทรง', 'แบบ': 'แบบ / ทรง', 'ทรง': 'แบบ / ทรง', 'รูปทรง': 'แบบ / ทรง',
  'ชนิดสินค้า': 'แบบ / ทรง', 'ชนิดชุด': 'แบบ / ทรง', 'สินค้า': 'แบบ / ทรง', 'การปิด / เปิด': 'การปิด', 'การปิดปาก': 'การปิด',
  'เอว': 'ขอบเอว', 'อุปกรณ์เสริม': 'อุปกรณ์', 'การตัดเย็บ': 'การเก็บขอบ', 'ขอบผ้า': 'การเก็บขอบ',
  'กางเกง': 'ขอบเอว', 'รูปแบบ': 'หูหิ้ว / สาย', 'หู': 'หูหิ้ว / สาย', 'วัสดุ': 'วัสดุหู / สาย', 'พู่': 'อุปกรณ์' }
// คำต่างกันแต่เย็บเหมือนกัน รวมเป็นแถวเดียว · null = ไม่ต้องถาม (ซ้ำกับหัวข้ออื่น หรือไม่เกี่ยวกับจักร)
const OPTION_ALIAS = {
  'ผ้าเดียวกับตัว (พิมพ์ลาย)': 'ผ้าเดียวกับตัว', 'เอวยางยืด + เชือกปรับ ทรงตรง': 'เอวยางยืด + เชือกปรับ', 'ผ้าริบสีพื้น': 'ผ้าริบ', 'ปลายแขนจั๊ม (ริบ)': 'จั๊มปลายแขน (ริบ)',
  'กระดุมพลาสติกสีเข้ากับผ้า': 'กระดุมพลาสติก', 'หูรูดเชือก': 'เชือกหูรูด', 'พับริมเย็บ 4 ด้าน': 'พับริมเย็บ',
  'โพ้งขอบ 4 ด้าน': 'โพ้งขอบ', 'โพ้งริม (ริมเล็ก)': 'โพ้งริม', 'ไม้/ท่อแขวน': 'ไม้แขวน', 'มีพู่': 'พู่',
  'ทรงแบน': 'ทรงแบน (ไม่มีก้น ไม่มีข้าง)', 'ขยายก้น': 'ขยายเฉพาะก้น', 'ขยายก้นและข้าง': 'ขยายก้นและข้าง (ทรงกล่อง)',
}
// หัวข้อ แบบ / ทรง ในฟอร์มปนชื่อสินค้าและขนาด · เก็บเฉพาะแบบที่ทำให้งานเย็บต่างกัน
const SHAPE_KEEP = new Set(['เสื้อกล้ามวิ่ง', '2 สี (แต่งสีที่แขนและปก)', '2 สี (แต่งสีที่สาบและปก)', 'คอตั้ง ซิปหน้า',
  'มีฮู้ด ซิปหน้า', 'ฮู้ดสวมหัว (ไม่มีซิป)', 'บอดี้สูท', 'เดรส', 'สายเดี่ยว', 'ขายาว ขาจั๊ม',
  'ทรงแบน (ไม่มีก้น ไม่มีข้าง)', 'ขยายเฉพาะก้น', 'ขยายข้าง', 'ขยายก้นและข้าง (ทรงกล่อง)', 'ถุงหูรูด', 'ทรงสะพายข้าง',
  'ทรงเป้หูรูด', 'ทรงเจาะหู'])
// ซ้ำกับหัวข้ออื่นแล้ว (กระดุมแป๊กอยู่หัวข้อกระดุม · เชือกหูรูดอยู่หัวข้อการปิด · เอวยางยืดอยู่หัวข้อขอบเอว)
const DROP_IN = { 'การปิด': ['กระดุมแป๊ก'], 'หูหิ้ว / สาย': ['เชือกหูรูด'], 'รายละเอียด': ['เอวยางยืด + เชือกผูก'] }
// เรียงหัวข้อตามหมวด เสื้อ → กางเกง → ป้าย → ผ้าผืน → ถุง ให้หัวหน้าเย็บไล่ตอบได้ง่าย
const ORDER = ['แบบ / ทรง', 'คอเสื้อ', 'ปก', 'ผ้าคอ', 'แขน', 'ปลายแขน', 'สาบเสื้อ', 'กระดุม', 'ซิปหน้า', 'ตะเข็บข้าง',
  'ชายเสื้อ', 'กระเป๋า', 'ซับใน', 'รายละเอียด', 'กางเกง', 'ขอบเอว', 'ปลายขา', 'ผ่าข้าง', 'แต่งขอบขา', 'กระเป๋ากางเกง',
  'ป้ายคอ', 'ป้ายไซซ์', 'ป้ายอื่น', 'การเก็บขอบ', 'รางสอด', 'ปลายราง', 'อุปกรณ์', 'สายคล้องคอ', 'ตัวล็อก',
  'หูหิ้ว / สาย', 'วัสดุหู / สาย', 'การปิด', 'ช่องใส่ของ', 'ตะเข็บตัวกระเป๋า', 'เสริมความแข็งแรง', 'แบบพับเก็บ']
const orderOf = t => (ORDER.includes(t) ? ORDER.indexOf(t) : ORDER.length)
const groupMap = new Map()
let productCount = 0
for (const code of SEWN) {
  const p = ctx.PRODUCTS[code]
  if (!p) throw new Error(`ไม่พบสินค้า ${code} ในฟอร์ม`)
  productCount++
  for (const s of p.sections || []) {
    if (SKIP_SECTION.test(s.title)) continue
    for (const f of s.fields || []) {
      if (SKIP_FIELD.has(f.id)) continue
      let opts = []
      if (f.type === 'radio' || f.type === 'check') opts = (f.options || []).map(label).filter(o => o && !SKIP_OPTION.test(o))
      else if (f.type === 'itemTable') opts = [`มี${f.label} (ต่อ 1 จุด)`]
      if (!opts.length) continue
      const title = GROUP_ALIAS[f.label] ?? f.label
      for (const raw of opts) {
        const o = OPTION_ALIAS[raw] ?? raw
        if (title === 'แบบ / ทรง' && !SHAPE_KEEP.has(o)) continue
        if (DROP_IN[title]?.includes(o)) continue
        if (!groupMap.has(title)) groupMap.set(title, new Set())
        groupMap.get(title).add(o)
      }
    }
  }
}
const groups = [
  // งานประกอบตัวที่ทุกชิ้นต้องทำ แยกตามหมวด ไม่ใช่รายสินค้า
  { title: 'โครงพื้นฐาน', opts: ['เสื้อ (เข้าไหล่ เย็บข้าง)', 'กางเกง (เป้า ข้าง)', 'ผ้าผืน / ป้าย / ธง', 'ถุง / กระเป๋า'], base: true },
  ...[...groupMap].map(([title, set]) => ({ title, opts: [...set] }))
    .sort((x, y) => orderOf(x.title) - orderOf(y.title)),
]

const machineHead = MACHINES.map(([, n]) => `<th class="m">${esc(n)}</th>`).join('')
// ค่าร่าง (draft.mjs) พิมพ์เป็นเครื่องหมายสีเทาในกล่อง ให้หัวหน้าเย็บติ๊กทับหรือขีดฆ่า
// เครื่องหมายถูกวาดเป็น SVG เพราะฟอนต์ Sarabun ไม่มีอักขระ ✓ (ถ้าใช้ตัวอักษร PDF จะดึงฟอนต์อื่นมาปน)
const TICK = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.2 5.3 4.2 7.3 7.9 2.9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const boxes = (draft = []) => MACHINES.map(([code]) =>
  `<td class="m"><span class="box${draft.includes(code) ? ' draft' : ''}">${draft.includes(code) ? TICK : ''}</span></td>`).join('')
const row = (group, text, cls = '', draft = []) =>
  `<tr class="${cls}"><td class="g">${group}</td><td class="opt">${text}</td>${boxes(draft)}<td class="num"></td><td class="num"></td><td class="note"></td></tr>`
// หัวตารางพิมพ์ซ้ำทุกหน้า กระดาษแยกกันก็ยังอ่านคอลัมน์ได้
// table-layout: fixed อ่านความกว้างจากแถวแรก ซึ่งเป็นแถวชื่อตารางแบบรวมช่อง จึงต้องกำหนดด้วย colgroup
const colgroup = `<colgroup><col style="width:30mm"><col style="width:52mm">${MACHINES.map(() => '<col style="width:12.5mm">').join('')}<col style="width:18.5mm"><col style="width:18.5mm"><col></colgroup>`
const tableHead = `${colgroup}<thead><tr class="pname"><th colspan="${MACHINES.length + 5}">ง. ตารางสเปก: ใช้จักรอะไรเย็บ</th></tr>
  <tr><th class="opt" colspan="2">สเปกที่ลูกค้าสั่ง</th>${machineHead}
  <th class="num">จำนวน<br>กระบวนการ</th><th class="num">ได้กี่ตัว<br>ต่อชั่วโมง</th><th class="note">หมายเหตุ</th></tr></thead>`

const specPages = `
<section class="page">
  <table class="grid">${tableHead}<tbody>
    ${groups.map(g => g.opts.map((o, i) => row(i ? '' : esc(g.title), esc(o), [i ? '' : 'first', g.base ? 'base' : ''].join(' '), DRAFT[o])).join('')).join('')}
    ${row('อื่นๆ', '', 'first')}
  </tbody></table>
</section>`

const countRows = MACHINES.map(([, n, k]) =>
  `<tr><td>${esc(n)}</td><td class="num">${k}</td><td class="num"></td><td class="num"></td><td></td></tr>`).join('')
const logRows = Array.from({ length: 7 }, () => '<tr>' + '<td></td>'.repeat(9) + '</tr>').join('')
// ช่องเขียนตอบเป็นเส้นแยกจากตัวหนังสือ สระล่างจึงไม่ชนเส้น
const blank = (w = 30) => `<span class="line" style="min-width:${w}mm"></span>`

const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<title>ใบเก็บข้อมูล จักรต่อตัวเลือก</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  /* ภาษาไทยมีสระบน-ล่างซ้อนกัน ต้องเว้นบรรทัดกว้างกว่าภาษาอังกฤษ ไม่งั้นสระชนกัน */
  body { margin: 0; font: 11.5pt/1.65 "Sarabun", sans-serif; color: #1c2b27; }
  .page { break-before: page; }
  .page:first-child { break-before: auto; }
  h1 { margin: 0 0 1mm; padding-top: 1mm; font-size: 19pt; line-height: 1.5; color: #0f4a3d; }
  h2 { margin: 0 0 2mm; padding-top: 1.5mm; font-size: 15pt; line-height: 1.5; color: #0f4a3d; }
  h3 { margin: 4mm 0 1.5mm; font-size: 12.5pt; line-height: 1.5; color: #0f4a3d; }
  p, ol { margin: 1mm 0; }
  ol { padding-left: 6mm; }
  li { margin-bottom: 1.4mm; }
  .sub { color: #4d5d58; }
  h2.next { margin-top: 5mm; }
  .who { display: flex; gap: 8mm; margin: 3mm 0 2mm; }
  .who div { flex: 1; display: flex; align-items: flex-end; gap: 2mm; font-weight: 600; }
  .who div span { flex: 1; height: 9mm; border-bottom: 1px solid #555; }
  .line { display: inline-block; height: 6.5mm; vertical-align: bottom; border-bottom: 1px solid #555; margin: 0 1mm; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #8a9692; padding: 1.4mm 1.5mm; vertical-align: middle; }
  th { background: #e5efec; font-size: 10pt; font-weight: 600; line-height: 1.4; }
  .grid { table-layout: fixed; }
  .grid thead { display: table-header-group; }
  .grid tr.pname th { padding: 1mm 0 2mm; border: 0; background: none; text-align: left; font-size: 15pt; font-weight: 700; line-height: 1.5; color: #0f4a3d; }
  .grid th.opt, .grid td.opt { width: 66mm; text-align: left; }
  .grid .m { width: 13mm; text-align: center; padding: 1mm .4mm; }
  .grid th.m { font-size: 8.8pt; line-height: 1.35; }
  .grid .num { width: 19mm; text-align: center; }
  .grid th.num { font-size: 9pt; line-height: 1.35; }
  .grid tr { break-inside: avoid; }
  .grid td { height: 7.1mm; padding-top: .6mm; padding-bottom: .6mm; line-height: 1.45; }
  .grid td.g { border-right: 0; font-size: 9.5pt; font-weight: 700; color: #0f4a3d; line-height: 1.4; }
  .grid tr.first td { border-top: 2px solid #4d5d58; }
  .grid tr.base td { background: #fff8e6; }
  .grid td.opt { border-left: 0; }
  .box { display: inline-block; width: 4.4mm; height: 4.4mm; vertical-align: middle; border: 1.4px solid #333; border-radius: 1mm; }
  .box.draft { display: inline-grid; place-items: center; border-color: #9aa5a1; color: #8f9a96; }
  .box.draft svg { width: 3.6mm; height: 3.6mm; }
  .choice { display: block; margin: 1.2mm 0 0 1mm; }
  .choice .box { margin-right: 2mm; }
  .simple td { height: 9mm; line-height: 1.45; }
  .simple .num { width: 22mm; text-align: center; }
  .ex { margin: 2mm 0; padding: 2mm 3mm; border-left: 3px solid #c9a227; background: #fffaf0; }
  .cols { display: grid; grid-template-columns: 1.15fr 1fr; gap: 8mm; }
</style></head><body>

<section class="page">
  <h1>ใบเก็บข้อมูล: สเปกงาน ต้องใช้จักรอะไรเย็บ</h1>
  <p class="sub">ใช้วางระบบ <b>CAP จักรต่องาน</b> (งานนี้ต้องใช้จักรชนิดไหน กี่ตัว ถึงเสร็จทันนัดลูกค้า) · ภาพพิมพ์ 142 · พิมพ์ ${new Date().toISOString().slice(0, 10)}</p>
  <div class="who"><div>ผู้ให้ข้อมูล<span></span></div><div>ตำแหน่ง<span></span></div><div>วันที่<span></span></div></div>
  <div class="cols">
  <div>
    <h3>วิธีกรอกตาราง ง. (หน้า 3 เป็นต้นไป)</h3>
    <ol>
      <li>1 แถว = 1 สเปก ไม่แยกสินค้า · แถว <b>โครงพื้นฐาน</b> = งานประกอบที่ทุกตัวต้องทำ</li>
      <li>สเปกนี้ต้องใช้จักรอะไรเย็บ <b>ติ๊กทุกชนิดที่ใช้</b> · ไม่ต้องใช้จักร เว้นว่าง</li>
      <li><b>จำนวนกระบวนการ</b> = สเปกนั้นมีกี่ขั้นตอนเย็บ (ตั้งจักร 5 นาทีต่อกระบวนการ)</li>
      <li><b>ได้กี่ตัวต่อชั่วโมง</b> = ช่าง 1 คน กับจักร 1 ตัว ทำขั้นนี้ได้ประมาณกี่ตัว · ตอบเป็นช่วงได้ เช่น 40–60 · ไม่แน่ใจ เว้นไว้</li>
      <li>สเปกที่ไม่ได้ทำจริง ขีดฆ่าแถว · สเปกที่ขาด เขียนเพิ่มในแถว อื่นๆ ท้ายตาราง</li>
      <li><span class="box draft">${TICK}</span> <b>เครื่องหมายสีเทา = ค่าร่าง</b> (จากความรู้ทั่วไปของงานเย็บ ไม่ใช่ของโรงงานนี้) · ถูก = <b>ติ๊กทับด้วยปากกา</b> · ผิด = <b>ขีดฆ่า</b> · ขาด = ติ๊กเพิ่ม</li>
    </ol>
    <div class="ex"><b>ตัวอย่าง</b> สเปก กระดุม "3 เม็ด" ให้ติ๊ก <b>ติดกระดุม</b> และ <b>เจาะรังดุม</b> · 2 กระบวนการ · 60 ตัวต่อชั่วโมง</div>

  </div>
  <div>
    <h3>ก. จักรที่มีจริง (ตัวเลขจากระบบ · กรุณานับใหม่)</h3>
    <table class="simple"><thead><tr><th>ชนิดจักร</th><th class="num">ในระบบ</th><th class="num">นับจริง</th><th class="num">เสีย / ปิด</th><th>หมายเหตุ</th></tr></thead>
    <tbody>${countRows}</tbody></table>
  </div>
  </div>
</section>

<section class="page">
    <h2>ข. คำถามรวมของสายเย็บ</h2>
    <ol>
      <li>ช่างเย็บทั้งหมด ${blank(16)} คน · ทำงานวันละ ${blank(16)} ชั่วโมง (ไม่นับพัก)</li>
      <li>ตั้งจักร 5 นาทีต่อกระบวนการ เกิดตอนไหน (ติ๊ก 1 ข้อ)
        <span class="choice"><span class="box"></span>ครั้งเดียวตอนเริ่มงาน แต่ละคนทำกระบวนการของตัวเองจนจบ</span>
        <span class="choice"><span class="box"></span>ทุกครั้งที่ช่างสลับไปทำกระบวนการอื่น</span>
        <span class="choice"><span class="box"></span>อื่นๆ ${blank(70)}</span></li>
      <li>งานหนึ่งงาน ใส่ช่างได้สูงสุด ${blank(16)} คน · เพราะ ${blank(55)}</li>
      <li>ขั้นตอนที่ต้องทำตามลำดับ แบ่งคนทำพร้อมกันไม่ได้ ${blank(50)}</li>
      <li>จักรชนิดที่มักขาด หรือเป็นคอขวด ${blank(68)}</li>
      <li>ช่างที่ใช้จักร ลา / ติดกระดุม / เจาะรังดุม ได้ มีกี่คน ${blank(38)}</li>
    </ol>

  <h2 class="next">ค. ใบบันทึกงานจริง: ฝ่ายผลิตเลือกจักรต่องาน</h2>
  <p>ช่วงแรก <b>ฝ่ายผลิตเป็นคนเลือกจักรต่องาน</b> · กรอกทุกงานเย็บ 2–3 สัปดาห์ · จดว่าเลือกจักรอะไร ใช้เวลาจริงเท่าไร เพื่อเทียบกับตัวเลขในใบนี้</p>
  <table class="simple"><thead><tr>
    <th style="width:18mm">วันที่</th><th style="width:28mm">เลขงาน (SC)</th><th>สินค้า / สเปกสำคัญ</th><th style="width:18mm">จำนวนตัว</th>
    <th style="width:41mm">จักรที่เลือก (ชนิด × ตัว)</th><th style="width:19mm">ช่าง (คน)</th><th style="width:27mm">เริ่ม (วัน เวลา)</th><th style="width:27mm">เสร็จ (วัน เวลา)</th><th style="width:38mm">ทัน / ไม่ทัน · หมายเหตุ</th>
  </tr></thead><tbody>${logRows}</tbody></table>
</section>
${specPages}
</body></html>`

// ค่าร่างที่ไม่ตรงกับสเปกใดเลย = พิมพ์ชื่อผิด ต้องแก้ draft.mjs ก่อนพิมพ์ใบ
const allSpecs = new Set(groups.flatMap(g => g.opts))
const stray = Object.keys(DRAFT).filter(k => !allSpecs.has(k))
if (stray.length) throw new Error(`ค่าร่างไม่ตรงกับสเปกในฟอร์ม: ${stray.join(' · ')}`)
const noDraft = [...allSpecs].filter(k => !DRAFT[k])
if (noDraft.length) console.log(`ไม่มีค่าร่าง ${noDraft.length} สเปก: ${noDraft.join(' · ')}`)

const out = new URL('docs/ใบเก็บข้อมูล-จักรต่อตัวเลือก.html', root)
writeFileSync(out, html)
const n = groups.reduce((a, g) => a + g.opts.length, 0)
console.log(`สร้าง docs/ใบเก็บข้อมูล-จักรต่อตัวเลือก.html · รวมจาก ${productCount} สินค้า · ${n} สเปก`)
