// ส่วน F: ฟอร์มใบยืนยัน (ตรวจด้วย validate() ของฟอร์มเอง) + สุ่มสินค้าเทียบฉบับลูกค้า/ฉบับโรงงาน + กฎฝั่งฐาน
import { createRng } from '../lib/rng.mjs'

export async function runConfirmationTests(client, browser, fixtures, { seed = 1, quick = false } = {}) {
  const rng = createRng(seed)
  await client.reset(true)
  const tested = []
  const failures = []
  const fail = msg => { throw new Error(msg) }
  const check = async (name, fn) => {
    try { await fn(); tested.push(name) } catch (e) { failures.push(e.message) }
  }

  await browser.goto('admin1', '', 1440, '/confirmation')
  await browser.waitText('ใบยืนยันการผลิต')
  const issuesFor = () => browser.ev(() => validate().map(m => m.id))
  const reset = product => browser.ev(p => {
    if (document.body.classList.contains('preview')) togglePreview(false)
    state = fresh()
    state.product = p
    state.pickOpen = false
    renderForm()
  }, product)
  const setP = (key, value) => browser.ev((k, v) => { scope('p')[k] = v; rerender() }, key, value)

  await check('PR244-collar-color', async () => {
    await reset('tshirt')
    await setP('collar', 'ปกสำเร็จ')
    if (!(await issuesFor()).includes('fld_p_collar_color')) fail('PR244: ปกสำเร็จไม่ใส่สีปกแล้ว validate ไม่ฟ้อง fld_p_collar_color')
    await setP('collar_color', 'ดำ')
    if ((await issuesFor()).includes('fld_p_collar_color')) fail('PR244: ใส่สีปกแล้วยังฟ้อง')
    await setP('collar', 'ไม่มีปก')
    if ((await issuesFor()).includes('fld_p_collar_color')) fail('PR244: ไม่มีปกแต่ยังบังคับสีปก')
  })

  await check('PR245-fabric-qty-unit', async () => {
    await reset('tshirt')
    await setP('fabric_rows', [{ part: 'แขน', fabric: 'ตาข่าย', color: 'ขาว' }])
    if (!(await issuesFor()).includes('fld_p_fabric_rows')) fail('PR245: ผ้าเพิ่มไม่มีจำนวนแล้ว validate ไม่ฟ้อง')
    await setP('fabric_rows', [{ part: 'แขน', fabric: 'ตาข่าย', color: 'ขาว', qty: '2.5', unit: 'หลา' }])
    if ((await issuesFor()).includes('fld_p_fabric_rows')) fail('PR245: ผ้าเพิ่มกรอกครบแล้วยังฟ้อง')
    await setP('fabric_rows', [{ part: 'แขน', fabric: 'ตาข่าย', color: 'ขาว', qty: '0', unit: 'หลา' }])
    if (!(await issuesFor()).includes('fld_p_fabric_rows')) fail('PR245: ผ้าเพิ่มจำนวน 0 แล้วไม่ฟ้อง')
  })

  let copies = ''
  await check('copies', async () => {
    const leaks = []
    let fieldsFilled = 0
    const products = await browser.ev(() => Object.keys(PRODUCTS))
    const sample = quick ? rng.shuffle(products).slice(0, 6) : products
    for (const code of sample) {
      const res = await browser.ev(p => {
        state = fresh()
        state.product = p
        state.pickOpen = false
        Object.assign(state.h, { doc_no: 'QA-DOC', customer: 'ลูกค้า', job_name: 'งาน', due_date: '2099-01-20' })
        const filled = []
        for (const sec of layout().filter(s => s.s === 'p' && s.fields)) {
          for (const f of sec.fields) {
            const v = scope('p')
            if (!['text', 'textarea'].includes(f.type) || !visible(f, v)) continue
            v[f.id] = `QAX${f.id}QAX`
            filled.push({ id: f.id, customer: customerSees(f, sec) })
          }
        }
        const was = viewOnly
        viewOnly = false
        renderDoc()
        const customer = document.querySelector('#doc').innerText
        viewOnly = true
        renderDoc()
        const factory = document.querySelector('#doc').innerText
        viewOnly = was
        let errors = []
        try { errors = validate().filter(m => m.hard).map(m => m.id) } catch (e) { errors = ['validate-crash: ' + e.message] }
        return {
          leaks: filled.filter(x => !x.customer && customer.includes(`QAX${x.id}QAX`)).map(x => x.id),
          missingFactory: filled.filter(x => !factory.includes(`QAX${x.id}QAX`)).map(x => x.id),
          crash: errors.filter(e => e.startsWith('validate-crash')),
          filled: filled.length,
        }
      }, code)
      fieldsFilled += res.filled
      if (res.leaks.length) leaks.push(`${code}: ฉบับลูกค้าแสดงช่องภายใน ${res.leaks.join(', ')}`)
      if (res.missingFactory.length) leaks.push(`${code}: ฉบับโรงงานไม่แสดง ${res.missingFactory.join(', ')}`)
      if (res.crash.length) leaks.push(`${code}: ${res.crash.join(', ')}`)
    }
    if (leaks.length) fail(`ใบยืนยัน ${leaks.length} สินค้า: ${leaks.slice(0, 6).join(' ; ')}`)
    copies = `copies-${sample.length}-products-${fieldsFilled}-fields`
  })

  await check('hem-images', async () => {
    const res = await browser.ev(() => {
      const out = []
      for (const [product, sec] of Object.entries(PRODUCTS)) {
        for (const s of sec.sections) for (const f of s.fields ?? []) {
          if (f.type !== 'radio') continue
          for (const o of f.options) if (OPT_IMG[o]) out.push({ product, field: f.id, option: o })
        }
      }
      const broken = Object.entries(OPT_IMG).filter(([, src]) => !/^data:image\/webp;base64,/.test(src)).map(([o]) => o)
      const unused = Object.keys(OPT_IMG).filter(o => !out.some(x => x.option === o))
      state = fresh()
      state.product = 'scarf'
      state.pickOpen = false
      Object.assign(scope('p'), { item: 'ผ้าพันคอ', sew_mode: SEW_CUSTOM, edge: 'พับริมเย็บ' })
      renderForm()
      const formImgs = document.querySelectorAll('.opt .optimg').length
      const was = viewOnly
      viewOnly = true
      renderDoc()
      const factory = document.querySelectorAll('#doc .optimg').length
      viewOnly = false
      renderDoc()
      const customer = document.querySelectorAll('#doc .optimg').length
      viewOnly = was
      return { used: out.length, broken, unused, formImgs, factory, customer }
    })
    if (res.broken.length || res.unused.length) fail(`รูปเย็บขอบ: รูปเสีย ${res.broken.join(', ')} · ไม่ตรงตัวเลือกใด ${res.unused.join(', ')}`)
    if (res.formImgs < 2) fail(`รูปเย็บขอบ: ฟอร์มแสดงรูป ${res.formImgs} รูป (ควรมีม้วนริม + พับริมเย็บ)`)
    if (res.factory !== 1) fail(`รูปเย็บขอบ: ฉบับโรงงานแสดงรูป ${res.factory} รูป (ควร 1 รูปของแบบที่เลือก)`)
    if (res.customer !== 0) fail(`รูปเย็บขอบ: ฉบับลูกค้าแสดงรูป ${res.customer} รูป (ช่องเย็บเป็นข้อมูลภายใน)`)
  })

  await check('hem-size', async () => {
    const res = await browser.ev(() => {
      state = fresh()
      state.product = 'scarf'
      state.pickOpen = false
      const v = scope('p')
      Object.assign(v, { item: 'ผ้าพันคอ', sew_mode: SEW_CUSTOM, edge: 'พับริมเย็บ' })
      const ids = () => validate().map(m => m.id)
      const askedWhenFold = ids().includes('fld_p_edge_size')
      v.edge_size = '0.6 ซม.'
      const doneWhenFilled = !ids().includes('fld_p_edge_size')
      const was = viewOnly
      viewOnly = true
      renderDoc()
      const factory = document.querySelector('#doc').innerText
      viewOnly = was
      v.edge = 'โพ้งริม (ริมเล็ก)'
      delete v.edge_size
      const notAskedWhenOverlock = !ids().includes('fld_p_edge_size')
      return { askedWhenFold, doneWhenFilled, printed: /ขนาดพับ \/ ม้วนริม\s*0\.6 ซม\./.test(factory), notAskedWhenOverlock }
    })
    const bad = Object.entries(res).filter(([, ok]) => !ok).map(([k]) => k)
    if (bad.length) fail(`ขนาดพับ/ม้วนริม: ${bad.join(', ')}`)
  })

  await check('PR241-taken-doc-no', async () => {
    const dupNo = `F-TAKEN-${seed}`
    const taken = await client.rpc('admin1', 'receive_job', {
      p_confirmation_no: dupNo, p_customer_name: 'ลูกค้าเดิม', p_job_name: 'งานรับแล้ว',
      p_product_type_code: 'tshirt', p_qty: 10, p_unit: 'ตัว', p_due_date: '2099-01-20',
      p_route_code: 'cut_only', p_confirmation_pdf_path: null, p_needs_sample: false,
    })
    if (!taken.ok) fail(`รับงาน ${dupNo} ไม่ได้: ${JSON.stringify(taken.body)}`)
    const save = await client.rpc('admin1', 'save_confirmation_draft', {
      p_data: { app: 'phappim-confirm', v: 1, product: 'tshirt', h: { doc_no: dupNo }, p: {} },
    })
    if (save.ok || !/เปลี่ยน "?เลขที่ใบ/.test(String(save.body?.message))) fail(`PR241: บันทึกใบด้วยเลขของงานที่รับแล้ว ข้อความไม่บอกให้เปลี่ยนเลขที่ใบ: ${JSON.stringify(save.body)}`)
  })

  await check('PR226-infinity-date', async () => {
    const inf = await client.rpc('admin1', 'receive_job', {
      p_confirmation_no: `F-INF-${seed}`, p_customer_name: 'Inf', p_job_name: 'Inf',
      p_product_type_code: 'tshirt', p_qty: 10, p_unit: 'ตัว', p_due_date: 'infinity',
      p_route_code: 'cut_only', p_confirmation_pdf_path: null, p_needs_sample: false,
    })
    if (inf.ok) fail('PR226: รับวันที่ infinity')
  })

  if (failures.length) {
    const err = new Error(`${failures.length} ข้อ: ${failures.join(' ; ')}`)
    err.details = failures
    throw err
  }
  return { tested: [...tested.filter(t => t !== 'copies'), copies] }
}
