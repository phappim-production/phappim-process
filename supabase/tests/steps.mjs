// อ่านจากตาราง stations จริง ชุดทดสอบจึงไม่ต้องแก้ทุกครั้งที่หน้างานเปลี่ยนขั้นย่อย
// ตัวอย่าง = เฉพาะ req (QC+Packing ไม่บังคับ) · ผลิตจริง = req + num + appr
// ไม่รวมขั้นที่มีปุ่มของตัวเอง (ยอดเย็บ · ตัวแรก · ผลตรวจ QC) และขั้นล็อกที่ระบบติ๊กให้
const OWN_BUTTON = { sew: ['sew_count', 'first_piece'], qc_pack: ['inspect'] }

export async function requiredSteps(db, station, phase, { except = [] } = {}) {
  if (phase === 'sample' && station === 'qc_pack') return []
  const subs = (await db.query(`select substeps from public.stations where code = $1`, [station])).rows[0].substeps
  const kinds = phase === 'sample' ? ['req'] : ['req', 'num', 'appr']
  return subs
    .filter(s => kinds.includes(s.kind))
    .filter(s => !(OWN_BUTTON[station] ?? []).includes(s.key) && !except.includes(s.key))
    .map(s => (s.kind === 'num' ? [s.key, 10] : [s.key]))
}

export const substepSql = (id, k, v) =>
  `public.complete_substep('${id}', '${k}'${v === undefined ? '' : `, '${JSON.stringify(v)}'::jsonb`})`
