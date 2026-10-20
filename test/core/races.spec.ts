/**
 * Responses of requests that were already running must not undo later writes. Found by an
 * adversarial review; every case failed before the write fence was added.
 */
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { effect } from 'vue'
import { createPiniaStore } from '../../src/pinia/index.js'
import { collectionFixture, fixture, resetFixtureIds } from '../../src/testing/index.js'
import { createVueReactivity } from '../../src/vue/index.js'
import { createApi } from '../helpers.js'

beforeEach(() => {
  resetFixtureIds()
})

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

async function loadedCamp(api = createApi(), properties: Record<string, unknown> = {}) {
  const camp = fixture('Camp', { title: 'old', ...properties })
  api.mock.get(camp)
  const wrapper = await api.get(camp._meta.self)._meta.load
  return { api, camp, wrapper, uri: wrapper._meta.self }
}

describe('a GET that started before a write', () => {
  it('does not overwrite the result of a PATCH', async () => {
    const { api, camp, wrapper, uri } = await loadedCamp()
    api.mock.get(camp).delay(30).once().reply(200, copy(camp))
    api.mock.patch(camp).delay(5)

    const reload = api.reload(uri)
    await wrapper.$patch({ title: 'new' })
    await reload

    expect(api.get(uri).title).toBe('new')
  })

  it('does not remove an item created by a POST, and the reload after the POST is a new one', async () => {
    const api = createApi()
    const activities = collectionFixture('Activity', [
      fixture('Activity', { title: 'Hike' }),
    ])
    api.mock.get(activities)
    await api.get(activities._meta.self)._meta.load
    api.mock.get(activities).delay(30).once().reply(200, copy(activities))
    api.mock.post(activities).delay(5)

    void api.reload(activities._meta.self)
    await api.get(activities._meta.self).$post({ title: 'Swim' })
    await wait(50)

    expect(api.get(activities._meta.self).items.map((item) => item.title)).toEqual([
      'Hike',
      'Swim',
    ])
    expect(api.mock.requests.map((request) => request.method)).toEqual([
      'GET',
      'GET',
      'POST',
      'GET',
    ])
  })

  it('does not bring back a deleted resource', async () => {
    const { api, camp, uri } = await loadedCamp()
    api.mock.get(camp).delay(30).once().reply(200, copy(camp))
    api.mock.delete(camp).delay(5)

    void api.reload(uri).catch(() => undefined)
    await api.del(uri)
    await wait(40)

    expect(api.store.has(uri)).toBe(false)
  })

  it('does not undo invalidate', async () => {
    const { api, camp, uri } = await loadedCamp()
    api.mock.get(camp).delay(20).once()

    void api.reload(uri)
    await wait(1)
    api.invalidate(uri)
    await wait(30)

    expect(api.status(uri)).toBe('stale')
  })

  it('does not bring anything back after purgeAll', async () => {
    const api = createApi()
    const camp = fixture('Camp', { title: 'secret' })
    api.mock.get(camp).delay(20)

    api.get(camp._meta.self)
    api.purgeAll()
    await wait(30)

    expect(api.store.snapshot()).toEqual({})
  })
})

describe('mutations', () => {
  it('can patch a temporary item after its POST finished', async () => {
    const api = createApi()
    const activities = collectionFixture('Activity', [])
    api.mock.get(activities)
    const collection = await api.get(activities._meta.self)._meta.load
    api.mock.post(activities).delay(5)

    const post = collection.$post({ title: 'Swim' })
    const temporary = api.get(activities._meta.self).items[0]
    const created = await post
    api.mock.patch(`/api${created!._meta.self}`)

    await expect(temporary.$patch({ title: 'Dive' })).resolves.toMatchObject({
      title: 'Dive',
    })
  })

  it('sends a field again when an earlier pending patch set the same value', async () => {
    const { api, camp, wrapper, uri } = await loadedCamp(undefined, { motto: 'm' })
    api.mock.patch(camp).delay(5).once().reply(422, { detail: 'bad' })
    api.mock.patch(camp).delay(5)

    const first = wrapper.$patch({ title: 'a' }).catch(() => 'failed')
    const second = wrapper.$patch({ title: 'a', motto: 'x' })
    expect(await first).toBe('failed')
    await second

    expect(
      api.mock.requests.filter((r) => r.method === 'PATCH').map((r) => r.body)
    ).toEqual([{ title: 'a' }, { title: 'a', motto: 'x' }])
    expect(api.get(uri).title).toBe('a')
  })
})

describe('caches', () => {
  it('recompute derived fields when a dependency is purged and loaded again', async () => {
    const api = createApi({
      preprocessors: {
        Camp: (camp, ctx) => ({
          creatorName: ctx.get(camp.$hrefSync('creator'))?.name as string | undefined,
        }),
      },
    })
    const user = fixture('User', { name: 'A' })
    const camp = fixture('Camp', { creator: user })
    api.mock.get(camp)
    api.mock.get(user).once()
    await api.get(camp._meta.self)._meta.load
    await api.get(user._meta.self)._meta.load
    expect(api.get(camp._meta.self).creatorName).toBe('A')

    api.purge(user._meta.self)
    api.mock.get(user).reply(200, { ...copy(user), name: 'B' })
    await api.get(user._meta.self)._meta.load

    expect(api.get(camp._meta.self).creatorName).toBe('B')
  })

  it('forget the items of purged collections', async () => {
    const api = createApi()
    const activities = collectionFixture('Activity', [
      fixture('Activity', { title: 'Hike' }),
    ])
    api.mock.get(activities)
    await api.get(activities._meta.self)._meta.load
    expect(api.get(activities._meta.self).items).toHaveLength(1)

    api.purgeAll()

    expect((api as unknown as { itemsCache: Map<string, unknown> }).itemsCache.size).toBe(
      0
    )
  })
})

describe('reactivity', () => {
  it('a read that starts a reload does not make the effect depend on the whole Pinia store', async () => {
    const pinia = createPinia()
    const api = createApi({
      store: createPiniaStore(pinia),
      reactivity: createVueReactivity(),
    })
    const camp = fixture('Camp', { title: 'x' })
    const other = fixture('Camp', { title: 'o' })
    api.mock.get(camp).once().reply(500)
    api.mock.get(other)
    await api.get(camp._meta.self)._meta.load.catch(() => undefined)
    api.invalidate(camp._meta.self)
    api.mock.get(camp).delay(1000)

    let runs = 0
    effect(() => {
      runs++
      String(api.get(camp._meta.self).title)
    })
    await api.get(other._meta.self)._meta.load
    await api.reload(other._meta.self)

    expect(runs).toBe(1)
  })
})
