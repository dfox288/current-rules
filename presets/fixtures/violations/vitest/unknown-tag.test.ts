import { expect, it } from 'vitest'

it('carries a tag nobody defined', { tags: ['mediun'] }, () => {
  expect(1).toBe(1)
})
