import { expect, it } from 'vitest'
import { add } from '../../app/utils/add'

// Guards: addition never loses the sign of a negative operand (fixture stand-in for a safety guard).
it('keeps the sign', { tags: ['protected'] }, () => {
  expect(add(-1, -1)).toBe(-2)
})
