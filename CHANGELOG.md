# Changelog

All notable changes to this project are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Reapply pending nested PATCH changes after rollback and on 204 responses without restoring
  failed changes or overwriting confirmed server values.
- Keep recomputed optimistic objects read-only and relations callable after a pending clear.
- Apply nested merge patches to null, missing, array and scalar values using an empty object.

## [1.0.0] - 2026-10-24

First release of halc, the successor of hal-json-vuex 3 and hal-json-normalizer 5
([RFC](https://github.com/ecamp/ecamp3/issues/11062)). See the README for the migration guide.

### Added

- Framework-free core with the hal-json-vuex call surface: `api.get`, relation functions,
  `_meta.load`, `items`/`allItems`, `$reload`, `$post`, `$patch`, `$del`, `$href`, `$loadItems`.
- Adapters behind small interfaces: `halc/hal` (API format), `halc/vue` (reactivity and plugin),
  `halc/vuex`, `halc/pinia` and `halc/plain` (stores), `MemoryStore` and no-op reactivity built in.
- Zero-config entity type detection from self links, exposed as `_meta.type`.
- Optimistic `$post`/`$patch`/`$del` with rollback; `$patch` sends only changed fields.
- Sticky load errors, request de-duplication and retries with backoff for GET requests.
- `ApiError` with method, URI, status, type, body excerpt and parsed body.
- `$toData()`: a mutable copy of an entity's data with relations as URIs, e.g. as form model.
- `$hrefs`, `$hrefSync`, `$hrefsSync`, `$rel`, `_meta.links`, `_meta.error`, `api.status()`,
  `api.invalidate()`.
- Preprocessors for derived fields per entity type.
- Optional `ResourceMap` typing for entity properties and relations.
- `halc/testing`: fixtures, an in-memory mock server, `toMatchRequests`.

[Unreleased]: https://github.com/ecamp/halc/commits/main
