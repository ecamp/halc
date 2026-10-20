import {
  isCollectionRef,
  isLinkRef,
  type CollectionRef,
  type EntityRecord,
} from './records.js'
import { deepEqual } from './util.js'

/** A mutation waiting for the API to answer. Plain, serializable data. */
export interface PendingMutation {
  id: string
  kind: 'post' | 'patch' | 'delete'
  /** Target URI: the collection for POST, the entity for PATCH and DELETE. */
  uri: string
  /** The request body. */
  body?: Record<string, unknown>
  /** Whether the change is applied locally while the request is in flight. */
  optimistic: boolean
  /** For PATCH: the local changes in record form (relations as refs). */
  dirty?: Record<string, unknown>
  /** For POST: the URI of the temporary record. */
  tempUri?: string
}

/**
 * Every write goes through this queue. Mutations to the same URI run one after another,
 * mutations to different URIs run in parallel. The list of pending mutations is plain data, so
 * it can be persisted and replayed later.
 */
export class MutationQueue {
  private readonly mutations: PendingMutation[] = []
  private readonly tails = new Map<string, Promise<unknown>>()
  private counter = 0

  get pending(): readonly PendingMutation[] {
    return this.mutations
  }

  nextId(): string {
    this.counter += 1
    return `${Date.now().toString(36)}-${this.counter.toString(36)}`
  }

  add(mutation: PendingMutation): void {
    this.mutations.push(mutation)
  }

  remove(mutation: PendingMutation): void {
    const index = this.mutations.indexOf(mutation)
    if (index !== -1) this.mutations.splice(index, 1)
  }

  /** Runs the task after all earlier tasks for the same URI have settled. */
  run<T>(uri: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(uri) ?? Promise.resolve()
    const result = previous.then(task, task)
    const tail = result.then(
      () => undefined,
      () => undefined
    )
    this.tails.set(uri, tail)
    void tail.then(() => {
      if (this.tails.get(uri) === tail) this.tails.delete(uri)
    })
    return result
  }

  /** Resolves when every mutation for this URI that is queued now has settled. */
  settled(uri: string): Promise<void> {
    return (this.tails.get(uri) ?? Promise.resolve()).then(() => undefined)
  }

  /**
   * The optimistic changes of all pending mutations of a URI, in record form: patched fields,
   * and the temporary items of pending POSTs appended to `items`.
   */
  dirtyFor(record: EntityRecord): Record<string, unknown> | undefined {
    let dirty: Record<string, unknown> | undefined
    for (const mutation of this.mutations) {
      if (mutation.uri !== record.uri || !mutation.optimistic) continue
      if (mutation.kind === 'patch' && mutation.dirty) {
        dirty = { ...dirty, ...mutation.dirty }
      } else if (mutation.kind === 'post' && mutation.tempUri) {
        const base = (dirty?.items ?? record.data.items) as CollectionRef | undefined
        const hrefs = isCollectionRef(base) ? base.hrefs : []
        dirty = { ...dirty, items: { hrefs: [...hrefs, mutation.tempUri] } }
      }
    }
    return dirty
  }
}

export interface DiffContext {
  normalizeUri(uri: string): string
  /** Turns a wrapper into an IRI that can be sent to the API. */
  iriOf(self: string): string
}

function selfOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('_meta' in value)) return undefined
  const meta = value._meta
  if (typeof meta !== 'object' || meta === null) return undefined
  const self = (meta as { self?: unknown }).self
  return typeof self === 'string' ? self : undefined
}

/** Converts a value given by a caller into what is sent to the API. */
function toBodyValue(value: unknown, context: DiffContext): unknown {
  const self = selfOf(value)
  if (self !== undefined) return context.iriOf(self)
  if (Array.isArray(value)) return value.map((entry) => toBodyValue(entry, context))
  return value
}

function toHref(value: unknown, context: DiffContext): string | null | undefined {
  if (value === null) return null
  if (typeof value === 'string') return context.normalizeUri(value)
  const self = selfOf(value)
  return self === undefined ? undefined : context.normalizeUri(self)
}

/**
 * Converts a body value into the form it has in a record, given the current value: IRIs become
 * relation refs where the record has a relation, everything else is a JSON copy (so dates and
 * other objects compare the way they will be sent).
 */
function toRecordValue(current: unknown, value: unknown, context: DiffContext): unknown {
  if (isLinkRef(current) || current === null) {
    const href = toHref(value, context)
    if (href === null) return null
    if (href !== undefined && isLinkRef(current)) return { href }
  }
  if (isCollectionRef(current) && Array.isArray(value)) {
    const hrefs = value.map((entry) => toHref(entry, context))
    if (hrefs.every((href) => typeof href === 'string')) return { hrefs }
  }
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value)) as unknown
}

export interface PatchDiff {
  /** Fields to send, in the form the API expects. */
  body: Record<string, unknown>
  /** The same fields in record form, for the optimistic update. */
  dirty: Record<string, unknown>
}

/**
 * Computes what a PATCH has to send: every top-level field of `data` whose value differs from
 * the current value. Functions (relation accessors) and `_meta` are ignored, so a spread wrapper
 * can be passed. With `force`, every given field is sent.
 */
export function diffForPatch(
  current: Record<string, unknown>,
  data: Record<string, unknown>,
  context: DiffContext,
  force = false
): PatchDiff {
  const body: Record<string, unknown> = {}
  const dirty: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (key === '_meta' || typeof value === 'function' || value === undefined) continue
    const recordValue = toRecordValue(current[key], value, context)
    if (!force && deepEqual(recordValue, current[key])) continue
    body[key] = toBodyValue(value, context)
    dirty[key] = recordValue
  }
  return { body, dirty }
}

/** Prepares the body of a POST: wrappers become IRIs, functions and `_meta` are dropped. */
export function bodyForPost(
  data: Record<string, unknown>,
  context: DiffContext
): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (key === '_meta' || typeof value === 'function' || value === undefined) continue
    body[key] = toBodyValue(value, context)
  }
  return body
}
