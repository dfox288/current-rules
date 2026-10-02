import { expect, it } from 'vitest'

let attempts = 0
// Large may retry once; a test that asks for more and passes on the third attempt is not allowed.
it('retries more than once', { retry: 3 }, () => {
  attempts++
  expect(attempts).toBe(3)
})
