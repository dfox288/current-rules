import { describe, expect, it } from 'vitest'
import { retryCount, retryRefusal } from './retry.js'

describe('retryCount', () => {
  it('reads a number, an object with a count, and nothing', () => {
    expect(retryCount(3)).toBe(3)
    expect(retryCount({ count: 2, delay: 10 })).toBe(2)
    expect(retryCount(undefined)).toBe(0)
    expect(retryCount(0)).toBe(0)
    expect(retryCount({ delay: 10 })).toBe(0)
    expect(retryCount(null)).toBe(0)
  })
})

describe('retryRefusal', () => {
  it('names the number asked for and what to do instead', () => {
    expect(retryRefusal(2)).toMatch(/never retry \(this one asks for 2\).*quarantine/)
    expect(retryRefusal({ count: 1 })).toMatch(/asks for 1/)
  })
  it('control: no retry is no refusal', () => {
    expect(retryRefusal(0)).toBeUndefined()
    expect(retryRefusal(undefined)).toBeUndefined()
  })
})
