import { expect, it } from 'vitest'

// The static scan of `vitest list` reads a tag only when it is written in the call: a tag set through a
// variable is invisible to it (the file is parsed, the test is found, the tag filter does not match).
const options = { tags: ['medium'] }
it('is a medium test whose tag the scan cannot read', options, () => {
  expect(1).toBe(1)
})
