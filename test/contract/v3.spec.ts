/**
 * The hal-json-vuex v3 test suite, ported as contract tests: the same scenarios and fixtures,
 * asserted through the wrapper API instead of the Vuex store shape. Where halc deliberately
 * behaves differently, the test says so.
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '../../src/core/errors.js'
import { createApi, flush } from '../helpers.js'

type Json = Record<string, any>

function v3(name: string): Json {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/v3/${name}.json`, import.meta.url), 'utf8')
  )
}

const self = (href: string, rest: Json = {}) => ({ ...rest, _links: { self: { href } } })

let api: ReturnType<typeof createApi>

describe.each([true, false])(
  'v3 contract (avoidNPlusOneRequests: %s)',
  (avoidNPlusOneRequests) => {
    beforeEach(() => {
      api = createApi({
        baseUrl: 'http://localhost',
        forceRequestedSelfLink: true,
        avoidNPlusOneRequests,
      })
    })

    describe('importing', () => {
      it('loads the API root', async () => {
        api.mock.get('/').reply(200, v3('root').serverResponse)
        const root = await api.get()._meta.load
        expect(root).toMatchObject({ this: 'is', the: 'root' })
        expect(api.mock.requests[0]?.url).toBe('http://localhost/')
      })

      it('serializes resources', async () => {
        api.mock.get('/').reply(200, v3('root').serverResponse)
        const placeholder = api.get()
        expect(JSON.stringify(placeholder)).toBe('{}')
        const root = await placeholder._meta.load
        expect(root.toJSON()).toEqual({ this: 'is', the: 'root', _meta: { self: '' } })
      })

      it('imports an embedded single entity', async () => {
        api.mock.get('/camps/1').reply(200, v3('embedded-single-entity').serverResponse)
        const placeholder = api.get('/camps/1')
        expect(`${placeholder.campType().name}`).toBe('')
        const camp = await placeholder._meta.load
        expect(camp.campType()).toMatchObject({
          id: 20,
          name: 'camp',
          js: true,
          targetGroup: 'Kids',
        })
        expect(api.mock.requests).toHaveLength(1)
      })

      it('imports a reference to a single entity without overwriting it', async () => {
        api.mock
          .get('/camps/1')
          .reply(200, v3('reference-to-single-entity').serverResponse)
        const camp = await api.get('/camps/1')._meta.load
        expect(camp.campType()._meta.self).toBe('/campTypes/20')
        expect(api.isUnknown('/campTypes/20')).toBe(false) // requested on access
      })

      it.each(['embedded-collection', 'embedded-collection-link-array'])(
        'imports %s as a virtual collection',
        async (name) => {
          api.mock.get('/camps/1').reply(200, v3(name).serverResponse)
          const camp = await api.get('/camps/1')._meta.load
          const periods = camp.periods()
          expect(periods._meta.self).toBe('/camps/1#periods')
          expect(periods.items.map((period: Json) => period.id)).toEqual([104, 128])
          expect(periods.items[0].camp()._meta.self).toBe('/camps/1')
          expect(api.mock.requests).toHaveLength(1)
        }
      )

      it('imports an empty embedded collection', async () => {
        api.mock
          .get('/camps/1')
          .reply(200, { ...self('/camps/1'), _embedded: { periods: [] } })
        const camp = await api.get('/camps/1')._meta.load
        expect(camp.periods().items).toEqual([])
      })

      it('imports an embedded collection with standalone link', async () => {
        api.mock
          .get('/camps/1')
          .reply(200, v3('embedded-collection-standalone-link').serverResponse)
        const camp = await api.get('/camps/1')._meta.load
        expect(camp.periods()._meta.self).toBe('/camps/1/periods')
        expect(camp.periods().items.map((period: Json) => period.id)).toEqual([104, 128])
        expect(api.mock.requests).toHaveLength(1)
      })

      it('imports a linked single entity and loads it on access', async () => {
        api.mock.get('/camps/1').reply(200, v3('linked-single-entity').serverResponse)
        api.mock
          .get('/users/83')
          .reply(200, self('/users/83', { id: 83, name: 'Pflock' }))
        const camp = await api.get('/camps/1')._meta.load
        const leader = await camp.main_leader()._meta.load
        expect(leader.name).toBe('Pflock')
      })

      it('imports a linked entity array', async () => {
        api.mock.get('/camps/1').reply(200, v3('linked-entity-array').serverResponse)
        api.mock.get('/activities/1').reply(200, self('/activities/1', { id: 1 }))
        api.mock.get('/activities/2').reply(200, self('/activities/2', { id: 2 }))
        const camp = await api.get('/camps/1')._meta.load
        const activities = await camp.activities().$loadItems()
        expect(activities.items.map((activity: Json) => activity.id)).toEqual([1, 2])
      })

      it('imports a linked collection', async () => {
        api.mock.get('/camps/1').reply(200, v3('linked-collection').serverResponse)
        api.mock
          .get('/camps/1/activities')
          .reply(200, v3('collection-firstPage').serverResponse)
        const camp = await api.get('/camps/1')._meta.load
        const activities = await camp.activities()._meta.load
        expect(activities.items.map((activity: Json) => activity.title)).toEqual([
          'Volleyball',
          'Geländespiel',
        ])
        expect(activities.items[0].type().name).toBe('LS')
      })

      it('imports a page of a paginated collection with its links', async () => {
        api.mock
          .get('/camps/1/activities')
          .reply(200, v3('collection-firstPage').serverResponse)
        const page = await api.get('/camps/1/activities')._meta.load
        expect(page.$hrefSync('next')).toBe('/camps/1/activities?page=1&page_size=2')
        expect(page._total).toBe(3)
      })

      it('handles object and array properties', async () => {
        api.mock.get('/camps/1').reply(200, v3('object-property').serverResponse)
        api.mock.get('/camps/2').reply(200, {
          ...v3('array-property').serverResponse,
          _links: { self: { href: '/camps/2' } },
        })
        const objectCamp = await api.get('/camps/1')._meta.load
        const arrayCamp = await api.get('/camps/2')._meta.load
        expect(objectCamp.toJSON()).toMatchObject({ id: 1 })
        expect(arrayCamp.arrayProperty).toEqual([{ a: 1, nested: [{ b: 2 }] }])
        expect(arrayCamp.emptyArray).toEqual([])
      })
    })

    describe('get and load promises', () => {
      it('accepts a wrapper or placeholder instead of a URI', async () => {
        api.mock.get('/camps/1').reply(200, self('/camps/1', { id: 1 }))
        const placeholder = api.get('/camps/1')
        expect(api.get(placeholder)).toBe(placeholder)
        const camp = await placeholder._meta.load
        expect(api.get(camp)).toBe(camp)
      })

      it('accepts a placeholder of a relation, whose URI is not known yet', () => {
        api.mock.get('/camps/1').delay(5).reply(200, self('/camps/1'))
        const relation = api.get('/camps/1').leader()
        expect(api.get(relation)).toBe(relation)
        expect(relation._meta.self).toBeUndefined()
        expect(relation._meta.loading).toBe(true)
      })

      it('resolves _meta.load of placeholders and loaded resources to the loaded resource', async () => {
        api.mock.get('/camps/1').reply(200, self('/camps/1', { id: 1 }))
        const fromPlaceholder = await api.get('/camps/1')._meta.load
        const fromLoaded = await api.get('/camps/1')._meta.load
        expect(fromPlaceholder).toBe(fromLoaded)
        expect(fromLoaded.id).toBe(1)
      })

      it('resolves the load promise of a reloading resource after the reload', async () => {
        api.mock
          .get('/camps/1')
          .reply(200, self('/camps/1', { version: 1 }))
          .once()
        api.mock
          .get('/camps/1')
          .delay(5)
          .reply(200, self('/camps/1', { version: 2 }))
        await api.get('/camps/1')._meta.load

        const reload = api.reload('/camps/1')
        // Old data meanwhile, and no loading flag (as in v3).
        expect(api.get('/camps/1')).toMatchObject({ version: 1 })
        expect(api.get('/camps/1')._meta.loading).toBe(false)
        expect((await api.get('/camps/1')._meta.load).version).toBe(2)
        await reload
      })

      it('sends only one reload request while one is running', async () => {
        api.mock.get('/camps/1').reply(200, self('/camps/1'))
        await api.get('/camps/1')._meta.load
        api.mock.requests.length = 0

        await Promise.all([
          api.reload('/camps/1'),
          api.reload('/camps/1'),
          api.get('/camps/1').$reload(),
        ])

        expect(api.mock.requests).toHaveLength(1)
      })

      it('throws for invalid input', () => {
        expect(() => api.get(null as never)).toThrow('is not an entity or URI')
      })
    })

    describe('purge and reload', () => {
      it('purges a URI, an entity or everything, and loads again on access', async () => {
        api.mock.get('/camps/1').reply(200, self('/camps/1'))
        const camp = await api.get('/camps/1')._meta.load
        api.purge('/camps/1')
        expect(api.isUnknown('/camps/1')).toBe(true)
        await api.get('/camps/1')._meta.load
        api.purge(camp)
        expect(api.isUnknown('/camps/1')).toBe(true)
        await api.get('/camps/1')._meta.load
        api.purgeAll()
        expect(api.isUnknown('/camps/1')).toBe(true)
        expect(api.mock.requests).toHaveLength(3)
      })

      it('reloads a URI or an object', async () => {
        api.mock
          .get('/camps/1')
          .reply(200, self('/camps/1', { title: 'a' }))
          .once()
        api.mock
          .get('/camps/1')
          .reply(200, self('/camps/1', { title: 'b' }))
          .once()
        api.mock.get('/camps/1').reply(200, self('/camps/1', { title: 'c' }))
        const camp = await api.get('/camps/1')._meta.load
        expect((await api.reload('/camps/1')).title).toBe('b')
        expect((await api.reload(camp)).title).toBe('c')
      })

      it('reloads embedded and linked collections by reloading their owner', async () => {
        api.mock.get('/camps/1').reply(200, v3('embedded-collection').serverResponse)
        const camp = await api.get('/camps/1')._meta.load
        const periods = await api.reload(camp.periods())
        expect(periods.items).toHaveLength(2)
        expect(api.mock.requests.map((request) => request.uri)).toEqual([
          '/camps/1',
          '/camps/1',
        ])
      })
    })

    describe('deleting', () => {
      it.each([
        ['a URI', () => '/users/1'],
        ['an object', () => api.get('/users/1')],
      ])('deletes %s and reloads all entities referencing it', async (_, target) => {
        api.mock.get('/groups/99').reply(200, v3('multiple-references-to-user')).once()
        api.mock
          .get('/groups/99')
          .reply(200, self('/groups/99', { id: 99, name: 'Pfadi Züri' }))
        api.mock.get('/camps/123').reply(200, self('/camps/123', { id: 123 }))
        api.mock.delete('/users/1').reply(204)
        await api.get('/groups/99')._meta.load
        await api.del(target())
        expect(
          api.mock.requests.filter((request) => request.method === 'DELETE')
        ).toHaveLength(1)
        expect(
          api.mock.requests.filter((request) => request.method === 'GET')
        ).toHaveLength(3)
        expect(api.isUnknown('/users/1')).toBe(true)
      })

      it('does not delete when the API fails', async () => {
        api.mock.get('/users/1').reply(200, self('/users/1', { id: 1 }))
        api.mock.delete('/users/1').reply(500)
        const user = await api.get('/users/1')._meta.load
        expect(user._meta.deleting).toBe(false)
        await expect(api.del(user)).rejects.toThrow(
          'Could not DELETE http://localhost/users/1 (status 500'
        )
        expect(api.get('/users/1')._meta.deleting).toBe(false)
        expect(api.isUnknown('/users/1')).toBe(false)
      })

      it('breaks circular dependencies when deleting an entity in the reference circle', async () => {
        const circle = v3('circular-reference')
        api.mock.get('/periods/1').reply(200, circle.serverResponse).once()
        api.mock.get('/periods/1').networkError()
        api.mock.get('/days/2').reply(404)
        api.mock.delete('/periods/1').reply(204)
        const period = await api.get('/periods/1')._meta.load

        await api.del(period)
        await flush()

        expect(
          api.mock.requests.filter((request) => request.method === 'GET')
        ).toHaveLength(2)
      })

      it('breaks circular dependencies when deleting an entity outside the reference circle', async () => {
        const circle = v3('circular-reference')
        api.mock.get('/camps/3').reply(200, circle.campServerResponse).once()
        api.mock.get('/periods/1').reply(200, circle.serverResponse).timesLimit(2)
        api.mock.get('/periods/1').networkError()
        api.mock.get('/days/2').reply(404)
        api.mock.delete('/camps/3').reply(204)
        const camp = await api.get('/camps/3')._meta.load
        await api.get('/periods/1')._meta.load

        await api.del(camp)
        await flush()

        expect(
          api.mock.requests.filter((request) => request.method === 'GET')
        ).toHaveLength(3)
      })

      it('transitively handles cascade deleted entities', async () => {
        api.mock.get('/authors/99').reply(200, {
          id: 99,
          ...self('http://localhost/authors/99'),
          _embedded: {
            latestBook: {
              id: 123,
              _links: {
                self: { href: 'http://localhost/books/123' },
                author: { href: 'http://localhost/authors/99' },
              },
              _embedded: {
                chapters: [
                  {
                    id: 444,
                    _links: {
                      self: { href: 'http://localhost/chapters/444' },
                      book: { href: 'http://localhost/books/123' },
                    },
                    _embedded: {
                      teaserPage: {
                        id: 1234,
                        _links: {
                          self: { href: 'http://localhost/pages/1234' },
                          chapter: { href: 'http://localhost/chapters/444' },
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        })
        api.mock.delete('/authors/99').reply(204)
        for (const uri of ['/books/123', '/chapters/444', '/pages/1234'])
          api.mock.get(uri).reply(404).once()
        await api.get('/authors/99')._meta.load

        await api.del('/authors/99')
        await flush()

        // Deliberate change: v3 purged cascade deleted entities, so the next read requested them
        // again. halc keeps them as sticky 404 errors, so no further requests are sent.
        expect(api.isUnknown('/authors/99')).toBe(true)
        for (const uri of ['/books/123', '/chapters/444', '/pages/1234']) {
          expect(api.status(uri)).toBe('error')
          expect(api.get(uri)._meta.error?.status).toBe(404)
        }
        expect(api.mock.requests).toHaveLength(5)
      })

      it.each([
        [
          'a standalone collection',
          '/camps/1/activities',
          v3('collection-firstPage').serverResponse,
          '/activities/2394',
        ],
        [
          'an embedded collection',
          '/camps/1',
          v3('embedded-collection').serverResponse,
          '/periods/104',
        ],
      ])('filters deleting items from %s', async (_, uri, response, item) => {
        api.mock.get(uri).reply(200, response)
        api.mock.delete(item).delay(5).reply(204)
        await api.get(uri)._meta.load
        const collection =
          uri === '/camps/1' ? () => api.get(uri).periods() : () => api.get(uri)
        expect(collection().items).toHaveLength(2)

        const deletion = api.del(item)
        expect(collection().items).toHaveLength(1)
        expect(collection().allItems).toHaveLength(2)
        await deletion.catch(() => undefined)
      })
    })

    describe('patching, posting and links', () => {
      it('patches an entity and stores the response', async () => {
        api.mock.get('/camps/1').reply(200, v3('embedded-single-entity').serverResponse)
        api.mock
          .patch('/camps/1')
          .reply(200, { ...v3('embedded-single-entity').serverResponse, id: 2 })
        await api.get('/camps/1')._meta.load
        const patched = await api.patch('/camps/1', { id: 2 })
        expect(patched.id).toBe(2)
        expect(api.mock.requests[1]?.body).toEqual({ id: 2 })
      })

      it('without optimistic updates, returns the old data while the patch is in progress', async () => {
        api.mock.get('/camps/1').reply(200, self('/camps/1', { title: 'old' }))
        api.mock
          .patch('/camps/1')
          .delay(5)
          .reply(200, self('/camps/1', { title: 'new' }))
        await api.get('/camps/1')._meta.load
        const patch = api.patch('/camps/1', { title: 'new' }, { optimistic: false })
        expect(api.get('/camps/1').title).toBe('old')
        await patch
        expect(api.get('/camps/1').title).toBe('new')
      })

      it('posts an entity and stores the response', async () => {
        api.mock.post('/camps').reply(201, self('/camps/2', { title: 'new' }))
        const created = await api.post('/camps', { title: 'new' })
        expect(created?._meta.self).toBe('/camps/2')
        expect(api.get('/camps/2').title).toBe('new')
      })

      it('handles 204 No Content on POST', async () => {
        api.mock.post('/camps').reply(204)
        await expect(api.post('/camps', {})).resolves.toBeNull()
      })

      it('gets hrefs of linked and templated entities without fetching them', async () => {
        api.mock.get('/camps/1').reply(200, v3('templated-link').linkingServerResponse)
        api.mock.get('/camps/2').reply(200, v3('linked-single-entity').serverResponse)
        await expect(api.href('/camps/1', 'users', { id: 83 })).resolves.toBe(
          '/camps/1/users/83'
        )
        await expect(api.href('/camps/2', 'main_leader')).resolves.toBe('/users/83')
        await expect(api.href('/camps/2', 'missing')).resolves.toBeUndefined()
        expect(api.mock.requests).toHaveLength(2)
      })

      it.each([true, false])(
        'follows templated links (linking entity loaded: %s)',
        async (loadedFirst) => {
          const fixture = v3('templated-link')
          api.mock.get('/camps/1').reply(200, fixture.linkingServerResponse)
          api.mock.get('/camps/1/users/83').reply(200, fixture.linkedServerResponse)
          if (loadedFirst) await api.get('/camps/1')._meta.load
          const user = await api.get('/camps/1').users({ id: 83 })._meta.load
          expect(user.name).toBe('Pflock')
        }
      )

      it('rejects mutations of virtual collections', async () => {
        api.mock.get('/camps/1').reply(200, v3('embedded-collection').serverResponse)
        const camp = await api.get('/camps/1')._meta.load
        await expect(camp.periods().$del()).rejects.toThrow(
          'not implemented for virtual resources'
        )
        await expect(api.post(camp.periods(), {})).rejects.toThrow(
          'not implemented for virtual resources'
        )
        await expect(api.patch(camp.periods(), {})).rejects.toThrow(
          'not implemented for virtual resources'
        )
      })

      it.each(['post', 'patch', 'del', 'reload'] as const)(
        'rejects invalid input to %s',
        async (method) => {
          const call =
            method === 'del' || method === 'reload'
              ? () => api[method](null as never)
              : () => api[method](null as never, {})
          await expect(call()).rejects.toThrow('is not an entity or URI')
        }
      )
    })

    describe('errors', () => {
      it.each([
        ['network error', (route: any) => route.networkError(), undefined],
        ['404 Not Found', (route: any) => route.reply(404), 404],
        ['403 Forbidden', (route: any) => route.reply(403), 403],
      ])('rejects get on %s with an ApiError', async (_, configure, status) => {
        configure(api.mock.get('/camps/1'))
        const error = await api.get('/camps/1')._meta.load.catch((e: unknown) => e)
        expect(error).toBeInstanceOf(ApiError)
        expect((error as ApiError).status).toBe(status)
      })

      it.each([
        ['network error', (route: any) => route.networkError(), undefined],
        ['404 Not Found', (route: any) => route.reply(404), 404],
        ['403 Forbidden', (route: any) => route.reply(403), 403],
        [
          '422 validation error',
          (route: any) =>
            route.reply(422, {
              violations: [{ propertyPath: 'title', message: 'required' }],
            }),
          422,
        ],
      ])('rejects patch on %s with an ApiError', async (_, configure, status) => {
        api.mock.get('/camps/1').reply(200, self('/camps/1', { title: 'x' }))
        configure(api.mock.patch('/camps/1'))
        await api.get('/camps/1')._meta.load
        const error = (await api
          .patch('/camps/1', { title: '' })
          .catch((e: unknown) => e)) as ApiError
        expect(error.status).toBe(status)
        expect(api.get('/camps/1').title).toBe('x')
      })

      it('rejects relation access on properties that are no relations', async () => {
        api.mock.get('/camps/1').reply(200, self('/camps/1', { title: 'x' }))
        // A placeholder cannot know yet whether `title` is a relation...
        const title = api.get('/camps/1').title()
        // ...so the mistake surfaces when loading.
        await expect(title._meta.load).rejects.toThrow(
          "Property 'title' of '/camps/1' was used like a relation"
        )
        // On loaded entities, non-relations are plain values and missing ones are undefined.
        expect(api.get('/camps/1').title).toBe('x')
        expect(api.get('/camps/1').missing).toBeUndefined()
      })

      it('exposes absolute URLs on loaded and loading resources', async () => {
        api.mock.get('/camps/1').delay(5).reply(200, self('/camps/1'))
        expect(api.get('/camps/1')._meta.selfUrl).toBe('http://localhost/camps/1')
        expect((await api.get('/camps/1')._meta.load)._meta.selfUrl).toBe(
          'http://localhost/camps/1'
        )
      })
    })
  }
)
