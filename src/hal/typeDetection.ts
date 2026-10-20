/**
 * Zero-config type detection: in a HAL API, the self links are the type system.
 * `/camps/4b2c6f1a9e3d` is a `Camp`, `/content_node/column_layouts/9f8e7d6c5b4a` a `ColumnLayout`,
 * `/camps/4b2c6f1a9e3d/categories` a collection of `Category`.
 */

/** A rule maps a path (relative to the API root, without query string) to a type name. */
export type TypeRule =
  | { match: RegExp | ((path: string, fragment: unknown) => boolean); type: string }
  | ((path: string, fragment: unknown) => string | undefined)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i
const HEX = /^[0-9a-f]{8,}$/i

/** An id segment is all digits, a UUID, a ULID, or hex with 8 or more characters. */
export function isIdSegment(segment: string): boolean {
  return (
    HEX.test(segment) || /^\d+$/.test(segment) || UUID.test(segment) || ULID.test(segment)
  )
}

/**
 * Turns a plural resource name into a singular one: `activities` → `activity`,
 * `boxes` → `box`, `statuses` → `status`, `responses` → `response`, `camps` → `camp`.
 */
export function singularize(word: string): string {
  if (/ies$/i.test(word)) return word.slice(0, -3) + 'y'
  if (/(ss|x|ch|sh|us)es$/i.test(word)) return word.slice(0, -2)
  if (/[^s]s$/i.test(word)) return word.slice(0, -1)
  return word
}

function pascalCase(name: string): string {
  return name
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

/** The path of a URI without origin, query string and fragment. */
export function pathOf(uri: string): string {
  let path = uri.replace(/[?#].*$/, '')
  const origin = /^[a-z][a-z\d+\-.]*:\/\/[^/]*/i.exec(path)
  if (origin) path = path.slice(origin[0].length)
  return path
}

/** The path with id segments replaced by `{id}`, for devtools and error messages. */
export function resourceOf(uri: string): string {
  const segments = pathOf(uri).split('/').filter(Boolean)
  return (
    '/' + segments.map((segment) => (isIdSegment(segment) ? '{id}' : segment)).join('/')
  )
}

export interface PathRuleOptions {
  singularize?: (word: string) => string
}

/**
 * The default rule: the last segment that is not an id, singularised and PascalCased. The API
 * root gets `Root`.
 */
export function pathTypeRule(options: PathRuleOptions = {}): TypeRule {
  const toSingular = options.singularize ?? singularize
  // A response holds many records with few distinct resource names.
  const typeOfName = new Map<string, string>()
  return (path: string) => {
    const segments = path.split('/').filter(Boolean)
    if (segments.length === 0) return 'Root'
    let name: string | undefined
    for (let index = segments.length - 1; index >= 0 && name === undefined; index--) {
      const segment = segments[index] as string
      if (!isIdSegment(segment)) name = segment
    }
    if (name === undefined) return undefined
    let type = typeOfName.get(name)
    if (type === undefined) {
      const words = name.split(/(?=[A-Z])|[_-]/).filter(Boolean)
      const last = words.pop() ?? ''
      type = pascalCase([...words, toSingular(last)].join('_'))
      typeOfName.set(name, type)
    }
    return type
  }
}

export const defaultTypeRules: readonly TypeRule[] = Object.freeze([pathTypeRule()])

function applyRule(rule: TypeRule, path: string, fragment: unknown): string | undefined {
  if (typeof rule === 'function') return rule(path, fragment)
  const matches =
    typeof rule.match === 'function' ? rule.match(path, fragment) : rule.match.test(path)
  return matches ? rule.type : undefined
}

/**
 * Detects the type of a resource. A string `@type` in the fragment wins, otherwise the first
 * rule that returns a type for the path of the self link.
 */
export function detectType(
  selfLink: string,
  fragment: unknown,
  rules: readonly TypeRule[] = defaultTypeRules
): string | undefined {
  if (typeof fragment === 'object' && fragment !== null) {
    const declared = (fragment as Record<string, unknown>)['@type']
    if (typeof declared === 'string') return declared
  }
  const path = pathOf(selfLink)
  for (const rule of rules) {
    const type = applyRule(rule, path, fragment)
    if (type !== undefined) return type
  }
  return undefined
}
