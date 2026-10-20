import type { ApiAdapter, MutationMethod } from '../core/index.js'
import { normalizeHal } from './normalize.js'
import {
  defaultTypeRules,
  detectType,
  resourceOf,
  type TypeRule,
} from './typeDetection.js'

export interface HalAdapterOptions {
  /**
   * Ordered type detection rules, e.g.
   * `[{ match: /^\/invitations\/[^/]+\/find$/, type: 'Invitation' }, ...defaultTypeRules]`.
   */
  types?: readonly TypeRule[]
  /** Replaces type detection completely. */
  typeOf?: (selfLink: string, fragment: unknown) => string | undefined
  /** Content type of request bodies per method. PATCH defaults to JSON merge patch (RFC 7396). */
  contentTypes?: Partial<Record<MutationMethod, string>>
}

const defaultContentTypes: Record<MutationMethod, string> = {
  POST: 'application/json',
  PUT: 'application/json',
  PATCH: 'application/merge-patch+json',
  DELETE: 'application/json',
}

/** Creates an {@link ApiAdapter} for HAL (`application/hal+json`) APIs. */
export function createHalAdapter(options: HalAdapterOptions = {}): ApiAdapter {
  const rules = options.types ?? defaultTypeRules
  const typeOf =
    options.typeOf ??
    ((selfLink: string, fragment?: unknown) => detectType(selfLink, fragment, rules))
  const contentTypes = { ...defaultContentTypes, ...options.contentTypes }

  return {
    accept: 'application/hal+json',
    contentTypes: ['application/hal+json', 'application/json'],
    normalize: (uri, body, _headers, context) =>
      normalizeHal(uri, body, context, { typeOf, resourceOf }),
    serialize: (_uri, data, method) => ({
      body: JSON.stringify(data),
      contentType: contentTypes[method],
    }),
    typeOf,
    identity: (body) => {
      if (typeof body !== 'object' || body === null) return undefined
      const self = (body as { _links?: { self?: { href?: unknown } } })._links?.self?.href
      return typeof self === 'string' ? self : undefined
    },
  }
}

/** The HAL adapter with default options. */
export const hal: ApiAdapter = createHalAdapter()

export { HalFormatError, normalizeHal, type NormalizeOptions } from './normalize.js'
export {
  defaultTypeRules,
  detectType,
  isIdSegment,
  pathOf,
  pathTypeRule,
  resourceOf,
  singularize,
  type PathRuleOptions,
  type TypeRule,
} from './typeDetection.js'
