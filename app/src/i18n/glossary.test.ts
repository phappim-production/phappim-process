import { expect, it } from 'vitest'
import { GLOSSARY_ACTIONS, GLOSSARY_STATUS, GLOSSARY_WORDS } from './glossary'
import { STATION_NAME } from '../proto/model'
import { MY } from './my'

it('หน้าคำศัพท์: ทุกคำและคำอธิบายมีคำแปลพม่า', () => {
  const keys = [...GLOSSARY_ACTIONS, ...GLOSSARY_STATUS, ...GLOSSARY_WORDS].flatMap(e => [e.th, e.note ?? '']).filter(Boolean)
  keys.push(...Object.values(STATION_NAME))
  expect(keys.filter(k => !(k in MY))).toEqual([])
})
