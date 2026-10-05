import { afterEach, expect, it } from 'vitest'

// A relative URL is judged against `globalThis.location` (a browser-like environment has one).
const setLocation = (href: string | undefined) => {
  Object.defineProperty(globalThis, 'location', {
    value: href === undefined ? undefined : new URL(href),
    configurable: true,
    writable: true,
  })
}
afterEach(() => setLocation(undefined))

const refusal = async (url: string) => {
  try {
    await fetch(url)
  } catch (error) {
    return String((error as Error).message)
  }
  return ''
}
const REFUSED = /tests of the (small|medium) tier/

it('medium: a relative URL against a loopback location is not refused', { tags: ['medium'] }, async () => {
  setLocation('http://127.0.0.1:9/')
  expect(await refusal('/api/ping')).not.toMatch(REFUSED)
})

it('medium: a relative URL against a non-loopback location is refused', { tags: ['medium'] }, async () => {
  setLocation('http://203.0.113.1/')
  expect(await refusal('/api/ping')).toMatch(/reach only localhost/)
})

it('medium: a relative URL without any location is refused', { tags: ['medium'] }, async () => {
  setLocation(undefined)
  expect(await refusal('/api/ping')).toMatch(/reach only localhost/)
})

it('medium: an absolute non-loopback URL is refused', { tags: ['medium'] }, async () => {
  setLocation('http://127.0.0.1:9/')
  expect(await refusal('http://203.0.113.1/x')).toMatch(/reach only localhost/)
})

it('small: a relative URL against a loopback location is refused', async () => {
  setLocation('http://127.0.0.1:9/')
  expect(await refusal('/api/ping')).toMatch(/small tier never touch the network/)
})
