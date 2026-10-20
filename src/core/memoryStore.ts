import type { StoreAdapter } from './adapters.js'
import { applyMetaPatch, type EntityRecord, type MetaPatch } from './records.js'

/**
 * The default store: a `Map` of records. Used in tests, Node clients, SSR, and in apps that
 * don't want Pinia or Vuex.
 */
export class MemoryStore implements StoreAdapter {
  readonly readOnly = false
  private readonly records = new Map<string, EntityRecord>()

  constructor(initial: Record<string, EntityRecord> = {}) {
    for (const [uri, record] of Object.entries(initial)) this.records.set(uri, record)
  }

  get(uri: string): EntityRecord | undefined {
    return this.records.get(uri)
  }

  has(uri: string): boolean {
    return this.records.has(uri)
  }

  set(records: EntityRecord[]): void {
    for (const record of records) this.records.set(record.uri, record)
  }

  patchMeta(uri: string, meta: MetaPatch): void {
    const record = this.records.get(uri)
    if (!record) return
    this.records.set(uri, { ...record, meta: applyMetaPatch(record.meta, meta) })
  }

  remove(uris: string[]): void {
    for (const uri of uris) this.records.delete(uri)
  }

  snapshot(): Record<string, EntityRecord> {
    return Object.fromEntries(this.records)
  }
}
