import { describe, expect, it } from 'vitest'
import type { TestModule } from 'vitest/node'
import { summarize, testPresetReporter, tierOf } from './reporter.js'

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

describe('summarize: medium files', () => {
  const module = (id: string, tests: { project: string; tags: string[]; state: string }[]): TestModule =>
    ({
      moduleId: id,
      relativeModuleId: id,
      children: {
        allTests: () =>
          tests.map((t) => ({
            project: { name: t.project },
            tags: t.tags,
            fullName: 'a test',
            options: {},
            result: () => ({ state: t.state }),
            diagnostic: () => ({ retryCount: 0 }),
          })),
      },
    }) as unknown as TestModule

  it('lists a file with a medium test the tag filter skipped, so the small run can report what it did not run', () => {
    const s = summarize([
      module('/r/a.test.ts', [{ project: 'unit', tags: ['medium'], state: 'skipped' }]),
      module('/r/b.test.ts', [{ project: 'unit', tags: [], state: 'passed' }]),
      module('/r/c.test.ts', [{ project: 'unit', tags: ['medium'], state: 'passed' }]),
    ])
    expect(s.mediumFiles).toEqual(['/r/a.test.ts', '/r/c.test.ts'])
  })
  it('does not list nuxt or e2e files (they are not selected by the scan)', () => {
    const s = summarize([
      module('/r/n.test.ts', [{ project: 'nuxt', tags: ['medium'], state: 'passed' }]),
      module('/r/e.test.ts', [{ project: 'e2e', tags: ['medium'], state: 'passed' }]),
    ])
    expect(s.mediumFiles).toEqual([])
  })
})

describe('unhandled errors in a run that executed no file', () => {
  const unhandled = [new Error('Projects "e2e" and "unit" have different \'maxWorkers\' but same \'sequence.groupOrder\'')]

  /** Runs the reporter's end-of-run hook with its output and exit code captured. */
  const endRun = (modules: TestModule[], errors: unknown[]) => {
    const before = process.exitCode
    const write = process.stdout.write
    let out = ''
    process.stdout.write = ((chunk: string) => ((out += chunk), true)) as typeof process.stdout.write
    process.exitCode = undefined
    try {
      ;(testPresetReporter.onTestRunEnd as (m: TestModule[], e: unknown[]) => void)(modules, errors)
      return { out, exitCode: process.exitCode }
    } finally {
      process.stdout.write = write
      process.exitCode = before
    }
  }

  it('the summary carries the number of unhandled errors', () => {
    expect(summarize([], unhandled).unhandledErrors).toBe(1)
    expect(summarize([fakeModule('unit', [])], []).unhandledErrors).toBe(0)
  })
  it('is red from the reporter, whatever Vitest exits with, and says why', () => {
    const { out, exitCode } = endRun([], unhandled)
    expect(exitCode).toBe(1)
    expect(out).toMatch(/\[test-preset\] FAIL: the run executed 0 files and hit 1 unhandled error/)
    expect(out).toContain('maxWorkers')
  })
  it('control: a run that executed files and had no error is not touched', () => {
    const { out, exitCode } = endRun([fakeModule('unit', [])], [])
    expect(exitCode).toBeUndefined()
    expect(out).not.toContain('FAIL')
  })
  it('control: a run that executed no file and had no error (nothing selected) is not touched', () => {
    expect(endRun([], []).exitCode).toBeUndefined()
  })
})

describe('summarize: failures per tier', () => {
  const run = (project: string, tags: string[], state: string): TestModule =>
    ({
      moduleId: `/r/${project}-${tags.join('')}.test.ts`,
      relativeModuleId: `${project}.test.ts`,
      children: {
        allTests: () => [
          { project: { name: project }, tags, fullName: 'a test', options: {}, result: () => ({ state }), diagnostic: () => ({ retryCount: 0 }) },
        ],
      },
    }) as unknown as TestModule

  it('counts a failed test in its own tier, so a run shared by small and medium can say which one is red', () => {
    const s = summarize([run('unit', [], 'passed'), run('unit', ['medium'], 'failed'), run('nuxt', [], 'failed'), run('e2e', [], 'passed')])
    expect(s.tiers.small.failed).toBe(0)
    expect(s.tiers.medium.failed).toBe(2)
    expect(s.tiers.large.failed).toBe(0)
    expect(s.failed).toBe(2)
  })
})

describe('summarize: skip reasons', () => {
  type Skip = { name: string; tags?: string[]; mode?: string; note?: string }
  const skipModule = (skips: Skip[]): TestModule =>
    ({
      moduleId: '/r/a.test.ts',
      relativeModuleId: 'a.test.ts',
      children: {
        allTests: () =>
          skips.map((t) => ({
            project: { name: 'unit' },
            tags: t.tags ?? [],
            fullName: t.name,
            options: {},
            task: { mode: t.mode ?? 'skip' },
            result: () => ({ state: 'skipped', ...(t.note ? { note: t.note } : {}) }),
            diagnostic: () => undefined,
          })),
      },
    }) as unknown as TestModule

  it('gives a skipped test the reason it was given: the text of ctx.skip()', () => {
    const s = summarize([skipModule([{ name: 'needs a db', note: 'no database in this sandbox' }])])
    expect(s.skips).toEqual([{ label: 'a.test.ts > needs a db', reason: 'no database in this sandbox' }])
  })
  it('names the quarantine tag, a todo, and a skip written in the code, each with its own reason', () => {
    const s = summarize([
      skipModule([
        { name: 'q', tags: ['quarantine'] },
        { name: 't', mode: 'todo' },
        { name: 'plain' },
      ]),
    ])
    expect(s.skips.map((x) => x.reason)).toEqual([
      expect.stringContaining('quarantine'),
      expect.stringContaining('todo'),
      expect.stringContaining('no reason given'),
    ])
    expect(s.skipped).toBe(3)
    expect(s.quarantined).toBe(1)
  })
  it('does not count a test the run excluded with its tag filter as a skip (small run: the medium-tagged ones)', () => {
    const s = summarize(
      [skipModule([{ name: 'm', tags: ['medium'] }, { name: 'real skip' }])],
      [],
      ['!medium'],
    )
    expect(s.skips.map((x) => x.label)).toEqual(['a.test.ts > real skip'])
    expect(s.skipped).toBe(1)
    expect(s.filtered).toBe(1)
  })
  it('does the same for the medium run: a test without the medium tag is excluded, not skipped', () => {
    const s = summarize([skipModule([{ name: 'small one' }, { name: 'm', tags: ['medium'] }])], [], ['medium'])
    expect(s.skips.map((x) => x.label)).toEqual(['a.test.ts > m'])
    expect(s.filtered).toBe(1)
  })
  it('with a filter it cannot read, lists every skip (an extra line beats a hidden skip)', () => {
    const s = summarize([skipModule([{ name: 'a' }, { name: 'b', tags: ['medium'] }])], [], ['medium && !protected'])
    expect(s.skips).toHaveLength(2)
    expect(s.filtered).toBe(0)
  })
  it('the reporter prints one line per skip, with the reason', () => {
    const out: string[] = []
    const write = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string) => (out.push(String(chunk)), true)) as typeof process.stdout.write
    try {
      testPresetReporter.onTestRunEnd([skipModule([{ name: 'needs a db', note: 'no database' }])])
    } finally {
      process.stdout.write = write
    }
    expect(out.join('')).toContain('[test-preset] SKIPPED: a.test.ts > needs a db (no database)')
  })
})
