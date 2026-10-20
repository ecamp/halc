const BODY_EXCERPT_LENGTH = 500

export interface ApiErrorDetails {
  method: string
  uri: string
  url?: string | undefined
  status?: number | undefined
  type?: string | undefined
  headers?: Headers | undefined
  body?: string | undefined
  data?: unknown
  cause?: unknown
}

/**
 * Every failed request and every rejected operation of halc rejects with an ApiError, so callers
 * can rely on `method`, `uri` and (if a response was received) `status`.
 */
export class ApiError extends Error {
  override name = 'ApiError'
  /** HTTP method of the failed request. */
  readonly method: string
  /** Normalized URI of the resource. */
  readonly uri: string
  /** Absolute URL of the failed request, if one was sent. */
  readonly url: string | undefined
  /** HTTP status code, undefined if no response was received. */
  readonly status: number | undefined
  /** Detected entity type of the resource, if known. */
  readonly type: string | undefined
  /** Response headers, if a response was received. */
  readonly headers: Headers | undefined
  /** The beginning of the response body, for error messages and logs. */
  readonly bodyExcerpt: string | undefined
  /** The parsed JSON response body (e.g. problem details or validation violations), if any. */
  readonly data: unknown

  constructor(message: string, details: ApiErrorDetails) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause })
    this.method = details.method
    this.uri = details.uri
    this.url = details.url
    this.status = details.status
    this.type = details.type
    this.headers = details.headers
    this.bodyExcerpt = details.body?.slice(0, BODY_EXCERPT_LENGTH)
    this.data = details.data
  }

  /** Axios-like view of the response, to ease migrating error handling code from hal-json-vuex. */
  get response():
    { status: number; headers: Record<string, string>; data: unknown } | undefined {
    if (this.status === undefined) return undefined
    return {
      status: this.status,
      headers: Object.fromEntries(this.headers?.entries() ?? []),
      data: this.data,
    }
  }
}
