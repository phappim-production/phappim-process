import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function buildMinimalPdf() {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    '4 0 obj\n<< /Length 55 >>\nstream\nBT /F1 18 Tf 72 740 Td (PP142 R14 Test Confirmation PDF) Tj ET\nendstream\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'))
    pdf += obj
  }
  const xrefPos = Buffer.byteLength(pdf, 'utf8')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objects.length; i++) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`
  return Buffer.from(pdf, 'utf8')
}

async function renderCanvasImages(tab) {
  const res = await tab.ev(async () => {
    async function draw(w, h, mime, label, accent) {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const g = canvas.getContext('2d')
      g.fillStyle = '#f3f4f6'
      g.fillRect(0, 0, w, h)
      g.fillStyle = accent
      g.strokeStyle = '#1f2937'
      g.lineWidth = 6
      g.beginPath()
      g.moveTo(w * 0.32, h * 0.14)
      g.lineTo(w * 0.16, h * 0.30)
      g.lineTo(w * 0.24, h * 0.44)
      g.lineTo(w * 0.30, h * 0.38)
      g.lineTo(w * 0.30, h * 0.86)
      g.lineTo(w * 0.70, h * 0.86)
      g.lineTo(w * 0.70, h * 0.38)
      g.lineTo(w * 0.76, h * 0.44)
      g.lineTo(w * 0.84, h * 0.30)
      g.lineTo(w * 0.68, h * 0.14)
      g.closePath()
      g.fill()
      g.stroke()
      g.fillStyle = '#ffffff'
      g.font = 'bold 28px sans-serif'
      g.textAlign = 'center'
      g.fillText(label, w / 2, h * 0.55)
      const blob = await new Promise(r => canvas.toBlob(r, mime, 0.9))
      const buf = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      for (const b of buf) bin += String.fromCharCode(b)
      return btoa(bin)
    }
    return {
      frontPng: await draw(800, 600, 'image/png', 'FRONT R14', '#166534'),
      backJpg: await draw(600, 600, 'image/jpeg', 'BACK R14', '#1d4ed8'),
      detailWebp: await draw(600, 600, 'image/webp', 'DETAIL R14', '#9a3412'),
    }
  })
  return {
    frontPng: Buffer.from(res.frontPng, 'base64'),
    backJpg: Buffer.from(res.backJpg, 'base64'),
    detailWebp: Buffer.from(res.detailWebp, 'base64'),
  }
}

export async function createFixtures(tab) {
  const dir = await mkdtemp(join(tmpdir(), 'pp142-r14-fixtures-'))
  const imgs = await renderCanvasImages(tab)
  const paths = {
    pdf: join(dir, 'confirm-valid.pdf'),
    frontPng: join(dir, 'mockup-front.png'),
    backJpg: join(dir, 'mockup-back.jpg'),
    detailWebp: join(dir, 'mockup-detail.webp'),
    gif: join(dir, 'bad.gif'),
    txt: join(dir, 'notes.txt'),
    fakePdf: join(dir, 'fake.pdf'),
    fakePng: join(dir, 'fake.png'),
    emptyPng: join(dir, 'empty.png'),
    hugeJpg: join(dir, 'huge-21mb.jpg'),
  }

  const huge = Buffer.alloc(21 * 1024 * 1024, 0)
  huge[0] = 0xff; huge[1] = 0xd8; huge[2] = 0xff; huge[3] = 0xe0

  await Promise.all([
    writeFile(paths.pdf, buildMinimalPdf()),
    writeFile(paths.frontPng, imgs.frontPng),
    writeFile(paths.backJpg, imgs.backJpg),
    writeFile(paths.detailWebp, imgs.detailWebp),
    writeFile(paths.gif, Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;')),
    writeFile(paths.txt, 'not a pdf or image'),
    writeFile(paths.fakePdf, 'not really a pdf'),
    writeFile(paths.fakePng, 'not really a png'),
    writeFile(paths.emptyPng, Buffer.alloc(0)),
    writeFile(paths.hugeJpg, huge),
  ])

  return {
    dir,
    paths,
    async cleanup() {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    },
  }
}
