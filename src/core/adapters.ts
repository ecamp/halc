import type { EntityRecord, MetaPatch } from './records.js'

/**
 * A key-value table of {@link EntityRecord}s. The core never touches Pinia, Vuex or Vue directly,
 * it only talks to the store through this interface.
 */
export interface StoreAdapter {
  get(uri: string): EntityRecord | undefined
  has(uri: string): boolean
  /** Cache write after a response, one call per response. Never sends anything. */
  set(records: EntityRecord[]): void
  /** Merges into the meta of an existing record; `undefined` values remove a field. */
  patchMeta(uri: string, meta: MetaPatch): void
  remove(uris: string[]): void
  /** All records, for workers, SSR, devtools and persistence. */
  snapshot(): Record<string, EntityRecord>
  readonly readOnly: boolean
}

export interface Signal<T> {
  readonly value: T
}

/**
 * Tracks changes at exactly one granularity: the version of a record. Whole entities are never
 * made reactive.
 */
export interface ReactivityAdapter {
  /** One version signal per URI, created lazily. */
  signal(uri: string): Signal<number>
  /** Called by the core after a write to the record with this URI. */
  bump(uri: string): void
  /** Called by wrappers on every read, so a running reactive effect depends on this URI. */
  track(uri: string): void
  /** Called when a record is removed from the store, to free the signal. */
  release?(uri: string): void
  /** Excludes a wrapper from the framework's own deep reactivity, e.g. Vue's `markRaw`. */
  markRaw?<T extends object>(value: T): T
}

export interface NormalizeContext {
  /** Normalizes a URI found in the response the same way the client normalizes URIs. */
  normalizeUri(uri: string): string
}

/** Reserved seam for transparent pagination, unused in 1.0. */
export interface PaginationStrategy {
  /** Called for every normalized collection page. undefined = not paginated. */
  describe(page: EntityRecord): PageInfo | undefined
  /** Strips paging parameters so every page maps to one collection identity. */
  baseUri(uri: string): string
}

export interface PageInfo {
  totalItems?: number
  next?: string
  remaining?: string[]
}

export type MutationMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE'

/** Isolates the wire format. The core only ever sees {@link EntityRecord}s. */
export interface ApiAdapter {
  /** Value of the Accept header, e.g. `'application/hal+json'`. */
  readonly accept: string
  /** Media types accepted in successful responses. Defaults to `[accept]`. */
  readonly contentTypes?: readonly string[]
  /**
   * Turns a response body into records: the requested resource first, followed by every
   * embedded resource, each with its detected `meta.type`. The returned records must be new
   * objects; the client takes ownership and completes their meta in place.
   */
  normalize(
    uri: string,
    body: unknown,
    headers: Headers,
    context: NormalizeContext
  ): EntityRecord[]
  serialize(
    uri: string,
    data: Record<string, unknown>,
    method: MutationMethod
  ): { body: string; contentType: string }
  /** Derives the entity type from a (normalized) self link and the raw JSON fragment. */
  typeOf(selfLink: string, fragment?: unknown): string | undefined
  /** Extracts the self link of a response body. */
  readonly identity: (body: unknown) => string | undefined
  /** Reserved seam for transparent pagination, unused in 1.0. */
  readonly pagination?: PaginationStrategy
}

export interface HttpRequest {
  method: 'GET' | MutationMethod
  url: string
  headers: Record<string, string>
  body?: string
}

export interface HttpResponse {
  status: number
  headers: Headers
  /** The raw response body, empty for responses without a body. */
  body: string
}

/**
 * Sends requests. A transport resolves for every HTTP response, including error statuses, and
 * only rejects when no response was received (network error, CORS, aborted).
 */
export interface HttpTransport {
  request(request: HttpRequest): Promise<HttpResponse>
}

/** Modifies outgoing requests, e.g. to add authentication or locale headers. */
export type RequestInterceptor = (
  request: HttpRequest
) => HttpRequest | Promise<HttpRequest>
