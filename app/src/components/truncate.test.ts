import { describe, expect, it } from 'vitest'
import css from '../index.css?raw'

describe('.truncate', () => {
  const rule = /\.truncate\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''

  it('clips only horizontally so Thai tone marks above the line stay visible', () => {
    expect(rule).toMatch(/overflow-x:\s*clip/)
  })

  it('can shrink inside flex/grid cards so long customer names do not push the card past a phone screen', () => {
    expect(rule).toMatch(/min-width:\s*0/)
  })
})
