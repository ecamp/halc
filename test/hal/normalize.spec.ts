import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createUriNormalizer } from '../../src/core/uri.js'
import { createHalAdapter, hal, HalFormatError } from '../../src/hal/index.js'

const context = { normalizeUri: createUriNormalizer('http://localhost/api') }

function v3Fixture(name: string): unknown {
  const url = new URL(`../fixtures/v3/${name}.json`, import.meta.url)
  const json = JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>
  return 'serverResponse' in json ? json.serverResponse : json
}

function normalize(body: unknown, uri = '/requested') {
  return hal.normalize(uri, body, new Headers(), context)
}

describe('HAL normalizer', () => {
  it.each([
    'root',
    'embedded-single-entity',
    'reference-to-single-entity',
    'embedded-collection',
    'embedded-collection-standalone-link',
    'embedded-collection-link-array',
    'linked-single-entity',
    'linked-collection',
    'linked-entity-array',
    'collection-firstPage',
    'collection-page1',
    'circular-reference',
    'multiple-references-to-user',
    'object-property',
    'array-property',
  ])('normalizes the v3 fixture %s', (name) => {
    expect(normalize(v3Fixture(name))).toMatchSnapshot()
  })

  it('emits the document first, then every embedded resource with its type', () => {
    const records = normalize({
      id: 1,
      _links: { self: { href: '/api/camps/1' }, creator: { href: '/api/users/7' } },
      _embedded: {
        periods: [{ id: 2, _links: { self: { href: '/api/periods/2' } } }],
        mainPeriod: { id: 2, _links: { self: { href: '/api/periods/2' } } },
      },
    })

    expect(records.map((record) => [record.uri, record.meta.type])).toEqual([
      ['/camps/1', 'Camp'],
      ['/periods/2', 'Period'],
      ['/periods/2', 'Period'],
    ])
    expect(records[0]?.data).toEqual({
      id: 1,
      creator: { href: '/users/7' },
      periods: { hrefs: ['/periods/2'] },
      mainPeriod: { href: '/periods/2' },
    })
  })

  it('stores collections as records with items', () => {
    const [collection, item] = normalize({
      _links: { self: { href: '/api/activities?camp=1' } },
      _embedded: { items: [{ id: 3, _links: { self: { href: '/api/activities/3' } } }] },
      totalItems: 1,
    })

    expect(collection).toMatchObject({
      uri: '/activities?camp=1',
      data: { items: { hrefs: ['/activities/3'] }, totalItems: 1 },
      meta: { type: 'Activity', resource: '/activities' },
    })
    expect(item?.uri).toBe('/activities/3')
  })

  it('keeps templated links unexpanded and drops link attributes', () => {
    const [record] = normalize({
      _links: {
        self: { href: '/api/' },
        camps: { href: '/api/camps{/id}', templated: true },
        login: { href: '/api/authentication_token', templated: false, title: 'Login' },
        curies: [{ name: 'ht', href: '/rels/{rel}', templated: true }],
      },
    })

    expect(record?.uri).toBe('')
    expect(record?.meta.type).toBe('Root')
    expect(record?.data).toEqual({
      camps: { href: '/api/camps{/id}', templated: true },
      login: { href: '/authentication_token' },
    })
  })

  it('does not emit records for embedded references without data', () => {
    const records = normalize({
      _links: { self: { href: '/api/camps/1' } },
      _embedded: { creator: { _links: { self: { href: '/api/users/1' } } } },
    })
    expect(records).toHaveLength(1)
    expect(records[0]?.data.creator).toEqual({ href: '/users/1' })
  })

  it('keeps embedded plain objects and lists as data', () => {
    const [record] = normalize({
      _links: { self: { href: '/api/camps/1' } },
      _embedded: {
        settings: { color: 'red' },
        tags: [{ name: 'a' }],
        empty: [],
        nothing: null,
      },
    })
    expect(record?.data).toEqual({
      settings: { color: 'red' },
      tags: [{ name: 'a' }],
      empty: { hrefs: [] },
      nothing: null,
    })
  })

  it('uses the requested URI for documents without self link', () => {
    expect(normalize({ a: 1 }, '/requested')[0]).toMatchObject({
      uri: '/requested',
      data: { a: 1 },
    })
  })

  it('reports invalid HAL with the JSON path', () => {
    expect(() => normalize('nope')).toThrow(
      new HalFormatError('A HAL document must be an object', '$')
    )
    expect(() =>
      normalize({ _links: { self: { href: '/a' }, camp: { title: 'x' } } })
    ).toThrow('Link without href at $._links.camp')
    expect(() =>
      normalize({
        _links: { self: { href: '/a' } },
        _embedded: { items: [{ _links: { self: { href: '/b' } } }, { id: 1 }] },
      })
    ).toThrow('Embedded resource without self link at $._embedded.items[1]')
  })
})

describe('HAL adapter', () => {
  it('serializes bodies as JSON, PATCH as merge patch', () => {
    expect(hal.serialize('/camps/1', { a: 1 }, 'POST')).toEqual({
      body: '{"a":1}',
      contentType: 'application/json',
    })
    expect(hal.serialize('/camps/1', { a: 1 }, 'PATCH').contentType).toBe(
      'application/merge-patch+json'
    )
    expect(
      createHalAdapter({ contentTypes: { PATCH: 'application/json' } }).serialize(
        '/x',
        {},
        'PATCH'
      ).contentType
    ).toBe('application/json')
  })

  it('extracts the identity from the self link', () => {
    expect(hal.identity({ _links: { self: { href: '/api/camps/1' } } })).toBe(
      '/api/camps/1'
    )
    expect(hal.identity({ id: 1 })).toBeUndefined()
    expect(hal.identity(null)).toBeUndefined()
  })

  it('accepts HAL and plain JSON responses', () => {
    expect(hal.accept).toBe('application/hal+json')
    expect(hal.contentTypes).toEqual(['application/hal+json', 'application/json'])
  })

  it('can replace type detection', () => {
    const adapter = createHalAdapter({ typeOf: () => 'Thing' })
    expect(
      adapter.normalize(
        '/x',
        { _links: { self: { href: '/x' } } },
        new Headers(),
        context
      )[0]?.meta.type
    ).toBe('Thing')
  })
})
