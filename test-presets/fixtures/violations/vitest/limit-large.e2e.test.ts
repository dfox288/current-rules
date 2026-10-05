import { expect, it } from 'vitest'

it('takes longer than the large limit (30 s)', async () => {
  await new Promise((r) => setTimeout(r, 30_500))
  expect(true).toBe(true)
})
