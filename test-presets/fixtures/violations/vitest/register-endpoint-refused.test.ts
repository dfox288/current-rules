import { registerEndpoint } from '@nuxt/test-utils/runtime'
import { expect, it } from 'vitest'

// What small still refuses next to registerEndpoint: each of these reaches (or may reach) the network.
registerEndpoint('/api/hello', () => ({ ok: true }))

it('an unregistered relative URL', async () => {
  expect((await fetch('/api/unregistered')).status).toBe(200)
})

it('an absolute URL, even one that looks like the registered path on the page origin', async () => {
  expect((await fetch(`${location.origin}/api/hello`)).status).toBe(200)
})

it('a localhost port', async () => {
  expect((await fetch('http://127.0.0.1:9/api/hello')).status).toBe(200)
})

it('a protocol-relative URL is a host, not a path', async () => {
  expect((await fetch('//203.0.113.1/api/hello')).status).toBe(200)
})
