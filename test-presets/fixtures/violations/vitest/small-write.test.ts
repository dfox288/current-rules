import { existsSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const target = join(process.cwd(), 'planted-write.txt')

it('small test writes outside the temp dir (sync)', () => {
  writeFileSync(target, 'x')
  expect(existsSync(target)).toBe(true)
})

it('small test writes outside the temp dir (promises)', async () => {
  await writeFile(target, 'x')
  expect(existsSync(target)).toBe(true)
})
