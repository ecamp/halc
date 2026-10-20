import { describe, expect, it } from 'vitest'
import { MemoryStore } from '../../src/core/memoryStore.js'
import type { EntityRecord } from '../../src/core/records.js'

const record = (uri: string, version = 1): EntityRecord => ({
  uri,
  data: { id: uri },
  meta: { version, status: 'loaded', loadedAt: 1 },
})

describe('MemoryStore', () => {
  it('sets, gets and removes records', () => {
    const store = new MemoryStore()
    store.set([record('/a'), record('/b')])

    expect(store.has('/a')).toBe(true)
    expect(store.get('/b')).toEqual(record('/b'))

    store.remove(['/a'])
    expect(store.has('/a')).toBe(false)
    expect(store.snapshot()).toEqual({ '/b': record('/b') })
  })

  it('patches meta without mutating the previous record', () => {
    const store = new MemoryStore()
    const original = record('/a')
    store.set([{ ...original, meta: { ...original.meta, deleting: true } }])
    const before = store.get('/a')

    store.patchMeta('/a', { version: 2, deleting: undefined, status: 'stale' })

    expect(store.get('/a')?.meta).toEqual({ version: 2, status: 'stale', loadedAt: 1 })
    expect(before?.meta.deleting).toBe(true)
    store.patchMeta('/unknown', { version: 1 })
    expect(store.has('/unknown')).toBe(false)
  })

  it('can be created from a snapshot', () => {
    const snapshot = { '/a': record('/a') }
    expect(new MemoryStore(snapshot).snapshot()).toEqual(snapshot)
  })
})
