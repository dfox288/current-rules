import { registerEndpoint } from '@nuxt/test-utils/runtime'
import { expect, it } from 'vitest'

// An untagged test in the nuxt project runs under small's guards. registerEndpoint answers a relative URL in-process
// (no socket), so small allows it.
it('a registered relative URL is answered in-process, by fetch and by $fetch', async () => {
  registerEndpoint('/api/hello', () => ({ ok: true }))
  expect(await (await fetch('/api/hello')).json()).toEqual({ ok: true })
  expect(await $fetch('/api/hello')).toEqual({ ok: true })
})

it('a registered URL with a query string is answered too', async () => {
  registerEndpoint('/api/search', () => ({ hits: 1 }))
  expect(await (await fetch('/api/search?q=a')).json()).toEqual({ hits: 1 })
})

it('after the endpoint is unregistered the URL is refused again', async () => {
  const unregister = registerEndpoint('/api/gone', () => ({ ok: true }))
  expect((await fetch('/api/gone')).ok).toBe(true)
  unregister()
  await expect(fetch('/api/gone')).rejects.toThrow(/small tier never touch the network \(fetch \/api\/gone\)/)
})
