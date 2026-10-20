import { defineStore, type Pinia } from 'pinia'
import { markRaw, shallowRef, triggerRef } from 'vue'
import {
  applyMetaPatch,
  type EntityRecord,
  type MetaPatch,
  type StoreAdapter,
} from '../core/index.js'

export interface PiniaStoreOptions {
  /** The store id, default `api`. */
  id?: string
}

/**
 * Keeps the records in a Pinia store, so they show up in the devtools. The state is one
 * `shallowRef` holding the records (marked raw), so Pinia never converts them deeply; each write
 * is one action (`set`, `patchMeta`, `remove`), i.e. one entry per response in the devtools
 * timeline.
 */
export function createPiniaStore(
  pinia?: Pinia,
  options: PiniaStoreOptions = {}
): StoreAdapter {
  // Reads go through this plain object, so they never become reactive dependencies.
  let raw: Record<string, EntityRecord> = {}

  const useStore = defineStore(options.id ?? 'api', () => {
    const records = shallowRef(raw)

    function changed(): void {
      // Pick up state replaced from outside, e.g. by hydration.
      if (records.value !== raw) raw = records.value
    }

    function set(list: EntityRecord[]): void {
      changed()
      for (const record of list) raw[record.uri] = markRaw(record)
      triggerRef(records)
    }

    function patchMeta(uri: string, meta: MetaPatch): void {
      changed()
      const record = raw[uri]
      if (!record) return
      raw[uri] = markRaw({ ...record, meta: applyMetaPatch(record.meta, meta) })
      triggerRef(records)
    }

    function remove(uris: string[]): void {
      changed()
      for (const uri of uris) Reflect.deleteProperty(raw, uri)
      triggerRef(records)
    }

    return { records, set, patchMeta, remove }
  })

  const store = useStore(pinia)

  return {
    readOnly: false,
    get: (uri) => (Object.hasOwn(raw, uri) ? raw[uri] : undefined),
    has: (uri) => Object.hasOwn(raw, uri),
    set: (records) => {
      store.set(records)
    },
    patchMeta: (uri, meta) => {
      store.patchMeta(uri, meta)
    },
    remove: (uris) => {
      store.remove(uris)
    },
    snapshot: () => ({ ...raw }),
  }
}
