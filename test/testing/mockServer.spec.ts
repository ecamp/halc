import { beforeEach, describe, expect, it } from 'vitest'
import { createUriNormalizer } from '../../src/core/uri.js'
import { collectionFixture, fixture, resetFixtureIds } from '../../src/testing/fixture.js'
import { toMatchRequests } from '../../src/testing/matchers.js'
import { MockServer } from '../../src/testing/mockServer.js'

beforeEach(() => {
  resetFixtureIds()
})

function createServer() {
  return new MockServer({
    normalizeUri: createUriNormalizer('http://localhost/api'),
    typeOf: (uri) => (uri.startsWith('/camps') ? 'Camp' : undefined),
  })
}

function request(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
) {
  return {
    method,
    url: `http://localhost/api${path}`,
    headers: {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}

async function json(server: MockServer, ...args: Parameters<typeof request>) {
  const response = await server.transport.request(request(...args))
  return {
    status: response.status,
    body: response.body ? JSON.parse(response.body) : undefined,
  }
}

describe('MockServer', () => {
  it('answers GET with the fixture and records requests', async () => {
    const server = createServer()
    const camp = fixture('Camp', { title: 'x' })
    server.get(camp)

    const response = await server.transport.request(request('GET', '/camps/000000000001'))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/hal+json')
    expect(JSON.parse(response.body)).toEqual(JSON.parse(JSON.stringify(camp)))
    expect(server.requests).toMatchObject([
      { method: 'GET', uri: '/camps/000000000001', type: 'Camp', matched: true },
    ])
  })

  it('rejects unmocked requests', async () => {
    const server = createServer()
    await expect(server.transport.request(request('GET', '/x'))).rejects.toThrow(
      'halc/testing: no mock for GET http://localhost/api/x'
    )
    expect(server.requests[0]?.matched).toBe(false)
  })

  it('answers once-routes in order, otherwise the latest route', async () => {
    const server = createServer()
    server.get('/api/a').reply(200, { n: 1 })
    server.get('/api/a').reply(200, { n: 2 })
    server.get('/api/a').reply(200, { n: 3 }).once()
    server.get('/api/a').reply(500).once()

    expect(await json(server, 'GET', '/a')).toEqual({ status: 200, body: { n: 3 } })
    expect((await json(server, 'GET', '/a')).status).toBe(500)
    expect(await json(server, 'GET', '/a')).toEqual({ status: 200, body: { n: 2 } })
  })

  it('updates server state with the default PATCH, POST and DELETE answers', async () => {
    const server = createServer()
    const camp = fixture('Camp', { title: 'old' })
    const camps = collectionFixture('Camp', [camp])
    server.get(camps)
    server.get(camp)
    server.patch(camp)
    server.post(camps)
    server.delete(camp)

    expect(
      (await json(server, 'PATCH', '/camps/000000000001', { title: 'new' })).body.title
    ).toBe('new')
    expect((await json(server, 'GET', '/camps/000000000001')).body.title).toBe('new')
    const created = await json(server, 'POST', '/camps', { title: 'created' })
    expect(created).toMatchObject({
      status: 201,
      body: { title: 'created', _links: { self: { href: '/api/camps/000000000002' } } },
    })
    expect((await json(server, 'GET', '/camps')).body._embedded.items).toHaveLength(2)
    expect((await json(server, 'DELETE', '/camps/000000000001')).status).toBe(204)
    expect((await json(server, 'GET', '/camps/000000000001')).status).toBe(404)
    expect((await json(server, 'GET', '/camps')).body._embedded.items).toHaveLength(1)
  })

  it('passes the current state and the request to reply functions', async () => {
    const server = createServer()
    const camp = fixture('Camp', { title: 'old' })
    server.get(camp)
    server.patch(camp).reply(200, (current: any, req: any) => ({
      ...current,
      ...(req.body as object),
      extra: true,
    }))

    const { body } = await json(server, 'PATCH', '/camps/000000000001', { title: 'new' })

    expect(body).toMatchObject({ title: 'new', extra: true })
    expect(server.current(camp)).toMatchObject({ title: 'new', extra: true })
  })

  it('answers errors with problem details and can fail like a network', async () => {
    const server = createServer()
    server.get('/api/a').status(409)
    server.get('/api/b').networkError()

    const response = await server.transport.request(request('GET', '/a'))
    expect(response.status).toBe(409)
    expect(response.headers.get('Content-Type')).toBe('application/problem+json')
    await expect(server.transport.request(request('GET', '/b'))).rejects.toThrow(
      TypeError
    )
  })

  it('resets routes, requests and state', async () => {
    const server = createServer()
    server.get(fixture('Camp'))
    await server.transport.request(request('GET', '/camps/000000000001'))
    server.reset()
    expect(server.requests).toEqual([])
    await expect(
      server.transport.request(request('GET', '/camps/000000000001'))
    ).rejects.toThrow()
  })
})

describe('toMatchRequests', () => {
  it('compares only the given fields, in order', async () => {
    const server = createServer()
    server.get(fixture('Camp'))
    await server.transport.request(request('GET', '/camps/000000000001'))

    expect(toMatchRequests(server.requests, [{ method: 'GET', type: 'Camp' }]).pass).toBe(
      true
    )
    const mismatch = toMatchRequests(server.requests, [{ method: 'PATCH' }])
    expect(mismatch.pass).toBe(false)
    expect(mismatch.message()).toContain('GET /camps/000000000001 (Camp)')
    expect(toMatchRequests(server.requests, []).pass).toBe(false)
  })
})
