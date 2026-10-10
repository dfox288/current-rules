import { describe, expect, it } from 'vitest'
import { answeredInProcess } from './endpoint.js'

describe('answeredInProcess', () => {
  const registry = new Set(['/api/hello', '/api/search'])
  it('is true for a relative URL that registerEndpoint registered, with or without a query', () => {
    expect(answeredInProcess('/api/hello', registry)).toBe(true)
    expect(answeredInProcess('/api/search?q=a', registry)).toBe(true)
  })
  it('is false for a relative URL nothing registered', () => {
    expect(answeredInProcess('/api/other', registry)).toBe(false)
    expect(answeredInProcess('/api/hello/extra', registry)).toBe(false)
  })
  it('is false for an absolute URL, even one on the registered path', () => {
    expect(answeredInProcess('http://localhost:3000/api/hello', registry)).toBe(false)
    expect(answeredInProcess('http://127.0.0.1:9/api/hello', registry)).toBe(false)
  })
  it('is false for a protocol-relative URL (it names a host) and for a backslash form browsers read the same way', () => {
    // not a path, whatever the registry holds: the real fetch would send it to that host
    const odd = new Set(['//203.0.113.1/api/hello', '/\\203.0.113.1/api/hello'])
    expect(answeredInProcess('//203.0.113.1/api/hello', odd)).toBe(false)
    expect(answeredInProcess('/\\203.0.113.1/api/hello', odd)).toBe(false)
  })
  it('is false when there is no registry (a plain node environment) or it is empty', () => {
    expect(answeredInProcess('/api/hello', undefined)).toBe(false)
    expect(answeredInProcess('/api/hello', new Set())).toBe(false)
  })
})
