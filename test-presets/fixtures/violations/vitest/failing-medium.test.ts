import { expect, it } from 'vitest'

it('fails as a medium test', { tags: ['medium'] }, () => {
  expect(1).toBe(2)
})
