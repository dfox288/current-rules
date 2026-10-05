import { expect, it } from 'vitest'

it('raises its own limit above small', { timeout: 60_000 }, () => {
  expect(1).toBe(1)
})

it('raises its own limit above medium', { timeout: 60_000, tags: ['medium'] }, () => {
  expect(1).toBe(1)
})

it('lowers its own limit (allowed)', { timeout: 1_000 }, () => {
  expect(1).toBe(1)
})
