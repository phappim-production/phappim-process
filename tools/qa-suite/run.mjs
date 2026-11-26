#!/usr/bin/env node
// ระบบทดสอบถาวร (qa-suite) · รันบน 127.0.0.1 เท่านั้น (พอร์ต 5244 / 5245) · ออกด้วย exit code != 0 เมื่อมีข้อล้ม
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { assertSafeDist, assertNoExternalAttempts } from './lib/safety.mjs'
import { createClient } from './lib/client.mjs'
import { ActionRecorder, replayCmd } from './lib/rng.mjs'
import { writeReport } from './lib/report.mjs'
import { runInvariantSelfTests } from './checks/invariants.mjs'
import { runSimulation } from './parts/sim.mjs'
import { runUiCrawler } from './parts/ui.mjs'
import { runSecurityAudit } from './parts/security.mjs'
import { runConfirmationTests } from './parts/confirmation.mjs'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const PORT = process.env.QA_PORT ?? '5244'
const FILES_PORT = process.env.QA_FILES_PORT ?? '5245'
const ORIGIN = `http://127.0.0.1:${PORT}`

function parseArgs(argv) {
  const opts = {
    mode: 'quick',
    only: null,
    seed: 1,
    days: null,
    outDir: null,
    skipBuild: false,
    compare: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--quick') opts.mode = 'quick'
    else if (a === '--full') opts.mode = 'full'
    else if (a === '--skip-build') opts.skipBuild = true
    else if (a === '--only') opts.only = argv[++i]
    else if (a === '--seed') opts.seed = Number(argv[++i]) || 1
    else if (a === '--days') opts.days = Number(argv[++i]) || 10
    else if (a === '--out') opts.outDir = resolve(argv[++i])
    else if (a === '--compare') opts.compare = resolve(argv[++i])
  }
  if (opts.days == null) opts.days = opts.mode === 'full' ? 20 : 5
  if (!opts.outDir) {
    opts.outDir = join(tmpdir(), 'qa-suite', `run-${opts.mode}-seed${opts.seed}`)
  }
  return opts
}

const opts = parseArgs(process.argv.slice(2))
await mkdir(opts.outDir, { recursive: true })
await mkdir(join(opts.outDir, 'img'), { recursive: true })

// ตั้งค่า env ให้ server.mjs และ chrome.mjs ใช้พอร์ต 5244/5245 และไม่เขียนลง repo
process.env.QA_PORT = PORT
process.env.QA_FILES_PORT = FILES_PORT
process.env.QA_ORIGIN = ORIGIN
process.env.QA_MATERIALS_CHECK = '1'
process.env.QA_IMG_DIR = join(opts.outDir, 'img')

if (!opts.skipBuild) {
  console.log(`[qa-suite] กำลัง build app แบบ loopback (${ORIGIN})...`)
  const b = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--prefix', 'app', 'run', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      VITE_SUPABASE_URL: ORIGIN,
      VITE_SUPABASE_ANON_KEY: 'r14-local-anon-key',
      VITE_FILES_URL: `http://127.0.0.1:${FILES_PORT}`,
    },
  })
  if (b.status !== 0) process.exit(b.status ?? 1)
}

const safety = await assertSafeDist(join(ROOT, 'app', 'dist'), PORT, FILES_PORT)
console.log(`[qa-suite] ตรวจ bundle ปลอดภัยแล้ว (${safety.scannedFiles} ไฟล์ · ชี้ ${ORIGIN})`)

const { startLocalStack } = await import('../qa-r14/server.mjs')
const { openChrome } = await import('../qa-r14/chrome.mjs')
const { createFixtures } = await import('../qa-r14/fixtures.mjs')

const startedAt = new Date().toISOString()
const t0 = Date.now()
const stack = await startLocalStack({ materialsCheck: true })
if (!/^http:\/\/127\.0\.0\.1:/.test(stack.origin)) throw new Error('ต้องรันบน 127.0.0.1 เท่านั้น')
const client = createClient(stack)
const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
const browser = chrome.wrap(chrome.main)
const recorder = new ActionRecorder(opts.outDir)
await recorder.init()

const parts = []
async function runPart(id, fn) {
  const pt0 = Date.now()
  try {
    const res = await fn()
    assertNoExternalAttempts(chrome)
    parts.push({ id, status: 'PASS', durationMs: Date.now() - pt0, detail: typeof res === 'string' ? res : JSON.stringify(res) })
    console.log(`PASS [${id}] (${Date.now() - pt0} ms) · ${typeof res === 'string' ? res : JSON.stringify(res)}`)
  } catch (e) {
    parts.push({
      id,
      status: 'FAIL',
      durationMs: Date.now() - pt0,
      error: e?.message ?? String(e),
      replay: replayCmd({ seed: opts.seed, days: opts.days, only: id, outDir: opts.outDir }),
      shrunkTrace: e?.trace ? e.trace.slice(-15) : undefined,
    })
    console.log(`FAIL [${id}] (${Date.now() - pt0} ms) · ${e?.message ?? e}`)
  }
}

try {
  const fixtures = await createFixtures(chrome.main)
  const want = name => !opts.only || opts.only === name

  if (opts.only === 'invariants-selftest') {
    await runPart('invariants-selftest', async () => {
      const res = await runInvariantSelfTests(client)
      return `ตรวจจับข้อมูลผิดได้ครบ ${res.length}/${res.length} ข้อ`
    })
  } else {
    if (want('security')) {
      await runPart('security', () => runSecurityAudit(client, browser))
    }
    if (want('sim')) {
      await runPart('sim', () => runSimulation(client, {
        seed: opts.seed,
        days: opts.days,
        browser,
        recorder,
        quick: opts.mode === 'quick',
      }))
    }
    if (want('confirmation')) {
      await runPart('confirmation', () => runConfirmationTests(client, browser, fixtures, {
        seed: opts.seed,
        quick: opts.mode === 'quick',
      }))
    }
    if (want('ui')) {
      await runPart('ui', () => runUiCrawler(browser, client, {
        outDir: opts.outDir,
        quick: opts.mode === 'quick',
      }))
    }
  }
} finally {
  await chrome.close()
  await stack.close?.()
}

const report = await writeReport({
  outDir: opts.outDir,
  comparePath: opts.compare,
  parts,
  meta: {
    mode: opts.mode,
    seed: opts.seed,
    days: opts.days,
    startedAt,
    durationMs: Date.now() - t0,
    externalAttempts: chrome.externalAttempts.length,
    replay: replayCmd(opts),
  },
})

console.log(`[qa-suite] รายงาน: ${join(opts.outDir, 'report.md')}`)
console.log(`[qa-suite] สรุป: ${report.summary.passed}/${report.summary.total} PASS · externalAttempts=${chrome.externalAttempts.length}`)
process.exit(report.summary.ok ? 0 : 1)
