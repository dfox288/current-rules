import { describe, it } from 'vitest'

it.skip('plain skip', () => {})
it.todo('a todo')
it('ctx skip', (ctx) => {
  ctx.skip('no database in this sandbox')
})
it.skipIf(true)('skipIf', () => {})
it('quarantined', { tags: ['quarantine'] }, () => {})
describe.skip('skipped suite', () => {
  it('inner', () => {})
})
it('ran', () => {})
