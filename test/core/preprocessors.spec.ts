import { beforeEach, describe, expect, it, vi } from 'vitest'
import { collectionFixture, fixture, resetFixtureIds } from '../../src/testing/index.js'
import { createApi } from '../helpers.js'

beforeEach(() => {
  resetFixtureIds()
})

describe('preprocessors', () => {
  it('adds derived fields to every entity of a type, embedded ones included', async () => {
    const api = createApi({
      preprocessors: {
        Activity: (activity) => ({ shout: String(activity.title).toUpperCase() }),
      },
    })
    const activities = collectionFixture('Activity', [
      fixture('Activity', { title: 'hike' }),
      fixture('Activity', { title: 'swim' }),
    ])
    api.mock.get(activities)

    const collection = await api.get(activities._meta.self)._meta.load

    expect(collection.items.map((activity: any) => activity.shout)).toEqual([
      'HIKE',
      'SWIM',
    ])
  })

  it('keeps derived fields out of spreads, JSON and patches', async () => {
    const api = createApi({ preprocessors: { Camp: () => ({ derived: 1 }) } })
    const camp = fixture('Camp', { title: 'x' })
    api.mock.get(camp)
    const loaded = await api.get(camp._meta.self)._meta.load

    expect(loaded.derived).toBe(1)
    expect({ ...loaded }).toEqual({ _meta: loaded._meta, title: 'x' })
    expect(JSON.stringify(loaded)).toBe(
      '{"title":"x","_meta":{"self":"/camps/000000000001"}}'
    )
    await loaded.$patch({ ...loaded })
    expect(api.mock.requests).toHaveLength(1)
  })

  it('memoizes per version and recomputes when the entity changes', async () => {
    const preprocessor = vi.fn((camp: any) => ({
      upper: String(camp.title).toUpperCase(),
    }))
    const api = createApi({ preprocessors: { Camp: preprocessor } })
    const camp = fixture('Camp', { title: 'a' })
    api.mock.get(camp)
    api.mock.patch(camp)
    const loaded = await api.get(camp._meta.self)._meta.load

    for (let i = 0; i < 5; i++) expect(api.get(camp._meta.self).upper).toBe('A')
    expect(preprocessor).toHaveBeenCalledTimes(1)

    const patch = loaded.$patch({ title: 'b' })
    // Preprocessors see optimistic changes.
    expect(api.get(camp._meta.self).upper).toBe('B')
    await patch
    expect(api.get(camp._meta.self).upper).toBe('B')
  })

  it('recomputes when a resource read through ctx.get changes', async () => {
    const api = createApi({
      preprocessors: {
        ScheduleEntry: (entry, ctx) => ({
          dayNumber: ctx.get(entry.$hrefSync('day'))?.number as number | undefined,
        }),
      },
    })
    const day = fixture('Day', { number: 1 })
    const entry = fixture('ScheduleEntry', { day })
    api.mock.get(entry)
    api.mock.get(day).once()
    api.mock.get(day).reply(200, (current: any) => ({ ...current, number: 2 }))

    const loaded = await api.get(entry._meta.self)._meta.load
    expect(loaded.dayNumber).toBeUndefined()
    expect(api.mock.requests).toHaveLength(1)

    await loaded.day()._meta.load
    expect(api.get(entry._meta.self).dayNumber).toBe(1)
    await api.reload(day._meta.self)
    expect(api.get(entry._meta.self).dayNumber).toBe(2)
  })

  it('does not run for placeholders', () => {
    const preprocessor = vi.fn(() => ({}))
    const api = createApi({ preprocessors: { Camp: preprocessor } })
    api.mock
      .get('/api/camps/1')
      .delay(5)
      .reply(200, { _links: { self: { href: '/api/camps/1' } } })

    expect(api.get('/camps/1').anything).toBeTypeOf('function')
    expect(preprocessor).not.toHaveBeenCalled()
  })
})

describe('preprocessors and collections', () => {
  it('do not run for the collections of their type', async () => {
    const preprocessor = vi.fn((activity: any) => ({
      shout: String(activity.title).toUpperCase(),
    }))
    const api = createApi({ preprocessors: { Activity: preprocessor } })
    const activities = collectionFixture('Activity', [
      fixture('Activity', { title: 'hike' }),
    ])
    api.mock.get(activities)

    const collection = await api.get(activities._meta.self)._meta.load

    expect(collection.items[0].shout).toBe('HIKE')
    expect(collection.shout).toBeUndefined()
    expect(preprocessor).toHaveBeenCalledTimes(1)
  })
})
