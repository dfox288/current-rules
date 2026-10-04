import { describe, expect, it } from 'vitest'
import type { TestModule } from 'vitest/node'
import { summarize, tierOf } from './reporter.js'

describe('tierOf', () => {
  it('counts an untagged test in the nuxt project as medium (it boots Nuxt)', () => {
    expect(tierOf('nuxt', [])).toBe('medium')
  })
  it('counts an untagged test in the unit project as small', () => {
    expect(tierOf('unit', [])).toBe('small')
  })
  it('lets an explicit medium tag win in either project', () => {
    expect(tierOf('unit', ['medium'])).toBe('medium')
    expect(tierOf('nuxt', ['medium'])).toBe('medium')
  })
  it('counts everything in e2e as large', () => {
    expect(tierOf('e2e', [])).toBe('large')
  })
})

const fakeModule = (project: string, tags: string[]): TestModule =>
  ({
    moduleId: `/repo/${project}.test.ts`,
    relativeModuleId: `${project}.test.ts`,
    children: {
      allTests: () => [
        {
          project: { name: project },
          tags,
          fullName: 'a test',
          options: {},
          result: () => ({ state: 'passed' }),
          diagnostic: () => ({ retryCount: 0 }),
        },
      ],
    },
  }) as unknown as TestModule

describe('summarize', () => {
  it('puts nuxt tests in the medium tier of the run summary, unit tests in small', () => {
    const s = summarize([fakeModule('nuxt', []), fakeModule('unit', [])])
    expect(s.tiers.medium.tests).toBe(1)
    expect(s.tiers.small.tests).toBe(1)
  })
})
