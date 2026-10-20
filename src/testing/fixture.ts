/**
 * Builds HAL documents from type names and plain objects, so tests contain no URIs.
 *
 * ```ts
 * const book = fixture('Book', {
 *   title: 'The Hobbit',
 *   chapters: [fixture('Chapter', { title: 'An Unexpected Party' })],
 * })
 * book._meta.self    // '/api/books/000000000002'
 * book.chapters      // the fixture of the chapters collection, for mocking it
 * ```
 */

export interface FixtureMeta {
  /** The self link of the fixture. */
  self: string
  /** The type name the fixture was created for. */
  type: string
}

/** A HAL document with non-enumerable helpers: `_meta` and one fixture per relation. */
export type Fixture = Record<string, unknown> & {
  readonly _meta: FixtureMeta
  readonly _links: Record<string, unknown>
}

export interface FixtureOptions {
  /** Overrides the generated self link. */
  self?: string
  /** Embed relations instead of only linking them: all (`true`) or the named ones. */
  embed?: boolean | readonly string[]
}

const fixtures = new WeakSet()
let basePath = '/api'
let counter = 0

/** Sets the path prefix of generated self links (default `/api`). */
export function setFixtureBasePath(path: string): void {
  basePath = path.replace(/\/+$/, '')
}

/** Restarts the id sequence, so ids are deterministic in every test. */
export function resetFixtureIds(): void {
  counter = 0
}

/** A 12 character hex id, which type detection recognizes as id. */
export function nextFixtureId(): string {
  counter += 1
  return counter.toString(16).padStart(12, '0')
}

export function isFixture(value: unknown): value is Fixture {
  return typeof value === 'object' && value !== null && fixtures.has(value)
}

function snakeCase(name: string): string {
  return name
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase()
}

/** `Chapter` → `chapters`, `AudioBook` → `audio_books`, `Category` → `categories`, `Box` → `boxes`. */
export function pluralPath(type: string): string {
  const name = snakeCase(type)
  if (/[^aeiou]y$/.test(name)) return name.slice(0, -1) + 'ies'
  if (/(s|x|z|ch|sh)$/.test(name)) return name + 'es'
  return name + 's'
}

function shouldEmbed(options: FixtureOptions, relation: string): boolean {
  return Array.isArray(options.embed)
    ? options.embed.includes(relation)
    : options.embed === true
}

function define(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: false, configurable: true })
}

function finish(document: Record<string, unknown>, meta: FixtureMeta): Fixture {
  define(document, '_meta', meta)
  fixtures.add(document)
  return document as Fixture
}

/** A collection fixture: a HAL document embedding the given items under `items`. */
export function collectionFixture(
  itemType: string,
  items: readonly Fixture[],
  options: { self?: string } = {}
): Fixture {
  const self = options.self ?? `${basePath}/${pluralPath(itemType)}`
  return finish(
    {
      totalItems: items.length,
      _links: {
        self: { href: self },
        items: items.map((item) => ({ href: item._meta.self })),
      },
      _embedded: { items: [...items] },
    },
    { self, type: itemType }
  )
}

/**
 * Creates a HAL document of the given type. Nested fixtures become links (or embeds, see
 * {@link FixtureOptions.embed}): a fixture is a to-one relation, an array of fixtures a to-many
 * relation with a collection of its own.
 */
export function fixture(
  type: string,
  properties: Record<string, unknown> = {},
  options: FixtureOptions = {}
): Fixture {
  const self = options.self ?? `${basePath}/${pluralPath(type)}/${nextFixtureId()}`
  const { _links: extraLinks, ...rest } = properties as {
    _links?: Record<string, unknown>
  }
  const document: Record<string, unknown> = {}
  const links: Record<string, unknown> = { self: { href: self } }
  const embedded: Record<string, unknown> = {}
  const relations: Record<string, Fixture> = {}

  for (const [key, value] of Object.entries(rest)) {
    if (isFixture(value)) {
      links[key] = { href: value._meta.self }
      if (shouldEmbed(options, key)) embedded[key] = value
      relations[key] = value
    } else if (Array.isArray(value) && value.length > 0 && value.every(isFixture)) {
      const items = value
      const collection = collectionFixture(items[0]?._meta.type ?? 'Resource', items, {
        self: `${self}/${snakeCase(key)}`,
      })
      links[key] = { href: collection._meta.self }
      if (shouldEmbed(options, key)) embedded[key] = items
      relations[key] = collection
    } else {
      document[key] = value
    }
  }

  document._links = { ...links, ...extraLinks }
  if (Object.keys(embedded).length > 0) document._embedded = embedded
  for (const [key, relation] of Object.entries(relations)) define(document, key, relation)
  return finish(document, { self, type })
}
