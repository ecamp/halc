import { beforeEach, describe, expect, it } from 'vitest'
import { computed, isReactive, nextTick, reactive, watchEffect } from 'vue'
import { collectionFixture, fixture, resetFixtureIds } from '../../src/testing/index.js'
import { createVueReactivity } from '../../src/vue/index.js'
import { createApi } from '../helpers.js'

beforeEach(() => {
  resetFixtureIds()
})

function createVueApi() {
  return createApi({ reactivity: createVueReactivity() })
}

describe('Vue reactivity', () => {
  it('re-runs an effect once when the entity it read changes', async () => {
    const api = createVueApi()
    const camp = fixture('Camp', { title: 'a', motto: 'm' })
    api.mock.get(camp)
    api.mock.patch(camp)

    const titles: string[] = []
    watchEffect(() => titles.push(String(api.get(camp._meta.self).title)), {
      flush: 'sync',
    })
    // Properties of placeholders render empty.
    expect(titles).toEqual([''])

    await api.get(camp._meta.self)._meta.load
    expect(titles).toEqual(['', 'a'])

    await api.patch(camp._meta.self, { title: 'b', motto: 'n' })
    // Optimistic write + confirmation: two versions, one run each.
    expect(titles).toEqual(['', 'a', 'b', 'b'])
  })

  it('does not re-run a list effect when an item changes, only effects reading the item', async () => {
    const api = createVueApi()
    const activities = collectionFixture('Activity', [
      fixture('Activity', { title: 'a' }),
      fixture('Activity', { title: 'b' }),
    ])
    api.mock.get(activities)
    api.mock.patch('/api/activities/000000000001')
    const collection = await api.get(activities._meta.self)._meta.load

    let listRuns = 0
    let itemRuns = 0
    const count = computed(() => {
      listRuns++
      return api.get(activities._meta.self).items.length
    })
    const firstTitle = computed(() => {
      itemRuns++
      return api.get(activities._meta.self).items[0]?.title
    })
    expect([count.value, firstTitle.value]).toEqual([2, 'a'])

    await collection.items[0].$patch({ title: 'z' }, { optimistic: false })
    expect([count.value, firstTitle.value]).toEqual([2, 'z'])
    expect(listRuns).toBe(1)
    expect(itemRuns).toBe(2)
  })

  it('keeps items identical while the collection does not change', async () => {
    const api = createVueApi()
    const activities = collectionFixture('Activity', [
      fixture('Activity', { title: 'a' }),
    ])
    api.mock.get(activities)
    const collection = await api.get(activities._meta.self)._meta.load

    const items = computed(() => api.get(activities._meta.self).items)
    expect(items.value).toBe(collection.items)
    expect(items.value).toBe(items.value)
  })

  it('never lets Vue wrap wrappers or records in its own Proxies', async () => {
    const api = createVueApi()
    const camp = fixture('Camp', { title: 'a' })
    api.mock.get(camp)
    const placeholder = api.get(camp._meta.self)
    const loaded = await placeholder._meta.load

    const state = reactive({ loaded, placeholder })
    expect(isReactive(state.loaded)).toBe(false)
    expect(state.loaded).toBe(loaded)
    expect(state.placeholder).toBe(placeholder)
    expect(state.placeholder.title).toBe('a')
  })

  it('updates effects when a placeholder loads and when a relation is relinked', async () => {
    const api = createVueApi()
    const ada = fixture('User', { name: 'Ada' })
    const bob = fixture('User', { name: 'Bob' })
    const camp = fixture('Camp', { creator: ada }, { embed: true })
    api.mock.get(camp)
    api.mock.get(bob)
    api.mock.patch(camp).reply(200, (current: any) => ({
      ...current,
      _links: { ...current._links, creator: { href: bob._meta.self } },
      _embedded: {},
    }))

    const name = computed(() => api.get(camp._meta.self).creator().name)
    expect(`${name.value}`).toBe('')
    await api.get(camp._meta.self)._meta.load
    expect(name.value).toBe('Ada')

    await api.patch(camp._meta.self, { creator: bob._meta.self })
    expect(String(name.value)).toBe('')
    await api.get(bob._meta.self)._meta.load
    await nextTick()
    expect(name.value).toBe('Bob')
  })
})
