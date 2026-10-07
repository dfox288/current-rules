import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { expectShape, loadAnswer, recordAnswer, shapeDiff } from './shape.js'

const dir = mkdtempSync(join(tmpdir(), 'shape-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const real = { id: 7, name: 'run', ok: true, owner: null, tags: ['a', 'b'], steps: [{ n: 1, label: 'x' }] }

describe('shapeDiff', () => {
  it('accepts other values of the same shape', () => {
    const fake = { id: 99, name: '', ok: false, owner: null, tags: [], steps: [{ n: 2, label: 'y' }, { n: 3, label: 'z' }] }
    expect(shapeDiff(fake, real)).toEqual([])
  })
  it('reports a missing key, an extra key and a kind change with their paths', () => {
    const fake = { id: '7', name: 'run', ok: true, owner: null, tags: ['a'], steps: [{ n: 1 }], extra: 1 }
    expect(shapeDiff(fake, real)).toEqual([
      '$.extra: key is not in the recorded answer',
      '$.id: expected number, got string',
      '$.steps[0].label: key is missing',
    ])
  })
  it('checks every element of an array, not only the first', () => {
    expect(shapeDiff({ ...real, tags: ['a', 2] }, real)).toEqual(['$.tags[1]: expected string, got number'])
  })
  it('tells null from a value, and an array from an object', () => {
    expect(shapeDiff({ ...real, owner: 'bob' }, real)).toEqual(['$.owner: expected null, got string'])
    expect(shapeDiff({ ...real, tags: {} }, real)).toEqual(['$.tags: expected array, got object'])
  })
  it('merges recorded elements: a key some lack is optional, kinds are a union', () => {
    const recorded = [{ a: 1, b: 'x' }, { a: null }]
    expect(shapeDiff([{ a: 2 }, { a: null, b: 'q' }], recorded)).toEqual([])
    expect(shapeDiff([{ a: 'no' }], recorded)).toEqual(['$[0].a: expected number | null, got string'])
    expect(shapeDiff([{ b: 'only' }], recorded)).toEqual(['$[0].a: key is missing'])
  })
  it('treats an undefined value as an absent key', () => {
    expect(shapeDiff({ id: 1, gone: undefined }, { id: 2 })).toEqual([])
    expect(shapeDiff({ id: undefined }, { id: 2 })).toEqual(['$.id: key is missing'])
  })
  it('accepts any element after an empty recorded array', () => {
    expect(shapeDiff({ rows: [1, 'a'] }, { rows: [] })).toEqual([])
  })
  it('reports a root of the wrong kind', () => {
    expect(shapeDiff([], real)).toEqual(['$: expected object, got array'])
  })
  it('reports a value JSON cannot hold instead of passing it', () => {
    expect(shapeDiff({ id: () => 1 }, { id: 1 })).toEqual(['$.id: got a function, which is not JSON data'])
  })
})

describe('recordings', () => {
  it('writes a recording that expectShape then reads back', () => {
    const file = join(dir, 'nested', 'run.json')
    recordAnswer(file, real)
    expect(loadAnswer(file)).toEqual(real)
    expect(readFileSync(file, 'utf8').endsWith('\n')).toBe(true)
    expectShape({ ...real, id: 8 }, file)
  })
  it('fails expectShape with every difference and the re-record hint', () => {
    const file = join(dir, 'run2.json')
    recordAnswer(file, real)
    expect(() => expectShape({ ...real, id: 'x', name: 1 }, file)).toThrow(
      /\$\.id: expected number, got string\n {2}\$\.name: expected string, got number\nIf the real service changed, re-record on purpose/,
    )
  })
  it('fails on a missing recording and never creates one', () => {
    const file = join(dir, 'absent.json')
    expect(() => expectShape(real, file)).toThrow(/no recorded answer at .*absent\.json/)
    expect(() => loadAnswer(file)).toThrow(/no recorded answer/)
  })
  it('refuses to record what JSON cannot hold', () => {
    expect(() => recordAnswer(join(dir, 'bad.json'), { f: () => 1 })).toThrow(/not JSON data/)
  })
})
