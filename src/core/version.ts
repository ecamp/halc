declare const __HALC_VERSION__: string | undefined

/** The version of halc, set at build time. */
export const VERSION: string =
  typeof __HALC_VERSION__ === 'string' ? __HALC_VERSION__ : 'development'
