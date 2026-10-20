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

    expect(Object.keys(loaded)).toEqual(['title', 'creator'])
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
