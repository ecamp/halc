import { hal } from '../src/hal/index.js'
import { createMockApi, type MockApiOptions } from '../src/testing/index.js'

/** A mock API with the HAL adapter and the default fixture base URL. */
export function createApi(options: Partial<MockApiOptions> = {}) {
  return createMockApi({ adapter: hal, ...options })
}

/** Lets pending promise callbacks and zero-delay timers run. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
