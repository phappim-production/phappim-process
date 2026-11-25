import { isStationCode, type FirstPieceStatus, type Job, type PhotoGate } from '../proto/model'
import { signFiles, uploadFile } from './files'
import { contentKey, shrinkImage } from './mockups'

export type PhotoFlagRow = {
  job_id: string; station_code: string; needs_first_piece: boolean
  first_piece: FirstPieceStatus | null; first_piece_id: number | string | null; reject_reason: string | null; first_piece_at: string | null
  finish_photos: number; visit: number; folder: string; remind_minutes?: number | null
}

export const MAX_PHOTOS = 6
const PHOTO_SIDE = 1600
const PHOTO_QUALITY = 0.8

export function toPhotoGate(r: PhotoFlagRow): PhotoGate | null {
  if (!isStationCode(r.station_code)) return null
  const gate: PhotoGate = { station: r.station_code, needsFirstPiece: r.needs_first_piece, finishPhotos: Number(r.finish_photos) || 0, folder: r.folder, visit: Number(r.visit), remindMinutes: Number(r.remind_minutes) || 15 }
  if (r.first_piece && r.first_piece_id != null && r.first_piece_at) {
    gate.firstPiece = { status: r.first_piece, id: Number(r.first_piece_id), at: new Date(r.first_piece_at) }
    if (r.reject_reason) gate.firstPiece.reason = r.reject_reason
  }
  return gate
}

export function attachPhotoGates(jobs: Job[], rows: PhotoFlagRow[]): Job[] {
  const byJob = new Map<string, PhotoGate>()
  for (const r of rows) { const g = toPhotoGate(r); if (g) byJob.set(r.job_id, g) }
  return jobs.map(j => {
    const photos = byJob.get(j.id)
    if (photos && photos.station === j.station) return { ...j, photos }
    if (!j.photos) return j
    const { photos: _gone, ...rest } = j
    return rest
  })
}

export type PhotoStep = 'first_piece' | 'wait' | 'rejected' | 'finish' | 'ready'

// ข้อความเดียวกับ private.photo_gate_missing · ฐานข้อมูลตรวจซ้ำตอนกดเสร็จ
export function photoStep(g: PhotoGate | undefined): PhotoStep {
  if (!g) return 'ready'
  if (g.needsFirstPiece) {
    if (!g.firstPiece) return 'first_piece'
    if (g.firstPiece.status === 'pending') return 'wait'
    if (g.firstPiece.status === 'rejected') return 'rejected'
  }
  return g.finishPhotos > 0 ? 'ready' : 'finish'
}

export function photoBlock(g: PhotoGate | undefined): string | null {
  switch (photoStep(g)) {
    case 'first_piece': return 'ถ่ายรูปชิ้นแรกส่งให้แอดมินอนุมัติก่อน'
    case 'wait': return 'รูปชิ้นแรกรอแอดมินอนุมัติ'
    case 'rejected': return 'ชิ้นแรกไม่ผ่าน แก้แล้วถ่ายรูปชิ้นแรกส่งใหม่'
    case 'finish': return 'ถ่ายรูปงานเสร็จอย่างน้อย 1 รูป'
    default: return null
  }
}

export function stationPhotoPath(g: Pick<PhotoGate, 'folder' | 'station' | 'visit'>, key: string): string {
  return `${g.folder}/${g.station}/${g.visit}/${key.replace(/[^A-Za-z0-9]/g, '').slice(0, 64) || 'photo'}.jpg`
}

export type PendingFirstPiece = { job: Job; checkId: number; at: Date }

export function pendingFirstPieces(jobs: readonly Job[]): PendingFirstPiece[] {
  return jobs.flatMap(job => {
    const fp = job.photos?.firstPiece
    return (job.status === 'doing' || job.status === 'hold' || job.status === 'queued') && fp?.status === 'pending' ? [{ job, checkId: fp.id, at: fp.at }] : []
  })
    .filter((p, i, all) => all.findIndex(x => x.checkId === p.checkId) === i)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
}

export const REJECT_REASONS = ['สีเพี้ยน', 'ตำแหน่งผิด', 'ขนาดผิด', 'ผิดแบบ / ผิดไฟล์', 'งานไม่เรียบร้อย'] as const

export function rejectText(picked: readonly string[], detail: string): string {
  return [...picked, detail.trim()].filter(Boolean).join(' · ')
}

export function minutesWaiting(at: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000))
}

// รูปจากกล้องมือถือ 3–10 MB → ย่อเป็น JPG ด้านยาว 1600 px (~300 KB) ส่งผ่านเน็ตมือถือได้เร็ว
export async function uploadStationPhotos(g: PhotoGate, files: readonly Blob[]): Promise<{ ok: true; paths: string[] } | { ok: false; reason: string }> {
  if (!files.length) return { ok: false, reason: 'ยังไม่มีรูป ให้ถ่ายรูปก่อนส่ง' }
  if (files.length > MAX_PHOTOS) return { ok: false, reason: `ส่งรูปได้ครั้งละไม่เกิน ${MAX_PHOTOS} รูป` }
  const paths: string[] = []
  for (const [i, file] of files.entries()) {
    const jpg = await shrinkImage(file, PHOTO_SIDE, PHOTO_QUALITY)
    if (jpg.type !== 'image/jpeg') return { ok: false, reason: `รูปที่ ${i + 1} เปิดไม่ได้ ให้ถ่ายใหม่` }
    const path = stationPhotoPath(g, await contentKey(jpg))
    const up = await uploadFile('station_photos', path, jpg, 'image/jpeg')
    if (!up.ok) return { ok: false, reason: files.length > 1 ? `รูปที่ ${i + 1}: ${up.reason}` : up.reason }
    paths.push(path)
  }
  return { ok: true, paths }
}

export async function signStationPhotos(paths: readonly string[]): Promise<Map<string, string>> {
  if (!paths.length) return new Map()
  const r = await signFiles('station_photos', paths, 3600)
  return r.ok ? r.urls : new Map()
}
