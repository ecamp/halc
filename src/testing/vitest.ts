/**
 * Registers the halc matchers with Vitest. Import it once, e.g. in a setup file:
 * `import 'halc/testing/vitest'`.
 */
import { expect } from 'vitest'
import { matchers, type ExpectedRequest } from './matchers.js'

expect.extend(matchers)

declare module 'vitest' {
  interface Matchers<R> {
    /** Checks recorded mock requests in order, comparing only the given fields. */
    toMatchRequests(expected: readonly ExpectedRequest[]): R
  }
}
