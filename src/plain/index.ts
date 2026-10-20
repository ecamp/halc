import type { EntityRecord, StoreAdapter } from '../core/index.js'

function readOnlyError(operation: string): Error {
  return new Error(`PlainObjectStore is read-only, ${operation} is not possible`)
}

/**
 * A read-only store over a snapshot of another store, e.g. posted from the main thread into a
 * worker: `new PlainObjectStore(api.store.snapshot())`. Reading something that is not in the
 * snapshot throws instead of sending a request.
 */
export class PlainObjectStore implements StoreAdapter {
  readonly readOnly = true

  constructor(private readonly records: Readonly<Record<string, EntityRecord>>) {}

  get(uri: string): EntityRecord | undefined {
    return Object.hasOwn(this.records, uri) ? this.records[uri] : undefined
  }

  has(uri: string): boolean {
    return Object.hasOwn(this.records, uri)
  }

  set(): never {
    throw readOnlyError('set')
  }

  patchMeta(): never {
    throw readOnlyError('patchMeta')
  }

  remove(): never {
    throw readOnlyError('remove')
  }

  snapshot(): Record<string, EntityRecord> {
    return { ...this.records }
  }
}
