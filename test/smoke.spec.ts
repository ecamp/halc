/** The example from the README, kept here so it stays correct. */
import { expect, it } from 'vitest'
import { hal } from '../src/hal/index.js'
import { createMockApi, fixture, resetFixtureIds } from '../src/testing/index.js'
import '../src/testing/vitest.js'

it('runs the README testing example', async () => {
  resetFixtureIds()
  const api = createMockApi({ adapter: hal })
  const book = fixture('Book', {
    title: 'The Hobbit',
    chapters: [
      fixture('Chapter', { title: 'An Unexpected Party' }),
      fixture('Chapter', { title: 'Roast Mutton' }),
    ],
  })
  expect(book._meta.self).toBe('/api/books/000000000003')
  api.mock.get(book)
  api.mock.get(book.chapters as typeof book)
  api.mock.patch(book).reply(200, (current: any) => ({ ...current, title: 'Renamed' }))

  const loaded = await api.get(book._meta.self)._meta.load
  await loaded.chapters()._meta.load
  expect(loaded.chapters().items).toHaveLength(2)
  await loaded.$patch({ title: 'Renamed' })
  expect(api.mock.requests).toMatchRequests([
    { method: 'GET', type: 'Book' },
    { method: 'GET', type: 'Chapter' },
    { method: 'PATCH', type: 'Book', body: { title: 'Renamed' } },
  ])
})
