import { beforeEach, describe, expect, it } from 'vitest'
import type { ReactivityAdapter } from '../../src/core/adapters.js'
import { createHalc } from '../../src/core/client.js'
import { collectionFixture, fixture, resetFixtureIds } from '../../src/testing/index.js'
import { createApi } from '../helpers.js'

beforeEach(() => {
  resetFixtureIds()
})

function recordingReactivity() {
  const tracked = new Set<string>()
  const bumped: string[] = []
  const marked = new WeakSet()
  const reactivity: ReactivityAdapter = {
    signal: () => ({ value: 0 }),
    track: (uri) => tracked.add(uri),
    bump: (uri) => bumped.push(uri),
    markRaw: (value) => {
      marked.add(value)
      return value
    },
  }
  return { reactivity, tracked, bumped, marked }
}

describe('wrappers', () => {
  it('are plain objects whose data properties are own, enumerable and live', async () => {
    const api = createApi()
    const camp = fixture('Camp', { title: 'x', creator: fixture('User') })
    api.mock.get(camp)
    api.mock.patch(camp)
    const loaded = await api.get(camp._meta.self)._meta.load

    expect(Object.keys(loaded)).toEqual(['_meta', 'title', 'creator'])
    // Like in hal-json-vuex, a spread copy keeps _meta and working relations.
    const copy: Record<string, any> = { ...loaded, extra: true }
    expect(copy._meta.self).toBe('/camps/000000000002')
    expect(copy.creator()._meta.self).toBe('/users/000000000001')
    expect(loaded.creator).toBeTypeOf('function')
    expect(loaded.creator).toBe(loaded.creator)
    expect(loaded.constructor.name).toBe('Camp')

    await api.patch(camp._meta.self, { title: 'y' })
    // An old wrapper still reads current values.
    expect(loaded.title).toBe('y')
  })

  it('are cast with as() at no cost', async () => {
    const api = createApi()
    const camp = fixture('Camp')
    api.mock.get(camp)
    const loaded = await api.get(camp._meta.self)._meta.load
    expect(loaded.as()).toBe(loaded)
  })

  it('resolves normalized URIs to URLs, e.g. to navigate to an expanded templated link', async () => {
    const api = createApi()
    api.mock.get('/api/').reply(200, {
      _links: {
        self: { href: '/api/' },
        oauth: { href: '/api/auth{?callback}', templated: true },
      },
    })
    const href = await api.href('', 'oauth', { callback: 'https://app.example.com/back' })
    expect(href).toBe('/auth?callback=https%3A%2F%2Fapp.example.com%2Fback')
    expect(api.resolveUrl(href!)).toBe(
      'http://localhost/api/auth?callback=https%3A%2F%2Fapp.example.com%2Fback'
    )
  })

  it('expose absolute URLs', async () => {
    const api = createApi()
    const camp = fixture('Camp')
    api.mock.get(camp).delay(5)

    const placeholder = api.get(camp._meta.self)
    expect(placeholder._meta.selfUrl).toBe('http://localhost/api/camps/000000000001')
    expect((await placeholder._meta.load)._meta.selfUrl).toBe(
      'http://localhost/api/camps/000000000001'
    )
  })
})

describe('reactivity contract', () => {
  it('tracks the URI of every read and bumps every written record once', async () => {
    const { reactivity, tracked, bumped, marked } = recordingReactivity()
    const api = createApi({ reactivity })
    const activities = collectionFixture('Activity', [
      fixture('Activity', { title: 'a' }),
      fixture('Activity', { title: 'b' }),
    ])
    api.mock.get(activities)

    const collection = await api.get(activities._meta.self)._meta.load
    expect(bumped.sort()).toEqual([
      '/activities',
      '/activities/000000000001',
      '/activities/000000000002',
    ])
    expect(marked.has(collection)).toBe(true)

    tracked.clear()
    const items = collection.items
    expect([...tracked]).toEqual(['/activities'])
    expect(items[0].title).toBe('a')
    expect([...tracked]).toEqual(['/activities', '/activities/000000000001'])
  })

  it('does not notify when a read starts a request', () => {
    const { reactivity, bumped } = recordingReactivity()
    const api = createApi({ reactivity })
    api.mock
      .get('/api/camps/1')
      .delay(5)
      .reply(200, { _links: { self: { href: '/api/camps/1' } } })

    api.get('/camps/1')

    expect(bumped).toEqual([])
  })

  it('client methods work when detached from the client', async () => {
    const api = createApi()
    api.mock
      .get('/api/camps/1')
      .reply(200, { _links: { self: { href: '/api/camps/1' } }, a: 1 })
    const { get, reload, isUnknown } = api
    const component = {}

    expect((await get('/camps/1')._meta.load).a).toBe(1)
    // Bound to something else, like ecamp3's `this.api.get.bind(this)` in a component.
    await expect((reload as any).call(component, '/camps/1')).resolves.toBeDefined()
    expect((api.get as any).bind(component)('/camps/1').a).toBe(1)
    expect(isUnknown('/camps/2')).toBe(true)
  })

  it('can be replaced before use', () => {
    const { reactivity, tracked } = recordingReactivity()
    const api = createHalc({
      adapter: createApi().adapter,
      transport: { request: () => new Promise(() => undefined) },
    })
    api.setReactivity(reactivity)
    api.get('/camps/1')
    expect(api.reactivity).toBe(reactivity)
    expect(tracked.has('/camps/1')).toBe(true)
  })
})

describe('placeholders after loading', () => {
  it('behave like the loaded wrapper for spreads, `in` and descriptors', async () => {
    const api = createApi()
    const camp = fixture('Camp', { title: 'x', creator: fixture('User') })
    api.mock.get(camp)

    const placeholder = api.get(camp._meta.self)
    expect('title' in placeholder).toBe(false)
    expect('_meta' in placeholder).toBe(true)
    expect(Object.keys(placeholder)).toEqual([])
    await placeholder._meta.load

    expect('title' in placeholder).toBe(true)
    expect(Object.keys(placeholder)).toEqual(['_meta', 'title', 'creator'])
    const { title, creator } = { ...placeholder }
    expect(title).toBe('x')
    expect(creator()._meta.self).toBe('/users/000000000001')
    expect(Object.getOwnPropertyDescriptor(placeholder, 'title')).toMatchObject({
      value: 'x',
      enumerable: true,
    })
    expect(Object.getOwnPropertyDescriptor(placeholder, 'missing')).toBeUndefined()
  })

  it('delegate mutations and links of unloaded resources', async () => {
    const api = createApi()
    const camp = fixture('Camp', { creator: fixture('User') })
    api.mock.get(camp).delay(5)

    const placeholder = api.get(camp._meta.self)
    expect(placeholder.$hrefSync('creator')).toBeUndefined()
    expect(placeholder.$hrefsSync('creator')).toBeUndefined()
    expect(placeholder.as()).toBe(placeholder)
    await expect(placeholder.$href('creator')).resolves.toBe('/users/000000000001')
    await expect(placeholder.$reload()).resolves.toBeDefined()
    expect(placeholder.$rel('creator')._meta.self).toBe('/users/000000000001')
  })
})

describe('virtual collections', () => {
  it('offer links, JSON and item loading', async () => {
    const api = createApi({ avoidNPlusOneRequests: false })
    api.mock.get('/api/camps/1').reply(200, {
      _links: { self: { href: '/api/camps/1' }, periods: [{ href: '/api/periods/1' }] },
    })
    api.mock
      .get('/api/periods/1')
      .reply(200, { _links: { self: { href: '/api/periods/1' } }, a: 1 })

    const periods = (await api.get('/camps/1')._meta.load).periods()
    expect(periods.$hrefSync('self')).toBe('/camps/1#periods')
    expect(periods.$hrefSync('other')).toBeUndefined()
    expect(periods.$hrefsSync('items')).toEqual(['/periods/1'])
    await expect(periods.$href('self')).resolves.toBe('/camps/1#periods')
    await expect(periods.$hrefs('items')).resolves.toEqual(['/periods/1'])
    expect(periods.toJSON()).toEqual({
      items: ['/periods/1'],
      _meta: { self: '/camps/1#periods' },
    })
    expect(periods._meta.links).toEqual({})
    expect(periods._meta.deleting).toBe(false)
    expect(periods._meta.status).toBe('loaded')
    expect(periods._meta.selfUrl).toBe('http://localhost/api/camps/1#periods')
    expect(periods.as()).toBe(periods)
    expect(() => periods.$rel('x')).toThrow('Virtual resources have no relations')

    const loaded = await periods.$loadItems()
    expect(loaded.items[0]!.a).toBe(1)
  })
})

describe('$toData', () => {
  async function loadedBook(api = createApi()) {
    api.mock.get('/api/books/1').reply(200, {
      _links: {
        self: { href: '/api/books/1' },
        author: { href: '/api/authors/1' },
        reviews: { href: '/api/reviews{?rating}', templated: true },
      },
      _embedded: {
        chapters: [{ _links: { self: { href: '/api/chapters/1' } }, title: 'c' }],
      },
      title: 'The Hobbit',
      meta: { tags: ['fantasy'] },
      editor: null,
    })
    return { api, book: await api.get('/books/1')._meta.load }
  }

  it('copies the data with relations as URIs, without links that are templates', async () => {
    const { book } = await loadedBook()

    expect(book.$toData()).toEqual({
      title: 'The Hobbit',
      meta: { tags: ['fantasy'] },
      editor: null,
      author: '/authors/1',
      chapters: ['/chapters/1'],
    })
  })

  it('returns a mutable copy that is independent of the store', async () => {
    const { api, book } = await loadedBook()

    const data = book.$toData()
    data.title = 'Changed'
    ;(data.meta as { tags: string[] }).tags.push('classic')

    expect(api.get('/books/1').title).toBe('The Hobbit')
    expect(api.get('/books/1').meta).toEqual({ tags: ['fantasy'] })
  })

  it('can be patched back without sending anything', async () => {
    const { api, book } = await loadedBook()

    await book.$patch(book.$toData())

    expect(api.mock.requests).toHaveLength(1)
  })

  it('contains optimistic changes, not derived fields', async () => {
    const { api } = await loadedBook(
      createApi({ preprocessors: { Book: (book) => ({ shout: String(book.title) }) } })
    )
    api.mock.patch('/api/books/1').delay(5)

    const patch = api.get('/books/1').$patch({ title: 'New' })
    expect(api.get('/books/1').$toData()).toMatchObject({ title: 'New' })
    expect(api.get('/books/1').$toData()).not.toHaveProperty('shout')
    await patch
  })

  it('throws for resources that are not loaded, and works once they are', async () => {
    const api = createApi()
    api.mock
      .get('/api/books/1')
      .delay(5)
      .reply(200, { _links: { self: { href: '/api/books/1' } }, a: 1 })

    const placeholder = api.get('/books/1')
    expect(() => placeholder.$toData()).toThrow(
      'Cannot copy the data of a resource before it is loaded'
    )
    await placeholder._meta.load
    expect(placeholder.$toData()).toEqual({ a: 1 })
  })

  it('copies the URIs of the items of an embedded collection', async () => {
    const { book } = await loadedBook()
    expect(book.chapters().$toData()).toEqual({ items: ['/chapters/1'] })
  })
})
