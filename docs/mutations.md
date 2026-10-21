# Mutations

## Queue

Every POST, PATCH and DELETE is a `PendingMutation` (plain, serializable data) in the
`MutationQueue`. Mutations of the same URI run one after another, others in parallel. The
optimistic state of a record (`meta.dirty`) is recomputed from all pending optimistic mutations of
its URI whenever one is added or settles, and when a response for the URI is written,
so overlapping mutations roll back correctly in any order.

Optimistic changes must be visible synchronously: `post`/`patch`/`del` only `await` before applying
them when they have to (temporary URIs, records still loading).

## PATCH

A PATCH sends a top-level field if it differs from the confirmed data or from the current
optimistic data. Comparing with both keeps a field that matches only an earlier pending patch,
because that patch may still fail.

- **Comparison:** values are compared in their JSON form. Relations are compared by normalized URI
  and sent as IRIs; wrappers are sent as IRIs.
- **Ignored:** functions and `_meta` are ignored, so a spread wrapper can be passed.
- **Nested objects:** the optimistic value of an object field is the JSON merge patch (RFC 7386) of
  the current value and the patch, matching `application/merge-patch+json`. The body contains only
  the patch.
- **Error responses:** a 409 reloads the resource after the rollback, and a 204 commits the change
  and reloads.

## POST

An optimistic POST into a loaded collection creates a temporary record `urn:tmp:<id>` and appends
it to the collection's `items` through the queue's dirty state.

- **Temporary data:** the temporary record holds the posted data. A value becomes a relation ref
  if it was given as a wrapper, if the same field is a relation on an item already in the
  collection, or if it is the IRI of a resource in the store. Lists that call `item.relation()` on
  every item rely on this.
- **Temporary URIs:** the client remembers which URI each temporary URI turned into, also after the
  POST settled, so a view can still patch or delete a temporary item it holds.
- **Reload:** after the POST, the collection is reloaded if it is loaded (not if its last load
  failed).

A POST without data sends no body and is never optimistic.

## DELETE

While a DELETE runs, the record is marked `deleting` and every collection listing it gets a new
version, so `items` hides it (`allItems` doesn't). Afterwards, every record referencing it is
reloaded and the record is removed.
