import { expect, it } from 'vitest'
import { shout } from '../../app/utils/related-only'

// The one test that imports app/utils/related-only.ts: a `related` run for that file selects this and nothing else.
it('shouts', () => {
  expect(shout('hey')).toBe('HEY!')
})
