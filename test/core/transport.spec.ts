import { describe, expect, it, vi } from 'vitest'
import { createFetchTransport } from '../../src/core/transport.js'

describe('createFetchTransport', () => {
  it('sends requests with fetch and returns status, headers and body', async () => {
    const fetch = vi.fn(
      async () =>
        new Response('{"a":1}', {
          status: 201,
          headers: { 'Content-Type': 'application/hal+json' },
        })
    )
    const transport = createFetchTransport({ fetch, credentials: 'include' })

    const response = await transport.request({
      method: 'POST',
      url: 'http://localhost/api/camps',
      headers: { Accept: 'application/hal+json' },
      body: '{}',
    })

    expect(fetch).toHaveBeenCalledWith('http://localhost/api/camps', {
      method: 'POST',
      headers: { Accept: 'application/hal+json' },
      body: '{}',
      credentials: 'include',
    })
    expect(response.status).toBe(201)
    expect(response.headers.get('content-type')).toBe('application/hal+json')
    expect(response.body).toBe('{"a":1}')
  })

  it('resolves for error statuses and rejects for network errors', async () => {
    const transport = createFetchTransport({
      fetch: vi
        .fn()
        .mockResolvedValueOnce(new Response('nope', { status: 500 }))
        .mockRejectedValueOnce(new TypeError('Failed to fetch')),
    })
    const request = { method: 'GET' as const, url: 'http://localhost/', headers: {} }

    await expect(transport.request(request)).resolves.toMatchObject({
      status: 500,
      body: 'nope',
    })
    await expect(transport.request(request)).rejects.toThrow('Failed to fetch')
  })
})
