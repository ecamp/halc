import { beforeEach, describe, expect, it } from 'vitest'
import { createHalc } from '../../src/core/client.js'
import { hal } from '../../src/hal/index.js'
import { PlainObjectStore } from '../../src/plain/index.js'
import { fixture, resetFixtureIds } from '../../src/testing/index.js'
import { createApi } from '../helpers.js'

beforeEach(() => {
  resetFixtureIds()
})

async function snapshotOfLoadedCamp() {
  const api = createApi()
  const periods = [fixture('Period', { name: 'A' }), fixture('Period', { name: 'B' })]
  const camp = fixture('Camp', { title: 'Summer', periods }, { embed: true })
  api.mock.get(camp)
  await api.get(camp._meta.self)._meta.load
  // What the main thread posts to the worker: plain, structured-cloneable data.
  return { camp, snapshot: structuredClone(api.store.snapshot()) }
}

describe('PlainObjectStore', () => {
  it('serves a snapshot through the normal wrapper API', async () => {
    const { camp, snapshot } = await snapshotOfLoadedCamp()
    const api = createHalc({
      adapter: hal,
      baseUrl: 'http://localhost/api',
      store: new PlainObjectStore(snapshot),
      transport: {
        request: () => Promise.reject(new Error('no requests in the worker')),
      },
    })

    const loaded = api.get(camp._meta.self)
    expect(loaded._meta.loading).toBe(false)
    expect(loaded.title).toBe('Summer')
    expect(loaded.periods().items.map((period: any) => period.name)).toEqual(['A', 'B'])
    await expect(loaded._meta.load).resolves.toBe(loaded)
    expect(api.store.snapshot()).toEqual(snapshot)
  })

  it('throws for resources missing in the snapshot, and for writes', async () => {
    const { camp, snapshot } = await snapshotOfLoadedCamp()
    const api = createHalc({ adapter: hal, store: new PlainObjectStore(snapshot) })

    expect(() => api.get('/missing')).toThrow('"/missing" is not in the read-only store')
    await expect(api.patch(camp._meta.self, { title: 'x' })).rejects.toThrow('read-only')
    expect(() => {
      api.store.set([])
    }).toThrow('PlainObjectStore is read-only, set is not possible')
    expect(() => {
      api.store.patchMeta('/x', {})
    }).toThrow('read-only')
    expect(() => {
      api.store.remove([])
    }).toThrow('read-only')
  })

  it('does not load unknown items of collections', () => {
    const snapshot = {
      '/activities': {
        uri: '/activities',
        data: { items: { hrefs: ['/activities/1'] } },
        meta: { version: 1, status: 'loaded' as const, loadedAt: 1 },
      },
    }
    const api = createHalc({ adapter: hal, store: new PlainObjectStore(snapshot) })
    expect(api.get('/activities').items).toHaveLength(1)
  })
})
