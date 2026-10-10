import { expect, it } from 'vitest'

let attempts = 0
// The baseline has no retries in small: asking for one must not turn a red run into a green one, and the test is
// refused before its body runs (the body would print BODY RAN).
it('retries itself in a small tier', { retry: 2 }, () => {
  console.log('BODY RAN')
  attempts++
  expect(attempts).toBeGreaterThan(1)
})
