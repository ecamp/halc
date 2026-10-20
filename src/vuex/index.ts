import { markRaw, toRaw } from 'vue'
import {
  applyMetaPatch,
  type EntityRecord,
  type MetaPatch,
  type StoreAdapter,
} from '../core/index.js'

export interface VuexStoreOptions {
  /** Name of the Vuex module, default `api` (as in hal-json-vuex). */
  moduleName?: string
}

type State = Record<string, EntityRecord>

/**
 * The parts of a Vuex 4 store this adapter uses. Declared here because vuex 4 does not expose its
 * types through its package exports.
 */
export interface VuexStoreLike {
  readonly state: unknown
  registerModule(
    name: string,
    module: {
      namespaced: boolean
      state: () => State
      mutations: Record<string, (state: State, payload: never) => void>
    }
  ): void
  commit(type: string, payload?: unknown): void
}

/**
 * Keeps the records in a namespaced Vuex module (`api` by default, like hal-json-vuex), with the
 * mutations `set`, `patchMeta` and `remove`: one mutation per response. Records are marked raw,
 * so Vuex never converts them deeply, and reads bypass Vuex's reactivity.
 */
export function createVuexStore(
  store: VuexStoreLike,
  options: VuexStoreOptions = {}
): StoreAdapter {
  const name = options.moduleName ?? 'api'

  store.registerModule(name, {
    namespaced: true,
    state: (): State => ({}),
    mutations: {
      set(state: State, records: EntityRecord[]) {
        for (const record of records) state[record.uri] = markRaw(record)
      },
      patchMeta(state: State, { uri, meta }: { uri: string; meta: MetaPatch }) {
        const record = state[uri]
        if (!record) return
        state[uri] = markRaw({ ...record, meta: applyMetaPatch(record.meta, meta) })
      },
      remove(state: State, uris: string[]) {
        for (const uri of uris) Reflect.deleteProperty(state, uri)
      },
    },
  })

  const state = (): State => (toRaw(store.state) as Record<string, State>)[name] ?? {}

  return {
    readOnly: false,
    get: (uri) => {
      const records = state()
      return Object.hasOwn(records, uri) ? toRaw(records[uri]) : undefined
    },
    has: (uri) => Object.hasOwn(state(), uri),
    set: (records) => {
      store.commit(`${name}/set`, records)
    },
    patchMeta: (uri, meta) => {
      store.commit(`${name}/patchMeta`, { uri, meta })
    },
    remove: (uris) => {
      store.commit(`${name}/remove`, uris)
    },
    snapshot: () => ({ ...state() }),
  }
}
