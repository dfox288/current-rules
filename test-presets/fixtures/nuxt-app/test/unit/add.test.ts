import { expect, it } from 'vitest'
import { add } from '../../app/utils/add'

it('adds two numbers', () => {
  expect(add(2, 3)).toBe(5)
})

it('runs in UTC', () => {
  expect(new Date(0).getTimezoneOffset()).toBe(0)
  expect(process.env.TZ).toBe('UTC')
})
