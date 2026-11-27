// ตัวสุ่มแบบกำหนด seed (รันซ้ำได้ผลเดิม) · บันทึกทุกการกระทำลง actions.jsonl
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

export function replayCmd({ mode, seed, days, only, mutate, outDir }) {
  const parts = ['node tools/qa-suite/run.mjs', `--${mode ?? 'quick'}`, '--skip-build']
  if (only) parts.push(`--only ${only}`)
  if (mutate) parts.push(`--mutate ${mutate}`)
  if (seed != null) parts.push(`--seed ${seed}`)
  if (days != null) parts.push(`--days ${days}`)
  if (outDir) parts.push(`--out "${outDir}"`)
  return parts.join(' ')
}
