import { describe, expect, it } from 'vitest'
import {
  createUriNormalizer,
  createUrlResolver,
  sortQueryParams,
} from '../../src/core/uri.js'

describe('sortQueryParams', () => {
  it.each([
    ['', ''],
    ['/', '/'],
    ['/?', '/'],
    ['?', ''],
    ['http://localhost', 'http://localhost'],
    ['http://localhost/?', 'http://localhost/'],
    ['/camps/1?', '/camps/1'],
    ['/camps/?page=0&abc=123', '/camps/?abc=123&page=0'],
    ['/camps?page=0&abc=123&page=1', '/camps?abc=123&page=0&page=1'],
    ['/camps?page=1&abc=123&page=0', '/camps?abc=123&page=1&page=0'],
    ['/camps?page=0&xyz=123&page=1', '/camps?page=0&page=1&xyz=123'],
    ['/camps/?e[]=abc&a[]=123&a=test', '/camps/?a=test&a%5B%5D=123&e%5B%5D=abc'],
    ['/camps/1?b=2&a=1#periods', '/camps/1?a=1&b=2#periods'],
  ])('sorts %j to %j', (uri, expected) => {
    expect(sortQueryParams(uri)).toBe(expected)
  })
})

describe('createUriNormalizer', () => {
  // Ported from the hal-json-vuex v3 suite. Deliberate change: the API root is always ''.
  it.each([
    [undefined, '/api/activities', '/api/activities'],
    [null, '/api/activities', '/api/activities'],
    ['', '/api/activities', '/api/activities'],
    ['/api', '/api/activities', '/activities'],
    ['http://localhost:3000', 'http://localhost:3000/api/activities', '/api/activities'],
    ['http://localhost:3000', '/api/activities', '/api/activities'],
    ['http://localhost:3000/api', 'http://localhost:3000/api/activities', '/activities'],
    ['http://localhost:3000/api', '/api/activities', '/activities'],
    ['http://localhost:3000/api/', '/api/activities', '/activities'],
    ['http://localhost:3000/api/', 'http://localhost:3000/api/activities', '/activities'],
    [
      'http://localhost:3000/api/',
      'http://localhost:3000/print/activities',
      'http://localhost:3000/print/activities',
    ],
    [
      'http://localhost:3000/api/',
      '/api/activities?page=0&abc=123',
      '/activities?abc=123&page=0',
    ],
    ['/api', '/api/activities?page=0&abc=123', '/activities?abc=123&page=0'],
    [
      'http://localhost:3000/api',
      'https://example.com/api/activities',
      'https://example.com/api/activities',
    ],
  ])('with base URL %j normalizes %j to %j', (baseUrl, uri, expected) => {
    expect(createUriNormalizer(baseUrl)(uri)).toBe(expected)
  })

  it.each([
    '',
    '/',
    '/api',
    '/api/',
    'http://localhost:3000/api/',
    'http://localhost:3000/api',
  ])('normalizes the API root %j to the empty string', (uri) => {
    expect(createUriNormalizer('http://localhost:3000/api')(uri)).toBe('')
  })

  it('only strips the base path at a segment boundary', () => {
    expect(createUriNormalizer('/api')('/apiary/1')).toBe('/apiary/1')
  })

  it('is idempotent', () => {
    const normalize = createUriNormalizer('http://localhost:3000/api')
    for (const uri of ['/api/camps/1?b=1&a=2', '/camps/1', '', 'http://other/x?b&a']) {
      expect(normalize(normalize(uri))).toBe(normalize(uri))
    }
  })
})

describe('createUrlResolver', () => {
  const resolve = createUrlResolver('http://localhost:3000/api/')

  it('joins normalized URIs with the base URL', () => {
    expect(resolve('/camps/1')).toBe('http://localhost:3000/api/camps/1')
    expect(resolve('')).toBe('http://localhost:3000/api/')
    expect(resolve('?a=1')).toBe('http://localhost:3000/api/?a=1')
  })

  it('keeps absolute URLs and drops fragments', () => {
    expect(resolve('https://example.com/x')).toBe('https://example.com/x')
    expect(resolve('/camps/1#periods')).toBe('http://localhost:3000/api/camps/1')
  })
})

describe('createUriNormalizer edge cases', () => {
  it('treats an explicit default port like no port', () => {
    const normalize = createUriNormalizer('http://localhost/api')
    expect(normalize('http://localhost:80/api/x')).toBe('/x')
    expect(
      createUriNormalizer('https://example.com/api')('https://example.com:443/api/x')
    ).toBe('/x')
  })

  it('resolves a relative base URL against the page origin in browsers', () => {
    const globals = globalThis as { location?: unknown }
    const previous = globals.location
    globals.location = { origin: 'https://app.example.com' }
    try {
      const normalize = createUriNormalizer('/api')
      expect(normalize('https://app.example.com/api/x')).toBe('/x')
      expect(normalize('/api/x')).toBe('/x')
      expect(normalize('https://other.example.com/api/x')).toBe(
        'https://other.example.com/api/x'
      )
    } finally {
      globals.location = previous
    }
  })
})
