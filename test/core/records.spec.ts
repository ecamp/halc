import { describe, expect, it } from 'vitest'
import {
  currentData,
  currentValue,
  isCollectionRecord,
  isCollectionRef,
  isLinkRef,
  isRelationRef,
  isTemplatedLinkRef,
} from '../../src/core/records.js'

describe('relation refs', () => {
  it('recognizes refs by their exact shape', () => {
    expect(isLinkRef({ href: '/a' })).toBe(true)
    expect(isLinkRef({ href: '/a', title: 'A' })).toBe(false)
    expect(isTemplatedLinkRef({ href: '/a{/id}', templated: true })).toBe(true)
    expect(isTemplatedLinkRef({ href: '/a', templated: false })).toBe(false)
    expect(isCollectionRef({ hrefs: [] })).toBe(true)
    expect(isCollectionRef({ hrefs: 'x' })).toBe(false)
    expect(isRelationRef(null)).toBe(false)
    expect(isRelationRef([{ href: '/a' }])).toBe(false)
  })

  it('reads dirty values over data', () => {
    const record = {
      uri: '/a',
      data: { title: 'old', items: { hrefs: [] } },
      meta: { version: 1, status: 'loaded' as const, dirty: { title: 'new' } },
    }
    expect(currentData(record)).toEqual({ title: 'new', items: { hrefs: [] } })
    expect(currentValue(record, 'title')).toBe('new')
    expect(isCollectionRecord(record)).toBe(true)
  })
})
