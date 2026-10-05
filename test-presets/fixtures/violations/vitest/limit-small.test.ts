import { expect, it } from 'vitest'

it('takes longer than the small limit (5 s)', async () => {
  await new Promise((r) => setTimeout(r, 5_500))
  expect(true).toBe(true)
})
