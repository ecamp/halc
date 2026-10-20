/**
 * Sorts the query parameters of a URI by key, keeping the order of values of duplicate keys,
 * and drops an empty query string. `/a?b=1&a=2&b=0` becomes `/a?a=2&b=1&b=0`.
 */
export function sortQueryParams(uri: string): string {
  const hashStart = uri.indexOf('#')
  const fragment = hashStart === -1 ? '' : uri.slice(hashStart)
  const withoutFragment = hashStart === -1 ? uri : uri.slice(0, hashStart)

  const queryStart = withoutFragment.indexOf('?')
  if (queryStart === -1) return uri

  const path = withoutFragment.slice(0, queryStart)
  const query = new URLSearchParams(withoutFragment.slice(queryStart + 1))
  const sorted = new URLSearchParams()
  for (const key of [...new Set(query.keys())].sort()) {
    for (const value of query.getAll(key)) sorted.append(key, value)
  }

  const sortedQuery = sorted.toString()
  return `${path}${sortedQuery ? `?${sortedQuery}` : ''}${fragment}`
}

function parseAbsolute(uri: string): URL | undefined {
  if (!/^[a-z][a-z\d+\-.]*:/i.test(uri)) return undefined
  try {
    return new URL(uri)
  } catch {
    return undefined
  }
}

function stripPathPrefix(uri: string, prefix: string): string {
  if (!prefix || !uri.startsWith(prefix)) return uri
  const rest = uri.slice(prefix.length)
  if (rest === '' || /^[/?#]/.test(rest)) return rest
  return uri
}

export type UriNormalizer = (uri: string) => string

/**
 * Creates the function that turns any URI the API hands out into the key of a record:
 * the API base URL (origin and path prefix) is removed, query parameters are sorted, and the
 * API root is always the empty string.
 *
 * With `baseUrl = 'https://example.com/api'`, the URIs `https://example.com/api/camps/1?b=1&a=2`
 * and `/api/camps/1?a=2&b=1` both normalize to `/camps/1?a=2&b=1`, and `/api/` to `''`.
 * URIs on other origins are only sorted.
 */
export function createUriNormalizer(baseUrl: string | null | undefined): UriNormalizer {
  const base = baseUrl ? parseAbsolute(baseUrl) : undefined
  const origin = base?.origin
  const pathPrefix = (base ? base.pathname : (baseUrl ?? '')).replace(/\/+$/, '')

  return (uri: string): string => {
    let normalized = sortQueryParams(uri)

    const absolute = parseAbsolute(normalized)
    if (absolute) {
      if (absolute.origin !== origin) return normalized
      const relative = normalized.slice(absolute.origin.length)
      const stripped = stripPathPrefix(relative, pathPrefix)
      // Same origin, but outside the API: only an absolute URL resolves to it correctly.
      if (stripped === relative && pathPrefix) return normalized
      normalized = relative
    }

    normalized = stripPathPrefix(normalized, pathPrefix)
    if (
      normalized === '/' ||
      normalized.startsWith('/?') ||
      normalized.startsWith('/#')
    ) {
      normalized = normalized.slice(1)
    }
    return normalized
  }
}

/** Joins a normalized URI with the API base URL into an absolute URL for requests. */
export function createUrlResolver(
  baseUrl: string | null | undefined
): (uri: string) => string {
  const base = (baseUrl ?? '').replace(/\/+$/, '')
  return (uri: string): string => {
    const withoutFragment = uri.split('#')[0] ?? ''
    if (parseAbsolute(withoutFragment)) return withoutFragment
    if (withoutFragment === '' || withoutFragment.startsWith('?')) {
      return `${base}/${withoutFragment}`
    }
    return `${base}${withoutFragment}`
  }
}
