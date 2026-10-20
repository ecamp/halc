import type { ApiError } from './errors.js'

/**
 * Lifecycle of a record in the store.
 *
 * - `placeholder`: the URI is known, but nothing has been requested yet
 * - `loading`: the first request for this URI is in flight
 * - `loaded`: the data is available (it may be reloading in the background)
 * - `stale`: the data is available, but outdated; the next read reloads it
 * - `error`: the last load failed; no request is sent until the record is reloaded or invalidated
 */
export type RecordStatus = 'placeholder' | 'loading' | 'loaded' | 'stale' | 'error'

export interface EntityMeta {
  /** Bumped on every write; used as cache key for wrappers. */
  version: number
  /** Entity type detected by the API adapter, e.g. `'Camp'`. */
  type?: string
  /** Internal: parameterised path for devtools and error messages, never used as a key. */
  resource?: string
  /** Epoch ms of the last successful load; undefined for placeholders. */
  loadedAt?: number
  status: RecordStatus
  /** Local optimistic changes, not yet confirmed by the API. Read on top of `data`. */
  dirty?: Record<string, unknown>
  /** Set while a DELETE request for this record is in flight. */
  deleting?: boolean
  /** The error of the last failed load or mutation. */
  error?: ApiError
  /** Reserved for HTTP revalidation, unused in 1.0. */
  etag?: string
  /** Reserved for HTTP revalidation, unused in 1.0. */
  lastModified?: string
  /** Reserved for HTTP revalidation, unused in 1.0. */
  freshUntil?: number
  /** Reserved for pagination, unused in 1.0. */
  pages?: string[]
  /** Reserved for pagination, unused in 1.0. */
  totalItems?: number
}

/** A partial update of {@link EntityMeta}; `undefined` removes a field. */
export type MetaPatch = { [K in keyof EntityMeta]?: EntityMeta[K] | undefined }

/** Applies a {@link MetaPatch}, returning a new meta object without `undefined` fields. */
export function applyMetaPatch(meta: EntityMeta, patch: MetaPatch): EntityMeta {
  const result: Record<string, unknown> = { ...meta, ...patch }
  return Object.fromEntries(
    Object.entries(result).filter(([, value]) => value !== undefined)
  ) as unknown as EntityMeta
}

/**
 * What the store holds: one record per URI. Records are plain, serializable data and are
 * treated as immutable: every write replaces the record object.
 */
export interface EntityRecord {
  /** Normalized self link, the primary key. */
  uri: string
  /** Own properties; relations are replaced by {@link RelationRef}s. */
  data: Record<string, unknown>
  meta: EntityMeta
}

/** A link to a single related resource. */
export interface LinkRef {
  href: string
}

/** A templated link (RFC 6570), stored unexpanded. */
export interface TemplatedLinkRef {
  href: string
  templated: true
}

/** An embedded or linked list of resources, which has no URI of its own. */
export interface CollectionRef {
  hrefs: string[]
}

export type RelationRef = LinkRef | TemplatedLinkRef | CollectionRef

function hasExactKeys(value: object, keys: string[]): boolean {
  const ownKeys = Object.keys(value)
  return ownKeys.length === keys.length && keys.every((key) => key in value)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isLinkRef(value: unknown): value is LinkRef {
  return (
    isObject(value) && typeof value.href === 'string' && hasExactKeys(value, ['href'])
  )
}

export function isTemplatedLinkRef(value: unknown): value is TemplatedLinkRef {
  return (
    isObject(value) &&
    typeof value.href === 'string' &&
    value.templated === true &&
    hasExactKeys(value, ['href', 'templated'])
  )
}

export function isCollectionRef(value: unknown): value is CollectionRef {
  return isObject(value) && Array.isArray(value.hrefs) && hasExactKeys(value, ['hrefs'])
}

export function isRelationRef(value: unknown): value is RelationRef {
  return isLinkRef(value) || isTemplatedLinkRef(value) || isCollectionRef(value)
}

/** A record is a collection if its `items` property is a {@link CollectionRef}. */
export function isCollectionRecord(record: EntityRecord): boolean {
  return isCollectionRef(currentData(record).items)
}

/** The data of a record as clients see it: confirmed data with local optimistic changes on top. */
export function currentData(record: EntityRecord): Record<string, unknown> {
  return record.meta.dirty ? { ...record.data, ...record.meta.dirty } : record.data
}

/** The value of a single property as clients see it, without copying the whole data object. */
export function currentValue(record: EntityRecord, key: string): unknown {
  const dirty = record.meta.dirty
  if (dirty && key in dirty) return dirty[key]
  return record.data[key]
}

/** Creates a record for a URI that is known, but not loaded. */
export function placeholderRecord(
  uri: string,
  status: 'placeholder' | 'loading' = 'placeholder'
): EntityRecord {
  return { uri, data: {}, meta: { version: 0, status } }
}

export function isLoaded(record: EntityRecord | undefined): boolean {
  return record?.meta.loadedAt !== undefined
}
