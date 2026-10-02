import { expect, it } from 'vitest'

let attempts = 0
// The baseline has no retries in small: asking for one must not turn a red run into a green one.
it('retries itself in a small tier', { retry: 2 }, () => {
  attempts++
  expect(attempts).toBeGreaterThan(1)
})
