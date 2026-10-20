import type { MockRequest } from './mockServer.js'

export type ExpectedRequest = Partial<Omit<MockRequest, 'headers'>> & {
  headers?: Record<string, string>
}

function matches(actual: MockRequest, expected: ExpectedRequest): boolean {
  return Object.entries(expected).every(([key, value]) => {
    const actualValue = actual[key as keyof MockRequest]
    if (key === 'headers' && value && typeof value === 'object') {
      return Object.entries(value).every(
        ([header, headerValue]) => actual.headers[header] === headerValue
      )
    }
    return JSON.stringify(actualValue) === JSON.stringify(value)
  })
}

function describe(request: MockRequest | ExpectedRequest): string {
  const parts = [request.method ?? '*', request.uri ?? request.url ?? '']
  if (request.type) parts.push(`(${request.type})`)
  if (request.body !== undefined) parts.push(JSON.stringify(request.body))
  return parts.filter(Boolean).join(' ')
}

/**
 * Checks that the recorded requests match the expected ones in order, comparing only the given
 * fields of each expected request.
 */
export function toMatchRequests(
  received: readonly MockRequest[],
  expected: readonly ExpectedRequest[]
): { pass: boolean; message: () => string } {
  const pass =
    received.length === expected.length &&
    expected.every((request, index) => {
      const actual = received[index]
      return actual !== undefined && matches(actual, request)
    })
  return {
    pass,
    message: () =>
      [
        pass ? 'Expected requests not to match:' : 'Expected requests to match:',
        ...expected.map((request) => `  ${describe(request)}`),
        'Received:',
        ...received.map(
          (request) =>
            `  ${describe(request)} headers=${JSON.stringify(request.headers)}${request.matched ? '' : ' (no mock)'}`
        ),
      ].join('\n'),
  }
}

export const matchers = { toMatchRequests }
