import { expect, it } from 'vitest'

it('is a medium test in a file nobody listed', { tags: ['medium'] }, () => {
  expect(1).toBe(1)
})
