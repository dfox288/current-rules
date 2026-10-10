import { describe, expect, it } from 'vitest'
import { defineTestConfig } from './config.js'

type Project = { test: Record<string, unknown> }
const projectOf = (config: Awaited<ReturnType<typeof defineTestConfig>>, name: string) =>
  (config.test?.projects as Project[]).find((p) => p.test.name === name) as Project

describe('defineTestConfig: a globalSetup passed through test:', () => {
  const base = { include: ['x.e2e.test.ts'], hookTimeout: 1_000, justification: 'the repo seeds a fixture' }

  it('is kept in e2e when the input has no globalSetup of its own', async () => {
    const config = await defineTestConfig({ e2e: { ...base, test: { globalSetup: ['seed.ts'] } } })
    expect(projectOf(config, 'e2e').test.globalSetup).toEqual(['seed.ts'])
  })

  it('is kept next to the input globalSetup in e2e, the input first', async () => {
    const config = await defineTestConfig({
      e2e: { ...base, globalSetup: ['build.ts'], test: { globalSetup: ['seed.ts'] } },
    })
    expect(projectOf(config, 'e2e').test.globalSetup).toEqual(['build.ts', 'seed.ts'])
  })

  it('is kept in unit', async () => {
    const config = await defineTestConfig({
      unit: { include: ['a.test.ts'], justification: 'x', test: { globalSetup: ['seed.ts'] } },
    })
    expect(projectOf(config, 'unit').test.globalSetup).toEqual(['seed.ts'])
  })

  it('leaves e2e without a globalSetup key when neither is given', async () => {
    const config = await defineTestConfig({ e2e: base })
    expect('globalSetup' in projectOf(config, 'e2e').test).toBe(false)
  })
})

describe('defineTestConfig: sequence.groupOrder', () => {
  const e2e = { include: ['x.e2e.test.ts'], hookTimeout: 1_000 }

  it('runs unit before e2e, so two projects with different maxWorkers do not collide', async () => {
    const config = await defineTestConfig({
      unit: { include: ['a.test.ts'], justification: 'workers', test: { maxWorkers: 3 } },
      e2e: { ...e2e, justification: 'workers', test: { maxWorkers: 2 } },
    })
    const order = (name: string) => (projectOf(config, name).test.sequence as { groupOrder: number }).groupOrder
    expect(order('unit')).toBeLessThan(order('e2e'))
    expect([order('unit'), order('e2e')]).toEqual([0, 1])
  })

  it('keeps the other sequence options a repo passes', async () => {
    const config = await defineTestConfig({
      unit: { include: ['a.test.ts'], justification: 'order', test: { sequence: { shuffle: false, concurrent: false } } },
    })
    expect(projectOf(config, 'unit').test.sequence).toEqual({ shuffle: false, concurrent: false, groupOrder: 0 })
  })

  it('accepts the order a repo set itself when it is the preset\'s (beacon\'s old setting)', async () => {
    const config = await defineTestConfig({
      unit: { include: ['a.test.ts'], justification: 'order', test: { sequence: { groupOrder: 0 } } },
      e2e: { ...e2e, justification: 'order', test: { sequence: { groupOrder: 1 } } },
    })
    expect(projectOf(config, 'e2e').test.sequence).toEqual({ groupOrder: 1 })
  })

  it('refuses a different order: the preset owns it', async () => {
    await expect(
      defineTestConfig({ unit: { include: ['a.test.ts'], justification: 'order', test: { sequence: { groupOrder: 5 } } } }),
    ).rejects.toThrow(/sets "sequence.groupOrder", which the preset fixes \(unit and nuxt 0, e2e 1\)/)
  })
})
