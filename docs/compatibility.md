# Compatibility

halc keeps the call surface and the semantics of hal-json-vuex 3 that consumer code depends on.
Every deliberate difference is listed in the README section "Migrating from hal-json-vuex". A change
of observable behaviour is either compatible with that, or added to that list together with a
CHANGELOG entry.

Behaviour consumers rely on, which is easy to break unknowingly:

- `{ ...entity }` keeps `_meta`, the data and working relation functions. Consumers spread entities
  into view models.
- Only collections have `items`: `'items' in value` tells a collection from a single resource.
- Client methods work detached (`const { get } = api`, `apiGet: api.get.bind(component)`).
- Placeholders: unknown properties are callable and render as `''`, `items` is `[]`,
  `_meta.loading` is `true` and `_meta.self` is the URI if known. `api.get(placeholder)` returns the
  placeholder.
- Entities are read-only. Forms use `$toData()` (a mutable copy with relations as URIs) as their
  model.
- `ApiError.response` mirrors an axios response (`status`, `data`, `headers` with lower-case
  names) for error handling written for axios.
- `api.post(uri)` without data is valid, as an action without body.
- Embedded collections without a URI of their own are addressable as `owner#relation`.

Consumers also depend on timing. For example, the order in which `_meta.load` and `$loadItems()`
resolve shows up in forms that combine both. Prefer resolving promises with as few extra
microtasks as possible, and test changes in a consumer app before releasing them (see
[testing.md](testing.md)).
