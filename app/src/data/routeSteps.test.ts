import { describe, expect, it } from 'vitest'
import { routeSteps } from './routeSteps'

describe('เส้นทางงานบนการ์ด', () => {
  it('สถานีก่อนหน้าผ่านแล้ว สถานีปัจจุบันเด่น ที่เหลือยังไม่ถึง', () => {
    expect(routeSteps('normal', 'cut').map(s => s.state)).toEqual(['done', 'done', 'now', 'todo', 'todo'])
  })

  it('เส้นทางปักผ่านสถานีปัก', () => {
    expect(routeSteps('emb', 'emb')).toEqual([
      { station: 'cut', state: 'done' }, { station: 'emb', state: 'now' }, { station: 'sew', state: 'todo' }, { station: 'qc_pack', state: 'todo' },
    ])
  })

  it('สถานีที่ไม่อยู่ในเส้นทาง (เช่น ส่งออกข้างนอก) ไม่แต่งว่าผ่านแล้ว', () => {
    expect(routeSteps('normal', 'outside').every(s => s.state === 'todo')).toBe(true)
    expect(routeSteps('normal', null).every(s => s.state === 'todo')).toBe(true)
  })
})
