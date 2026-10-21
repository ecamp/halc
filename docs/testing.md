# Testing

## Layout

| Path                         | What                                                               |
| ---------------------------- | ------------------------------------------------------------------ |
| `test/core/`, `test/hal/`, … | Unit tests per module                                              |
| `test/contract/v3.spec.ts`   | The hal-json-vuex 3 suite, asserted through the wrapper API        |
| `test/core/races.spec.ts`    | Concurrency between running requests and later writes              |
| `test/**/*.test-d.ts`        | Type tests, only typechecked (`npm run typecheck`), never executed |
| `test/smoke.spec.ts`         | The README testing example                                         |
| `bench/*.bench.ts`           | Benchmarks with budget assertions (`npm run bench`)                |

## Conventions

- Vitest without globals. `test/helpers.ts` provides `createApi()` (a mock API with the HAL
  adapter) and `flush()`. Call `resetFixtureIds()` in `beforeEach` so fixture URIs are
  deterministic (`/api/books/000000000001`, …).
- Mock routes on `api.mock` instead of stubbing `fetch`. Limited routes (`.once()`,
  `.timesLimit()`) answer first, in registration order; otherwise the latest route answers.
  Unmocked requests fail. GET fixtures are server state that the default PATCH, POST and DELETE
  answers update.
- Tests have their own `test/tsconfig.json` without `noUncheckedIndexedAccess`. Vuex types don't
  resolve through its package exports, so `test/shims.d.ts` declares the parts the tests use.
- Vue tests that render components opt into `// @vitest-environment happy-dom`. They fail on any
  Vue warning (`console.warn` is asserted in `afterEach`).
- `expectTypeOf(expression)` evaluates the expression at runtime. Assertions about types of
  wrappers that don't exist at runtime belong in `*.test-d.ts` files.
- Verify a regression test fails without the fix (e.g. stash `src/` and run it).

## Benchmarks

Vitest 5 runs benchmarks through the `bench` test fixture
(`test('…', async ({ bench }) => { const result = await bench('…', fn).run() })`) in files matched
by `benchmark.include`, only with `vitest bench`. The budget is asserted on `result.latency.p50`.

Benchmarks import the built package by its name (`halc`), because Vitest's module transform adds
overhead to every export access. `bench/tsconfig.json` maps these imports to `src/` for type
checking, and `npm run bench` builds first.

## In a consumer app before publishing

To try unreleased changes in an app (e.g. ecamp3 in Docker):

1. Pack the package into a directory the app's containers can see:
   `npm pack --pack-destination <app>/common/vendor`.
2. Reference the tarball with a `file:` dependency, then run `npm install <tarball>` in the
   container. The version doesn't change, so a plain `npm install` may keep the old contents.
3. Restart the Vite dev server. Otherwise it serves its old pre-bundled dependencies and the page
   stays blank (504 "Outdated Optimize Dep").

Check in the browser with the app's own client (e.g.
`document.querySelector('#app').__vue_app__.config.globalProperties.api`) to exercise exact code
paths, and restore any data you change.
