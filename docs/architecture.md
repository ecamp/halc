# Architecture

## Modules

`src/core/` is framework-free and imports from no other module. Every other module in
`src/<module>/` imports only from `../core/index.js`, never from another module, so each can become
a package of its own. ESLint enforces this with `no-restricted-imports` patterns (see
[tooling.md](tooling.md)).

- `records.ts`: the record model and relation refs.
- `client.ts`: `HalcClient`, which owns loading, writing, collections, preprocessors and mutations.
- `wrappers.ts`: wrappers, placeholders and virtual collections.
- `mutations.ts`: the mutation queue and PATCH diffing (see [mutations.md](mutations.md)).
- `uri.ts`: URI normalization.
- `adapters.ts`: the `StoreAdapter`, `ReactivityAdapter`, `ApiAdapter` and `HttpTransport`
  interfaces.
- `types.ts`: public types.
- `index.ts`: the public barrel.

## Records

The store holds one record per normalized URI: `{ uri, data, meta }`, plain and serializable (it
is posted to workers and serialized for SSR). Records are immutable: every write replaces the
record object and gives it a new `meta.version` from a client-wide counter.
Versions are never reused, because caches compare versions for equality, also across a purge.

Relations in `data` are `RelationRef`s, recognized only by their exact shape: `{ href }`,
`{ href, templated: true }`, `{ hrefs: [...] }`. The HAL normalizer must produce exactly these
shapes (it drops link attributes like `title`). Collections are records whose `data.items` is a
`{ hrefs }` ref. A collection's `meta.type` is the type of its items.

`meta.dirty` holds the optimistic state and is read on top of `data`. It is always derived from the
pending mutations, never edited directly.

Record data is deep-frozen when written, so code mutating values read from a wrapper fails loudly.

An `ApiAdapter.normalize()` must return new record objects: the client completes their meta in place
to avoid copying thousands of records per response. The HAL normalizer merges repeated
occurrences of a resource within one document (the outermost wins).

## URIs

Store keys are normalized URIs:

- The API base path is removed, at a segment boundary only.
- Query parameters are sorted, and the API root is always `''`.
- Absolute URLs of the API's origin are made relative, while URLs on the same origin but outside
  the API path stay absolute.
- A relative `baseUrl` (e.g. `/api`) is resolved against `location.origin` in browsers.

Everything halc hands out (`_meta.self`, `$href`, `$hrefSync`, …) is normalized, also expanded
templated links. `resolveUrl()` turns a normalized URI into a URL for requests or navigation.

## Wrappers

A loaded record is exposed as a wrapper:

- **Class:** one per entity type, and separate ones for collections. Only collection wrappers
  have `items`/`allItems`.
- **Data properties:** each data key, and `_meta`, is an own, enumerable getter. Every read goes to
  the current record and calls `reactivity.track(uri)`. So `{ ...wrapper }` keeps `_meta`, the
  values and working relation functions.
- **Relations:** relation refs read as accessor functions, cached per wrapper and key.
- **Caching:** wrappers are cached per version, so `api.get(uri)` returns the same object until the
  record changes.
- **Fixed property set:** a wrapper's own properties are defined when it is created. Keys a later
  version adds only appear on wrappers created afterwards.
- **Derived fields:** preprocessor fields are non-enumerable getters on the per-type prototype.
  They are memoized per record version plus the versions of all records read through `ctx.get()`.
  Collections never run preprocessors.

`items` arrays are frozen and cached per collection version plus a global write generation. A
collection's version must change whenever its visible items change. Example: `del()` bumps every
collection listing the item, because the `deleting` flag of the item filters it out of `items`.

## Placeholders

A resource that isn't loaded is a Proxy placeholder, either for a known URI or for a relation of an
unloaded resource (whose URI is unknown).

- **Unknown properties:** they can't be told apart from relations before the data arrives, so
  every unknown string property is a callable accessor that renders as `''`.
- **Reserved names:** `then`, symbols and `__`-prefixed names (framework probes such as Vue's
  `__v_isRef`) return `undefined`, so placeholders are not mistaken for promises or refs.
- **After loading:** once the resource is loaded, every trap forwards to the real wrapper, so a
  placeholder held by a view keeps working. Property descriptors are reported as configurable data
  values to satisfy Proxy invariants.
- **Reactivity:** `markRaw` from the reactivity adapter defines `__v_skip` on the proxy target, and
  the get trap answers from the target first.

## Loading

- In-flight GETs are de-duplicated per URI, including all retries.
- A first load writes nothing until the response arrives: the in-flight entry is what makes
  `status()` report `loading`. Each response is one `store.set` batch, followed by one
  `reactivity.bump` per record.
- **Reads never write synchronously.** `get()`, `items`, `_meta.load` and every other read may run
  inside a reactive effect. The requests they start must not write to the store or bump before
  the response arrives. Writes from user actions (`reload`, mutations) may.
- **Sticky errors:** a failed load stores an `error` record. Reads return it without a request
  until `reload`, `invalidate` or new data, so views re-rendering on missing resources don't loop.
  A 404/410 for a loaded record also reloads the records that referenced it.

## Write fence

Responses of requests that started before a later write must not undo it.

- Writes that must win record an epoch per URI: mutation results, `invalidate`, removals and
  `purgeAll` (for every URI).
- Every GET remembers the epoch it started at, and records changed since then are dropped from its
  response (and its errors are ignored).
- A forced load (a reload) does not join an in-flight request that started before such a write.

Any new write path that represents newer state than a running request's response must record its
epoch.

## Reactivity

The only reactive granularity is the version of a URI: `track(uri)` on every read, `bump(uri)`
after every write. Store adapters never provide reactivity: Pinia and Vuex hold raw records, and
their adapters read from the raw objects so reads don't create dependencies on the store state.
`halcVue` installs the Vue adapter when the client still has the no-op adapter.

## Client methods

The public methods of the client are bound to the instance and typed with `this: void`, because
consumers pass them around detached. A new public method joins that list.
