import { beforeEach, describe, expect, it } from 'vitest'
import { collectionFixture, fixture, resetFixtureIds } from '../../src/testing/index.js'
import { createApi, flush } from '../helpers.js'

beforeEach(() => {
  resetFixtureIds()
})

function self(href: string) {
  return { _links: { self: { href } } }
}

describe('relations', () => {
  it('follows links to single resources and loads them lazily', async () => {
    const api = createApi()
    const user = fixture('User', { name: 'Ada' })
    const camp = fixture('Camp', { creator: user })
    api.mock.get(camp)
    api.mock.get(user)

    const loaded = await api.get(camp._meta.self)._meta.load
    expect(api.mock.requests).toHaveLength(1)

    const creator = loaded.creator()
    expect(creator._meta.self).toBe('/users/000000000001')
    expect(creator._meta.loading).toBe(true)
    expect((await creator._meta.load).name).toBe('Ada')
    expect(loaded.$hrefSync('creator')).toBe('/users/000000000001')
  })

  it('returns embedded single resources without a request', async () => {
    const api = createApi()
    const camp = fixture(
      'Camp',
      { creator: fixture('User', { name: 'Ada' }) },
      { embed: true }
    )
    api.mock.get(camp)

    const loaded = await api.get(camp._meta.self)._meta.load

    expect(loaded.creator().name).toBe('Ada')
    expect(api.mock.requests).toHaveLength(1)
  })

  it('expands templated links', async () => {
    const api = createApi()
    api.mock.get('/api/').reply(200, {
      _links: {
        self: { href: '/api/' },
        camps: { href: '/api/camps{/id}{?isPrototype}', templated: true },
      },
    })
    api.mock.get('/api/camps/1').reply(200, { ...self('/api/camps/1'), title: 'One' })

    const root = await api.get()._meta.load

    expect((await root.camps({ id: 1 })._meta.load).title).toBe('One')
    expect(root.$hrefSync('camps', { isPrototype: true })).toBe('/camps?isPrototype=true')
    await expect(root.$href('camps', { id: 2 })).resolves.toBe('/camps/2')
    await expect(api.href('', 'camps')).resolves.toBe('/camps')
  })

  it('supports relation names that are no identifiers', async () => {
    const api = createApi()
    api.mock.get('/api/posts/1').reply(200, {
      ...self('/api/posts/1'),
      _links: { self: { href: '/api/posts/1' }, 'ht:author': { href: '/api/users/1' } },
    })
    const post = await api.get('/posts/1')._meta.load

    expect(post['ht:author']()._meta.self).toBe('/users/1')
    expect(post.$rel('ht:author')._meta.self).toBe('/users/1')
  })

  it('throws when a property is used like a relation', async () => {
    const api = createApi()
    const camp = fixture('Camp', { title: 'x' })
    api.mock.get(camp)
    const loaded = await api.get(camp._meta.self)._meta.load

    expect(() => loaded.$rel('title')).toThrow(
      "Property 'title' of '/camps/000000000001' was used like a relation"
    )
    expect(loaded.missing).toBeUndefined()
  })

  it('exposes the raw relations in _meta.links', async () => {
    const api = createApi()
    const camp = fixture('Camp', { title: 'x', creator: fixture('User') })
    api.mock.get(camp)
    const loaded = await api.get(camp._meta.self)._meta.load

    expect(loaded._meta.links).toEqual({ creator: { href: '/users/000000000001' } })
  })
})

describe('placeholders', () => {
  it('chains relations of unloaded resources', async () => {
    const api = createApi()
    const user = fixture('User', { name: 'Ada' })
    const camp = fixture('Camp', { creator: user })
    api.mock.get(camp).delay(5)
    api.mock.get(user)

    const creator = api.get(camp._meta.self).creator()
    expect(creator._meta.loading).toBe(true)
    expect(creator._meta.self).toBeUndefined()
    expect(creator.items).toEqual([])
    expect(`${creator.name}`).toBe('')
    expect(api.get(creator)).toBe(creator)

    expect((await creator._meta.load).name).toBe('Ada')
    expect(creator.name).toBe('Ada')
    expect(creator._meta.self).toBe('/users/000000000001')
  })

  it('returns the same placeholder for the same relation call', () => {
    const api = createApi()
    api.mock.get('/api/camps/1').delay(5).reply(200, self('/api/camps/1'))
    const camp = api.get('/camps/1')

    expect(camp.periods()).toBe(camp.periods())
    expect(camp.periods).toBe(camp.periods)
    expect(camp.periods({ a: 1 })).not.toBe(camp.periods())
  })

  it('rejects the load of a relation the API did not return', async () => {
    const api = createApi()
    api.mock.get('/api/camps/1').reply(200, { ...self('/api/camps/1'), title: 'x' })

    const missing = api.get('/camps/1').missing()

    await expect(missing._meta.load).rejects.toThrow(
      "Property 'missing' of '/camps/1' was used like a relation"
    )
    expect(missing._meta.loading).toBe(false)
    expect(missing._meta.error?.message).toContain('missing')
  })

  it('runs mutations once the resource is loaded', async () => {
    const api = createApi()
    const camp = fixture('Camp', { title: 'old' })
    api.mock.get(camp).delay(5)
    api.mock.patch(camp)

    await api.get(camp._meta.self).$patch({ title: 'new' })

    expect(api.get(camp._meta.self).title).toBe('new')
  })

  it('does not look like a promise or a Vue object', () => {
    const api = createApi()
    api.mock.get('/api/camps/1').delay(5).reply(200, self('/api/camps/1'))
    const camp = api.get('/camps/1')

    expect(camp.then).toBeUndefined()
    expect(camp.__v_isRef).toBeUndefined()
    expect(JSON.stringify(camp)).toBe('{}')
  })
})

describe('collections', () => {
  it('loads a collection with embedded items, as plain frozen arrays', async () => {
    const api = createApi()
    const activities = collectionFixture('Activity', [
      fixture('Activity', { title: 'Hike' }),
      fixture('Activity', { title: 'Campfire' }),
    ])
    api.mock.get(activities)

    const collection = await api.get(activities._meta.self)._meta.load

    expect(Array.isArray(collection.items)).toBe(true)
    expect(Object.isFrozen(collection.items)).toBe(true)
    expect(collection.items.map((item: any) => item.title)).toEqual(['Hike', 'Campfire'])
    expect(
      collection.items.find((item: any) => item.title === 'Campfire')?._meta.type
    ).toBe('Activity')
    expect(collection.items).toBe(collection.items)
    expect(collection._meta.type).toBe('Activity')
    expect(collection.totalItems).toBe(2)
    expect(api.mock.requests).toHaveLength(1)
  })

  it('returns empty items for unloaded collections and non-collections', async () => {
    const api = createApi()
    const camp = fixture('Camp')
    api.mock.get('/api/activities').delay(5).reply(200, collectionFixture('Activity', []))
    api.mock.get(camp)

    expect(api.get('/activities').items).toEqual([])
    expect(api.get('/activities').allItems).toEqual([])
    expect((await api.get(camp._meta.self)._meta.load).items).toEqual([])
  })

  it('handles embedded lists without a URI of their own as virtual collections', async () => {
    const api = createApi()
    api.mock.get('/api/camps/1').reply(200, {
      ...self('/api/camps/1'),
      _embedded: {
        periods: [
          { ...self('/api/periods/1'), name: 'A' },
          { ...self('/api/periods/2'), name: 'B' },
        ],
      },
    })

    const camp = await api.get('/camps/1')._meta.load
    const periods = camp.periods()

    expect(periods._meta.virtual).toBe(true)
    expect(periods._meta.self).toBe('/camps/1#periods')
    expect(periods._meta.type).toBe('Period')
    expect(periods.items.map((period: any) => period.name)).toEqual(['A', 'B'])
    expect(api.get('/camps/1#periods')).toBe(periods)
    expect(camp.$hrefsSync('periods')).toEqual(['/periods/1', '/periods/2'])
    await expect(camp.$hrefs('periods')).resolves.toEqual(['/periods/1', '/periods/2'])
    await expect(periods.$post({})).rejects.toThrow(
      'not implemented for virtual resources'
    )
    await expect(api.patch(periods, {})).rejects.toThrow(
      'not implemented for virtual resources'
    )

    await periods.$reload()
    expect(api.mock.requests.map((request) => request.uri)).toEqual([
      '/camps/1',
      '/camps/1',
    ])
  })

  it('resolves virtual collections of unloaded owners', async () => {
    const api = createApi()
    api.mock
      .get('/api/camps/1')
      .delay(5)
      .reply(200, {
        ...self('/api/camps/1'),
        _embedded: { periods: [{ ...self('/api/periods/1'), a: 1 }] },
      })

    const periods = api.get('/camps/1#periods')
    expect(periods.items).toEqual([])

    await periods._meta.load
    expect(periods.items).toHaveLength(1)
  })

  it('links to a standalone collection when the API also sends a link', async () => {
    const api = createApi()
    const camp = fixture(
      'Camp',
      { periods: [fixture('Period', { a: 1 })] },
      { embed: true }
    )
    api.mock.get(camp)

    const loaded = await api.get(camp._meta.self)._meta.load

    expect(loaded.periods()._meta.self).toBe('/camps/000000000002/periods')
    expect(loaded.periods().items).toHaveLength(1)
    expect(loaded.$hrefSync('periods')).toBe('/camps/000000000002/periods')
    expect(loaded.$hrefsSync('periods')).toEqual(['/periods/000000000001'])
    expect(api.mock.requests).toHaveLength(1)
  })

  it('avoids n+1 requests: reloads the collection before loading single items', async () => {
    const api = createApi()
    api.mock
      .get('/api/camps/1')
      .reply(200, {
        ...self('/api/camps/1'),
        _links: {
          self: { href: '/api/camps/1' },
          activities: [{ href: '/api/activities/1' }],
        },
      })
      .once()
    api.mock.get('/api/camps/1').reply(200, {
      ...self('/api/camps/1'),
      _embedded: { activities: [{ ...self('/api/activities/1'), title: 'Hike' }] },
    })

    const loaded = await api.get('/camps/1')._meta.load
    const activities = loaded.activities()
    expect(activities.items[0]._meta.loading).toBe(true)

    await activities.$loadItems()

    expect(api.get('/camps/1').activities().items[0].title).toBe('Hike')
    expect(api.mock.requests.map((request) => request.uri)).toEqual([
      '/camps/1',
      '/camps/1',
    ])
  })

  it('falls back to loading every item if the reload does not embed them', async () => {
    const api = createApi()
    api.mock.get('/api/camps/1').reply(200, {
      _links: {
        self: { href: '/api/camps/1' },
        activities: [{ href: '/api/activities/1' }],
      },
    })
    api.mock
      .get('/api/activities/1')
      .reply(200, { ...self('/api/activities/1'), title: 'Hike' })

    const camp = await api.get('/camps/1')._meta.load
    const items = camp.activities().items
    await flush()
    await flush()

    expect(items[0].title).toBe('Hike')
    expect(api.mock.requests.map((request) => request.uri)).toEqual([
      '/camps/1',
      '/camps/1',
      '/activities/1',
    ])
  })

  it('loads every item on its own without avoidNPlusOneRequests', async () => {
    const api = createApi({ avoidNPlusOneRequests: false })
    api.mock.get('/api/camps/1').reply(200, {
      _links: {
        self: { href: '/api/camps/1' },
        activities: [{ href: '/api/activities/1' }],
      },
    })
    api.mock
      .get('/api/activities/1')
      .reply(200, { ...self('/api/activities/1'), title: 'Hike' })

    const camp = await api.get('/camps/1')._meta.load
    await camp.activities().$loadItems()

    expect(api.mock.requests.map((request) => request.uri)).toEqual([
      '/camps/1',
      '/activities/1',
    ])
  })

  it('$loadItems settles per item and rejects only if every item failed', async () => {
    const api = createApi({ avoidNPlusOneRequests: false })
    api.mock.get('/api/list').reply(200, {
      _links: {
        self: { href: '/api/list' },
        items: [{ href: '/api/activities/1' }, { href: '/api/activities/2' }],
      },
    })
    api.mock
      .get('/api/activities/1')
      .reply(200, { ...self('/api/activities/1'), title: 'ok' })
    api.mock.get('/api/activities/2').reply(500)
    api.mock.get('/api/broken').reply(200, {
      _links: { self: { href: '/api/broken' }, items: [{ href: '/api/activities/2' }] },
    })

    const list = await api.get('/list').$loadItems()
    expect(list.items.map((item: any) => item._meta.error?.status ?? item.title)).toEqual(
      ['ok', 500]
    )
    await expect(api.get('/broken').$loadItems()).rejects.toThrow('status 500')
  })

  it('$loadItems rejects for non-collections', async () => {
    const api = createApi()
    api.mock.get('/api/users/1').reply(200, { ...self('/api/users/1'), name: 'x' })
    await expect(api.get('/users/1').$loadItems()).rejects.toThrow(
      '"/users/1" is not a collection'
    )
  })
})
