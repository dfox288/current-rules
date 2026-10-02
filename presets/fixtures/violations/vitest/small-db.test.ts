import { expect, it } from 'vitest'
import { openTestSchema } from '@dfox288/test-preset-vitest/db'

it('small test asks for the database', async () => {
  const db = await openTestSchema()
  expect((await db.sql`select 1 as one`)[0].one).toBe(1)
})
