/** The example from the README, kept here so it stays correct. */
import { expect, it } from 'vitest'
import { hal } from '../src/hal/index.js'
import { createMockApi, fixture, resetFixtureIds } from '../src/testing/index.js'
import '../src/testing/vitest.js'

it('runs the README testing example', async () => {
  resetFixtureIds()
  const api = createMockApi({ adapter: hal })
  const camp = fixture('Camp', {
    title: 'Summer camp',
    activities: [
      fixture('Activity', { title: 'Hike' }),
      fixture('Activity', { title: 'Campfire' }),
    ],
  })
  expect(camp._meta.self).toBe('/api/camps/000000000003')
  api.mock.get(camp)
  api.mock.get(camp.activities as typeof camp)
  api.mock.patch(camp).reply(200, (current: any) => ({ ...current, title: 'Renamed' }))

  const loaded = await api.get(camp._meta.self)._meta.load
  await loaded.activities()._meta.load
  expect(loaded.activities().items).toHaveLength(2)
  await loaded.$patch({ title: 'Renamed' })
  expect(api.mock.requests).toMatchRequests([
    { method: 'GET', type: 'Camp' },
    { method: 'GET', type: 'Activity' },
    { method: 'PATCH', type: 'Camp', body: { title: 'Renamed' } },
  ])
})
