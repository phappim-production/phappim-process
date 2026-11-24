// ผ่านตัวอย่างแล้วต้องบอกชัด ไม่อย่างนั้นหน้างานเข้าใจว่ายังรอตัวอย่าง
export function sampleText(job: { needs_sample?: boolean | null; develop?: boolean | null; sample_round: number; phase: string }): string {
  if (job.needs_sample === false) return 'ไม่ขึ้นตัวอย่าง'
  if (job.develop) return job.phase === 'done' ? `งาน Develop · ผ่านตัวอย่างแล้ว (รอบ ${job.sample_round})` : `งาน Develop · ตัวอย่างรอบ ${job.sample_round} · ไม่ผลิตจริง`
  if (job.phase === 'production' || job.phase === 'done') return `ผ่านตัวอย่างแล้ว (รอบ ${job.sample_round})`
  return `ขึ้นตัวอย่าง รอบ ${job.sample_round} · ยังไม่ผ่าน`
}
