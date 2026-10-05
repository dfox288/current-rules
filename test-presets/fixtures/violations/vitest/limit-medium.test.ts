import { expect, it } from 'vitest'

it('takes longer than the medium limit (15 s)', { tags: ['medium'] }, async () => {
  await new Promise((r) => setTimeout(r, 15_500))
  expect(true).toBe(true)
})

it('takes longer than small but within medium', { tags: ['medium'] }, async () => {
  await new Promise((r) => setTimeout(r, 5_500))
  expect(true).toBe(true)
})
