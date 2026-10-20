import { beforeEach, describe, expect, it } from 'vitest'
import {
  collectionFixture,
  fixture,
  pluralPath,
  resetFixtureIds,
  setFixtureBasePath,
} from '../../src/testing/fixture.js'

beforeEach(() => {
  resetFixtureIds()
})

describe('fixture', () => {
  it('builds HAL documents from type names', () => {
    const camp = fixture('Camp', { title: 'Summer camp' })

    expect(JSON.parse(JSON.stringify(camp))).toEqual({
      title: 'Summer camp',
      _links: { self: { href: '/api/camps/000000000001' } },
    })
    expect(camp._meta).toEqual({ self: '/api/camps/000000000001', type: 'Camp' })
  })

  it('links nested fixtures and exposes them for mocking', () => {
    const user = fixture('User')
    const activities = [fixture('Activity'), fixture('Activity')]
    const camp = fixture('Camp', { creator: user, activities })

    expect(camp._links).toEqual({
      self: { href: '/api/camps/000000000004' },
      creator: { href: '/api/users/000000000001' },
      activities: { href: '/api/camps/000000000004/activities' },
    })
    expect(camp.creator).toBe(user)
    expect((camp.activities as any)._embedded.items).toEqual(activities)
    expect((camp.activities as any)._meta.type).toBe('Activity')
    expect(camp._embedded).toBeUndefined()
  })

  it('embeds relations on request', () => {
    const user = fixture('User', { name: 'x' })
    const camp = fixture(
      'Camp',
      { creator: user, periods: [fixture('Period')] },
      { embed: ['creator'] }
    )

    expect(camp._embedded).toEqual({ creator: user })
  })

  it('accepts a custom self link, extra links and a base path', () => {
    expect(fixture('Camp', {}, { self: '/custom' })._meta.self).toBe('/custom')
    expect(fixture('Camp', { _links: { x: { href: '/x' } } })._links.x).toEqual({
      href: '/x',
    })
    setFixtureBasePath('/v2/')
    try {
      expect(fixture('Camp')._meta.self).toBe('/v2/camps/000000000002')
      expect(collectionFixture('Camp', [])._meta.self).toBe('/v2/camps')
    } finally {
      setFixtureBasePath('/api')
    }
  })

  it('pluralizes type names into paths', () => {
    expect(pluralPath('Activity')).toBe('activities')
    expect(pluralPath('ScheduleEntry')).toBe('schedule_entries')
    expect(pluralPath('Box')).toBe('boxes')
    expect(pluralPath('Day')).toBe('days')
    expect(pluralPath('Camp')).toBe('camps')
  })
})
