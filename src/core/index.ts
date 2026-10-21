export { createHalc, HalcClient } from './client.js'
export { ApiError, type ApiErrorDetails } from './errors.js'
export { VERSION } from './version.js'
export { MemoryStore } from './memoryStore.js'
export { noopReactivity } from './noopReactivity.js'
export { createFetchTransport, type FetchTransportOptions } from './transport.js'
export { createUriNormalizer, sortQueryParams, type UriNormalizer } from './uri.js'
export { expandTemplate } from './template.js'
export { defaultRetryOptions, type RetryOptions } from './retry.js'
export {
  applyMetaPatch,
  currentData,
  isCollectionRef,
  isLinkRef,
  isRelationRef,
  isTemplatedLinkRef,
  type CollectionRef,
  type EntityMeta,
  type EntityRecord,
  type LinkRef,
  type MetaPatch,
  type RecordStatus,
  type RelationRef,
  type TemplatedLinkRef,
} from './records.js'
export type {
  ApiAdapter,
  HttpRequest,
  HttpResponse,
  HttpTransport,
  MutationMethod,
  NormalizeContext,
  PageInfo,
  PaginationStrategy,
  ReactivityAdapter,
  RequestInterceptor,
  Signal,
  StoreAdapter,
} from './adapters.js'
export type * from './types.js'
