/**
 * Benchmarks with the performance budget from the architecture concept, enforced in CI
 * (`npm run bench`). The budget is checked against the median, so a single slow sample on a
 * busy CI machine does not fail the build.
 */
import { describe, expect, test } from 'vitest'
import { activitiesBody, clientServing, collectionUri } from './data.js'

const body = activitiesBody(5000)

describe('5000 item collection', () => {
  test('is parsed, normalized and stored in under 50 ms', async ({ bench }) => {
    const result = await bench('load', async () => {
      await clientServing(body).get(collectionUri)._meta.load
    }).run()

    expect(result.latency.p50).toBeLessThan(50)
  })

  test('is searched with items.find() in under 1 ms', async ({ bench }) => {
    const api = clientServing(body)
    await api.get(collectionUri)._meta.load

    const result = await bench('items.find()', () => {
      api.get(collectionUri).items.find((item) => item.title === 'Activity 4999')
    }).run()

    expect(result.latency.p50).toBeLessThan(1)
  })

  test('allocates nothing when an unchanged entity is read again', async ({ bench }) => {
    const api = clientServing(body)
    await api.get(collectionUri)._meta.load
    const first = api.get('/activities/000000000123')

    const result = await bench('api.get() x 10 000', () => {
      for (let i = 0; i < 10_000; i++) api.get('/activities/000000000123')
    }).run()

    expect(api.get('/activities/000000000123')).toBe(first)
    expect(result.latency.p50).toBeLessThan(5)
  })
})
