import type { HttpRequest, HttpResponse, HttpTransport } from './adapters.js'
import { VERSION } from './version.js'

/**
 * Outside browsers, fetch identifies itself as `node`, which some firewalls block. Like other
 * HTTP clients, halc sends its own name there instead; browsers keep their user agent.
 */
function defaultHeaders(): Record<string, string> {
  const versions = (globalThis as { process?: { versions?: { node?: string } } }).process
    ?.versions
  return versions?.node === undefined ? {} : { 'User-Agent': `halc/${VERSION}` }
}

export interface FetchTransportOptions {
  /** The fetch implementation, defaults to the global `fetch`. */
  fetch?: typeof fetch
  /** Whether to send cookies, defaults to `'same-origin'`. */
  credentials?: RequestCredentials
}

function withDefaults(
  headers: Record<string, string>,
  defaults: Record<string, string>
): Record<string, string> {
  const given = new Set(Object.keys(headers).map((name) => name.toLowerCase()))
  const missing = Object.entries(defaults).filter(
    ([name]) => !given.has(name.toLowerCase())
  )
  return missing.length === 0 ? headers : { ...Object.fromEntries(missing), ...headers }
}

/** The default {@link HttpTransport}, based on `fetch`. */
export function createFetchTransport(options: FetchTransportOptions = {}): HttpTransport {
  const credentials = options.credentials ?? 'same-origin'
  const defaults = defaultHeaders()
  return {
    async request(request: HttpRequest): Promise<HttpResponse> {
      const fetchFn = options.fetch ?? globalThis.fetch
      const init: RequestInit = {
        method: request.method,
        headers: withDefaults(request.headers, defaults),
        credentials,
      }
      if (request.body !== undefined) init.body = request.body
      const response = await fetchFn(request.url, init)
      return {
        status: response.status,
        headers: response.headers,
        body: await response.text(),
      }
    },
  }
}
