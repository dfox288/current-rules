import { expect, it } from 'vitest'

// Medium reaches localhost and the test database's host by exact hostname. A name that only starts with, ends with or
// contains one of them is another host (DNS would send it there): refused, before any lookup.
const refusal = async (url: string) => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) })
  } catch (error) {
    return String((error as Error).message)
  }
  return ''
}
const REFUSED = /tests of the medium tier reach only localhost/

const lookalikes = [
  'http://127.0.0.1.example.com/',
  'http://127.0.0.1.nip.io:9/',
  'http://localhost.example.com/',
  'http://example.com-localhost/',
  'http://xlocalhost/',
  'http://[::1].example.com/',
  'http://127.0.0.1@203.0.113.1/', // userinfo: the host is 203.0.113.1
  'http://203.0.113.1#@127.0.0.1/', // a fragment, not userinfo: the host is 203.0.113.1
]

for (const url of lookalikes)
  it(`medium: ${url} is refused`, { tags: ['medium'] }, async () => {
    expect(await refusal(url)).toMatch(REFUSED)
  })

it('medium: a lookalike of the test database host is refused', { tags: ['medium'] }, async () => {
  const host = new URL(process.env.TEST_DATABASE_URL ?? '').hostname
  expect(await refusal(`http://${host}.example.com/`)).toMatch(REFUSED)
  expect(await refusal(`http://x${host}/`)).toMatch(REFUSED)
})

it('control: the exact hostnames are not refused (the connection may fail, the guard does not)', { tags: ['medium'] }, async () => {
  expect(await refusal('http://127.0.0.1:9/')).not.toMatch(REFUSED)
  expect(await refusal('http://localhost:9/')).not.toMatch(REFUSED)
  expect(await refusal('http://[::1]:9/')).not.toMatch(REFUSED)
})
