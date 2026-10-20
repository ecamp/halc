import { describe, expect, it } from 'vitest'
import {
  defaultTypeRules,
  detectType,
  isIdSegment,
  pathTypeRule,
  resourceOf,
  singularize,
} from '../../src/hal/typeDetection.js'

describe('type detection', () => {
  it.each([
    ['/camps/4b2c6f1a9e3d', '/camps/{id}', 'Camp'],
    ['/activities?camp=%2Fapi%2Fcamps%2F4b2c6f1a9e3d', '/activities', 'Activity'],
    [
      '/content_node/column_layouts/9f8e7d6c5b4a',
      '/content_node/column_layouts/{id}',
      'ColumnLayout',
    ],
    ['/schedule_entries/1a2b3c4d5e6f', '/schedule_entries/{id}', 'ScheduleEntry'],
    ['/camps/4b2c6f1a9e3d/categories', '/camps/{id}/categories', 'Category'],
    ['', '/', 'Root'],
    ['/', '/', 'Root'],
    ['http://localhost:3000/print/activities', '/print/activities', 'Activity'],
    ['/day_responsibles/1', '/day_responsibles/{id}', 'DayResponsible'],
    ['/scheduleEntries/1', '/scheduleEntries/{id}', 'ScheduleEntry'],
    ['/users/018f4d3a-7c1b-7e2a-9f00-0123456789ab', '/users/{id}', 'User'],
    ['/users/01ARZ3NDEKTSV4RRFFQ69G5FAV', '/users/{id}', 'User'],
    // The examples from the README
    ['/books/4b2c6f1a9e3d', '/books/{id}', 'Book'],
    ['/chapters?book=%2Fapi%2Fbooks%2F4b2c6f1a9e3d', '/chapters', 'Chapter'],
    ['/library/audio_books/9f8e7d6c5b4a', '/library/audio_books/{id}', 'AudioBook'],
    ['/books/4b2c6f1a9e3d/categories', '/books/{id}/categories', 'Category'],
  ])('detects %j as %j / %j', (uri, resource, type) => {
    expect(resourceOf(uri)).toBe(resource)
    expect(detectType(uri, {})).toBe(type)
  })

  it('classifies id segments', () => {
    expect(isIdSegment('123')).toBe(true)
    expect(isIdSegment('4b2c6f1a9e3d')).toBe(true)
    expect(isIdSegment('abcdef')).toBe(false)
    expect(isIdSegment('camps')).toBe(false)
    // The known limit: a name made of 8+ letters a-f looks like an id.
    expect(isIdSegment('deadbeef')).toBe(true)
  })

  it('lets a declared @type win', () => {
    expect(detectType('/camps/1', { '@type': 'SummerCamp' })).toBe('SummerCamp')
  })

  it('applies custom rules in order', () => {
    const rules = [
      { match: /^\/invitations\/[^/]+\/find$/, type: 'Invitation' },
      (path: string) => (path.startsWith('/auth/') ? 'Auth' : undefined),
      ...defaultTypeRules,
    ]
    expect(detectType('/invitations/abc/find', {}, rules)).toBe('Invitation')
    expect(detectType('/auth/google', {}, rules)).toBe('Auth')
    expect(detectType('/camps/1', {}, rules)).toBe('Camp')
  })

  it('accepts a custom singularization', () => {
    const rule = pathTypeRule({
      singularize: (word) => (word === 'people' ? 'person' : word),
    })
    expect(detectType('/people/1', {}, [rule])).toBe('Person')
  })

  it('returns undefined for paths of ids only', () => {
    expect(detectType('/123', {})).toBeUndefined()
  })
})

describe('singularize', () => {
  it.each([
    ['camps', 'camp'],
    ['activities', 'activity'],
    ['categories', 'category'],
    ['boxes', 'box'],
    ['branches', 'branch'],
    ['wishes', 'wish'],
    ['addresses', 'address'],
    ['statuses', 'status'],
    ['responses', 'response'],
    ['courses', 'course'],
    ['class', 'class'],
    ['material_lists', 'material_list'],
  ])('%s → %s', (plural, singular) => {
    expect(singularize(plural)).toBe(singular)
  })
})
