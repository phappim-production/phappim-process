// สร้างหน้าเก็บสเปกจริงของสินค้า (app/public/spec-check.html → เว็บ /spec-check) จากฟอร์มใบยืนยัน
// รัน: node tools/spec-check/build.mjs · ฟอร์มเปลี่ยนตัวเลือกเมื่อไร รันใหม่ (ผลที่แอดมินตอบไว้อ้างด้วยรหัสสินค้า/ช่อง ไม่หาย)
import { readFileSync, writeFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const root = new URL('../../', import.meta.url)
const form = readFileSync(new URL('production-confirmation.html', root), 'utf8')
// ส่วนนิยามสินค้า: ตั้งแต่ค่าคงที่ OTHER จนจบ TAIL (ก่อนโค้ดหน้าจอ) · ไม่เอา COMPANY (โลโก้ base64)
const start = form.indexOf("const OTHER = ")
const end = form.indexOf("const LS = 'phappim-confirm-v1'")
if (start < 0 || end < start) throw new Error('หา PRODUCTS ในฟอร์มไม่เจอ · โครงฟอร์มเปลี่ยน ต้องแก้สคริปต์นี้')
const ctx = { state: { h: {}, p: {} } }
runInNewContext(`${form.slice(start, end)}\n;this.CATS = CATS; this.PRODUCTS = PRODUCTS;`, ctx)

const data = {
  cats: ctx.CATS,
  products: Object.entries(ctx.PRODUCTS).map(([c, p]) => ({
    c, n: p.name, k: p.cat,
    s: (p.sections || []).map(s => ({
      t: s.title,
      f: (s.fields || []).map(f => {
        const o = { i: f.id, y: f.type, l: f.label }
        if (f.options) o.o = f.options
        if (f.other) o.x = 1
        if (f.when) o.w = 1
        if (f.unit) o.u = f.unit
        return o
      }),
    })),
  })),
}
const template = readFileSync(new URL('tools/spec-check/template.html', root), 'utf8')
const html = template
  .replace('/*DATA*/', JSON.stringify(data).replace(/</g, '\u003c'))
  .replace('/*STAMP*/', new Date().toISOString().slice(0, 10))
writeFileSync(new URL('app/public/spec-check.html', root), html)
const n = data.products.reduce((a, p) => a + p.s.reduce((b, s) => b + s.f.length, 0), 0)
console.log(`สร้าง app/public/spec-check.html · ${data.products.length} สินค้า · ${n} ช่อง`)
