import type { HalcClient } from './client.js'
import { ApiError } from './errors.js'
import {
  currentData,
  currentValue,
  isCollectionRef,
  isLoaded,
  isRelationRef,
  type EntityRecord,
  type RecordStatus,
  type RelationRef,
} from './records.js'
import type {
  MutationOptions,
  PatchOptions,
  PostOptions,
  Resource,
  ResourceMeta,
  TemplateParams,
} from './types.js'

/** Internal state of a wrapper, behind a symbol so it never shows up in spreads or JSON. */
export const INTERNAL = Symbol('halc')

interface ResourceInternals {
  client: HalcClient
  uri: string
  meta?: ResourceMetaView
  relations?: Map<string, (params?: TemplateParams) => Resource>
}

interface VirtualInternals {
  client: HalcClient
  ownerUri: string
  relation: string
  meta?: VirtualMetaView
}

export const EMPTY_ITEMS: readonly Resource[] = Object.freeze([])

function relationsOf(record: EntityRecord | undefined): Record<string, RelationRef> {
  const links: Record<string, RelationRef> = {}
  if (!record) return links
  for (const [key, value] of Object.entries(currentData(record))) {
    if (isRelationRef(value)) links[key] = value
  }
  return links
}

function isPending(status: RecordStatus | undefined): boolean {
  return status === undefined || status === 'placeholder' || status === 'loading'
}

class ResourceMetaView implements ResourceMeta {
  constructor(
    private readonly client: HalcClient,
    readonly self: string
  ) {}

  private get record(): EntityRecord | undefined {
    this.client.reactivity.track(this.self)
    return this.client.store.get(this.self)
  }

  get selfUrl(): string {
    return this.client.resolveUrl(this.self)
  }

  get load(): Promise<Resource> {
    return this.client.loadPromise(this.self)
  }

  get loading(): boolean {
    const record = this.record
    return !isLoaded(record) && isPending(record?.meta.status)
  }

  get status(): RecordStatus | undefined {
    return this.record?.meta.status
  }

  get type(): string | undefined {
    return this.record?.meta.type ?? this.client.adapter.typeOf(this.self)
  }

  get links(): Readonly<Record<string, RelationRef>> {
    return relationsOf(this.record)
  }

  get dirty(): Readonly<Record<string, unknown>> | undefined {
    return this.record?.meta.dirty
  }

  get deleting(): boolean {
    return this.record?.meta.deleting ?? false
  }

  get error(): ApiError | undefined {
    return this.record?.meta.error
  }

  get virtual(): boolean {
    return false
  }
}

/** Methods shared by every resource wrapper. Data properties are own getters per instance. */
class ResourceWrapper {
  declare readonly [INTERNAL]: ResourceInternals

  constructor(internals: ResourceInternals) {
    Object.defineProperty(this, INTERNAL, { value: internals })
  }

  get _meta(): ResourceMeta {
    const internals = this[INTERNAL]
    return (internals.meta ??= new ResourceMetaView(internals.client, internals.uri))
  }

  get items(): readonly Resource[] {
    const { client, uri } = this[INTERNAL]
    return client.collectionItems(uri, false)
  }

  get allItems(): readonly Resource[] {
    const { client, uri } = this[INTERNAL]
    return client.collectionItems(uri, true)
  }

  $reload(): Promise<Resource> {
    const { client, uri } = this[INTERNAL]
    return client.reload(uri)
  }

  $post(data: Record<string, unknown>, options?: PostOptions): Promise<Resource | null> {
    const { client, uri } = this[INTERNAL]
    return client.post(uri, data, options)
  }

  $patch(data: Record<string, unknown>, options?: PatchOptions): Promise<Resource> {
    const { client, uri } = this[INTERNAL]
    return client.patch(uri, data, options)
  }

  $del(options?: MutationOptions): Promise<void> {
    const { client, uri } = this[INTERNAL]
    return client.del(uri, options)
  }

  $href(relation: string, params?: TemplateParams): Promise<string | undefined> {
    const { client, uri } = this[INTERNAL]
    return client.href(uri, relation, params)
  }

  $hrefs(relation: string): Promise<string[]> {
    const { client, uri } = this[INTERNAL]
    return client.hrefs(uri, relation)
  }

  $hrefSync(relation: string, params?: TemplateParams): string | undefined {
    const { client, uri } = this[INTERNAL]
    return client.hrefSync(uri, relation, params)
  }

  $hrefsSync(relation: string): string[] | undefined {
    const { client, uri } = this[INTERNAL]
    return client.hrefsSync(uri, relation)
  }

  $loadItems(): Promise<Resource> {
    const { client, uri } = this[INTERNAL]
    return client.loadItems(uri)
  }

  $rel(relation: string, params?: TemplateParams): Resource {
    const { client, uri } = this[INTERNAL]
    return client.followRelation(uri, relation, params)
  }

  as(): this {
    return this
  }

  toJSON(): Record<string, unknown> {
    const { client, uri } = this[INTERNAL]
    const record = client.store.get(uri)
    return record
      ? { ...currentData(record), _meta: { self: uri } }
      : { _meta: { self: uri } }
  }
}

function relationAccessor(
  wrapper: ResourceWrapper,
  key: string
): (params?: TemplateParams) => Resource {
  const internals = wrapper[INTERNAL]
  internals.relations ??= new Map()
  let accessor = internals.relations.get(key)
  if (!accessor) {
    accessor = (params?: TemplateParams) =>
      internals.client.followRelation(internals.uri, key, params)
    internals.relations.set(key, accessor)
  }
  return accessor
}

function readProperty(wrapper: ResourceWrapper, key: string): unknown {
  const { client, uri } = wrapper[INTERNAL]
  client.reactivity.track(uri)
  const record = client.store.get(uri)
  if (!record) return undefined
  const value = currentValue(record, key)
  return isRelationRef(value) ? relationAccessor(wrapper, key) : value
}

const propertyDescriptors = new Map<string, PropertyDescriptor>()

function propertyDescriptor(key: string): PropertyDescriptor {
  let descriptor = propertyDescriptors.get(key)
  if (!descriptor) {
    descriptor = {
      get(this: ResourceWrapper) {
        return readProperty(this, key)
      },
      enumerable: true,
      configurable: true,
    }
    propertyDescriptors.set(key, descriptor)
  }
  return descriptor
}

const RESERVED_KEYS = new Set(['_meta', 'items', 'allItems'])

/** Builds and caches wrapper classes per entity type. */
export class WrapperFactory {
  private readonly classes = new Map<string, typeof ResourceWrapper>()
  private readonly descriptorSets = new Map<string, PropertyDescriptorMap>()

  constructor(private readonly client: HalcClient) {}

  create(uri: string, record: EntityRecord): Resource {
    const type = record.meta.type ?? ''
    const Wrapper = this.classFor(type)
    const wrapper = new Wrapper({ client: this.client, uri })
    const keys = Object.keys(currentData(record)).filter((key) => !RESERVED_KEYS.has(key))
    Object.defineProperties(wrapper, this.descriptorsFor(keys))
    return (this.client.reactivity.markRaw?.(wrapper) ?? wrapper) as unknown as Resource
  }

  private classFor(type: string): typeof ResourceWrapper {
    let Wrapper = this.classes.get(type)
    if (!Wrapper) {
      Wrapper = class extends ResourceWrapper {}
      Object.defineProperty(Wrapper, 'name', { value: type || 'Resource' })
      this.classes.set(type, Wrapper)
    }
    return Wrapper
  }

  private descriptorsFor(keys: string[]): PropertyDescriptorMap {
    const cacheKey = keys.join('\u0000')
    let descriptors = this.descriptorSets.get(cacheKey)
    if (!descriptors) {
      descriptors = Object.fromEntries(keys.map((key) => [key, propertyDescriptor(key)]))
      this.descriptorSets.set(cacheKey, descriptors)
    }
    return descriptors
  }
}

class VirtualMetaView implements ResourceMeta {
  constructor(private readonly internals: VirtualInternals) {}

  private get owner(): EntityRecord | undefined {
    const { client, ownerUri } = this.internals
    client.reactivity.track(ownerUri)
    return client.store.get(ownerUri)
  }

  get self(): string {
    return `${this.internals.ownerUri}#${this.internals.relation}`
  }

  get selfUrl(): string {
    const { client, ownerUri, relation } = this.internals
    return `${client.resolveUrl(ownerUri)}#${relation}`
  }

  get load(): Promise<Resource> {
    const { client, ownerUri, relation } = this.internals
    return client
      .loadPromise(ownerUri)
      .then(() => client.followRelation(ownerUri, relation))
  }

  get loading(): boolean {
    return !isLoaded(this.owner)
  }

  get status(): RecordStatus | undefined {
    return this.owner?.meta.status
  }

  get type(): string | undefined {
    const { client } = this.internals
    const first = this.hrefs[0]
    return first === undefined
      ? undefined
      : (client.store.get(first)?.meta.type ?? client.adapter.typeOf(first))
  }

  get links(): Readonly<Record<string, RelationRef>> {
    return {}
  }

  get dirty(): Readonly<Record<string, unknown>> | undefined {
    const dirty = this.owner?.meta.dirty
    return dirty && this.internals.relation in dirty ? dirty : undefined
  }

  get deleting(): boolean {
    return false
  }

  get error(): ApiError | undefined {
    return this.owner?.meta.error
  }

  get virtual(): boolean {
    return true
  }

  get hrefs(): string[] {
    const owner = this.owner
    const value = owner && currentValue(owner, this.internals.relation)
    return isCollectionRef(value) ? value.hrefs : []
  }
}

function rejectVirtual(operation: string): Promise<never> {
  return Promise.reject(
    new Error(
      `${operation} is not implemented for virtual resources (embedded collections without a URI of their own)`
    )
  )
}

/**
 * An embedded or linked list of resources without a URI of its own, e.g. `camp.periods()` when
 * the API embeds the periods into the camp. Its items live in the owner's record, so reloading
 * it reloads the owner.
 */
class VirtualCollectionWrapper {
  declare readonly [INTERNAL]: VirtualInternals

  constructor(internals: VirtualInternals) {
    Object.defineProperty(this, INTERNAL, { value: internals })
  }

  get _meta(): ResourceMeta {
    const internals = this[INTERNAL]
    return (internals.meta ??= new VirtualMetaView(internals))
  }

  get items(): readonly Resource[] {
    const { client, ownerUri, relation } = this[INTERNAL]
    return client.virtualItems(ownerUri, relation, false)
  }

  get allItems(): readonly Resource[] {
    const { client, ownerUri, relation } = this[INTERNAL]
    return client.virtualItems(ownerUri, relation, true)
  }

  $reload(): Promise<Resource> {
    const { client, ownerUri, relation } = this[INTERNAL]
    return client.reload(ownerUri).then(() => client.followRelation(ownerUri, relation))
  }

  $post(): Promise<never> {
    return rejectVirtual('post')
  }

  $patch(): Promise<never> {
    return rejectVirtual('patch')
  }

  $del(): Promise<never> {
    return rejectVirtual('del')
  }

  $href(relation: string): Promise<string | undefined> {
    return this._meta.load.then(() => this.$hrefSync(relation))
  }

  $hrefs(relation: string): Promise<string[]> {
    return this._meta.load.then(() => this.$hrefsSync(relation) ?? [])
  }

  $hrefSync(relation: string): string | undefined {
    return relation === 'self' ? this._meta.self : undefined
  }

  $hrefsSync(relation: string): string[] | undefined {
    const meta = this._meta as VirtualMetaView
    return relation === 'items' && !meta.loading ? [...meta.hrefs] : undefined
  }

  $loadItems(): Promise<Resource> {
    const { client, ownerUri, relation } = this[INTERNAL]
    return client.loadVirtualItems(ownerUri, relation)
  }

  $rel(): Resource {
    throw new Error('Virtual resources have no relations')
  }

  as(): this {
    return this
  }

  toJSON(): Record<string, unknown> {
    return {
      items: (this._meta as VirtualMetaView).hrefs,
      _meta: { self: this._meta.self },
    }
  }
}

export function createVirtualCollection(
  client: HalcClient,
  ownerUri: string,
  relation: string
): Resource {
  const wrapper = new VirtualCollectionWrapper({ client, ownerUri, relation })
  return (client.reactivity.markRaw?.(wrapper) ?? wrapper) as unknown as Resource
}

/** How a placeholder finds out what it stands for. */
interface PlaceholderSource {
  client: HalcClient
  /** The URI, if known. Unknown for relations of placeholders. */
  uri: string | undefined
  /** The real wrapper once available, an error if it never will be, undefined while loading. */
  resolve(): { wrapper: Resource } | { error: ApiError } | undefined
  load(): Promise<Resource>
  reload(): Promise<Resource>
}

const placeholderSources = new WeakMap<object, PlaceholderSource>()
const deferredCache = new WeakMap<object, Map<string, Resource>>()

export function isPlaceholder(value: unknown): boolean {
  return typeof value === 'object' && value !== null && placeholderSources.has(value)
}

function emptyString(): string {
  return ''
}

class PlaceholderMeta implements ResourceMeta {
  constructor(private readonly source: PlaceholderSource) {}

  private get resolution(): ReturnType<PlaceholderSource['resolve']> {
    return this.source.resolve()
  }

  get self(): string {
    return this.source.uri as string
  }

  get selfUrl(): string {
    const { uri, client } = this.source
    return (uri === undefined ? null : client.resolveUrl(uri)) as string
  }

  get load(): Promise<Resource> {
    return this.source.load()
  }

  get loading(): boolean {
    const resolution = this.resolution
    return !(resolution && 'error' in resolution)
  }

  get status(): RecordStatus | undefined {
    const { uri, client } = this.source
    return uri === undefined ? undefined : client.store.get(uri)?.meta.status
  }

  get type(): string | undefined {
    const { uri, client } = this.source
    if (uri === undefined) return undefined
    return client.store.get(uri)?.meta.type ?? client.adapter.typeOf(uri)
  }

  get links(): Readonly<Record<string, RelationRef>> {
    return {}
  }

  get dirty(): undefined {
    return undefined
  }

  get deleting(): boolean {
    return false
  }

  get error(): ApiError | undefined {
    const resolution = this.resolution
    return resolution && 'error' in resolution ? resolution.error : undefined
  }

  get virtual(): boolean {
    return false
  }
}

const DELEGATED_METHODS = new Set([
  '$post',
  '$patch',
  '$del',
  '$href',
  '$hrefs',
  '$loadItems',
])

/**
 * Creates a stand-in for a resource that is not loaded yet. It renders as an empty string, its
 * `items` are empty, and any unknown property is a relation function returning another
 * placeholder, so `api.get(uri).camp().periods().items` works before anything is loaded. Once
 * the resource is available, every read is forwarded to the real wrapper.
 */
function createPlaceholder(source: PlaceholderSource): Resource {
  const target = Object.create(null) as Record<PropertyKey, unknown>
  const accessors = new Map<string, (params?: TemplateParams) => Resource>()
  let meta: PlaceholderMeta | undefined

  const proxy: Resource = new Proxy(target, {
    get(target, property) {
      if (property in target) return target[property]
      const resolution = source.resolve()
      if (resolution && 'wrapper' in resolution) {
        return Reflect.get(resolution.wrapper, property) as unknown
      }
      if (typeof property === 'symbol') {
        return property === Symbol.toPrimitive ? emptyString : undefined
      }
      if (DELEGATED_METHODS.has(property)) {
        return (...args: unknown[]) =>
          source
            .load()
            .then((wrapper) =>
              (wrapper[property] as (...a: unknown[]) => unknown)(...args)
            )
      }
      switch (property) {
        case '_meta':
          return (meta ??= new PlaceholderMeta(source))
        case 'items':
        case 'allItems':
          return EMPTY_ITEMS
        case '$reload':
          return () => source.reload()
        case '$hrefSync':
        case '$hrefsSync':
          return () => undefined
        case '$rel':
          return (relation: string, params?: TemplateParams) =>
            createDeferred(proxy, relation, params)
        case 'as':
          return () => proxy
        case 'toJSON':
          return () => ({})
        case 'toString':
          return emptyString
        case 'then':
        case 'constructor':
          return undefined
      }
      // Vue and other frameworks probe objects for internal flags; those are not relations.
      if (property.startsWith('__')) return undefined

      let accessor = accessors.get(property)
      if (!accessor) {
        accessor = (params?: TemplateParams) => createDeferred(proxy, property, params)
        Object.defineProperty(accessor, 'toString', { value: emptyString })
        accessors.set(property, accessor)
      }
      return accessor
    },
    has(target, property) {
      const resolution = source.resolve()
      if (resolution && 'wrapper' in resolution) return property in resolution.wrapper
      return property in target || property === '_meta' || property === 'items'
    },
    ownKeys(target) {
      const resolution = source.resolve()
      const keys = Reflect.ownKeys(target)
      if (resolution && 'wrapper' in resolution) {
        for (const key of Reflect.ownKeys(resolution.wrapper)) {
          if (!keys.includes(key)) keys.push(key)
        }
      }
      return keys
    },
    getOwnPropertyDescriptor(target, property) {
      const own = Reflect.getOwnPropertyDescriptor(target, property)
      if (own) return own
      const resolution = source.resolve()
      if (!resolution || !('wrapper' in resolution)) return undefined
      const descriptor = Reflect.getOwnPropertyDescriptor(resolution.wrapper, property)
      if (!descriptor) return undefined
      // Proxy invariants forbid reporting non-configurable properties the target doesn't have.
      // Report the current value instead of the getter, since the getter needs the real wrapper.
      return {
        value: Reflect.get(resolution.wrapper, property) as unknown,
        enumerable: descriptor.enumerable ?? false,
        configurable: true,
        writable: false,
      }
    },
  }) as unknown as Resource

  placeholderSources.set(proxy, source)
  return source.client.reactivity.markRaw?.(proxy) ?? proxy
}

/** A placeholder for a URI whose record is not loaded (yet). */
export function createUriPlaceholder(client: HalcClient, uri: string): Resource {
  return createPlaceholder({
    client,
    uri,
    resolve() {
      client.reactivity.track(uri)
      const record = client.store.get(uri)
      if (isLoaded(record)) return { wrapper: client.wrapperFor(uri) }
      const error = record?.meta.status === 'error' ? record.meta.error : undefined
      return error ? { error } : undefined
    },
    load: () => client.loadPromise(uri),
    reload: () => client.reload(uri),
  })
}

function resolutionOf(
  value: Resource
): { wrapper: Resource } | { error: ApiError } | undefined {
  const source = placeholderSources.get(value)
  return source ? source.resolve() : { wrapper: value }
}

function notARelation(parent: Resource, relation: string): ApiError {
  const self = parent._meta.self
  return new ApiError(
    `Property '${relation}' of '${self}' was used like a relation, but the API returned no relation with this name`,
    { method: 'GET', uri: self, type: parent._meta.type }
  )
}

/** A placeholder for a relation of a resource that is not loaded yet. */
function createDeferred(
  parent: Resource,
  relation: string,
  params: TemplateParams | undefined
): Resource {
  const cacheKey = `${relation}\u0000${JSON.stringify(params ?? null)}`
  let cache = deferredCache.get(parent)
  const cached = cache?.get(cacheKey)
  if (cached) return cached

  const client = (placeholderSources.get(parent) as PlaceholderSource).client

  const follow = (wrapper: Resource): Resource | ApiError => {
    const accessor: unknown = wrapper[relation]
    if (typeof accessor !== 'function') return notARelation(wrapper, relation)
    return (accessor as (params?: TemplateParams) => Resource)(params)
  }

  const deferred = createPlaceholder({
    client,
    uri: undefined,
    resolve() {
      const resolution = resolutionOf(parent)
      if (!resolution || 'error' in resolution) return resolution
      const result = follow(resolution.wrapper)
      return result instanceof ApiError ? { error: result } : { wrapper: result }
    },
    load: () =>
      parent._meta.load.then((wrapper) => {
        const result = follow(wrapper)
        if (result instanceof ApiError) throw result
        return result._meta.load
      }),
    reload: () => deferred._meta.load.then((wrapper) => wrapper.$reload()),
  })

  if (!cache) {
    cache = new Map()
    deferredCache.set(parent, cache)
  }
  cache.set(cacheKey, deferred)
  return deferred
}
