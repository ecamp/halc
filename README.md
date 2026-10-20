# halc

The **HAL client** that does the heavy lifting for talking to your HAL (or other linked data) API. 💪🏽🟢

halc loads resources from a HAL API, keeps them in a normalized store and hands them to your views
as plain objects with relation functions:

```js
const book = api.get('/books/1')
book._meta.loading // true at first, then false
book.chapters().items // [] while loading, then the chapters
await book.$patch({ title: 'There and Back Again' }) // optimistic, sends only what changed
```

It is the successor of [hal-json-vuex](https://github.com/ecamp/hal-json-vuex) and
[hal-json-normalizer](https://github.com/carlobeltrame/hal-json-normalizer), written from scratch in
TypeScript ([RFC](https://github.com/ecamp/ecamp3/issues/11062)):

- **Same interface as hal-json-vuex** for the common calls, see [Migrating](#migrating-from-hal-json-vuex).
- **Modular**: store (Vuex, Pinia, in-memory, read-only snapshot), reactivity (Vue or none) and API
  format (HAL) are adapters behind small interfaces. The core depends on none of them.
- **Zero-config**: entity types (`Book`, `AudioBook`, …) are detected at runtime from self links.
- **Fast**: one store write per response, reactivity only per entity version, wrappers are cached
  plain objects and `items` are plain arrays.
- **Optimistic mutations** with rollback; `$patch` sends only the fields that changed.
- **Robust loading**: requests are de-duplicated, failures are sticky (no request loops), and network
  errors, 429 and 5xx are retried with backoff.
- **Preprocessors** for derived fields per entity type.
- **Testing helpers**: fixtures, an in-memory mock server and request matchers.

## Contents

- [Installation](#installation)
- [Setup](#setup)
- [Reading](#reading)
- [Writing](#writing)
- [Errors and retries](#errors-and-retries)
- [Preprocessors](#preprocessors)
- [TypeScript](#typescript)
- [Modules](#modules)
- [Testing](#testing)
- [Migrating from hal-json-vuex](#migrating-from-hal-json-vuex)
- [Known limitations](#known-limitations)
- [Architecture](#architecture)
- [Development](#development)

## Installation

```sh
npm install halc
```

halc is ESM only and has a single dependency (`url-template`). `vue` (≥ 3.4), `pinia` and `vuex` are
optional peer dependencies: install the ones you use.

## Setup

### Vue 3 with Vuex

```js
import { createHalc, createFetchTransport } from 'halc'
import { hal } from 'halc/hal'
import { halcVue } from 'halc/vue'
import { createVuexStore } from 'halc/vuex'

const api = createHalc({
  adapter: hal,
  baseUrl: 'https://example.com/api',
  store: createVuexStore(store), // registers the Vuex module `api`
  transport: createFetchTransport({ credentials: 'include' }),
})

app.use(halcVue(api)) // this.api in components, useApi() in setup()
```

With Pinia, use `store: createPiniaStore(pinia)` from `halc/pinia`. Without `store`, records live in
a `MemoryStore`, which is just as reactive: reactivity is handled by `halc/vue`, not by the store.

### Without a framework

```js
import { createHalc } from 'halc'
import { hal } from 'halc/hal'

const api = createHalc({ adapter: hal, baseUrl: 'https://example.com/api' })
const book = await api.get('/books/1')._meta.load
```

### Options

| Option                   | Default             | Description                                                                          |
| ------------------------ | ------------------- | ------------------------------------------------------------------------------------ |
| `adapter`                | (required)          | The API format, `hal` from `halc/hal`                                                |
| `baseUrl`                |                     | Absolute URL of the API root. It is removed from URIs, so `_meta.self` is `/books/1` |
| `store`                  | `new MemoryStore()` | Where records live                                                                   |
| `reactivity`             | no-op               | Who is notified about changes; `halcVue()` installs Vue reactivity                   |
| `transport`              | `fetch`             | Sends requests; `createFetchTransport({ fetch, credentials })` or your own           |
| `headers`                | `{}`                | Headers for every request, on top of `Accept`                                        |
| `interceptors`           | `[]`                | `(request) => request` functions, e.g. for authentication                            |
| `retry`                  | 3 retries           | Retry policy for GET requests, `false` to disable                                    |
| `optimistic`             | `true`              | Apply mutations before the API confirms them                                         |
| `avoidNPlusOneRequests`  | `true`              | Reload a collection before loading its unknown items one by one                      |
| `forceRequestedSelfLink` | `false`             | Store a GET response only under the requested URI, even if its self link differs     |
| `preprocessors`          | `{}`                | [Derived fields](#preprocessors) per entity type                                     |

## Reading

```js
api.get(uri) // wrapper for a URI (or a wrapper), loaded from the API if needed
api.get() // the API root
api.reload(uriOrEntity) // Promise of the reloaded wrapper
api.href(uriOrEntity, 'relation', params) // Promise of a relation's URI
api.invalidate(uriOrEntity) // mark as outdated: the next read reloads it
api.purge(uriOrEntity) // forget, without telling the API; api.purgeAll() forgets everything
api.isUnknown(uri)
api.resolveUrl(uri) // the URL of a normalized URI, e.g. to navigate to an href
api.status(uri) // 'loading' | 'loaded' | 'stale' | 'error' | 'placeholder' | undefined
```

`api.get()` never waits. A loaded resource is returned from the store without a request, until it is
reloaded or invalidated. Otherwise a **placeholder** is returned and the request is sent; your view
updates once the data is there.

### Wrappers

A wrapper exposes the properties of a resource as plain properties, relations as functions, and a
small API whose names start with `$` or `_`:

```js
book.title // a property
book.author() // a to-one relation: another wrapper
book.chapters() // a to-many relation: a collection
book.reviews({ rating: 5 }) // a templated link, expanded with these parameters
book['ht:publisher']() // or book.$rel('ht:publisher'), for relation names that are no identifiers

book._meta.self // '/books/1' (the API base URL removed)
book._meta.selfUrl // 'https://example.com/api/books/1'
book._meta.load // Promise of the loaded wrapper, rejects with an ApiError
book._meta.loading // true until the first load finished (not during reloads)
book._meta.type // 'Book', detected from the self link
book._meta.links // the raw relations: { author: { href: '/authors/1' }, … }
book._meta.dirty // optimistic changes not yet confirmed by the API
book._meta.deleting // true while a DELETE is in flight
book._meta.error // the ApiError of the last failed load or mutation

book.$reload()
book.$href('author') // Promise<string | undefined>, waits for the book to load
book.$hrefSync('author') // string | undefined, never sends a request
book.$hrefs('chapters') // Promise<string[]>: every URI of a to-many relation
book.$hrefsSync('chapters') // string[] | undefined
```

Wrappers are plain objects: spreading (which keeps `_meta` and the relation functions) and
`JSON.stringify` work, and Vue never makes them reactive
(they are marked raw). Their data is **frozen**: change data with `$patch`, not by mutating objects.
A wrapper always reads the current data of its record, but `api.get(uri)` returns a new wrapper after
every change. Read resources in templates, computed properties and watchers rather than storing
wrappers in `data()`.

### Collections

```js
const chapters = book.chapters()
chapters.items // the items without those being deleted: a frozen plain array
chapters.allItems // including those being deleted
await chapters.$loadItems() // waits until every item settled
```

`items` is `[]` while the collection loads, never `undefined`. Items that are not in the store are
loaded on access (with `avoidNPlusOneRequests`, the collection itself is reloaded first, in the hope
that the API embeds them). `$loadItems()` settles per item: an item that fails gets `_meta.error`, the
others are unaffected, and it only rejects if every item failed.

Embedded lists without a URI of their own (e.g. chapters embedded into a book) are **virtual
collections**: their `_meta.self` is `'/books/1#chapters'`, `api.get('/books/1#chapters')` works, and
reloading them reloads the book. They cannot be posted to.

### Placeholders

While a resource is loading, `api.get()` and relation functions return placeholders, so that chains
like `api.get(uri).author().books().items` work right away:

- `_meta.loading` is `true`, `_meta.self` is the URI (`undefined` for relations of unloaded
  resources, whose URI is not known yet), `items` is `[]`, and `_meta.load` resolves once the data
  arrived.
- Every other property is a relation function returning another placeholder. Since a placeholder
  cannot know which names are relations before the data arrives, properties read from a placeholder
  are such functions too; they render as an empty string. Check `_meta.loading` before using values
  of a resource that may not be loaded.
- `$post`, `$patch`, `$del`, `$href`, `$hrefs` and `$loadItems` wait for the load.

Once loaded, a placeholder forwards everything to the real wrapper.

## Writing

```js
await api.post(collectionOrUri, data, options) // resolves to the created resource (or null)
await api.patch(uriOrEntity, data, options) // resolves to the updated resource
await api.del(uriOrEntity) // resolves once the resource and its references are updated
// or on wrappers:
await chapters.$post({ title: 'Prologue' })
await chapter.$patch({ title: 'Epilogue' })
await chapter.$del()
```

Mutations are **optimistic** by default: the change is visible at once and rolled back if the API
refuses it. Pass `{ optimistic: false }` per call, or as client option, to wait for the API first.
Mutations of the same URI run one after another, the others in parallel; `api.pendingMutations`
lists the ones in flight.

- **PATCH** sends only the top-level fields whose value changed, so `$patch({ ...form })` transmits
  only what the user touched, and nothing if nothing changed. Relations can be given as URIs or
  wrappers; wrappers are sent as IRIs. `{ force: true }` sends every given field. The body is a JSON
  merge patch (`application/merge-patch+json`). After a `409 Conflict`, the resource is reloaded. A
  `204 No Content` keeps the change and reloads the resource.
- **POST** adds a temporary item (`urn:tmp:…`) to the collection, replaces it with the created
  resource when the API answers, and then reloads the collection, so server-side ordering and filters
  win (`{ reload: false }` skips that). A `204` with a `Location` header loads that URI. Post to the
  URI of the collection you display (e.g. `book.chapters()`) to see the new item at once.
- **DELETE** hides the item from `items` (not from `allItems`) while the request runs. Afterwards,
  everything that referenced the resource is reloaded and the resource is removed from the store.

## Errors and retries

Every failure rejects with an `ApiError`:

```js
try {
  await book.$patch({ title: '' })
} catch (error) {
  error.method // 'PATCH'
  error.uri // '/books/1'
  error.status // 422 (undefined for network errors)
  error.type // 'Book'
  error.data // the parsed body, e.g. problem details with violations
  error.bodyExcerpt // the beginning of the raw body
  error.response // { status, headers, data }, like an axios response
}
```

- A response with an unexpected content type (e.g. an HTML login page) fails with a clear message
  instead of a JSON parse error.
- **Failures are sticky**: after a failed GET, `api.get(uri)` returns a placeholder with
  `_meta.error` set and a rejecting `_meta.load`, without sending another request, until `$reload()`,
  `api.invalidate()` or new data for that URI. A view that asks for a deleted entity on every render
  sends one request, not hundreds.
- **Retries**: network errors, `429` and `5xx` are retried with exponential backoff and jitter
  (0.5 s, 2 s, 8 s; `Retry-After` is honoured), sharing one promise between all callers. Other answers
  are final. Configure with `retry: { retries, baseDelay, factor, maxDelay, jitter }` or
  `retry: false`. Mutations are never retried.
- A `404` for a loaded resource means it is gone: whatever referenced it is reloaded.

## Preprocessors

Preprocessors add derived fields to every entity of a type, including embedded ones (but not to
collections, although a collection of chapters also has the type `Chapter`):

```js
const preprocessors = {
  Chapter: (chapter, ctx) => ({
    publishedAt: new Date(chapter.published),
    bookTitle: ctx.get(chapter.$hrefSync('book'))?.title,
  }),
}
const api = createHalc({ adapter: hal, preprocessors })

api.get(chapterUri).bookTitle
```

A preprocessor must be pure and must not send requests. It runs when a derived field of an entity is
read (and once when the first entity of its type is read, to learn the field names), and its result is
memoized per version of the entity; other resources read through `ctx.get()` (which never loads
anything) are tracked, so the derived fields are recomputed when they change. Derived fields are not enumerable, so they never end
up in `$patch({ ...entity })`, and they never shadow properties of the entity: use distinct names.

## TypeScript

halc works untyped: without further setup, every wrapper is a generic `Resource`, so the halc API
of the wrappers you get from the client (`_meta`, `$patch`, `items`, …) is typed and completes,
while entity properties and the results of relation functions are `any` (call `.as<'Type'>()` or
describe the types to go further). JavaScript projects get the same completion in editors.

For typed entities, describe them in the `ResourceMap`:

```ts
import type {
  Collection,
  Entity,
  InferPreprocessed,
  Preprocessors,
  Templated,
} from 'halc'

export const preprocessors = {
  Chapter: (chapter) => ({ publishedAt: new Date(chapter.published) }), // chapter is typed
} satisfies Preprocessors

declare module 'halc' {
  interface ResourceMap {
    Book: Entity<
      { title: string; subtitle: string | null },
      {
        chapters: Collection<'Chapter'> // to-many
        author: 'Author' // to-one
        reviews: Templated<Collection<'Review'>, { rating?: number }>
      }
    >
    Chapter: Entity<{ title: string; published: string }, { book: 'Book' }>
  }
  // Fields added by preprocessors:
  interface PreprocessedFields extends InferPreprocessed<typeof preprocessors> {}
}

const book = api.get<'Book'>('/books/1') // or api.get('/books/1').as<'Book'>()
book.chapters().items[0].book().title // string
book.chapters().items[0].publishedAt // Date
await book.$patch({ author: '/authors/2' }) // relations take URIs or wrappers
```

Type names are the ones detected at runtime (`_meta.type`). Preprocessors of types in the map receive
`BaseOf<'Book'>` (the wrapper without derived fields). `halc/vue` types `this.api` in Options API
components.

## Modules

| Import                | Contents                                                                              |
| --------------------- | ------------------------------------------------------------------------------------- |
| `halc`                | The client, `ApiError`, `MemoryStore`, `createFetchTransport`, the adapter interfaces |
| `halc/hal`            | The HAL adapter                                                                       |
| `halc/vue`            | Vue 3 reactivity, the `halcVue` plugin, `useApi()`                                    |
| `halc/vuex`           | Store adapter for Vuex 4                                                              |
| `halc/pinia`          | Store adapter for Pinia                                                               |
| `halc/plain`          | Read-only store over a snapshot, e.g. in a worker                                     |
| `halc/testing`        | Fixtures, mock server and request matchers                                            |
| `halc/testing/vitest` | Registers the matchers with Vitest                                                    |

The core never imports any of the other modules, so they can become packages of their own later.

### `halc/hal`

`hal` is the adapter with default options, `createHalAdapter(options)` configures one. Embedded
resources become records of their own, links become relations, and every record gets a type from its
self link: the last path segment that is not an id, singularised and PascalCased.

| Self link                                      | Type                    |
| ---------------------------------------------- | ----------------------- |
| `/books/4b2c6f1a9e3d`                          | `Book`                  |
| `/chapters?book=%2Fapi%2Fbooks%2F4b2c6f1a9e3d` | `Chapter` (collection)  |
| `/library/audio_books/9f8e7d6c5b4a`            | `AudioBook`             |
| `/books/4b2c6f1a9e3d/categories`               | `Category` (collection) |
| `/` (the API root)                             | `Root`                  |

Ids are path segments of digits, UUIDs, ULIDs or hex of 8 or more characters. A string `@type` in the
resource wins. For APIs that deviate from the convention:

```js
import { createHalAdapter, defaultTypeRules } from 'halc/hal'

const adapter = createHalAdapter({
  types: [
    { match: /^\/users\/[^/]+\/settings$/, type: 'UserSettings' },
    ...defaultTypeRules,
  ],
  // or replace detection completely: typeOf: (selfLink, fragment) => ...
  contentTypes: { PATCH: 'application/json' }, // request body content type per method
})
```

### `halc/vue`

`halcVue(client, { name: 'api' })` installs the client as `this.api` and for `useApi()`, and switches
the client to Vue reactivity: one version counter per URI, see [Architecture](#architecture).
`createVueReactivity()` is available for manual setups.

### `halc/vuex` and `halc/pinia`

`createVuexStore(store, { moduleName: 'api' })` registers a namespaced Vuex module with the mutations
`set`, `patchMeta` and `remove`. `createPiniaStore(pinia, { id: 'api' })` defines a Pinia store with
actions of the same names. Both write once per response and keep the records out of Vue's deep
reactivity.

### `halc/plain`

Runs the same wrapper code in a worker (e.g. for client-side PDF rendering), on a snapshot of the
store of the main thread:

```js
// main thread
worker.postMessage({ records: api.store.snapshot() })

// worker
import { createHalc } from 'halc'
import { hal } from 'halc/hal'
import { PlainObjectStore } from 'halc/plain'

const api = createHalc({ adapter: hal, store: new PlainObjectStore(records) })
api.get(bookUri).chapters().items // works like on the main thread
```

Reading something that is not in the snapshot throws, and nothing is ever requested.

## Testing

`halc/testing` builds HAL documents from type names and serves them from an in-memory mock server,
behind a real client:

```js
import { hal } from 'halc/hal'
import { createMockApi, fixture } from 'halc/testing'
import 'halc/testing/vitest' // registers toMatchRequests

const api = createMockApi({ adapter: hal })
const book = fixture('Book', {
  title: 'The Hobbit',
  chapters: [
    fixture('Chapter', { title: 'An Unexpected Party' }),
    fixture('Chapter', { title: 'Roast Mutton' }),
  ],
})
api.mock.get(book) // the route is the fixture's self link: /api/books/000000000003
api.mock.get(book.chapters) // the chapters collection of the book
api.mock.patch(book).reply(200, (current) => ({ ...current, title: 'Renamed' }))

const loaded = await api.get(book._meta.self)._meta.load
await loaded.chapters()._meta.load
expect(loaded.chapters().items).toHaveLength(2)
await loaded.$patch({ title: 'Renamed' })
expect(api.mock.requests).toMatchRequests([
  { method: 'GET', type: 'Book' },
  { method: 'GET', type: 'Chapter' },
  { method: 'PATCH', type: 'Book', body: { title: 'Renamed' } },
])
```

- `fixture(type, properties, { self, embed })`: nested fixtures become links (or embeds, with
  `embed: true` or a list of relation names); arrays of fixtures become a collection of their own.
  Ids are deterministic; `resetFixtureIds()` restarts them (e.g. in `beforeEach`).
- Routes: `api.mock.get|post|patch|put|delete(fixtureOrUri)`, configured with
  `.reply(status, body or (current, request) => body, headers)`, `.status(409)`, `.delay(ms)`,
  `.once()`, `.timesLimit(n)` and `.networkError()`. Limited routes answer first, in order;
  otherwise the latest route wins. Unmocked requests fail.
- Fixtures registered for GET are server state: the default PATCH, POST and DELETE answers update it,
  so reloads after a mutation see the change.
- `api.mock.requests` lists every request with method, URI, type, headers and parsed body.
  `api.store.snapshot()` is plain data to compare with `toEqual`.

## Migrating from hal-json-vuex

```diff
-import HalJsonVuex from 'hal-json-vuex'
-const api = new HalJsonVuex(store, axiosInstance, { forceRequestedSelfLink: true })
-app.use(api)
+import { createHalc, createFetchTransport } from 'halc'
+import { hal } from 'halc/hal'
+import { halcVue } from 'halc/vue'
+import { createVuexStore } from 'halc/vuex'
+const api = createHalc({
+  adapter: hal,
+  baseUrl: API_ROOT_URL,
+  store: createVuexStore(store),
+  transport: createFetchTransport({ credentials: 'include' }),
+  forceRequestedSelfLink: true,
+})
+app.use(halcVue(api))
```

Axios is no longer used: pass headers through `headers` or `interceptors`. PATCH bodies are sent as
`application/merge-patch+json` by default. The calls stay the same (`api.get`, relation functions,
`_meta.load`, `_meta.loading`, `_meta.self`, `items`, `allItems`, `$reload`, `$post`, `$patch`,
`$del`, `$href`, `$loadItems`, `api.href`, `api.reload`, `api.purge`, `api.purgeAll`,
`api.isUnknown`). Deliberate changes:

- `_meta.load` of a placeholder resolves only once the data is there, and it rejects with an
  `ApiError`. It replaces `ServerException`: `error.response.status`, `.data` and `.headers` still
  work, but `error.name` is `'ApiError'`.
- `items` of an unloaded collection is `[]`, never `undefined`, and always a plain frozen array (no
  more `find`/`filter` returning placeholders).
- Relation functions of unloaded resources return placeholders whose `_meta.load` rejects if the
  relation turns out not to exist.
- Mutations are optimistic and `$patch` sends only changed fields. Opt out with `optimistic: false`
  or `force: true` where that matters.
- Data read from wrappers is frozen: mutating it throws.
- After a failed GET, the resource is not requested again until it is reloaded (sticky errors), and
  entities deleted by a cascade end up in that state instead of being removed from the store.
- POST reloads the target collection afterwards.
- `$href` and `api.href` return normalized URIs for templated links too (v3 returned them with the
  API path). Use `api.resolveUrl(href)` where a URL is needed, e.g. to redirect the browser.
- The Vuex module holds records (`{ uri, data, meta }`) instead of v3's store data, and embedded lists
  are no longer stored under virtual keys (`api.get('/books/1#chapters')` still works).
- The API root is always `''` (v3 sometimes stored it as `'/'`).

## Known limitations

These behave like in hal-json-vuex:

- A wrapper reads current data, but its set of properties is fixed when it is created. If a later
  response adds a property the record did not have (e.g. an API that omits `null` values), only
  wrappers obtained afterwards (`api.get(uri)`, relation functions, `items`) have it.
- Plain JSON objects that look exactly like a relation (`{ href }`, `{ href, templated: true }` or
  `{ hrefs: [...] }`) are treated as one.
- Query strings are re-encoded when their parameters are sorted, so `?flag` is requested as `?flag=`.

## Architecture

The core keeps a flat, normalized table of **records** (`{ uri, data, meta }`: plain, serializable
data, keyed by normalized URI) in the store, and derives **wrappers** from it. A request flows like
this:

1. `api.get(uri)` asks the store. A loaded record is returned as its cached wrapper, a record in error
   state as a placeholder with the error, both without a request.
2. Otherwise the request is sent, or an in-flight request for the same URI is joined.
3. The API adapter normalizes the response into records: the resource and everything embedded, each
   with its detected type.
4. The records are written to the store in one batch, and the reactivity adapter is notified once per
   written record.
5. Wrappers of changed records are rebuilt on the next read; components that read them re-render.

Reactivity is tracked per record version: Vue components depend on a version counter per URI they
read, never on the data itself. Every write goes through a mutation queue that keeps the pending
mutations as plain data, so the optimistic state can be recomputed when any of them settles.

The store, reactivity, API format and HTTP transport are interfaces (`StoreAdapter`,
`ReactivityAdapter`, `ApiAdapter`, `HttpTransport`), and the record meta reserves fields for HTTP
revalidation and pagination, so these features can be added without changing the interfaces.

## Development

```sh
npm ci
npm test              # unit, contract and component tests
npm run typecheck     # TypeScript 7
npm run lint          # ESLint and Prettier (npm run lint:fix fixes)
npm run coverage
npm run bench         # benchmarks with the performance budget
npm run build         # dist/: bundled ESM, declarations and source maps
npm run check:package # publint and are-the-types-wrong on the packed package
```

How to release is described in [`.agents/skills/release/SKILL.md`](.agents/skills/release/SKILL.md).

Sources are typechecked and their declarations emitted by TypeScript 7; TypeScript 6 is only
installed as the compiler API that typescript-eslint needs.

## License

[MIT](LICENSE)
