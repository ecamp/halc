import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '../../src/core/errors.js'
import { collectionFixture, fixture, resetFixtureIds } from '../../src/testing/index.js'
import { createApi, flush } from '../helpers.js'

beforeEach(() => {
  resetFixtureIds()
})

async function loadedCamp(api = createApi(), properties: Record<string, unknown> = {}) {
  const camp = fixture('Camp', { title: 'old', motto: 'm', ...properties })
  api.mock.get(camp)
  const wrapper = await api.get(camp._meta.self)._meta.load
  return { api, camp, wrapper }
}

describe('patch', () => {
  it('applies the change at once and sends only changed fields', async () => {
    const { api, camp, wrapper } = await loadedCamp()
    api.mock.patch(camp).delay(5)

    const patch = wrapper.$patch({ ...wrapper, title: 'new', motto: 'm' })

    expect(api.get(camp._meta.self).title).toBe('new')
    expect(api.get(camp._meta.self)._meta.dirty).toEqual({ title: 'new' })
    expect(api.pendingMutations).toMatchObject([
      { kind: 'patch', body: { title: 'new' } },
    ])
    const patched = await patch
    expect(patched.title).toBe('new')
    expect(patched._meta.dirty).toBeUndefined()
    expect(api.pendingMutations).toEqual([])
    expect(api.mock.requests[1]).toMatchObject({
      method: 'PATCH',
      body: { title: 'new' },
      headers: { 'Content-Type': 'application/merge-patch+json' },
    })
  })

  it('sends nothing when nothing changed', async () => {
    const { api, wrapper } = await loadedCamp()

    await expect(wrapper.$patch({ title: 'old', motto: 'm' })).resolves.toBe(wrapper)

    expect(api.mock.requests).toHaveLength(1)
  })

  it('sends every given field with force', async () => {
    const { api, camp, wrapper } = await loadedCamp()
    api.mock.patch(camp)

    await wrapper.$patch({ title: 'old' }, { force: true })

    expect(api.mock.requests[1]?.body).toEqual({ title: 'old' })
  })

  it('compares relations by URI and sends IRIs', async () => {
    const user = fixture('User', { name: 'x' })
    const { api, camp, wrapper } = await loadedCamp(undefined, { creator: user })
    api.mock.patch(camp).reply(200, (current: any) => current)
    api.mock.get(user)
    const creator = await wrapper.creator()._meta.load

    await wrapper.$patch({ creator: '/api/users/000000000001' })
    await wrapper.$patch({ creator })
    expect(
      api.mock.requests.filter((request) => request.method === 'PATCH')
    ).toHaveLength(0)

    const other = fixture('User', { name: 'y' })
    api.mock
      .patch(camp)
      .delay(5)
      .reply(200, (current: any) => ({
        ...current,
        _links: { ...current._links, creator: { href: other._meta.self } },
      }))
    const patch = wrapper.$patch({ creator: other._meta.self })
    expect(api.get(camp._meta.self).creator()._meta.self).toBe('/users/000000000003')
    await patch
    expect(api.mock.requests.at(-1)?.body).toEqual({ creator: '/api/users/000000000003' })
  })

  it('rolls back and rejects when the API refuses', async () => {
    const { api, camp, wrapper } = await loadedCamp()
    api.mock
      .patch(camp)
      .delay(5)
      .reply(422, { violations: [{ propertyPath: 'title' }] })

    const patch = wrapper.$patch({ title: 'invalid' })
    expect(api.get(camp._meta.self).title).toBe('invalid')

    const error = (await patch.catch((e: unknown) => e)) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(422)
    expect(error.data).toEqual({ violations: [{ propertyPath: 'title' }] })
    expect(api.get(camp._meta.self).title).toBe('old')
    expect(api.get(camp._meta.self)._meta.dirty).toBeUndefined()
    expect(api.get(camp._meta.self)._meta.error).toBe(error)
  })

  it('reloads the entity after a conflict', async () => {
    const { api, camp, wrapper } = await loadedCamp()
    api.mock.patch(camp).reply(409)
    api.mock.get(camp).reply(200, (current: any) => ({ ...current, title: 'theirs' }))

    await expect(wrapper.$patch({ title: 'mine' })).rejects.toThrow('status 409')
    await flush()

    expect(api.get(camp._meta.self).title).toBe('theirs')
  })

  it('serializes mutations of the same URI and keeps later optimistic changes', async () => {
    const { api, camp, wrapper } = await loadedCamp()
    api.mock.patch(camp).delay(10)

    const first = wrapper.$patch({ title: 'one' })
    const second = wrapper.$patch({ motto: 'two' })
    expect(api.get(camp._meta.self)).toMatchObject({ title: 'one', motto: 'two' })

    await flush()
    // The second PATCH waits until the first one is answered.
    expect(
      api.mock.requests.filter((request) => request.method === 'PATCH')
    ).toHaveLength(1)
    await first
    expect(api.get(camp._meta.self)._meta.dirty).toEqual({ motto: 'two' })
    await second
    expect(api.get(camp._meta.self)).toMatchObject({ title: 'one', motto: 'two' })
    expect(api.get(camp._meta.self)._meta.dirty).toBeUndefined()
  })

  it('without optimistic, waits for the API before changing anything', async () => {
    const { api, camp, wrapper } = await loadedCamp(createApi({ optimistic: false }))
    api.mock.patch(camp).delay(5)

    const patch = wrapper.$patch({ title: 'new' })
    expect(api.get(camp._meta.self).title).toBe('old')
    await patch
    expect(api.get(camp._meta.self).title).toBe('new')

    api.mock.patch(camp).delay(5)
    const perCall = api
      .get(camp._meta.self)
      .$patch({ title: 'newer' }, { optimistic: true })
    expect(api.get(camp._meta.self).title).toBe('newer')
    await perCall
  })

  it('keeps the change and reloads on 204 No Content', async () => {
    const { api, camp, wrapper } = await loadedCamp()
    api.mock.patch(camp).reply(204)
    api.mock
      .get(camp)
      .delay(5)
      .reply(200, (current: any) => ({ ...current, title: 'server' }))

    await wrapper.$patch({ title: 'mine' })
    expect(api.get(camp._meta.self).title).toBe('mine')
    expect(api.status(camp._meta.self)).toBe('stale')

    await api.get(camp._meta.self)._meta.load
    expect(api.get(camp._meta.self).title).toBe('server')
  })

  it('freezes data so changes cannot bypass $patch', async () => {
    const { wrapper } = await loadedCamp(undefined, { tags: ['a'] })
    expect(() => wrapper.tags.push('b')).toThrow(TypeError)
  })
})

describe('post', () => {
  async function loadedCollection(api = createApi()) {
    const activities = collectionFixture('Activity', [
      fixture('Activity', { title: 'Hike' }),
    ])
    api.mock.get(activities)
    const collection = await api.get(activities._meta.self)._meta.load
    return { api, activities, collection }
  }

  it('shows the new item at once and resolves to the created resource', async () => {
    const { api, activities, collection } = await loadedCollection()
    api.mock.post(activities).delay(5)

    const post = collection.$post({ title: 'Swim' })
    const items = api.get(activities._meta.self).items
    expect(items.map((item: any) => item.title)).toEqual(['Hike', 'Swim'])
    expect(items[1]._meta.self).toMatch(/^urn:tmp:/)
    expect(items[1]._meta.dirty).toEqual({ title: 'Swim' })
    expect(items[1]._meta.type).toBe('Activity')
    expect(api.get(activities._meta.self).$hrefsSync('items')?.[1]).toMatch(/^urn:tmp:/)

    const created = await post
    expect(created?.title).toBe('Swim')
    expect(created?._meta.self).toBe('/activities/000000000002')
    expect(
      api.get(activities._meta.self).items.map((item: any) => item._meta.self)
    ).toEqual(['/activities/000000000001', '/activities/000000000002'])
    await expect(collection.$hrefs('items')).resolves.toEqual([
      '/activities/000000000001',
      '/activities/000000000002',
    ])
  })

  it('reloads the collection afterwards, unless asked not to', async () => {
    const { api, collection } = await loadedCollection()
    api.mock.post('/api/activities')

    await collection.$post({ title: 'Swim' })
    await flush()
    await collection.$post({ title: 'Run' }, { reload: false })
    await flush()

    expect(api.mock.requests.map((request) => request.method)).toEqual([
      'GET',
      'POST',
      'GET',
      'POST',
    ])
  })

  it('does not reload a collection whose last load failed', async () => {
    const api = createApi()
    api.mock.get('/api/camps').reply(400)
    api.mock.post('/api/camps').reply(201, {
      _links: { self: { href: '/api/camps/1' } },
      title: 't',
    })
    await api.get('/camps')._meta.load.catch(() => undefined)

    await api.post('/camps', { title: 't' })
    await flush()

    expect(api.mock.requests.map((request) => request.method)).toEqual(['GET', 'POST'])
  })

  it('removes the temporary item and rejects when the API refuses', async () => {
    const { api, activities, collection } = await loadedCollection()
    api.mock.post(activities).reply(422, { detail: 'nope' })

    await expect(collection.$post({ title: '' })).rejects.toThrow('nope')

    expect(api.get(activities._meta.self).items).toHaveLength(1)
    expect(api.get(activities._meta.self)._meta.dirty).toBeUndefined()
    expect(Object.keys(api.store.snapshot()).some((uri) => uri.startsWith('urn:'))).toBe(
      false
    )
  })

  it('loads the Location of a 204 answer', async () => {
    const { api, collection } = await loadedCollection()
    api.mock
      .post('/api/activities')
      .reply(204, undefined, { Location: '/api/activities/9' })
    api.mock.get('/api/activities/9').reply(200, {
      _links: { self: { href: '/api/activities/9' } },
      title: 'Nine',
    })

    const created = await collection.$post({ title: 'Nine' }, { reload: false })

    expect(created?.title).toBe('Nine')
  })

  it('sends no body when posting without data', async () => {
    const api = createApi()
    api.mock.post('/api/token/refresh').reply(204)

    await expect(api.post('/token/refresh')).resolves.toBeNull()

    expect(api.mock.requests[0]?.body).toBeUndefined()
    expect(api.mock.requests[0]?.headers['Content-Type']).toBeUndefined()
  })

  it('resolves to null for 204 without Location', async () => {
    const api = createApi()
    api.mock.post('/api/auth/resend_activation').reply(204)

    await expect(api.post('/auth/resend_activation', { email: 'x' })).resolves.toBeNull()
  })

  it('stores the answer of a custom operation under its self link', async () => {
    const api = createApi()
    const collaboration = fixture('CampCollaboration', { status: 'invited' })
    api.mock
      .post('/api/camp_collaborations/1/resend_invitation')
      .reply(200, collaboration)

    const result = await api.post('/camp_collaborations/1/resend_invitation', {})

    expect(result?._meta.type).toBe('CampCollaboration')
    expect(result?._meta.self).toBe('/camp_collaborations/000000000001')
  })

  it('waits for the creation when a temporary item is patched', async () => {
    const { api, activities, collection } = await loadedCollection()
    api.mock.post(activities).delay(5)
    api.mock.patch('/api/activities/000000000002')

    void collection.$post({ title: 'Swim' })
    const temporary = api.get(activities._meta.self).items[1]
    const patched = await temporary.$patch({ title: 'Dive' })

    expect(patched._meta.self).toBe('/activities/000000000002')
    expect(patched.title).toBe('Dive')
  })
})

describe('del', () => {
  async function loadedList(api = createApi()) {
    const hike = fixture('Activity', { title: 'Hike' })
    const swim = fixture('Activity', { title: 'Swim' })
    const activities = collectionFixture('Activity', [hike, swim])
    api.mock.get(activities)
    const collection = await api.get(activities._meta.self)._meta.load
    return { api, activities, collection, hike }
  }

  it('hides the item from items while deleting, then removes it', async () => {
    const { api, activities, collection, hike } = await loadedList()
    api.mock.delete(hike).delay(5)

    const deletion = collection.items[0].$del()
    const current = api.get(activities._meta.self)
    expect(current.items.map((item: any) => item.title)).toEqual(['Swim'])
    expect(current.allItems.map((item: any) => item.title)).toEqual(['Hike', 'Swim'])
    expect(current.allItems[0]._meta.deleting).toBe(true)

    await deletion
    expect(api.isUnknown(hike._meta.self)).toBe(true)
    expect(
      api.get(activities._meta.self).allItems.map((item: any) => item.title)
    ).toEqual(['Swim'])
    expect(api.mock.requests.map((request) => request.method)).toEqual([
      'GET',
      'DELETE',
      'GET',
    ])
  })

  it('shows the item again when the deletion fails', async () => {
    const { api, activities, hike } = await loadedList()
    api.mock.delete(hike).reply(403)

    await expect(api.del(hike._meta.self)).rejects.toThrow('status 403')

    const current = api.get(activities._meta.self)
    expect(current.items).toHaveLength(2)
    expect(current.items[0]._meta.deleting).toBe(false)
    expect(current.items[0]._meta.error?.status).toBe(403)
  })
})

describe('temporary items of optimistic POSTs', () => {
  it('have working relations', async () => {
    const api = createApi()
    const camp = fixture('Camp', { title: 'c' })
    const category = fixture('Category', { name: 'LS' })
    const existing = fixture('Activity', { title: 'Hike', camp, category })
    const activities = collectionFixture('Activity', [existing])
    api.mock.get(activities)
    api.mock.get(camp)
    api.mock.get(category)
    const collection = await api.get(activities._meta.self)._meta.load
    const loadedCamp = await api.get(camp._meta.self)._meta.load
    api.mock.post(activities).delay(5)

    const post = collection.$post({
      title: 'Swim',
      camp: loadedCamp, // a wrapper
      category: category._meta.self, // an IRI, a relation on the existing items
      location: '/somewhere', // a string that is no relation
    })
    const temporary = api.get(activities._meta.self).items[1]

    expect(temporary.camp()._meta.self).toBe('/camps/000000000001')
    expect(temporary.category()._meta.self).toBe('/categories/000000000002')
    expect(temporary.location).toBe('/somewhere')
    await post
  })
})
