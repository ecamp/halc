import {
  createHalc,
  createUriNormalizer,
  type ApiAdapter,
  type Client,
  type HalcOptions,
} from '../core/index.js'
import { MockServer } from './mockServer.js'

export interface MockApiOptions extends Omit<HalcOptions, 'transport' | 'adapter'> {
  adapter: ApiAdapter
}

export type MockApi = Client & { readonly mock: MockServer }

/**
 * Creates a real client that talks to an in-memory {@link MockServer} instead of the network.
 * Defaults: base URL `http://localhost/api` (matching the fixtures) and no retries.
 */
export function createMockApi(options: MockApiOptions): MockApi {
  const baseUrl = options.baseUrl ?? 'http://localhost/api'
  const mock = new MockServer({
    normalizeUri: createUriNormalizer(baseUrl),
    typeOf: (uri) => options.adapter.typeOf(uri),
  })
  const client = createHalc({
    retry: false,
    ...options,
    baseUrl,
    transport: mock.transport,
  })
  Object.defineProperty(client, 'mock', { value: mock, enumerable: false })
  return client as MockApi
}

export {
  collectionFixture,
  fixture,
  isFixture,
  nextFixtureId,
  pluralPath,
  resetFixtureIds,
  setFixtureBasePath,
  type Fixture,
  type FixtureMeta,
  type FixtureOptions,
} from './fixture.js'
export { MockRoute, MockServer, type MockRequest, type ReplyBody } from './mockServer.js'
export { matchers, toMatchRequests, type ExpectedRequest } from './matchers.js'
