# AGENTS.md

halc is a HAL API client, published as one ESM-only npm package with subpath exports (`halc`,
`halc/hal`, `halc/vue`, `halc/pinia`, `halc/vuex`, `halc/plain`, `halc/testing`). The default
branch is `main`. The README is the user documentation. The main consumer is eCamp v3
(`ecamp/ecamp3`), whose expectations come from the predecessor library hal-json-vuex.

## Commands

Use the Node version from `.nvmrc` and the npm scripts:

```bash
npm ci
npm test                    # unit, contract and component tests (Vitest)
npx vitest run test/core/client.get.spec.ts -t 'sticky'   # one file / one test
npm run typecheck           # src, test (incl. *.test-d.ts) and bench, with TypeScript 7
npm run lint                # ESLint (type-aware) + Prettier --check; npm run lint:fix
npm run coverage
npm run bench               # builds dist first, then benchmarks with budget assertions
npm run build               # tsup (JS) + tsc (declarations) into dist/
npm run check:package       # publint + are-the-types-wrong; run after build
```

`npm run lint`, `npm run typecheck` and `npm test` must pass for every commit. Never call
`npx tsc` (see [docs/tooling.md](docs/tooling.md)).

## Further docs (read when relevant)

- [docs/architecture.md](docs/architecture.md): records, URIs, wrappers, placeholders, loading,
  the write fence and reactivity. Read before changing anything in `src/core/`.
- [docs/mutations.md](docs/mutations.md): mutation queue, optimistic state, PATCH diffing, POST
  temporary items. Read before changing POST, PATCH or DELETE.
- [docs/compatibility.md](docs/compatibility.md): behaviour consumers rely on. Read before
  changing anything users can observe.
- [docs/testing.md](docs/testing.md): test layout and conventions, mock server, type tests,
  benchmarks, trying unreleased changes in a consumer app.
- [docs/tooling.md](docs/tooling.md): TypeScript 6/7, build output, module boundaries, adding a
  subpath export, dependencies.
- Releasing: the `release` skill in `.agents/skills/release/SKILL.md` (`.claude` links to
  `.agents`).

## Conventions

- **Small, reviewable commits:** one concern per commit, each passing lint, typecheck and tests.
  The subject follows Conventional Commits. The body states the why briefly and objectively, only
  when it isn't obvious, with no figures of speech.
- **Where documentation goes**, in this order:
  1. Make the code speak for itself: split and name methods, variables and tests so they are
     self-explanatory.
  2. User-facing behaviour goes into the README. If it differs from hal-json-vuex, it also goes
     into the README's migration section. Contributor knowledge goes into `docs/`.
  3. The reasoning behind a change goes into the commit message, not into code comments.
  4. `CHANGELOG.md` entries only for user-facing changes.
  5. Public API members get JSDoc (it shows up in editors). Other comments only when the
     information is relevant every time the code is read and can't be expressed otherwise. Keep
     them shorter and rarer than the comments around them.
- **No history in docs:** write documentation as if the current code were the first version ever
  written. Don't mention earlier implementations, previous decisions or review rounds. Comments
  never refer to names or locations in other files. Docs may name files and public APIs, but not
  internal identifiers.
- **Write down surprises:** when you discover or establish a non-obvious convention, pitfall or
  invariant that will matter again, add it here or to the matching `docs/` file. Keep this file
  short and move details to `docs/`. Behaviour that a regression test covers needs no prose.
- **Generic examples:** the README, JSDoc and docs use generic entities (books, chapters, authors,
  reviews), never eCamp's (camps, activities, …), also in URIs and type names.
- `test/smoke.spec.ts` is the README testing example; keep both in sync.
- Relative imports use `.js` extensions; strict TypeScript; Prettier with no semicolons, single
  quotes, width 90.
- Always ask before removing assertions from tests, especially in `test/contract/`.
