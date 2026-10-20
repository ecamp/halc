import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../src/core/errors.js'
import { fixture, resetFixtureIds } from '../../src/testing/index.js'
import { createApi, flush } from '../helpers.js'

beforeEach(() => {
  resetFixtureIds()
})

describe('get', () => {
  it('returns a placeholder, loads the resource and then returns the real wrapper', async () => {
    const api = createApi()
    const camp = fixture('Camp', { title: 'Summer camp' })
    api.mock.get(camp)

    const placeholder = api.get(camp._meta.self)
    expect(placeholder._meta.loading).toBe(true)
    expect(placeholder._meta.self).toBe('/camps/000000000001')
    expect(placeholder._meta.type).toBe('Camp')
    expect(placeholder.items).toEqual([])
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- placeholders render empty
    expect(String(placeholder)).toBe('')

    const loaded = await placeholder._meta.load
    expect(loaded._meta.loading).toBe(false)
    expect(loaded.title).toBe('Summer camp')
    expect(api.get(camp._meta.self)).toBe(loaded)
    // The placeholder forwards to the loaded resource from now on.
    expect(placeholder.title).toBe('Summer camp')
    expect(placeholder._meta.loading).toBe(false)
  })

  it('serves loaded resources from the store without requests', async () => {
    const api = createApi()
    const camp = fixture('Camp', { title: 'x' })
    api.mock.get(camp)
    await api.get(camp._meta.self)._meta.load

    for (let i = 0; i < 10; i++) api.get(camp._meta.self)

    expect(api.mock.requests).toHaveLength(1)
  })

  it('returns the same wrapper until the record changes', async () => {
    const api = createApi()
    const camp = fixture('Camp', { title: 'x' })
    api.mock.get(camp)
    const first = await api.get(camp._meta.self)._meta.load

    expect(api.get(camp._meta.self)).toBe(first)
    await first.$reload()
    expect(api.get(camp._meta.self)).not.toBe(first)
  })

  it('shares one request between concurrent calls', async () => {
    const api = createApi()
    const camp = fixture('Camp')
    api.mock.get(camp).delay(10)

    const loads = [api.get(camp._meta.self), api.get(camp._meta.self), api.get(camp)].map(
      (resource) => resource._meta.load
    )
    api.reload(camp._meta.self).catch(() => undefined)
    await Promise.all(loads)

    expect(api.mock.requests).toHaveLength(1)
  })

  it('loads the API root without argument', async () => {
    const api = createApi()
    api.mock.get('/api/').reply(200, { _links: { self: { href: '/api/' } }, the: 'root' })

    const root = await api.get()._meta.load

    expect(root.the).toBe('root')
    expect(root._meta.self).toBe('')
    expect(root._meta.type).toBe('Root')
    expect(api.mock.requests[0]?.url).toBe('http://localhost/api/')
  })

  it('accepts wrappers and normalizes URIs', async () => {
    const api = createApi()
    api.mock.get('/api/camps?b=2&a=1').reply(200, {
      _links: { self: { href: '/api/camps?a=1&b=2' } },
      _embedded: { items: [] },
    })

    const collection = await api.get('http://localhost/api/camps?b=2&a=1')._meta.load

    expect(collection._meta.self).toBe('/camps?a=1&b=2')
    expect(api.get(collection)).toBe(collection)
  })

  it('stores a response under the requested URI if the self link differs', async () => {
    const api = createApi()
    api.mock
      .get('/api/me')
      .reply(200, { name: 'me', _links: { self: { href: '/api/users/1' } } })

    const me = await api.get('/me')._meta.load

    expect(me.name).toBe('me')
    expect(me._meta.self).toBe('/me')
    expect(api.status('/users/1')).toBe('loaded')
  })

  it('with forceRequestedSelfLink, stores a response only under the requested URI', async () => {
    const api = createApi({ forceRequestedSelfLink: true })
    api.mock
      .get('/api/me')
      .reply(200, { name: 'me', _links: { self: { href: '/api/users/1' } } })

    await api.get('/me')._meta.load

    expect(api.isUnknown('/users/1')).toBe(true)
  })

  it('throws for invalid input', () => {
    const api = createApi()
    expect(() => api.get(null as never)).toThrow(
      'Could not perform GET, "null" is not an entity or URI'
    )
    expect(() => api.get({ _meta: {} } as never)).toThrow(ApiError)
  })

  it('sends Accept, default headers and runs interceptors', async () => {
    const api = createApi({
      headers: { 'Accept-Language': 'de' },
      interceptors: [
        (request) => ({
          ...request,
          headers: { ...request.headers, Authorization: 'Bearer x' },
        }),
      ],
    })
    const camp = fixture('Camp')
    api.mock.get(camp)

    await api.get(camp._meta.self)._meta.load

    expect(api.mock.requests[0]?.headers).toEqual({
      Accept: 'application/hal+json',
      'Accept-Language': 'de',
      Authorization: 'Bearer x',
    })
  })
})

describe('errors', () => {
  it('rejects _meta.load with an ApiError and keeps the error sticky', async () => {
    const api = createApi()
    api.mock.get('/api/camps/1').reply(404, { title: 'Not Found', detail: 'No camp' })

    const error = (await api
      .get('/camps/1')
      ._meta.load.catch((e: unknown) => e)) as ApiError

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      method: 'GET',
      uri: '/camps/1',
      status: 404,
      type: 'Camp',
    })
    expect(error.message).toBe(
      'Could not GET http://localhost/api/camps/1 (status 404, Not Found: No camp)'
    )
    expect(error.response).toMatchObject({ status: 404, data: { detail: 'No camp' } })

    // Asking again, as a view does on every render, sends nothing.
    for (let i = 0; i < 5; i++) {
      const camp = api.get('/camps/1')
      expect(camp._meta.loading).toBe(false)
      expect(camp._meta.error).toBe(error)
      expect(camp.title).toBeTypeOf('function')
    }
    await expect(api.get('/camps/1')._meta.load).rejects.toBe(error)
    expect(api.mock.requests).toHaveLength(1)
    expect(api.status('/camps/1')).toBe('error')
  })

  it('clears a sticky error on reload and on invalidate', async () => {
    const api = createApi()
    api.mock.get('/api/camps/1').reply(500).once()
    api.mock
      .get('/api/camps/1')
      .reply(200, { _links: { self: { href: '/api/camps/1' } }, a: 1 })
      .once()
    api.mock
      .get('/api/camps/1')
      .reply(200, { _links: { self: { href: '/api/camps/1' } }, a: 2 })

    await expect(api.get('/camps/1')._meta.load).rejects.toThrow('status 500')
    expect((await api.reload('/camps/1')).a).toBe(1)

    api.mock.get('/api/camps/2').reply(403).once()
    api.mock
      .get('/api/camps/2')
      .reply(200, { _links: { self: { href: '/api/camps/2' } } })
    await expect(api.get('/camps/2')._meta.load).rejects.toThrow('status 403')
    api.invalidate('/camps/2')
    await expect(api.get('/camps/2')._meta.load).resolves.toBeDefined()
  })

  it('keeps the data of a loaded resource when a reload fails', async () => {
    const api = createApi()
    const camp = fixture('Camp', { title: 'x' })
    api.mock.get(camp).once()
    api.mock.get(camp).reply(500)
    const loaded = await api.get(camp._meta.self)._meta.load

    const reload = loaded.$reload()
    // _meta.load of a reloading resource resolves even if the reload fails.
    const load = api.get(camp._meta.self)._meta.load
    await expect(reload).rejects.toThrow('status 500')
    await expect(load).resolves.toMatchObject({ title: 'x' })
    expect(api.get(camp._meta.self)._meta.error?.status).toBe(500)
    expect(api.get(camp._meta.self).title).toBe('x')
  })

  it('rejects responses with an unexpected content type', async () => {
    const api = createApi()
    api.mock
      .get('/api/camps/1')
      .reply(200, '<html>login</html>', { 'Content-Type': 'text/html' })

    await expect(api.get('/camps/1')._meta.load).rejects.toThrow(
      'Expected application/hal+json or application/json from GET http://localhost/api/camps/1, but received text/html'
    )
  })

  it('reports network errors', async () => {
    const api = createApi()
    api.mock.get('/api/camps/1').networkError()

    const error = (await api
      .get('/camps/1')
      ._meta.load.catch((e: unknown) => e)) as ApiError
    expect(error.status).toBeUndefined()
    expect(error.message).toBe(
      'Could not GET http://localhost/api/camps/1 (Network error (mocked))'
    )
    expect(error.cause).toBeInstanceOf(TypeError)
  })

  it('reloads the resources that referenced a resource that is gone', async () => {
    const api = createApi()
    const activity = fixture('Activity', { title: 'Hike' })
    const camp = fixture('Camp', { activities: [activity] }, { embed: true })
    api.mock.get(camp)
    await api.get(camp._meta.self)._meta.load
    api.mock.get(activity).reply(404)

    await api.reload(activity._meta.self).catch(() => undefined)
    await flush()

    // The embedded activities are a collection of their own, which is reloaded.
    expect(api.mock.requests.map((request) => request.uri)).toEqual([
      '/camps/000000000002',
      '/activities/000000000001',
      '/camps/000000000002/activities',
    ])
  })
})

describe('retries', () => {
  it('retries network errors, 429 and 5xx with backoff, sharing one promise', async () => {
    vi.useFakeTimers()
    try {
      const api = createApi({ retry: { jitter: false } })
      const camp = fixture('Camp')
      api.mock.get(camp).networkError().once()
      api.mock.get(camp).reply(503).once()
      api.mock.get(camp).reply(429, { title: 'slow down' }, { 'Retry-After': '1' }).once()
      api.mock.get(camp)

      const load = api.get(camp._meta.self)._meta.load
      api.get(camp._meta.self)
      await vi.advanceTimersByTimeAsync(499)
      expect(api.mock.requests).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(api.mock.requests).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(2000)
      expect(api.mock.requests).toHaveLength(3)
      await vi.advanceTimersByTimeAsync(1000)
      await expect(load).resolves.toBeDefined()
      expect(api.mock.requests).toHaveLength(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not retry other 4xx answers', async () => {
    const api = createApi({ retry: { retries: 3 } })
    api.mock.get('/api/camps/1').reply(400)
    await expect(api.get('/camps/1')._meta.load).rejects.toThrow()
    expect(api.mock.requests).toHaveLength(1)
  })
})

describe('store helpers', () => {
  it('purges resources so they are loaded again', async () => {
    const api = createApi()
    const camp = fixture('Camp')
    api.mock.get(camp)
    await api.get(camp._meta.self)._meta.load

    api.purge(camp._meta.self)
    expect(api.isUnknown(camp._meta.self)).toBe(true)
    await api.get(camp._meta.self)._meta.load

    api.purgeAll()
    expect(api.store.snapshot()).toEqual({})
    expect(api.mock.requests).toHaveLength(2)
  })

  it('reloads stale resources on the next read and shows the old data meanwhile', async () => {
    const api = createApi()
    const camp = fixture('Camp', { title: 'old' })
    api.mock.get(camp).once()
    api.mock.get(camp).reply(200, (current: any) => ({ ...current, title: 'new' }))
    await api.get(camp._meta.self)._meta.load

    api.invalidate(camp._meta.self)
    expect(api.status(camp._meta.self)).toBe('stale')
    expect(api.get(camp._meta.self).title).toBe('old')
    await api.get(camp._meta.self)._meta.load
    expect(api.get(camp._meta.self).title).toBe('new')
  })

  it('exposes the store as comparable plain data', async () => {
    const api = createApi()
    const camp = fixture('Camp', { title: 'x' })
    api.mock.get(camp)
    await api.get(camp._meta.self)._meta.load

    expect(api.store.snapshot()).toEqual({
      '/camps/000000000001': {
        uri: '/camps/000000000001',
        data: { title: 'x' },
        meta: {
          version: 1,
          status: 'loaded',
          loadedAt: expect.any(Number),
          type: 'Camp',
          resource: '/camps/{id}',
        },
      },
    })
  })
})
