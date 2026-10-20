export interface RetryOptions {
  /** Number of retries after the first attempt. Default 3. */
  retries?: number
  /** Delay before the first retry in ms. Default 500. */
  baseDelay?: number
  /** Multiplier for each further retry. Default 4, giving 0.5 s, 2 s, 8 s. */
  factor?: number
  /** Upper bound for a single delay in ms, also for `Retry-After`. Default 30 s. */
  maxDelay?: number
  /** Randomize each delay by ±25 %, so many clients don't retry in lockstep. Default true. */
  jitter?: boolean
}

export type ResolvedRetryOptions = Required<RetryOptions>

export const defaultRetryOptions: ResolvedRetryOptions = {
  retries: 3,
  baseDelay: 500,
  factor: 4,
  maxDelay: 30_000,
  jitter: true,
}

export function resolveRetryOptions(
  options: RetryOptions | false | undefined
): ResolvedRetryOptions {
  if (options === false) return { ...defaultRetryOptions, retries: 0 }
  return { ...defaultRetryOptions, ...options }
}

/** Network failures (no status), 429 and 5xx are worth retrying, every other answer is final. */
export function isRetryable(status: number | undefined): boolean {
  return status === undefined || status === 429 || status >= 500
}

function parseRetryAfter(
  value: string | null | undefined,
  now: number
): number | undefined {
  if (!value) return undefined
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - now)
}

/** Delay before retry number `attempt` (0-based), honouring a `Retry-After` header. */
export function retryDelay(
  attempt: number,
  options: ResolvedRetryOptions,
  retryAfter?: string | null
): number {
  const fromHeader = parseRetryAfter(retryAfter, Date.now())
  if (fromHeader !== undefined) return Math.min(fromHeader, options.maxDelay)

  const delay = options.baseDelay * options.factor ** attempt
  const jittered = options.jitter ? delay * (0.75 + Math.random() * 0.5) : delay
  return Math.min(Math.round(jittered), options.maxDelay)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
