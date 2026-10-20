import type { HttpRequest, HttpResponse, HttpTransport } from './adapters.js'

export interface FetchTransportOptions {
  /** The fetch implementation, defaults to the global `fetch`. */
  fetch?: typeof fetch
  /** Whether to send cookies, defaults to `'same-origin'`. */
  credentials?: RequestCredentials
}

/** The default {@link HttpTransport}, based on `fetch`. */
export function createFetchTransport(options: FetchTransportOptions = {}): HttpTransport {
  const credentials = options.credentials ?? 'same-origin'
  return {
    async request(request: HttpRequest): Promise<HttpResponse> {
      const fetchFn = options.fetch ?? globalThis.fetch
      const init: RequestInit = {
        method: request.method,
        headers: request.headers,
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
