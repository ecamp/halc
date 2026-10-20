import { describe, expect, it } from 'vitest'
import {
  defaultRetryOptions,
  isRetryable,
  resolveRetryOptions,
  retryDelay,
} from '../../src/core/retry.js'

describe('retry policy', () => {
  it('retries network errors, 429 and 5xx, nothing else', () => {
    expect(isRetryable(undefined)).toBe(true)
    expect(isRetryable(429)).toBe(true)
    expect(isRetryable(500)).toBe(true)
    expect(isRetryable(503)).toBe(true)
    expect(isRetryable(400)).toBe(false)
    expect(isRetryable(404)).toBe(false)
    expect(isRetryable(409)).toBe(false)
  })

  it('backs off exponentially: 0.5 s, 2 s, 8 s', () => {
    const options = { ...defaultRetryOptions, jitter: false }
    expect([0, 1, 2].map((attempt) => retryDelay(attempt, options))).toEqual([
      500, 2000, 8000,
    ])
  })

  it('jitters by at most 25 %', () => {
    for (let i = 0; i < 100; i++) {
      const delay = retryDelay(1, defaultRetryOptions)
      expect(delay).toBeGreaterThanOrEqual(1500)
      expect(delay).toBeLessThanOrEqual(2500)
    }
  })

  it('honours Retry-After in seconds and as date, capped at maxDelay', () => {
    const options = { ...defaultRetryOptions, jitter: false }
    expect(retryDelay(0, options, '3')).toBe(3000)
    expect(retryDelay(0, options, '3600')).toBe(30_000)
    const inTwoSeconds = new Date(Date.now() + 2000).toUTCString()
    expect(retryDelay(0, options, inTwoSeconds)).toBeLessThanOrEqual(2000)
    expect(retryDelay(0, options, 'garbage')).toBe(500)
  })

  it('can be disabled', () => {
    expect(resolveRetryOptions(false).retries).toBe(0)
    expect(resolveRetryOptions({ retries: 1 }).retries).toBe(1)
    expect(resolveRetryOptions(undefined)).toEqual(defaultRetryOptions)
  })
})
