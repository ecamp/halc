# AGENTS.md

halc is the HAL client of eCamp (successor of hal-json-vuex and hal-json-normalizer), published as
one ESM-only npm package with subpath exports. The default branch is `main`. The concept it
implements is [ecamp/ecamp3#11062](https://github.com/ecamp/ecamp3/issues/11062); the README is the
user documentation.

## Commands

Use the Node version from `.nvmrc` and the npm scripts:

```bash
npm ci
npm test                    # all unit, contract and component tests (Vitest)
npx vitest run test/core/client.get.spec.ts -t 'sticky'   # one file / one test
npm run typecheck           # src, test (+ *.test-d.ts type tests) and bench
npm run lint                # ESLint (type-aware) + Prettier --check; npm run lint:fix
npm run coverage
npm run bench               # builds dist first, then benchmarks with budget assertions
npm run build               # tsup (JS) + tsc (declarations) into dist/
npm run check:package       # publint + are-the-types-wrong; run after build
```

Before committing: `npm run lint`, `npm run typecheck` and `npm test` must pass.

TypeScript 7 (`typescript7`, an npm alias) typechecks and emits declarations. TypeScript 6
(`typescript`) is only there as the compiler API for typescript-eslint, which does not support TS 7
yet. Don't call `npx tsc` (that is TS 6); use the scripts.

## Architecture

- `src/core/` is framework-free and imports from no other module. `src/<module>/` (`hal`, `vue`,
  `pinia`, `vuex`, `plain`, `testing`) may only import from `../core/index.js`, never from each
  other. ESLint enforces this (`no-restricted-imports`), so modules can become packages later.
  Each module is a subpath export (`package.json` `exports` + `tsup.config.ts` entry).
- The store holds **records** (`src/core/records.ts`): `{ uri, data, meta }`, plain serializable
  data keyed by normalized URI (base URL stripped, query sorted, API root `''`, see `uri.ts`).
  Relations in `data` are `RelationRef`s recognized by exact shape: `{ href }`,
  `{ href, templated: true }`, `{ hrefs }`. Records are immutable; every write bumps
  `meta.version`. `meta.dirty` holds optimistic changes, read on top of `data`.
- `client.ts` (`HalcClient`) owns loading (in-flight de-duplication, retries, sticky errors),
  writes (always one `store.set` batch per response, then one `reactivity.bump` per record),
  collections, preprocessors and mutations. Reads that start a request must not write or bump
  synchronously (they may run inside Vue effects).
- `wrappers.ts`: loaded records become wrapper objects (one class per entity type, own enumerable
  getters per data key that read the current record and call `reactivity.track`), cached per
  version. Unloaded resources are Proxy **placeholders** that forward to the real wrapper once
  loaded. Embedded lists without own URI are virtual collections (`owner#relation`).
- `mutations.ts`: the `MutationQueue` (serialized per URI; the optimistic `dirty` state is always
  recomputed from the pending mutations) and field-level diffing for PATCH.
- `hal/`: normalizes HAL into records and detects entity types from self links
  (`typeDetection.ts`).
- Adapter interfaces (`StoreAdapter`, `ReactivityAdapter`, `ApiAdapter`, `HttpTransport`) are in
  `src/core/adapters.ts`; public types in `src/core/types.ts`; the public barrel is
  `src/core/index.ts`.

## Conventions

- Relative imports use `.js` extensions (`./client.js`), required by `NodeNext` resolution and the
  emitted declarations.
- Strict TypeScript with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` in `src/`
  (tests have their own `test/tsconfig.json` without the latter).
- Formatting is Prettier with the ecamp3 settings (no semicolons, single quotes, width 90).
- Tests: Vitest without globals. Use `createApi()` and `flush()` from `test/helpers.ts`, fixtures
  from `halc/testing` and `resetFixtureIds()` in `beforeEach`; mock routes instead of stubbing
  `fetch`. Vue component tests opt into `// @vitest-environment happy-dom`.
- `test/contract/v3.spec.ts` ports the hal-json-vuex v3 suite; a behaviour change there must be
  deliberate and explained in the test. Always ask before removing assertions.
- Type-level tests live in `*.test-d.ts` (only typechecked). Benchmarks in `bench/*.bench.ts`
  assert the performance budget and import the built package by its name (`halc`).
- Docs, JSDoc and examples use generic entities (books, chapters, authors, like hal-json-vuex did),
  not eCamp's camps and activities.
- `test/smoke.spec.ts` is the README testing example; keep both in sync. User-facing changes go
  into `CHANGELOG.md` and, if they affect usage, the README.
- Commits are small and explain the why in the message.
