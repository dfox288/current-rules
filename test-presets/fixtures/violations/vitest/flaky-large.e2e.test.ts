import { expect, it } from 'vitest'

let attempts = 0
it('fails once, passes on the retry', () => {
  attempts++
  expect(attempts).toBe(2)
})
