import type { EntityRecord, NormalizeContext, RelationRef } from '../core/index.js'

/** Raised for responses that are not valid HAL, with the JSON path of the problem. */
export class HalFormatError extends Error {
  override name = 'HalFormatError'

  constructor(
    message: string,
    readonly path: string
  ) {
    super(`${message} at ${path}`)
  }
}

export interface NormalizeOptions {
  /** Detects the type of every emitted record. */
  typeOf: (selfLink: string, fragment: unknown) => string | undefined
  /** Describes the parameterised path of a record, for devtools and error messages. */
  resourceOf: (selfLink: string) => string
  /** Link relations that are not relations of the resource. Default `['self', 'curies']`. */
  ignoredLinks?: readonly string[]
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function selfHref(value: unknown): string | undefined {
  if (!isObject(value) || !isObject(value._links)) return undefined
  const self = value._links.self
  return isObject(self) && typeof self.href === 'string' ? self.href : undefined
}

/** An embedded object that only consists of a self link carries no data. */
function isReferenceOnly(value: Json): boolean {
  return (
    Object.keys(value).length === 1 &&
    isObject(value._links) &&
    Object.keys(value._links).length === 1
  )
}

class Normalizer {
  readonly records: EntityRecord[] = []
  private readonly ignoredLinks: ReadonlySet<string>

  constructor(
    private readonly context: NormalizeContext,
    private readonly options: NormalizeOptions
  ) {
    this.ignoredLinks = new Set(options.ignoredLinks ?? ['self', 'curies'])
  }

  resource(fragment: Json, uri: string, path: string): void {
    const index = this.records.length
    this.records.push(undefined as unknown as EntityRecord)

    const data: Json = {}
    for (const [key, value] of Object.entries(fragment)) {
      if (key !== '_links' && key !== '_embedded') data[key] = value
    }

    const links = fragment._links ?? {}
    if (!isObject(links))
      throw new HalFormatError('_links must be an object', `${path}._links`)
    for (const [relation, link] of Object.entries(links)) {
      if (this.ignoredLinks.has(relation)) continue
      data[relation] = this.link(link, `${path}._links.${relation}`)
    }

    const embedded = fragment._embedded ?? {}
    if (!isObject(embedded)) {
      throw new HalFormatError('_embedded must be an object', `${path}._embedded`)
    }
    for (const [relation, value] of Object.entries(embedded)) {
      const relationPath = `${path}._embedded.${relation}`
      if (Array.isArray(value)) {
        data[relation] = this.embeddedList(value, links[relation], relation, relationPath)
      } else if (isObject(value) && selfHref(value) !== undefined) {
        data[relation] = { href: this.embed(value, relationPath) }
      } else {
        data[relation] = value
      }
    }

    const record: EntityRecord = { uri, data, meta: { version: 0, status: 'loaded' } }
    const type = this.options.typeOf(uri, fragment)
    if (type !== undefined) record.meta.type = type
    record.meta.resource = this.options.resourceOf(uri)
    this.records[index] = record
  }

  private embed(fragment: Json, path: string): string {
    const href = selfHref(fragment)
    if (href === undefined)
      throw new HalFormatError('Embedded resource without self link', path)
    const uri = this.context.normalizeUri(href)
    if (!isReferenceOnly(fragment)) this.resource(fragment, uri, path)
    return uri
  }

  private embeddedList(
    list: unknown[],
    link: unknown,
    relation: string,
    path: string
  ): unknown {
    if (list.length > 0 && !list.some((item) => selfHref(item) !== undefined)) {
      // A list of plain objects, not resources.
      return list
    }
    const hrefs = list.map((item, index) => {
      if (!isObject(item))
        throw new HalFormatError(
          'Embedded resource must be an object',
          `${path}[${index}]`
        )
      return this.embed(item, `${path}[${index}]`)
    })

    // A single link next to the embedded list is the URI of the list: store it as a collection.
    if (
      relation !== 'items' &&
      isObject(link) &&
      typeof link.href === 'string' &&
      link.templated !== true
    ) {
      const uri = this.context.normalizeUri(link.href)
      const record: EntityRecord = {
        uri,
        data: { items: { hrefs } },
        meta: { version: 0, status: 'loaded', resource: this.options.resourceOf(uri) },
      }
      const type = this.options.typeOf(uri, undefined)
      if (type !== undefined) record.meta.type = type
      this.records.push(record)
      return { href: uri }
    }
    return { hrefs }
  }

  private link(link: unknown, path: string): RelationRef | null {
    if (link === null) return null
    if (Array.isArray(link)) {
      return {
        hrefs: link.map((entry, index) => {
          if (!isObject(entry) || typeof entry.href !== 'string') {
            throw new HalFormatError('Link without href', `${path}[${index}]`)
          }
          return this.context.normalizeUri(entry.href)
        }),
      }
    }
    if (!isObject(link) || typeof link.href !== 'string') {
      throw new HalFormatError('Link without href', path)
    }
    if (link.templated === true) return { href: link.href, templated: true }
    return { href: this.context.normalizeUri(link.href) }
  }
}

/**
 * Flattens a HAL document into records: the document itself first, then every embedded
 * resource. Relations are replaced by refs, embedded lists become `{ hrefs }`, or a collection
 * record of their own if the document also links to the list.
 */
export function normalizeHal(
  uri: string,
  body: unknown,
  context: NormalizeContext,
  options: NormalizeOptions
): EntityRecord[] {
  if (!isObject(body)) throw new HalFormatError('A HAL document must be an object', '$')
  const normalizer = new Normalizer(context, options)
  const self = selfHref(body)
  normalizer.resource(body, self === undefined ? uri : context.normalizeUri(self), '$')
  return normalizer.records
}
