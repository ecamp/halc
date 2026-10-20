import { createHalc, type Client } from 'halc'
import { hal } from 'halc/hal'

/** A HAL collection like ecamp3's activities: every item embeds a few relations. */
export function activitiesBody(count: number): string {
  const items = Array.from({ length: count }, (_, index) => {
    const id = index.toString(16).padStart(12, '0')
    return {
      id,
      title: `Activity ${index}`,
      location: 'Forest',
      progress: index % 5,
      _links: {
        self: { href: `/api/activities/${id}` },
        camp: { href: '/api/camps/0000000000aa' },
        category: {
          href: `/api/categories/${(index % 7).toString(16).padStart(12, '0')}`,
        },
        rootContentNode: { href: `/api/content_node/column_layouts/${id}` },
        scheduleEntries: {
          href: `/api/schedule_entries?activity=%2Fapi%2Factivities%2F${id}`,
        },
      },
    }
  })
  return JSON.stringify({
    totalItems: count,
    _links: { self: { href: '/api/activities?camp=%2Fapi%2Fcamps%2F0000000000aa' } },
    _embedded: { items },
  })
}

export const collectionUri = '/activities?camp=%2Fapi%2Fcamps%2F0000000000aa'

/** A client whose transport answers every request with the given body, without delay. */
export function clientServing(body: string): Client {
  return createHalc({
    adapter: hal,
    baseUrl: 'http://localhost/api',
    transport: {
      request: () =>
        Promise.resolve({
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/hal+json' }),
          body,
        }),
    },
  })
}
