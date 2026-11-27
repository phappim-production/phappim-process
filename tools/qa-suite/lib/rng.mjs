// ตัวสุ่มแบบกำหนด seed ซ้ำได้ · บันทึกทุกการกระทำ · และย่อขั้นตอนที่ล้มให้สั้นที่สุด
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export function createRng(seed = 1) {
  let s = (Number(seed) >>> 0) || 1
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    seed: s,
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    pick: arr => arr[Math.floor(next() * arr.length)],
    chance: p => next() < p,
    shuffle: arr => {
      const a = [...arr]
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[a[i], a[j]] = [a[j], a[i]]
      }
      return a
    },
  }
}

export class ActionRecorder {
  constructor(outDir) {
    this.outDir = outDir
    this.file = join(outDir, 'actions.jsonl')
    this.actions = []
  }

  async init() {
    await mkdir(this.outDir, { recursive: true })
    await writeFile(this.file, '')
  }

  async record(entry) {
    const row = { seq: this.actions.length + 1, at: new Date().toISOString(), ...entry }
    this.actions.push(row)
    await appendFile(this.file, JSON.stringify(row) + '\n')
    return row
  }
}

// ย่อขั้นตอนที่ล้มแบบ delta-debugging (ตัดขั้นที่ไม่เกี่ยวออกทีละชุด จนเหลือชุดที่สั้นที่สุดที่ยังล้ม)
export async function shrinkTrace(actions, stillFails) {
  if (!actions.length) return []
  let best = [...actions]
  const last = best[best.length - 1]
  // ลองเอาเฉพาะขั้นที่เกี่ยวกับงานที่ล้ม (ถ้ามี jobNo)
  if (last?.jobNo) {
    const byJob = best.filter(a => a.jobNo === last.jobNo || a.global)
    if (byJob.length < best.length && await stillFails(byJob)) best = byJob
  }
  // ตัดทีละครึ่ง (ไม่รวมขั้นสุดท้ายที่ล้ม)
  let n = 2
  while (best.length > 2 && n <= best.length) {
    const body = best.slice(0, -1)
    const chunkSize = Math.max(1, Math.floor(body.length / n))
    let reduced = false
    for (let i = 0; i < body.length; i += chunkSize) {
      const candidate = [...body.slice(0, i), ...body.slice(i + chunkSize), last]
      if (candidate.length < best.length && await stillFails(candidate)) {
        best = candidate
        reduced = true
        break
      }
    }
    if (!reduced) n *= 2
  }
  return best
}

export function replayCmd({ seed, days, only, outDir }) {
  const parts = ['node tools/qa-suite/run.mjs']
  if (only) parts.push(`--only ${only}`)
  if (seed != null) parts.push(`--seed ${seed}`)
  if (days != null) parts.push(`--days ${days}`)
  if (outDir) parts.push(`--out "${outDir}"`)
  return parts.join(' ')
}
