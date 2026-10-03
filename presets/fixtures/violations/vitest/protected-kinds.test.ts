import { describe, expect, it } from 'vitest'

it('is protected directly', { tags: ['protected'] }, () => {
  expect(1).toBe(1)
})

describe('a group tagged protected', { tags: ['protected'] }, () => {
  it('inherits the tag (one)', () => {
    expect(1).toBe(1)
  })
  it('inherits the tag (two)', () => {
    expect(1).toBe(1)
  })
})

it('is not protected', () => {
  expect(1).toBe(1)
})
