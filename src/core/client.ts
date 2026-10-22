import type {
  ApiAdapter,
  HttpRequest,
  HttpResponse,
  HttpTransport,
  MutationMethod,
  ReactivityAdapter,
  StoreAdapter,
} from './adapters.js'
import { ApiError } from './errors.js'
import { MemoryStore } from './memoryStore.js'
import {
  bodyForPost,
  diffForPatch,
  MutationQueue,
  type DiffContext,
  type PatchDiff,
} from './mutations.js'
import { noopReactivity } from './noopReactivity.js'
import {
  currentData,
  currentValue,
  isCollectionRecord,
  isCollectionRef,
  isLinkRef,
  isLoaded,
  isTemplatedLinkRef,
  plainData,
  type EntityMeta,
  type EntityRecord,
  type MetaPatch,
  type RecordStatus,
} from './records.js'
import {
  isRetryable,
  resolveRetryOptions,
  retryDelay,
  sleep,
  type ResolvedRetryOptions,
} from './retry.js'
import { expandTemplate } from './template.js'
import { createFetchTransport } from './transport.js'
import type {
  Client,
  HalcOptions,
  MutationOptions,
  PatchOptions,
  PendingMutation,
  PostOptions,
  Preprocessor,
  PreprocessorContext,
  Of,
  Resource,
  TemplateParams,
  TypeName,
  UriOrEntity,
} from './types.js'
import { createUriNormalizer, createUrlResolver, type UriNormalizer } from './uri.js'
import { deepFreeze } from './util.js'
import {
  createUriPlaceholder,
  createVirtualCollection,
  EMPTY_ITEMS,
  isPlaceholder,
  WrapperFactory,
} from './wrappers.js'

const TEMP_URI_PREFIX = 'urn:tmp:'

const BOUND_METHODS = [
  'get',
  'reload',
  'post',
  'patch',
  'del',
  'href',
  'invalidate',
  'purge',
  'purgeAll',
  'isUnknown',
  'status',
  'setReactivity',
] as const

function ignore(): void {
  // Errors of fire-and-forget work are recorded on the records, nobody needs to handle them here.
}

function mediaType(contentType: string | null): string | undefined {
  return contentType?.split(';')[0]?.trim().toLowerCase()
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown
  } catch {
    return undefined
  }
}

interface CachedWrapper {
  version: number
  wrapper: Resource
}

interface CachedItems {
  version: number
  generation: number
  items: readonly Resource[]
}

interface DerivedMemo {
  version: number
  dependencies: Map<string, number>
  value: Record<string, unknown>
}

/** The client implementation. Use {@link createHalc} to create one. */
export class HalcClient implements Client {
  readonly store: StoreAdapter
  readonly adapter: ApiAdapter
  readonly options: Readonly<HalcOptions>
  readonly normalizeUri: UriNormalizer
  readonly resolveUrl: (uri: string) => string
  private currentReactivity: ReactivityAdapter
  private readonly transport: HttpTransport
  private readonly retry: ResolvedRetryOptions
  private readonly queue = new MutationQueue()
  private readonly factory = new WrapperFactory(this)
  private readonly inflight = new Map<string, Promise<void>>()
  private readonly wrappers = new Map<string, CachedWrapper>()
  private readonly placeholders = new Map<string, Resource>()
  private readonly virtualWrappers = new Map<string, CachedWrapper>()
  private readonly itemsCache = new Map<string, CachedItems>()
  private readonly itemLoads = new Map<string, Promise<void>>()
  private readonly derivedMemos = new Map<string, DerivedMemo>()
  private readonly pendingPosts = new Map<string, Promise<string | null>>()
  private readonly diffContext: DiffContext
  /** Incremented on every store write; invalidates cached `items` arrays. */
  private generation = 0
  /** Source of record versions: never reused, also not after a record was purged. */
  private version = 0
  /**
   * Write fence: `epoch` counts writes that must win over responses of requests that were
   * already running (mutation results, invalidate, delete, purge). `touched` remembers the
   * epoch of the last such write per URI, `purgedAt` the one of the last `purgeAll`.
   */
  private epoch = 0
  private purgedAt = 0
  private readonly touched = new Map<string, number>()
  private readonly inflightSince = new Map<string, number>()

  constructor(options: HalcOptions) {
    this.options = options
    this.adapter = options.adapter
    this.store = options.store ?? new MemoryStore()
    this.currentReactivity = options.reactivity ?? noopReactivity
    this.transport = options.transport ?? createFetchTransport()
    this.retry = resolveRetryOptions(options.retry)
    // Like the functions of hal-json-vuex, the methods work when passed around on their own
    // (e.g. `const { get } = api` or `apiGet: api.get`).
    for (const method of BOUND_METHODS) {
      Object.defineProperty(this, method, {
        value: this[method].bind(this),
        writable: true,
      })
    }
    this.normalizeUri = createUriNormalizer(options.baseUrl)
    this.resolveUrl = createUrlResolver(options.baseUrl)
    this.diffContext = {
      normalizeUri: this.normalizeUri,
      iriOf: (self) => {
        const url = this.resolveUrl(self)
        try {
          const parsed = new URL(url)
          return `${parsed.pathname}${parsed.search}`
        } catch {
          return url
        }
      },
    }
  }

  get reactivity(): ReactivityAdapter {
    return this.currentReactivity
  }

  setReactivity(reactivity: ReactivityAdapter): void {
    this.currentReactivity = reactivity
    this.wrappers.clear()
    this.placeholders.clear()
    this.virtualWrappers.clear()
    this.itemsCache.clear()
  }

  get pendingMutations(): readonly PendingMutation[] {
    return this.queue.pending
  }

  // ---------------------------------------------------------------------------------------------
  // Reading

  get<K extends TypeName | undefined = undefined>(
    uriOrEntity?: UriOrEntity
  ): K extends TypeName ? Of<K> : Resource {
    return this.getResource(uriOrEntity) as K extends TypeName ? Of<K> : Resource
  }

  async reload<K extends TypeName | undefined = undefined>(
    uriOrEntity: UriOrEntity
  ): Promise<K extends TypeName ? Of<K> : Resource> {
    return (await this.reloadResource(uriOrEntity)) as K extends TypeName
      ? Of<K>
      : Resource
  }

  /** @internal */
  getResource(uriOrEntity: UriOrEntity = ''): Resource {
    if (isPlaceholder(uriOrEntity) && this.uriOf(uriOrEntity) === undefined) {
      // A placeholder for a relation of an unloaded resource: its URI is not known yet.
      return uriOrEntity as Resource
    }
    const uri = this.toUri(uriOrEntity, 'GET')
    const hashIndex = uri.indexOf('#')
    if (hashIndex !== -1) {
      return this.getVirtual(uri.slice(0, hashIndex), uri.slice(hashIndex + 1))
    }

    this.reactivity.track(uri)
    const record = this.store.get(uri)
    if (this.store.readOnly) {
      if (!isLoaded(record)) {
        throw new ApiError(
          `"${uri}" is not in the read-only store. Make sure it is loaded before creating the snapshot.`,
          { method: 'GET', uri, type: this.adapter.typeOf(uri) }
        )
      }
    } else if (
      !record ||
      record.meta.status === 'placeholder' ||
      record.meta.status === 'stale'
    ) {
      void this.load(uri, true).catch(ignore)
    }
    return this.wrapperFor(uri)
  }

  /** @internal */
  async reloadResource(uriOrEntity: UriOrEntity): Promise<Resource> {
    const uri = this.toUri(uriOrEntity, 'GET')
    const hashIndex = uri.indexOf('#')
    if (hashIndex !== -1) {
      const ownerUri = uri.slice(0, hashIndex)
      await this.reloadResource(ownerUri)
      return this.followRelation(ownerUri, uri.slice(hashIndex + 1))
    }
    await this.load(uri, false, true)
    return this.wrapperFor(uri)
  }

  isUnknown(uri: string): boolean {
    const normalized = this.normalizeUri(uri)
    const base = normalized.split('#')[0] ?? ''
    this.reactivity.track(base)
    return !this.store.has(base) && !this.inflight.has(base)
  }

  status(uri: string): RecordStatus | undefined {
    const normalized = this.normalizeUri(uri)
    this.reactivity.track(normalized)
    const record = this.store.get(normalized)
    if (this.inflight.has(normalized) && !isLoaded(record)) return 'loading'
    return record?.meta.status
  }

  invalidate(uriOrEntity: UriOrEntity): void {
    const uri = this.toUri(uriOrEntity, 'GET')
    const record = this.store.get(uri)
    if (!record) return
    this.touch(uri)
    if (isLoaded(record)) {
      this.patchMeta(uri, { status: 'stale' })
    } else if (record.meta.status === 'error') {
      this.patchMeta(uri, { status: 'placeholder', error: undefined })
    }
  }

  purge(uriOrEntity: UriOrEntity): void {
    const uri = this.uriOf(uriOrEntity)
    if (uri !== undefined) this.removeRecords([uri])
  }

  purgeAll(): void {
    this.removeRecords(Object.keys(this.store.snapshot()))
    // Responses of requests that are still running must not bring anything back.
    this.purgedAt = ++this.epoch
    this.touched.clear()
    this.itemsCache.clear()
    this.virtualWrappers.clear()
  }

  async href(
    uriOrEntity: UriOrEntity,
    relation: string,
    params?: TemplateParams
  ): Promise<string | undefined> {
    const uri = this.toUri(uriOrEntity, 'GET')
    await this.getResource(uri)._meta.load
    return this.hrefSync(uri, relation, params)
  }

  async hrefs(uri: string, relation: string): Promise<string[]> {
    await this.loadPromise(uri)
    await this.queue.settled(uri)
    const record = this.store.get(uri)
    const value = record && currentValue(record, relation)
    if (isLinkRef(value) && !this.store.get(value.href)) {
      await this.loadPromise(value.href).catch(ignore)
      await this.queue.settled(value.href)
    }
    return this.hrefsSync(uri, relation) ?? []
  }

  hrefSync(uri: string, relation: string, params?: TemplateParams): string | undefined {
    const normalized = this.normalizeUri(uri)
    this.reactivity.track(normalized)
    const record = this.store.get(normalized)
    if (!isLoaded(record)) return undefined
    if (relation === 'self') return normalized
    const value = currentValue(record as EntityRecord, relation)
    if (isLinkRef(value)) return value.href
    if (isTemplatedLinkRef(value))
      return this.normalizeUri(expandTemplate(value.href, params))
    return undefined
  }

  hrefsSync(uri: string, relation: string): string[] | undefined {
    const normalized = this.normalizeUri(uri)
    this.reactivity.track(normalized)
    const record = this.store.get(normalized)
    if (!isLoaded(record)) return undefined
    const value = currentValue(record as EntityRecord, relation)
    if (isCollectionRef(value)) return [...value.hrefs]
    if (!isLinkRef(value)) return undefined

    this.reactivity.track(value.href)
    const target = this.store.get(value.href)
    if (!isLoaded(target)) return undefined
    const items = currentValue(target as EntityRecord, 'items')
    return isCollectionRef(items) ? [...items.hrefs] : [value.href]
  }

  // ---------------------------------------------------------------------------------------------
  // Wrappers (internal, used by wrappers.ts)

  /** @internal The current wrapper for a URI, without triggering a request. */
  wrapperFor(uri: string): Resource {
    const record = this.store.get(uri)
    if (!isLoaded(record)) {
      let placeholder = this.placeholders.get(uri)
      if (!placeholder) {
        placeholder = createUriPlaceholder(this, uri)
        this.placeholders.set(uri, placeholder)
      }
      return placeholder
    }
    const loaded = record as EntityRecord
    const cached = this.wrappers.get(uri)
    if (cached?.version === loaded.meta.version) return cached.wrapper
    const wrapper = this.factory.create(uri, loaded)
    this.wrappers.set(uri, { version: loaded.meta.version, wrapper })
    return wrapper
  }

  /** @internal Resolves when the resource settled, to its current wrapper. */
  loadPromise(uri: string): Promise<Resource> {
    const inflight = this.inflight.get(uri)
    const record = this.store.get(uri)
    if (inflight) {
      // A reload of a loaded resource resolves even if it fails: the old data is still there.
      return isLoaded(record)
        ? inflight.then(
            () => this.wrapperFor(uri),
            () => this.wrapperFor(uri)
          )
        : inflight.then(() => this.wrapperFor(uri))
    }
    if (record?.meta.status === 'error' && !isLoaded(record)) {
      return Promise.reject(
        record.meta.error ??
          new ApiError(`Could not GET "${uri}"`, { method: 'GET', uri })
      )
    }
    if (
      !this.store.readOnly &&
      (!record || !isLoaded(record) || record.meta.status === 'stale')
    ) {
      return this.load(uri, true).then(() => this.wrapperFor(uri))
    }
    if (!isLoaded(record)) {
      return Promise.reject(
        new ApiError(`"${uri}" is not in the read-only store`, { method: 'GET', uri })
      )
    }
    return Promise.resolve(this.wrapperFor(uri))
  }

  /** @internal */
  toData(uri: string): Record<string, unknown> {
    this.reactivity.track(uri)
    const record = this.store.get(uri)
    if (!record || !isLoaded(record)) {
      throw new Error(`Cannot copy the data of "${uri}" before it is loaded`)
    }
    return plainData(record)
  }

  /** @internal Calls a relation function of a resource by name. */
  followRelation(uri: string, relation: string, params?: TemplateParams): Resource {
    this.reactivity.track(uri)
    const record = this.store.get(uri)
    const value = record && currentValue(record, relation)
    if (isLinkRef(value)) return this.getResource(value.href)
    if (isTemplatedLinkRef(value))
      return this.getResource(expandTemplate(value.href, params))
    if (isCollectionRef(value)) return this.virtualCollection(uri, relation)
    if (!isLoaded(record)) return this.wrapperFor(uri).$rel(relation, params)
    throw new ApiError(
      `Property '${relation}' of '${uri}' was used like a relation, but the API returned no relation with this name`,
      { method: 'GET', uri, type: record?.meta.type }
    )
  }

  /** @internal Items of a collection with a URI. */
  collectionItems(uri: string, includeDeleting: boolean): readonly Resource[] {
    this.reactivity.track(uri)
    const record = this.store.get(uri)
    if (!record) return EMPTY_ITEMS
    const value = currentValue(record, 'items')
    if (!isCollectionRef(value)) return EMPTY_ITEMS
    return this.itemsFrom(uri, record.meta.version, value.hrefs, includeDeleting, () =>
      this.ensureItemsLoaded(uri, uri, () => this.currentHrefs(uri, 'items'))
    )
  }

  /** @internal Items of an embedded collection without URI. */
  virtualItems(
    ownerUri: string,
    relation: string,
    includeDeleting: boolean
  ): readonly Resource[] {
    this.reactivity.track(ownerUri)
    const owner = this.store.get(ownerUri)
    if (!owner) return EMPTY_ITEMS
    const value = currentValue(owner, relation)
    if (!isCollectionRef(value)) return EMPTY_ITEMS
    const key = `${ownerUri}#${relation}`
    return this.itemsFrom(key, owner.meta.version, value.hrefs, includeDeleting, () =>
      this.ensureItemsLoaded(key, ownerUri, () => this.currentHrefs(ownerUri, relation))
    )
  }

  /** @internal */
  async loadItems(uri: string): Promise<Resource> {
    await this.loadPromise(uri)
    const record = this.store.get(uri)
    if (!record || !isCollectionRecord(record)) {
      throw new ApiError(`"${uri}" is not a collection`, {
        method: 'GET',
        uri,
        type: record?.meta.type,
      })
    }
    await this.ensureItemsLoaded(uri, uri, () => this.currentHrefs(uri, 'items'))
    await this.settleAll(this.currentHrefs(uri, 'items'))
    return this.wrapperFor(uri)
  }

  /** @internal */
  async loadVirtualItems(ownerUri: string, relation: string): Promise<Resource> {
    await this.loadPromise(ownerUri)
    const hrefs = () => this.currentHrefs(ownerUri, relation)
    await this.ensureItemsLoaded(`${ownerUri}#${relation}`, ownerUri, hrefs)
    await this.settleAll(hrefs())
    return this.followRelation(ownerUri, relation)
  }

  /** @internal */
  hasPreprocessor(type: string): boolean {
    return this.preprocessorFor(type) !== undefined
  }

  /**
   * @internal Reads a derived field, recomputing the preprocessor if the record or anything it
   * read changed since the last run.
   */
  derived(wrapper: Resource, key: string | undefined): unknown {
    const uri = wrapper._meta.self
    this.reactivity.track(uri)
    const record = this.store.get(uri)
    // Collections carry the type of their items, but preprocessors are written for the items.
    if (!record || !isLoaded(record) || isCollectionRecord(record)) return undefined
    const type = record.meta.type ?? ''
    const preprocessor = this.preprocessorFor(type)
    if (!preprocessor) return undefined

    let memo = this.derivedMemos.get(uri)
    const upToDate =
      memo?.version === record.meta.version &&
      [...memo.dependencies].every(
        ([dependency, version]) =>
          (this.store.get(dependency)?.meta.version ?? -1) === version
      )
    if (memo && upToDate) {
      for (const dependency of memo.dependencies.keys()) this.reactivity.track(dependency)
    } else {
      const dependencies = new Map<string, number>()
      const context: PreprocessorContext = {
        get: (target) => {
          if (target === undefined || target === null) return undefined
          const normalized = this.normalizeUri(target)
          const dependency = this.store.get(normalized)
          dependencies.set(normalized, dependency?.meta.version ?? -1)
          this.reactivity.track(normalized)
          return isLoaded(dependency) ? this.wrapperFor(normalized) : undefined
        },
        hrefSync: (target, relation, params) => {
          const normalized = this.normalizeUri(target)
          dependencies.set(normalized, this.store.get(normalized)?.meta.version ?? -1)
          return this.hrefSync(normalized, relation, params)
        },
        options: this.options,
      }
      // Wrappers read current values, so any wrapper of this URI is as good as the newest.
      const value = { ...preprocessor(wrapper, context) } as Record<string, unknown>
      memo = { version: record.meta.version, dependencies, value }
      this.derivedMemos.set(uri, memo)
      this.factory.defineDerived(type, Object.keys(value))
    }
    return key === undefined ? undefined : memo.value[key]
  }

  // ---------------------------------------------------------------------------------------------
  // Mutations

  async post(
    uriOrCollection: UriOrEntity,
    data?: Record<string, unknown>,
    options: PostOptions = {}
  ): Promise<Resource | null> {
    const uri = this.toUri(uriOrCollection, 'POST')
    this.assertWritable(uri, 'post')
    // Without data, nothing is sent as body (e.g. for actions like refreshing a token).
    const body = data === undefined ? undefined : bodyForPost(data, this.diffContext)
    const collection = this.store.get(uri)
    const optimistic =
      body !== undefined &&
      (options.optimistic ?? this.options.optimistic ?? true) &&
      isLoaded(collection) &&
      isCollectionRecord(collection as EntityRecord)

    const id = this.queue.nextId()
    const tempUri = optimistic ? `${TEMP_URI_PREFIX}${id}` : undefined
    const mutation: PendingMutation = { id, kind: 'post', uri, optimistic }
    if (body) mutation.body = body
    if (tempUri) mutation.tempUri = tempUri
    this.queue.add(mutation)

    if (tempUri) {
      const type = collection?.meta.type
      const record: EntityRecord = {
        uri: tempUri,
        data: {},
        meta: {
          version: this.nextVersion(),
          status: 'loaded',
          loadedAt: Date.now(),
          dirty: deepFreeze(
            this.temporaryData(collection as EntityRecord, data ?? {}, body)
          ),
          ...(type === undefined ? {} : { type }),
        },
      }
      this.store.set([record])
      this.refreshDirty(uri)
    }

    const created = this.queue.run(uri, async () => {
      try {
        const response = await this.send('POST', uri, body)
        const createdUri = await this.storeMutationResponse(uri, response, 'POST')
        this.queue.remove(mutation)
        if (createdUri !== undefined) this.appendItem(uri, createdUri)
        else this.refreshDirty(uri)
        return createdUri ?? null
      } catch (error) {
        this.queue.remove(mutation)
        this.refreshDirty(uri, { error: error as ApiError })
        throw error
      } finally {
        if (tempUri) this.removeRecords([tempUri])
      }
    })
    // Kept after the POST settled: a view may still hold the temporary item and patch it later.
    if (tempUri)
      this.pendingPosts.set(
        tempUri,
        created.catch(() => null)
      )

    const createdUri = await created
    // Only collections that are loaded (not ones whose last load failed) are reloaded.
    if (options.reload !== false && isLoaded(this.store.get(uri))) {
      void this.load(uri, false, true).catch(ignore)
    }
    return createdUri === null ? null : this.wrapperFor(createdUri)
  }

  async patch(
    uriOrEntity: UriOrEntity,
    data: Record<string, unknown>,
    options: PatchOptions = {}
  ): Promise<Resource> {
    let uri = this.toUri(uriOrEntity, 'PATCH')
    // Only wait when necessary: the optimistic change should be visible synchronously.
    if (uri.startsWith(TEMP_URI_PREFIX)) uri = await this.confirmedUri(uri)
    if (this.inflight.has(uri) && !isLoaded(this.store.get(uri))) {
      await this.inflight.get(uri)?.catch(ignore)
    }
    this.assertWritable(uri, 'patch')
    const record = this.store.get(uri)
    const loaded = isLoaded(record)
    const diff = this.diffPatch(record, data, options.force || !loaded)
    if (loaded && Object.keys(diff.body).length === 0) return this.wrapperFor(uri)

    const optimistic = (options.optimistic ?? this.options.optimistic ?? true) && loaded
    const mutation: PendingMutation = {
      id: this.queue.nextId(),
      kind: 'patch',
      uri,
      body: diff.body,
      dirty: diff.dirty,
      optimistic,
    }
    this.queue.add(mutation)
    if (optimistic) this.refreshDirty(uri)

    return this.queue.run(uri, async () => {
      let response: HttpResponse
      try {
        response = await this.send('PATCH', uri, diff.body)
      } catch (error) {
        this.queue.remove(mutation)
        this.refreshDirty(uri, { error: error as ApiError })
        if ((error as ApiError).status === 409)
          void this.reloadResource(uri).catch(ignore)
        throw error
      }
      this.queue.remove(mutation)
      const storedUri = await this.storeMutationResponse(uri, response, 'PATCH')
      if (storedUri === undefined) {
        // No content: keep the change and fetch what the server made of it.
        this.commitData(uri, diff.dirty)
        void this.load(uri, false, true).catch(ignore)
      }
      return this.wrapperFor(uri)
    })
  }

  // Deletes are always optimistic: the item disappears from `items` while the request runs.
  async del(uriOrEntity: UriOrEntity, _options?: MutationOptions): Promise<void> {
    let uri = this.toUri(uriOrEntity, 'DELETE')
    if (uri.startsWith(TEMP_URI_PREFIX)) uri = await this.confirmedUri(uri)
    this.assertWritable(uri, 'del')
    const mutation: PendingMutation = {
      id: this.queue.nextId(),
      kind: 'delete',
      uri,
      optimistic: true,
    }
    this.queue.add(mutation)
    this.setDeleting(uri, true)

    return this.queue.run(uri, async () => {
      try {
        await this.send('DELETE', uri)
      } catch (error) {
        this.queue.remove(mutation)
        this.setDeleting(uri, false, error as ApiError)
        throw error
      }
      this.queue.remove(mutation)
      await this.reloadReferencing(uri)
      this.removeRecords([uri])
    })
  }

  // ---------------------------------------------------------------------------------------------
  // Internals

  private preprocessorFor(type: string): Preprocessor | undefined {
    return type ? this.options.preprocessors?.[type] : undefined
  }

  private uriOf(uriOrEntity: unknown): string | undefined {
    if (uriOrEntity === undefined) return ''
    if (typeof uriOrEntity === 'string') return this.normalizeUri(uriOrEntity)
    if (typeof uriOrEntity !== 'object' || uriOrEntity === null) return undefined
    const meta = (uriOrEntity as { _meta?: { self?: unknown } })._meta
    return typeof meta?.self === 'string' ? this.normalizeUri(meta.self) : undefined
  }

  private toUri(uriOrEntity: unknown, method: string): string {
    const uri = this.uriOf(uriOrEntity)
    if (uri === undefined) {
      throw new ApiError(
        `Could not perform ${method}, "${String(uriOrEntity)}" is not an entity or URI`,
        { method, uri: String(uriOrEntity) }
      )
    }
    return uri
  }

  /**
   * The data of the temporary record of an optimistic POST. Values that are relations become
   * relation refs, so `item.relation()` works on the temporary item too: values given as wrappers,
   * fields that are relations on the items already in the collection, and IRIs of resources in
   * the store.
   */
  private temporaryData(
    collection: EntityRecord,
    data: Record<string, unknown>,
    body: Record<string, unknown> | undefined
  ): Record<string, unknown> {
    const items = currentValue(collection, 'items')
    const sibling = isCollectionRef(items)
      ? items.hrefs.map((href) => this.store.get(href)).find(isLoaded)
      : undefined
    const isRelation = (key: string, given: unknown, value: unknown): boolean => {
      const siblingValue = sibling ? currentValue(sibling, key) : undefined
      if (isLinkRef(siblingValue) || isCollectionRef(siblingValue)) return true
      if (typeof given === 'object' && given !== null && '_meta' in given) return true
      return typeof value === 'string' && this.store.has(this.normalizeUri(value))
    }
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(
      JSON.parse(JSON.stringify(body ?? {})) as Record<string, unknown>
    )) {
      const given = data[key]
      if (typeof value === 'string' && isRelation(key, given, value)) {
        result[key] = { href: this.normalizeUri(value) }
      } else if (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((entry) => typeof entry === 'string') &&
        isRelation(key, Array.isArray(given) ? given[0] : given, value[0])
      ) {
        result[key] = {
          hrefs: value.map((entry) => this.normalizeUri(entry)),
        }
      } else {
        result[key] = value
      }
    }
    return result
  }

  /**
   * What a PATCH sends: fields that differ from the confirmed data or from the current
   * (optimistic) data. Comparing with both means a field is still sent when an earlier pending
   * patch set the same value, since that patch may fail.
   */
  private diffPatch(
    record: EntityRecord | undefined,
    data: Record<string, unknown>,
    force: boolean
  ): PatchDiff {
    const current = record ? currentData(record) : {}
    const diff = diffForPatch(current, data, this.diffContext, force)
    if (!record?.meta.dirty || force) return diff
    const confirmed = diffForPatch(record.data, data, this.diffContext)
    return {
      body: { ...confirmed.body, ...diff.body },
      dirty: { ...confirmed.dirty, ...diff.dirty },
    }
  }

  private assertWritable(uri: string, operation: string): void {
    if (uri.includes('#')) {
      throw new Error(
        `${operation} is not implemented for virtual resources (embedded collections without a URI of their own)`
      )
    }
    if (this.store.readOnly) {
      throw new ApiError(`Cannot ${operation} "${uri}": the store is read-only`, {
        method: operation.toUpperCase(),
        uri,
      })
    }
  }

  /** Waits for the POST that created a temporary record and returns the real URI. */
  private async confirmedUri(uri: string): Promise<string> {
    if (!uri.startsWith(TEMP_URI_PREFIX)) return uri
    const created = await this.pendingPosts.get(uri)
    if (!created) {
      throw new ApiError(`"${uri}" was never created`, { method: 'GET', uri })
    }
    return created
  }

  private getVirtual(ownerUri: string, relation: string): Resource {
    const owner = this.getResource(ownerUri)
    return isLoaded(this.store.get(ownerUri))
      ? this.followRelation(ownerUri, relation)
      : owner.$rel(relation)
  }

  private virtualCollection(ownerUri: string, relation: string): Resource {
    const key = `${ownerUri}#${relation}`
    const version = this.store.get(ownerUri)?.meta.version ?? 0
    const cached = this.virtualWrappers.get(key)
    if (cached?.version === version) return cached.wrapper
    const wrapper = createVirtualCollection(this, ownerUri, relation)
    this.virtualWrappers.set(key, { version, wrapper })
    return wrapper
  }

  private currentHrefs(uri: string, relation: string): string[] {
    const record = this.store.get(uri)
    const value = record && currentValue(record, relation)
    return isCollectionRef(value) ? value.hrefs : []
  }

  private itemsFrom(
    cacheKey: string,
    version: number,
    hrefs: string[],
    includeDeleting: boolean,
    loadUnknown: () => Promise<void>
  ): readonly Resource[] {
    const key = includeDeleting ? `${cacheKey}\u0000all` : cacheKey
    const cached = this.itemsCache.get(key)
    if (cached?.version === version && cached.generation === this.generation) {
      return cached.items
    }

    let hasUnknown = false
    const items: Resource[] = []
    for (const href of hrefs) {
      const record = this.store.get(href)
      if (!record) hasUnknown = true
      if (!includeDeleting && record?.meta.deleting) continue
      items.push(this.wrapperFor(href))
    }
    if (hasUnknown && !this.store.readOnly) void loadUnknown().catch(ignore)

    const frozen = Object.freeze(items)
    this.itemsCache.set(key, { version, generation: this.generation, items: frozen })
    return frozen
  }

  /**
   * Loads the items of a collection that are not in the store. With `avoidNPlusOneRequests`,
   * the collection (or the owner of an embedded collection) is reloaded first, in the hope that
   * the API embeds the items.
   */
  private ensureItemsLoaded(
    key: string,
    reloadUri: string,
    hrefs: () => string[]
  ): Promise<void> {
    const unknown = () => hrefs().filter((href) => !this.store.has(href))
    if (unknown().length === 0) return Promise.resolve()
    let loading = this.itemLoads.get(key)
    if (!loading) {
      loading = (async () => {
        if (this.options.avoidNPlusOneRequests ?? true) {
          await this.load(reloadUri, false, true).catch(ignore)
        }
        await Promise.allSettled(unknown().map((href) => this.load(href, true)))
      })().finally(() => this.itemLoads.delete(key))
      this.itemLoads.set(key, loading)
    }
    return loading
  }

  private async settleAll(hrefs: string[]): Promise<void> {
    const results = await Promise.allSettled(hrefs.map((href) => this.loadPromise(href)))
    const failure = results.find((result) => result.status === 'rejected')
    if (failure && results.every((result) => result.status === 'rejected')) {
      throw failure.reason
    }
  }

  /**
   * Loads a resource from the API, sharing an in-flight request for the same URI.
   * @param silent don't notify about the status change, because the caller is a read (which
   *               may run inside a reactive effect that must not write to its own dependencies)
   * @param force  start a new request even if the resource is loaded
   */
  private load(uri: string, silent: boolean, force = false): Promise<void> {
    const existing = this.inflight.get(uri)
    // A forced load (a reload) must not join a request that started before the last write to
    // this URI: that request's response is outdated and will be dropped by the write fence.
    if (
      existing &&
      !(force && this.changedSince(uri, this.inflightSince.get(uri) ?? 0))
    ) {
      return existing
    }

    const record = this.store.get(uri)
    if (!force && isLoaded(record) && record?.meta.status !== 'stale')
      return Promise.resolve()
    if (this.store.readOnly) return Promise.resolve()

    // A first load writes nothing until the response arrives (one store write per response);
    // until then, the in-flight request is what marks the URI as loading. Reads (silent) never
    // write, since they may run inside a reactive effect.
    if (!silent && record && !isLoaded(record) && record.meta.status !== 'loading') {
      this.patchMeta(uri, { status: 'loading', error: undefined })
    }

    const startedAt = this.epoch
    const promise = this.fetchAndStore(uri, startedAt).finally(() => {
      if (this.inflight.get(uri) === promise) {
        this.inflight.delete(uri)
        this.inflightSince.delete(uri)
      }
    })
    this.inflight.set(uri, promise)
    this.inflightSince.set(uri, startedAt)
    promise.catch(ignore)
    return promise
  }

  /** Whether a write that must win over running requests happened to this URI after `epoch`. */
  private changedSince(uri: string, epoch: number): boolean {
    return Math.max(this.touched.get(uri) ?? 0, this.purgedAt) > epoch
  }

  private touch(uri: string): void {
    this.touched.set(uri, ++this.epoch)
  }

  private nextVersion(previous = 0): number {
    this.version = Math.max(this.version, previous) + 1
    return this.version
  }

  private async fetchAndStore(uri: string, startedAt: number): Promise<void> {
    let response: HttpResponse
    try {
      response = await this.sendWithRetry(uri)
    } catch (error) {
      if (!this.changedSince(uri, startedAt)) this.recordLoadError(uri, error as ApiError)
      throw error
    }

    try {
      const records = this.parseRecords(uri, response, 'GET')
      const top = records[0]
      if (!top) {
        records.push({
          uri,
          data: {},
          meta: { version: 0, status: 'loaded', ...this.typeMeta(uri) },
        })
      } else if (top.uri !== uri) {
        if (this.options.forceRequestedSelfLink) records[0] = { ...top, uri }
        else records.push({ ...top, uri, meta: { ...top.meta } })
      }
      // Records written by mutations, invalidated, deleted or purged since the request started
      // are newer than this response.
      this.writeRecords(
        records.filter((record) => !this.changedSince(record.uri, startedAt))
      )
    } catch (error) {
      if (!this.changedSince(uri, startedAt)) this.recordLoadError(uri, error as ApiError)
      throw error
    }
  }

  private async sendWithRetry(uri: string): Promise<HttpResponse> {
    const url = this.resolveUrl(uri)
    for (let attempt = 0; ; attempt++) {
      let response: HttpResponse | undefined
      let networkError: unknown
      try {
        response = await this.request({ method: 'GET', url, headers: {} })
      } catch (error) {
        networkError = error
      }
      if (response && response.status < 400) return response
      if (attempt < this.retry.retries && isRetryable(response?.status)) {
        await sleep(retryDelay(attempt, this.retry, response?.headers.get('Retry-After')))
        continue
      }
      throw this.toApiError('GET', uri, url, response, networkError)
    }
  }

  private typeMeta(uri: string): Pick<EntityMeta, 'type'> {
    const type = this.adapter.typeOf(uri)
    return type === undefined ? {} : { type }
  }

  private recordLoadError(uri: string, error: ApiError): void {
    const record = this.store.get(uri)
    const gone = error.status === 404 || error.status === 410
    if (!record || gone || !isLoaded(record)) {
      this.store.set([
        {
          uri,
          data: {},
          meta: {
            version: this.nextVersion(record?.meta.version),
            status: 'error',
            error,
            ...(record?.meta.type === undefined
              ? this.typeMeta(uri)
              : { type: record.meta.type }),
          },
        },
      ])
      this.afterWrite([uri])
      // The resource is gone, probably deleted by someone else: whoever referenced it is outdated.
      if (gone && isLoaded(record)) void this.reloadReferencing(uri)
    } else {
      this.patchMeta(uri, { error })
    }
  }

  private async request(request: HttpRequest): Promise<HttpResponse> {
    let prepared: HttpRequest = {
      ...request,
      headers: {
        Accept: this.adapter.accept,
        ...this.options.headers,
        ...request.headers,
      },
    }
    for (const interceptor of this.options.interceptors ?? []) {
      prepared = await interceptor(prepared)
    }
    return this.transport.request(prepared)
  }

  private async send(
    method: MutationMethod,
    uri: string,
    data?: Record<string, unknown>
  ): Promise<HttpResponse> {
    const url = this.resolveUrl(uri)
    const request: HttpRequest = { method, url, headers: {} }
    if (data !== undefined) {
      const { body, contentType } = this.adapter.serialize(uri, data, method)
      request.body = body
      request.headers['Content-Type'] = contentType
    }
    let response: HttpResponse
    try {
      response = await this.request(request)
    } catch (error) {
      throw this.toApiError(method, uri, url, undefined, error)
    }
    if (response.status >= 400) throw this.toApiError(method, uri, url, response)
    return response
  }

  private parseRecords(
    uri: string,
    response: HttpResponse,
    method: string
  ): EntityRecord[] {
    if (response.status === 204 || response.body.trim() === '') return []
    const url = this.resolveUrl(uri)
    const received = mediaType(response.headers.get('Content-Type'))
    const accepted = this.adapter.contentTypes ?? [this.adapter.accept]
    if (received === undefined || !accepted.includes(received)) {
      throw this.toApiError(
        method,
        uri,
        url,
        response,
        undefined,
        `Expected ${accepted.join(' or ')} from ${method} ${url}, but received ${received ?? 'no content type'}`
      )
    }
    const body = parseJson(response.body)
    if (body === undefined) {
      throw this.toApiError(
        method,
        uri,
        url,
        response,
        undefined,
        `Invalid JSON from ${method} ${url}`
      )
    }
    try {
      return this.adapter.normalize(uri, body, response.headers, {
        normalizeUri: this.normalizeUri,
      })
    } catch (error) {
      throw this.toApiError(
        method,
        uri,
        url,
        response,
        error,
        `Could not normalize the response of ${method} ${url}: ${(error as Error).message}`
      )
    }
  }

  /** Stores the body of a mutation response. Returns the URI of the returned resource, if any. */
  private async storeMutationResponse(
    uri: string,
    response: HttpResponse,
    method: MutationMethod
  ): Promise<string | undefined> {
    const records = this.parseRecords(uri, response, method)
    const top = records[0]
    if (top) {
      const body = parseJson(response.body)
      const identity = this.adapter.identity(body)
      if (method === 'POST' && identity === undefined) records.shift()
      for (const record of records) this.touch(record.uri)
      this.writeRecords(records)
      if (method !== 'POST' || identity !== undefined) return top.uri
    }
    const location = response.headers.get('Location')
    if (method === 'POST' && location) {
      const created = this.normalizeUri(location)
      await this.load(created, false, true)
      return created
    }
    return undefined
  }

  private toApiError(
    method: string,
    uri: string,
    url: string,
    response?: HttpResponse,
    cause?: unknown,
    message?: string
  ): ApiError {
    const data = response ? parseJson(response.body) : undefined
    const problem = (typeof data === 'object' && data !== null ? data : {}) as {
      title?: unknown
      detail?: unknown
    }
    const detail = [problem.title, problem.detail]
      .filter((part) => typeof part === 'string')
      .join(': ')
    const reason = response
      ? `status ${response.status}${detail ? `, ${detail}` : ''}`
      : cause instanceof Error
        ? cause.message
        : String(cause)
    return new ApiError(message ?? `Could not ${method} ${url} (${reason})`, {
      method,
      uri,
      url,
      status: response?.status,
      type: this.store.get(uri)?.meta.type ?? this.adapter.typeOf(uri),
      headers: response?.headers,
      body: response?.body,
      data,
      cause,
    })
  }

  /** Writes response records in one batch and notifies once per record. */
  private writeRecords(records: EntityRecord[]): void {
    // The records are fresh from the adapter and owned by this call, so they are completed in
    // place: a large response is thousands of records, and copying them doubles the garbage.
    const now = Date.now()
    const uris: string[] = []
    for (const record of records) {
      const existing = this.store.get(record.uri)
      const meta = record.meta
      meta.version = this.nextVersion(existing?.meta.version)
      meta.status = 'loaded'
      meta.loadedAt = now
      if (meta.type === undefined && existing?.meta.type !== undefined) {
        meta.type = existing.meta.type
      }
      if (existing?.meta.deleting) meta.deleting = true
      deepFreeze(record.data)
      const dirty = this.queue.dirtyFor(record)
      if (dirty) meta.dirty = dirty
      uris.push(record.uri)
    }
    this.store.set(records)
    this.afterWrite(uris)
  }

  private patchMeta(uri: string, patch: MetaPatch): void {
    const record = this.store.get(uri)
    if (!record) return
    this.store.patchMeta(uri, {
      ...patch,
      version: this.nextVersion(record.meta.version),
    })
    this.afterWrite([uri])
  }

  private afterWrite(uris: string[]): void {
    this.generation++
    for (const uri of uris) this.reactivity.bump(uri)
  }

  private removeRecords(uris: string[]): void {
    if (uris.length === 0) return
    this.store.remove(uris)
    this.generation++
    for (const uri of uris) {
      this.touch(uri)
      this.wrappers.delete(uri)
      this.placeholders.delete(uri)
      this.derivedMemos.delete(uri)
      this.itemsCache.delete(uri)
      this.itemsCache.delete(`${uri}\u0000all`)
      this.reactivity.bump(uri)
      this.reactivity.release?.(uri)
    }
    // Embedded collections of removed records.
    const removed = new Set(uris)
    for (const map of [this.itemsCache, this.virtualWrappers]) {
      for (const key of map.keys()) {
        const owner = key.split('#')[0] ?? ''
        if (key.includes('#') && removed.has(owner)) map.delete(key)
      }
    }
  }

  /** Recomputes the optimistic changes of a record from the pending mutations. */
  private refreshDirty(uri: string, patch: MetaPatch = {}): void {
    const record = this.store.get(uri)
    if (!record) return
    this.patchMeta(uri, { ...patch, dirty: deepFreeze(this.queue.dirtyFor(record)) })
  }

  /** Writes confirmed changes into the data of a record (for answers without content). */
  private commitData(uri: string, changes: Record<string, unknown>): void {
    const record = this.store.get(uri)
    if (!record) return
    const updated: EntityRecord = {
      uri,
      data: deepFreeze({ ...record.data, ...changes }),
      meta: {
        ...record.meta,
        version: this.nextVersion(record.meta.version),
        status: 'stale',
      },
    }
    const dirty = this.queue.dirtyFor(updated)
    if (dirty) updated.meta.dirty = dirty
    else delete updated.meta.dirty
    this.touch(uri)
    this.store.set([updated])
    this.afterWrite([uri])
  }

  /** Adds a newly created resource to a collection, replacing its temporary item. */
  private appendItem(collectionUri: string, itemUri: string): void {
    const record = this.store.get(collectionUri)
    if (!record || !isCollectionRef(record.data.items)) {
      this.refreshDirty(collectionUri)
      return
    }
    const hrefs = record.data.items.hrefs
    if (hrefs.includes(itemUri)) {
      this.refreshDirty(collectionUri)
      return
    }
    const updated: EntityRecord = {
      uri: collectionUri,
      data: deepFreeze({ ...record.data, items: { hrefs: [...hrefs, itemUri] } }),
      meta: { ...record.meta, version: this.nextVersion(record.meta.version) },
    }
    const dirty = this.queue.dirtyFor(updated)
    if (dirty) updated.meta.dirty = dirty
    else delete updated.meta.dirty
    this.touch(collectionUri)
    this.store.set([updated])
    this.afterWrite([collectionUri])
  }

  private setDeleting(uri: string, deleting: boolean, error?: ApiError): void {
    const patch: MetaPatch = { deleting: deleting || undefined }
    if (error) patch.error = error
    this.patchMeta(uri, patch)
    // Collections listing this resource show it in `allItems` but not in `items`.
    const referencing = this.findReferencing(uri, true)
    for (const referrer of referencing) this.patchMeta(referrer, {})
  }

  /** URIs of records that reference the given URI (only through to-many relations if asked). */
  private findReferencing(uri: string, toManyOnly = false): string[] {
    const result: string[] = []
    for (const record of Object.values(this.store.snapshot())) {
      if (record.uri === uri) continue
      const references = Object.values(currentData(record)).some(
        (value) =>
          (isCollectionRef(value) && value.hrefs.includes(uri)) ||
          (!toManyOnly && isLinkRef(value) && value.href === uri)
      )
      if (references) result.push(record.uri)
    }
    return result
  }

  /** Reloads everything that references a deleted resource; errors are ignored. */
  private async reloadReferencing(uri: string): Promise<void> {
    const referencing = this.findReferencing(uri).filter((referrer) => {
      const record = this.store.get(referrer)
      return (
        isLoaded(record) &&
        !record?.meta.deleting &&
        !referrer.startsWith(TEMP_URI_PREFIX)
      )
    })
    await Promise.all(
      referencing.map((referrer) => this.load(referrer, false, true).catch(ignore))
    )
  }
}

/** Creates a halc client. */
export function createHalc(options: HalcOptions): Client {
  return new HalcClient(options)
}
