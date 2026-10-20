import { describe, expect, it } from 'vitest'
import { hal } from '../src/hal/index.js'
import { createMockApi, fixture } from '../src/testing/index.js'
import { toMatchRequests } from '../src/testing/matchers.js'

describe('smoke', () => {
  it('runs the example from the concept', async () => {
    const api = createMockApi({ adapter: hal })
    const camp = fixture('Camp', {
      title: 'Summer camp',
      activities: [
        fixture('Activity', { title: 'Hike' }),
        fixture('Activity', { title: 'Campfire' }),
      ],
    })
    api.mock.get(camp)
    api.mock.get(camp.activities as never)
    api.mock.patch(camp).reply(200, (c: any) => ({ ...c, title: 'Renamed' }))

    const loaded = await api.get(camp._meta.self)._meta.load
    expect(loaded.title).toBe('Summer camp')
    await loaded.activities()._meta.load
    expect(loaded.activities().items).toHaveLength(2)
    expect(loaded.activities().items.map((a: any) => a.title)).toEqual([
      'Hike',
      'Campfire',
    ])
    await loaded.$patch({ title: 'Renamed' })
    expect(api.get(camp._meta.self).title).toBe('Renamed')
    const result = toMatchRequests(api.mock.requests, [
      { method: 'GET', type: 'Camp' },
      { method: 'GET', type: 'Activity' },
      { method: 'PATCH', type: 'Camp', body: { title: 'Renamed' } },
    ])
    expect(result.pass, result.message()).toBe(true)
  })
})
