import { beforeEach, describe, expect, it } from 'vitest'
import { isReactive } from 'vue'
import { createStore } from 'vuex'
import { collectionFixture, fixture, resetFixtureIds } from '../../src/testing/index.js'
import { createVuexStore } from '../../src/vuex/index.js'
import { createApi } from '../helpers.js'

beforeEach(() => {
  resetFixtureIds()
})

describe('createVuexStore', () => {
  it('stores records in the api module with one mutation per response', async () => {
    const vuex = createStore({ strict: true })
    const store = createVuexStore(vuex)
    const api = createApi({ store })
    const activities = collectionFixture('Activity', [
      fixture('Activity', { title: 'a' }),
    ])
    api.mock.get(activities)

    const mutations: string[] = []
    vuex.subscribe(({ type }: { type: string }) => mutations.push(type))

    const collection = await api.get(activities._meta.self)._meta.load

    expect(mutations).toEqual(['api/set'])
    expect(collection.items[0].title).toBe('a')
    expect(Object.keys(vuex.state.api)).toEqual([
      '/activities',
      '/activities/000000000001',
    ])
    expect(isReactive(store.get('/activities'))).toBe(false)
  })

  it('patches meta and removes records through mutations', () => {
    const vuex = createStore({ strict: true })
    const store = createVuexStore(vuex, { moduleName: 'records' })
    store.set([{ uri: '/a', data: {}, meta: { version: 1, status: 'loaded' } }])

    store.patchMeta('/a', { deleting: true, version: 2 })
    store.patchMeta('/missing', { version: 1 })
    expect(store.get('/a')?.meta).toEqual({
      version: 2,
      status: 'loaded',
      deleting: true,
    })
    expect(store.snapshot()).toEqual({ '/a': store.get('/a') })

    store.remove(['/a'])
    expect(store.has('/a')).toBe(false)
    expect(vuex.state.records).toEqual({})
  })
})
