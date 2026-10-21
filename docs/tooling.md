# Tooling

## TypeScript 6 and 7

TypeScript 7 (installed as the npm alias `typescript7`) typechecks and emits declarations; the
scripts call `node node_modules/typescript7/bin/tsc`. TypeScript 7 has no stable compiler API, which
typescript-eslint needs, so TypeScript 6 is installed as `typescript` only for linting. `npx tsc`
runs TypeScript 6: use the npm scripts.

Three tsconfigs are typechecked: the root one (`src/`), `test/tsconfig.json` and
`bench/tsconfig.json`. `tsconfig.build.json` emits declarations with declaration maps and
`stripInternal`: members marked `@internal` don't reach the published types.

## Build output

tsup bundles each subpath entry with code splitting, so all subpaths share one copy of the core
(`instanceof ApiError` holds across `halc` and `halc/hal`). Source maps point into `src/`, which is
published. Declarations are emitted per source file next to the bundles.

Relative imports in `src/` use `.js` extensions (`./client.js`). The emitted declarations keep them,
and `NodeNext` consumers need them.

## Module boundaries

ESLint's `no-restricted-imports` patterns enforce that the core imports no module and modules don't
import each other (`eslint.config.js`). Resolution-based rules like `import-x/no-restricted-paths`
can't resolve `.js` specifiers to `.ts` files and silently check nothing.

## Adding a subpath export

1. Add `src/<name>/index.ts`, importing only from `../core/index.js`.
2. Add the entry to `tsup.config.ts` and to `exports` in `package.json` (types first).
3. Add `<name>` to the module list in `eslint.config.js`.
4. Add optional peer dependencies to `peerDependencies` and `peerDependenciesMeta`.
5. Run `npm run build && npm run check:package`.

## Dependencies

Dev dependencies are pinned, runtime and peer dependencies use ranges. npm install scripts are not
approved and aren't needed (esbuild ships its binary as an optional dependency); the release
workflow installs with `--ignore-scripts`. GitHub Actions are pinned by commit SHA, and Renovate
updates the digests.
