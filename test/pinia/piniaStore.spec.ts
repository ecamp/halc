import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { isReactive } from 'vue'
import { createPiniaStore } from '../../src/pinia/index.js'
import { collectionFixture, fixture, resetFixtureIds } from '../../src/testing/index.js'
import { createVueReactivity } from '../../src/vue/index.js'
import { createApi } from '../helpers.js'

beforeEach(() => {
  resetFixtureIds()
})

describe('createPiniaStore', () => {
  it('stores records in Pinia with one action per response', async () => {
    const pinia = createPinia()
    const store = createPiniaStore(pinia)
    const api = createApi({ store, reactivity: createVueReactivity() })
    const activities = collectionFixture('Activity', [
      fixture('Activity', { title: 'a' }),
      fixture('Activity', { title: 'b' }),
    ])
    api.mock.get(activities)

    const actions: string[] = []
    const piniaStore = (pinia as any)._s.get('api')
    piniaStore.$onAction(({ name }: { name: string }) => actions.push(name))

    const collection = await api.get(activities._meta.self)._meta.load

    expect(actions).toEqual(['set'])
    expect(collection.items.map((item: any) => item.title)).toEqual(['a', 'b'])
    expect(Object.keys(piniaStore.records)).toHaveLength(3)
    expect(isReactive(store.get('/activities'))).toBe(false)
    expect(store.snapshot()['/activities']).toEqual(store.get('/activities'))
  })

  it('patches meta and removes records', async () => {
    const store = createPiniaStore(createPinia(), { id: 'records' })
    store.set([{ uri: '/a', data: {}, meta: { version: 1, status: 'loaded' } }])

    store.patchMeta('/a', { status: 'stale', version: 2 })
    store.patchMeta('/missing', { version: 1 })
    expect(store.get('/a')?.meta).toEqual({ version: 2, status: 'stale' })
    expect(store.has('/missing')).toBe(false)

    store.remove(['/a'])
    expect(store.has('/a')).toBe(false)
    expect(store.readOnly).toBe(false)
  })
})
