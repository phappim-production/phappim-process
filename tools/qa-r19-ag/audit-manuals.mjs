import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { startLocalStack } from '../qa-r14/server.mjs'
import { openChrome } from '../qa-r14/chrome.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const PORT = Number(process.env.QA_PORT ?? 5234)
const FILES_PORT = Number(process.env.QA_FILES_PORT ?? 5235)
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const OUT_JSON = fileURLToPath(new URL('./manuals-audit-results.json', import.meta.url))

async function run() {
  const manualDir = join(ROOT, 'docs', 'คู่มือ')
  const manualFiles = ['แอดมิน.md', 'ฝ่ายผลิต.md', 'QC.md', 'ผู้บริหาร.md', 'เจ้าของระบบ.md', 'แผนอบรม.md']
  const manuals = {}
  for (const name of manualFiles) {
    const content = await readFile(join(manualDir, name), 'utf8')
    const imgs = [...content.matchAll(/img\/[^\s)"']+/g)].map(m => m[0])
    manuals[name] = {
      chars: content.length,
      imgs: [...new Set(imgs)],
      mentionsStationPhotos: /รูปยืนยันงาน|รูปชิ้นแรก|รูปงานเสร็จ/.test(content),
      mentionsV3: /แถบสี.*สถานี|สีตามสถานี|เส้นทาง.*บนการ์ด/.test(content),
      mentionsOldTerms: {
        screenStationWord: /ซิลค์สกรีน/.test(content),
        redUrgentWord: /ตัวแดง\s*\*\*ด่วน|คำว่า\s*ด่วน/.test(content),
        hatPillowFormulaNote: /ยังไม่มีสูตรจักร.*หมวก.*หมอน|หมวก.*หมอน.*ไม่มีสูตรจักร/.test(content),
        twoColCompareWord: /เทียบ.*ซ้าย.*ขวา|ซ้าย.*ขวา.*ม็อคอัพ/.test(content),
        englishTermLeak: /\b(Station|Audit Log|Roles|Dashboard|Overview)\b/.test(content),
      },
      content,
    }
  }
  const allImgFiles = await readdir(join(manualDir, 'img'))

  const stack = await startLocalStack({ port: PORT, filesPort: FILES_PORT })
  const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
  const t = chrome.wrap(chrome.main)

  const liveRoles = {}
  try {
    await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
    for (const [role, routes] of [
      ['owner', ['#/', '#/jobs', '#/board', '#/production-queue', '#/sewing', '#/reports', '#/reviews', '#/inbox', '#/settings', '#/history']],
      ['manager', ['#/', '#/production-queue', '#/reports', '#/reviews', '#/inbox']],
      ['admin1', ['#/', '#/jobs', '#/board', '#/production-queue', '#/reports', '#/inbox']],
      ['prod1', ['#/board', '#/production-queue', '#/sewing', '#/history', '#/report', '#/inbox']],
      ['sup1', ['#/board', '#/production-queue', '#/history', '#/inbox']],
      ['qc', ['#/board', '#/history', '#/report', '#/inbox']],
      ['staff_single', ['#/board', '#/history', '#/report', '#/words']],
    ]) {
      await t.goto(role, routes[0], 1440)
      await delay(300)
      const nav = await t.ev(() => [...document.querySelectorAll('aside nav a, aside nav button')].map(el => el.textContent.trim()).filter(Boolean))
      let settingsTabs = []
      if (role === 'owner') {
        await t.goto('owner', '#/settings', 1440)
        await t.waitText('สถานีและขั้นย่อย')
        settingsTabs = await t.ev(() => [...document.querySelectorAll('[role=group] button')].map(b => b.textContent.trim()))
      }
      liveRoles[role] = { nav, settingsTabs }
    }
  } finally {
    await chrome.close()
    await stack.close()
  }

  // Diff summary per manual vs live UI
  const report = {}
  for (const name of manualFiles) {
    const m = manuals[name]
    const diffs = []
    if (!m.mentionsStationPhotos) diffs.push('ยังไม่มีเนื้อหา/ขั้นตอนฟีเจอร์รูปยืนยันงานสถานี (รูปชิ้นแรก + รูปงานเสร็จ)')
    if (m.mentionsOldTerms.screenStationWord) diffs.push('ยังมีคำว่า "ซิลค์สกรีน" (ระบบใช้ "รีดฟิล์ม" สำหรับเส้นทางสกรีน และไม่มีคิวสถานีซิลค์สกรีน)')
    if (m.mentionsOldTerms.redUrgentWord) diffs.push('ระบุป้ายตัวแดง "ด่วน n" (PR 202 เปลี่ยนเป็นไอคอนตกใจ + เลยกำหนด / ติดปัญหา n)')
    if (m.mentionsOldTerms.hatPillowFormulaNote) diffs.push('ระบุตัวอย่างสินค้า "หมวก หมอน ยังไม่มีสูตรจักร" (ตรวจสอบเทียบสูตรจักรจริงใน settings)')
    if (m.mentionsOldTerms.twoColCompareWord) diffs.push('อธิบายเทียบม็อคอัพเป็น ซ้าย vs ขวา (ตัวดูรูปจริง PhotoViewer เป็นโหมดสลับ ทีละรูป / เทียบม็อคอัพ ด้วยแถบเลื่อนแบ่งภาพ + ขยาย)')
    const preV3Imgs = m.imgs.filter(i => !/v3|r19|r18/.test(i))
    report[name] = {
      chars: m.chars,
      imgCount: m.imgs.length,
      preV3ImgsCount: preV3Imgs.length,
      imgs: m.imgs,
      mentionsStationPhotos: m.mentionsStationPhotos,
      oldTerms: m.mentionsOldTerms,
      diffs,
    }
  }

  await writeFile(OUT_JSON, JSON.stringify({
    externalAttempts: chrome.externalAttempts,
    allImgFilesCount: allImgFiles.length,
    liveRoles,
    report,
  }, null, 2))
  console.log('SUMMARY audit-manuals:', JSON.stringify(Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.diffs.length + ' diffs']))))
}

run().catch(e => { console.error(e); process.exit(1) })
