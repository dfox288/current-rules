import net from 'node:net'
import { expect, it } from 'vitest'

it('small test opens a socket (fetch)', async () => {
  await expect(fetch('http://203.0.113.1/')).resolves.toBeDefined()
})

it('small test opens a socket (net)', () => {
  const socket = net.connect(80, '203.0.113.1')
  socket.destroy()
  expect(true).toBe(true)
})
