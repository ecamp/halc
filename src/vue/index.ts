import {
  inject,
  markRaw,
  shallowRef,
  type App,
  type InjectionKey,
  type Plugin,
  type ShallowRef,
} from 'vue'
import { noopReactivity, type Client, type ReactivityAdapter } from '../core/index.js'

/**
 * Reactivity for Vue 3: one `shallowRef` version counter per URI, created when a URI is first
 * read. Record data itself is never made reactive, and wrappers are marked raw so Vue never
 * wraps them in its own Proxies.
 */
export function createVueReactivity(): ReactivityAdapter {
  const signals = new Map<string, ShallowRef<number>>()

  function signal(uri: string): ShallowRef<number> {
    let version = signals.get(uri)
    if (!version) {
      version = shallowRef(0)
      signals.set(uri, version)
    }
    return version
  }

  return {
    signal,
    track(uri) {
      // Reading the value is what registers the dependency of the running effect.
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      signal(uri).value
    },
    bump(uri) {
      // Nobody can depend on a URI that was never read.
      const version = signals.get(uri)
      if (version) version.value++
    },
    release(uri) {
      signals.delete(uri)
    },
    markRaw: (value) => markRaw(value),
  }
}

/** The key under which the client is provided to the app, for `inject()`. */
export const apiKey: InjectionKey<Client> = Symbol('halc')

export interface HalcVueOptions {
  /** Name of the global property, default `api` (as in hal-json-vuex). */
  name?: string
}

/**
 * The Vue plugin: makes the client available as `this.api` in every component and through
 * {@link useApi}, and switches the client to Vue reactivity unless it already has another.
 *
 * ```ts
 * app.use(halcVue(createHalc({ adapter: hal, baseUrl })))
 * ```
 */
export function halcVue(client: Client, options: HalcVueOptions = {}): Plugin {
  if (client.reactivity === noopReactivity) client.setReactivity(createVueReactivity())
  const name = options.name ?? 'api'
  return {
    install(app: App) {
      ;(app.config.globalProperties as Record<string, unknown>)[name] = client
      app.provide(apiKey, client)
    },
  }
}

/** The client provided by {@link halcVue}, for `setup()` code. */
export function useApi(): Client {
  const client = inject(apiKey)
  if (!client)
    throw new Error('No halc client provided. Did you app.use(halcVue(client))?')
  return client
}

declare module 'vue' {
  interface ComponentCustomProperties {
    /** The halc client installed with `halcVue()`. */
    api: Client
  }
}
