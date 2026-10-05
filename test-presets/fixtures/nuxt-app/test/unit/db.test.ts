import { expect, it } from 'vitest'
import { openTestSchema } from '@dfox288/test-preset-vitest/db'

it('stores a row in a schema of its own', { tags: ['medium'] }, async () => {
  const db = await openTestSchema()
  await db.sql`create table items (id int primary key, name text)`
  await db.sql`insert into items values (1, 'a')`
  const rows = await db.sql`select name from items`
  expect(rows.map((r) => r.name)).toEqual(['a'])
  const [{ schema }] = await db.sql`select current_schema() as schema`
  expect(schema).toBe(db.schema)
})

it('each test gets a schema of its own', { tags: ['medium'] }, async () => {
  const db = await openTestSchema()
  const rows = await db.sql`select count(*)::int as n from information_schema.tables where table_schema = ${db.schema}`
  expect(rows[0].n).toBe(0)
})
