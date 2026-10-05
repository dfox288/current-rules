// The DB helper (`bindings/nuxt-ts.md`, "Databases"): one schema per test or per file in the server the
// environment provides as TEST_DATABASE_URL, dropped afterwards. No container is started here.
// Needs the `postgres` package (a peer of the preset). In `unit`/`nuxt` the variable is empty for an
// untagged test, so every function here throws for a small test: tag it `medium`.
import { randomBytes } from 'node:crypto'
import { DATABASE_ENV } from './constants.js'

type Sql = import('postgres').Sql

export interface TestSchema {
  /** The connection URL pinned to the schema through `search_path`. */
  url: string
  schema: string
  /** A client on the schema. Closed by `drop()`. */
  sql: Sql
  drop(): Promise<void>
}

interface Registry {
  admin: Sql | null
  test: TestSchema[]
  file: TestSchema[]
}
const KEY = Symbol.for('dfox288.test-preset.db')
const registry = ((globalThis as Record<symbol, unknown>)[KEY] ??= {
  admin: null,
  test: [],
  file: [],
}) as Registry

export function testDatabaseUrl(): string {
  const url = process.env[DATABASE_ENV]?.trim()
  if (!url)
    throw new Error(
      `${DATABASE_ENV} is empty: only a test tagged "medium" (or an e2e test) may use the database`,
    )
  return url
}

async function admin(): Promise<Sql> {
  if (!registry.admin) {
    const { default: postgres } = await import('postgres')
    registry.admin = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} })
  }
  return registry.admin
}

/** A new empty schema. `scope` says when it is dropped: after the test (default) or at file end. */
export async function openTestSchema(
  options: { scope?: 'test' | 'file'; prefix?: string } = {},
): Promise<TestSchema> {
  const base = testDatabaseUrl()
  const { default: postgres } = await import('postgres')
  const schema = `${options.prefix ?? 't'}_${process.pid}_${randomBytes(4).toString('hex')}`
  await (await admin()).unsafe(`CREATE SCHEMA "${schema}"`)
  const url = `${base}${base.includes('?') ? '&' : '?'}search_path=${schema}`
  const sql = postgres(url, { max: 4, onnotice: () => {} })
  const handle: TestSchema = {
    url,
    schema,
    sql,
    async drop() {
      await sql.end({ timeout: 1 })
      await (await admin()).unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    },
  }
  registry[options.scope === 'file' ? 'file' : 'test'].push(handle)
  return handle
}

async function dropAll(list: TestSchema[]) {
  for (const handle of list.splice(0)) await handle.drop()
}

export const dropTestSchemas = () => dropAll(registry.test)

export async function dropFileSchemas(): Promise<void> {
  await dropAll(registry.file)
  if (registry.admin) await registry.admin.end({ timeout: 1 })
  registry.admin = null
}
