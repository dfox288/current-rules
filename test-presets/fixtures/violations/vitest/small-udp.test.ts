import dgram from 'node:dgram'
import { expect, it } from 'vitest'

it('small test sends a UDP datagram', async () => {
  const socket = dgram.createSocket('udp4')
  try {
    await new Promise<void>((resolve, reject) =>
      socket.send('x', 53, '203.0.113.1', (error) => (error ? reject(error) : resolve())),
    )
  } finally {
    socket.close()
  }
  expect(true).toBe(true)
})
