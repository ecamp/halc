import type {
  ApiAdapter,
  HttpTransport,
  ReactivityAdapter,
  RequestInterceptor,
  StoreAdapter,
} from './adapters.js'
import type { ApiError } from './errors.js'
import type { PendingMutation } from './mutations.js'
import type { RecordStatus, RelationRef } from './records.js'
import type { RetryOptions } from './retry.js'

/**
 * Maps type names to wrapper types. Empty by default, so every entity is the generic
 * {@link Resource}. Augment it (by hand or with generated code) to get property completion:
 *
 * ```ts
 * declare module 'halc' {
 *   interface ResourceMap {
 *     Camp: Entity<{ title: string }, { activities: Collection<'Activity'>; creator: 'User' }>
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ResourceMap {}

/** All type names known from {@link ResourceMap}. */
export type TypeName = Extract<keyof ResourceMap, string>

/** The wrapper type for a type name. */
export type Of<K> = K extends TypeName ? ResourceMap[K] : Resource

type TemplateValue = string | number | boolean | null | undefined
export type TemplateParams = Record<
  string,
  TemplateValue | TemplateValue[] | Record<string, TemplateValue>
>

/** Anything that identifies a resource: a URI or a wrapper. */
export type UriOrEntity = string | { readonly _meta: { readonly self: string | null } }

export interface ResourceMeta<Self = Resource> {
  /** Normalized URI of the resource (the API base URL removed). */
  readonly self: string
  /** Absolute URL of the resource. */
  readonly selfUrl: string
  /**
   * Resolves to the loaded wrapper, rejects with an {@link ApiError} if loading fails. While a
   * loaded entity is reloading, resolves when the reload is done.
   */
  readonly load: Promise<Self>
  /** True until the first load finished. A reload of a loaded entity does not set it. */
  readonly loading: boolean
  readonly status: RecordStatus | undefined
  /** Type detected by the API adapter, e.g. `'Camp'`. */
  readonly type: string | undefined
  /** The raw relations of the entity. */
  readonly links: Readonly<Record<string, RelationRef>>
  /** Local optimistic changes not yet confirmed by the API. */
  readonly dirty: Readonly<Record<string, unknown>> | undefined
  /** True while a DELETE request for this resource is in flight. */
  readonly deleting: boolean
  /** The error of the last failed load or mutation. */
  readonly error: ApiError | undefined
  /** True for embedded collections without a URI of their own. */
  readonly virtual: boolean
}

export interface MutationOptions {
  /** Apply the change locally before the API confirms it. Defaults to the client option. */
  optimistic?: boolean
}

export interface PatchOptions extends MutationOptions {
  /** Send all given fields, even the ones that did not change. */
  force?: boolean
}

export interface PostOptions extends MutationOptions {
  /** Reload the collection after a successful POST. Default true. */
  reload?: boolean
}

export interface ResourceApi<Self = Resource, Props = Record<string, unknown>> {
  readonly _meta: ResourceMeta<Self>
  $reload(): Promise<Self>
  $post(data: Record<string, unknown>, options?: PostOptions): Promise<Resource | null>
  $patch(data: Partial<Props>, options?: PatchOptions): Promise<Self>
  $del(options?: MutationOptions): Promise<void>
  /** URI of a relation, waiting for this resource to load if necessary. */
  $href(relation: string, params?: TemplateParams): Promise<string | undefined>
  /** Every URI of a to-many relation, without loading the related resources. */
  $hrefs(relation: string): Promise<string[]>
  /** URI of a relation if this resource is loaded, undefined otherwise. Never sends a request. */
  $hrefSync(relation: string, params?: TemplateParams): string | undefined
  /** Every URI of a to-many relation if it is available without a request, undefined otherwise. */
  $hrefsSync(relation: string): string[] | undefined
  /** Resolves when every item of this collection settled. Rejects for non-collections. */
  $loadItems(): Promise<Self>
  /** Follows a relation by name, for names that are not valid identifiers (e.g. CURIEs). */
  $rel(relation: string, params?: TemplateParams): Resource
  /** Casts this wrapper to the wrapper type of a type name. Does nothing at runtime. */
  as<K extends TypeName>(): Of<K>
  toJSON(): Record<string, unknown>
}

export interface CollectionApi<Item = Resource> {
  /** The items, without the ones currently being deleted. Never undefined. */
  readonly items: readonly Item[]
  /** All items, including the ones currently being deleted. */
  readonly allItems: readonly Item[]
}

/** The generic wrapper type, used when no {@link ResourceMap} entry exists. */
export interface Resource extends ResourceApi, CollectionApi {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly [property: string]: any
}

declare const templatedMarker: unique symbol

/** Relation spec for a templated link in a {@link ResourceMap} entry. */
export interface Templated<T, Params = TemplateParams> {
  readonly [templatedMarker]: [T, Params]
}

type RelationTarget<T> = T extends string ? Of<T> : T

type RelationFunctions<R> = {
  readonly [K in keyof R]: R[K] extends Templated<infer T, infer Params>
    ? (params?: Params) => RelationTarget<T>
    : () => RelationTarget<R[K]>
}

/**
 * Wrapper type of an entity with properties `P` and relations `R`. A relation is a type name
 * (to-one), a {@link Collection} (to-many) or a {@link Templated} link.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type Entity<P, R = {}> = Readonly<P> &
  RelationFunctions<R> &
  ResourceApi<Entity<P, R>, P>

/** Wrapper type of a collection of the given type. */
export type Collection<T = Resource> = ResourceApi<Collection<T>> &
  CollectionApi<RelationTarget<T>>

export interface HalcOptions {
  /** Converts between the wire format and records, e.g. `hal` from `halc/hal`. */
  adapter: ApiAdapter
  /** Absolute URL of the API root, e.g. `https://example.com/api`. */
  baseUrl?: string
  /** Where records live. Defaults to a new `MemoryStore`. */
  store?: StoreAdapter
  /** Who is notified about changes. Defaults to no-op reactivity. */
  reactivity?: ReactivityAdapter
  /** Sends requests. Defaults to a `fetch` based transport. */
  transport?: HttpTransport
  /** Headers sent with every request, on top of `Accept`. */
  headers?: Record<string, string>
  /** Functions that may modify every outgoing request (auth, locale, …). */
  interceptors?: RequestInterceptor[]
  /** Retry policy for GET requests, `false` disables retries. */
  retry?: RetryOptions | false
  /** Apply mutations locally before the API confirms them. Default true. */
  optimistic?: boolean
  /**
   * When items of a collection are not loaded, reload the collection (hoping the API embeds
   * them) before loading every item on its own. Default true.
   */
  avoidNPlusOneRequests?: boolean
  /** Store a GET response under the requested URI, even if its self link differs. */
  forceRequestedSelfLink?: boolean
}

export type { PendingMutation }

export interface Client {
  /**
   * Returns the wrapper for a URI. Loads the resource from the API if it is not in the store,
   * in which case a placeholder is returned that turns into the real thing once loaded.
   * Without argument, returns the API root.
   */
  get<K extends TypeName | undefined = undefined>(
    uriOrEntity?: UriOrEntity
  ): K extends TypeName ? Of<K> : Resource
  /** Reloads a resource from the API, resolving to the updated wrapper. */
  reload<K extends TypeName | undefined = undefined>(
    uriOrEntity: UriOrEntity
  ): Promise<K extends TypeName ? Of<K> : Resource>
  /** Creates a resource in a collection. Resolves to the created resource. */
  post(
    uriOrCollection: UriOrEntity,
    data: Record<string, unknown>,
    options?: PostOptions
  ): Promise<Resource | null>
  /** Updates the given fields of a resource; sends only fields that changed. */
  patch(
    uriOrEntity: UriOrEntity,
    data: Record<string, unknown>,
    options?: PatchOptions
  ): Promise<Resource>
  /** Deletes a resource and reloads everything that referenced it. */
  del(uriOrEntity: UriOrEntity, options?: MutationOptions): Promise<void>
  /** URI of a relation of a resource, loading the resource if necessary. */
  href(
    uriOrEntity: UriOrEntity,
    relation: string,
    params?: TemplateParams
  ): Promise<string | undefined>
  /** Marks a resource as outdated, so the next read reloads it. Clears a sticky error. */
  invalidate(uriOrEntity: UriOrEntity): void
  /** Removes a resource from the store, without telling the API. */
  purge(uriOrEntity: UriOrEntity): void
  /** Removes everything from the store, without telling the API. */
  purgeAll(): void
  /** True if the store knows nothing about this URI. */
  isUnknown(uri: string): boolean
  /** The status of the record for this URI, undefined if unknown. */
  status(uri: string): RecordStatus | undefined
  /** Mutations that are waiting for the API. */
  readonly pendingMutations: readonly PendingMutation[]
  readonly store: StoreAdapter
  readonly adapter: ApiAdapter
  readonly reactivity: ReactivityAdapter
  readonly options: Readonly<HalcOptions>
  /**
   * Replaces the reactivity adapter. For framework integrations like `halc/vue`; call it before
   * reading anything.
   */
  setReactivity(reactivity: ReactivityAdapter): void
  /** Normalizes a URI the same way the store keys are normalized. */
  normalizeUri(uri: string): string
}
