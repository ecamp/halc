import type { HttpRequest, HttpResponse, HttpTransport } from '../core/index.js'
import { isFixture, nextFixtureId, type Fixture } from './fixture.js'

type Method = HttpRequest['method']

/** A request received by the mock server. */
export interface MockRequest {
  method: Method
  /** Absolute URL of the request. */
  url: string
  /** The URI, normalized like the client normalizes store keys. */
  uri: string
  /** The detected type of the requested resource. */
  type: string | undefined
  headers: Record<string, string>
  /** The parsed JSON body, if any. */
  body: unknown
  /** False if no route matched. */
  matched: boolean
}

/** A body, or a function computing it from the current server state and the request. */
export type ReplyBody = unknown | ((current: unknown, request: MockRequest) => unknown)

interface Reply {
  status: number
  body: ReplyBody
  headers: Record<string, string>
}

/** One mocked endpoint, configured by chaining. */
export class MockRoute {
  /** @internal */ replyValue: Reply | undefined
  /** @internal */ delayMs = 0
  /** @internal */ times = Infinity
  /** @internal */ failWithNetworkError = false

  constructor(
    readonly method: Method,
    readonly uri: string
  ) {}

  /** Responds with this status and body; a function body receives the current server state. */
  reply(status: number, body?: ReplyBody, headers: Record<string, string> = {}): this {
    this.replyValue = { status, body, headers }
    return this
  }

  /** Responds with this status and the default body. Handy for `.status(409)`. */
  status(status: number): this {
    this.replyValue = {
      status,
      body: this.replyValue?.body,
      headers: this.replyValue?.headers ?? {},
    }
    return this
  }

  /** Delays the response, for race condition tests. */
  delay(ms: number): this {
    this.delayMs = ms
    return this
  }

  /** Answers only the next request, later requests fall through to older routes. */
  once(): this {
    this.times = 1
    return this
  }

  /** Answers with this many requests, then falls through. */
  timesLimit(count: number): this {
    this.times = count
    return this
  }

  /** Fails like a network error, without a response. */
  networkError(): this {
    this.failWithNetworkError = true
    return this
  }
}

export interface MockServerOptions {
  normalizeUri: (uri: string) => string
  typeOf: (uri: string) => string | undefined
}

function targetUri(target: Fixture | string): string {
  return isFixture(target) ? target._meta.self : target
}

function parseBody(body: string | undefined): unknown {
  if (body === undefined || body === '') return undefined
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * An in-memory HAL server for tests. Routes are matched by method and normalized URI, see
 * {@link MockServer.findRoute}. GET routes registered with a fixture also keep that fixture as
 * server state, which the default PATCH, POST and DELETE answers update.
 */
export class MockServer {
  /** Every request received, in order. */
  readonly requests: MockRequest[] = []
  private readonly routes: MockRoute[] = []
  private readonly state = new Map<string, Record<string, unknown>>()

  constructor(private readonly options: MockServerOptions) {}

  readonly transport: HttpTransport = {
    request: (request) => this.handle(request),
  }

  get(target: Fixture | string): MockRoute {
    if (isFixture(target)) {
      this.state.set(this.options.normalizeUri(target._meta.self), clone(target))
    }
    return this.route('GET', target)
  }

  post(target: Fixture | string): MockRoute {
    return this.route('POST', target)
  }

  patch(target: Fixture | string): MockRoute {
    return this.route('PATCH', target)
  }

  put(target: Fixture | string): MockRoute {
    return this.route('PUT', target)
  }

  delete(target: Fixture | string): MockRoute {
    return this.route('DELETE', target)
  }

  /** The server state of a resource, as the default answers see it. */
  current(target: Fixture | string): unknown {
    return this.state.get(this.options.normalizeUri(targetUri(target)))
  }

  /** Forgets all routes, requests and state. */
  reset(): void {
    this.routes.length = 0
    this.requests.length = 0
    this.state.clear()
  }

  private route(method: Method, target: Fixture | string): MockRoute {
    const route = new MockRoute(method, this.options.normalizeUri(targetUri(target)))
    this.routes.push(route)
    return route
  }

  /**
   * Limited routes (`.once()`, `.timesLimit()`) answer first, in the order they were registered,
   * so a test can queue a sequence of answers. Otherwise the most recently registered route
   * answers, so a test can override an earlier route.
   */
  private findRoute(method: Method, uri: string): MockRoute | undefined {
    const candidates = this.routes.filter(
      (route) => route.method === method && route.uri === uri && route.times > 0
    )
    return candidates.find((route) => route.times !== Infinity) ?? candidates.at(-1)
  }

  private async handle(request: HttpRequest): Promise<HttpResponse> {
    const uri = this.options.normalizeUri(request.url)
    const route = this.findRoute(request.method, uri)
    const received: MockRequest = {
      method: request.method,
      url: request.url,
      uri,
      type: this.options.typeOf(uri),
      headers: request.headers,
      body: parseBody(request.body),
      matched: route !== undefined,
    }
    this.requests.push(received)

    if (!route) {
      throw new Error(`halc/testing: no mock for ${request.method} ${request.url}`)
    }
    route.times -= 1
    if (route.delayMs > 0)
      await new Promise((resolve) => setTimeout(resolve, route.delayMs))
    if (route.failWithNetworkError) throw new TypeError('Network error (mocked)')

    const { status, body, headers } = this.answer(route, received)
    const isError = status >= 400
    const text = body === undefined ? '' : JSON.stringify(body)
    const responseHeaders = new Headers(headers)
    if (text && !responseHeaders.has('Content-Type')) {
      responseHeaders.set(
        'Content-Type',
        isError ? 'application/problem+json' : 'application/hal+json'
      )
    }
    return { status, headers: responseHeaders, body: text }
  }

  private answer(route: MockRoute, request: MockRequest): Reply {
    const current = this.state.get(request.uri)
    const reply = route.replyValue
    if (reply && reply.body !== undefined) {
      const body: unknown =
        typeof reply.body === 'function'
          ? (reply.body as (current: unknown, request: MockRequest) => unknown)(
              current === undefined ? undefined : clone(current),
              request
            )
          : reply.body
      if (
        reply.status < 300 &&
        request.method !== 'DELETE' &&
        body &&
        typeof body === 'object'
      ) {
        const self = (body as { _links?: { self?: { href?: string } } })._links?.self
          ?.href
        if (self)
          this.state.set(
            this.options.normalizeUri(self),
            clone(body as Record<string, unknown>)
          )
      }
      return { status: reply.status, body, headers: reply.headers }
    }
    const status = reply?.status
    if (status !== undefined && status >= 400) {
      return {
        status,
        body: { title: 'Mocked error', status },
        headers: reply?.headers ?? {},
      }
    }
    return this.defaultAnswer(request, status, reply?.headers ?? {})
  }

  /** Default answers that behave like a simple HAL server on top of the registered fixtures. */
  private defaultAnswer(
    request: MockRequest,
    status: number | undefined,
    headers: Record<string, string>
  ): Reply {
    const current = this.state.get(request.uri)
    switch (request.method) {
      case 'GET':
        return current === undefined
          ? { status: 404, body: { title: 'Not Found', status: 404 }, headers }
          : { status: status ?? 200, body: current, headers }
      case 'PATCH':
      case 'PUT': {
        const updated = { ...current, ...(request.body as Record<string, unknown>) }
        this.state.set(request.uri, updated)
        return { status: status ?? 200, body: updated, headers }
      }
      case 'DELETE':
        this.state.delete(request.uri)
        for (const resource of this.state.values())
          this.removeFromCollection(resource, request.uri)
        return { status: status ?? 204, body: undefined, headers }
      case 'POST': {
        const path = new URL(request.url, 'http://localhost').pathname.replace(/\/+$/, '')
        const self = `${path}/${nextFixtureId()}`
        const created = {
          ...(request.body as Record<string, unknown>),
          _links: { self: { href: self } },
        }
        this.state.set(this.options.normalizeUri(self), created)
        if (current) this.addToCollection(current, created)
        return { status: status ?? 201, body: created, headers }
      }
    }
  }

  private addToCollection(
    collection: Record<string, unknown>,
    item: Record<string, unknown>
  ): void {
    const embedded = collection._embedded as { items?: unknown[] } | undefined
    if (embedded?.items) embedded.items.push(item)
    const links = collection._links as { items?: unknown[] } | undefined
    if (Array.isArray(links?.items))
      links.items.push({ href: (item._links as { self: { href: string } }).self.href })
  }

  private removeFromCollection(collection: Record<string, unknown>, uri: string): void {
    const selfOf = (value: unknown) =>
      this.options.normalizeUri(
        String(
          (value as { _links?: { self?: { href?: string } }; href?: string })._links?.self
            ?.href ?? (value as { href?: string }).href
        )
      )
    const embedded = collection._embedded as { items?: unknown[] } | undefined
    if (embedded?.items)
      embedded.items = embedded.items.filter((item) => selfOf(item) !== uri)
    const links = collection._links as { items?: unknown[] } | undefined
    if (links && Array.isArray(links.items))
      links.items = links.items.filter((link) => selfOf(link) !== uri)
  }
}
