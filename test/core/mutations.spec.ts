import { describe, expect, it } from 'vitest'
import {
  bodyForPost,
  diffForPatch,
  mergePatch,
  MutationQueue,
  recordPatchFor,
} from '../../src/core/mutations.js'
import type { EntityRecord } from '../../src/core/records.js'
import { createUriNormalizer } from '../../src/core/uri.js'
import { deepEqual, deepFreeze } from '../../src/core/util.js'

const context = {
  normalizeUri: createUriNormalizer('http://localhost/api'),
  iriOf: (self: string) => `/api${self}`,
}

const wrapper = (self: string) => ({ _meta: { self }, $patch: () => undefined })

describe('diffForPatch', () => {
  const current = {
    title: 'x',
    tags: ['a'],
    data: { nested: { deep: 1 } },
    creator: { href: '/users/1' },
    periods: { hrefs: ['/periods/1'] },
    parent: null,
  }

  it('keeps only top-level fields that differ', () => {
    expect(
      diffForPatch(
        current,
        { title: 'x', tags: ['a'], data: { nested: { deep: 2 } } },
        context
      )
    ).toEqual({
      body: { data: { nested: { deep: 2 } } },
      dirty: { data: { nested: { deep: 2 } } },
    })
  })

  it('ignores functions, _meta and undefined, so spread wrappers can be passed', () => {
    const data = {
      ...current,
      _meta: { self: '/camps/1' },
      creator: () => undefined,
      missing: undefined,
    }
    expect(diffForPatch(current, data, context).body).toEqual({})
  })

  it('compares relations by normalized URI and sends IRIs', () => {
    expect(
      diffForPatch(
        current,
        { creator: '/api/users/1', periods: ['/api/periods/1'] },
        context
      ).body
    ).toEqual({})
    expect(diffForPatch(current, { creator: wrapper('/users/1') }, context).body).toEqual(
      {}
    )
    expect(diffForPatch(current, { creator: wrapper('/users/2') }, context)).toEqual({
      body: { creator: '/api/users/2' },
      dirty: { creator: { href: '/users/2' } },
    })
    expect(
      diffForPatch(current, { periods: ['/api/periods/2'], creator: null }, context)
    ).toEqual({
      body: { periods: ['/api/periods/2'], creator: null },
      dirty: { periods: { hrefs: ['/periods/2'] }, creator: null },
    })
  })

  it('compares values the way they will be sent', () => {
    const date = new Date('2026-01-01T00:00:00Z')
    expect(
      diffForPatch({ start: '2026-01-01T00:00:00.000Z' }, { start: date }, context).body
    ).toEqual({})
  })

  it('sends everything with force', () => {
    expect(diffForPatch(current, { title: 'x' }, context, true).body).toEqual({
      title: 'x',
    })
  })
})

describe('bodyForPost', () => {
  it('turns wrappers into IRIs and drops functions and _meta', () => {
    expect(
      bodyForPost(
        { camp: wrapper('/camps/1'), title: 't', fn: () => 1, _meta: {} },
        context
      )
    ).toEqual({
      camp: '/api/camps/1',
      title: 't',
    })
  })
})

describe('recordPatchFor', () => {
  it.each(['visible', 'confirmed'])(
    'normalizes to-one and to-many relations from the %s state',
    (source) => {
      const references = {
        author: { href: '/authors/1' },
        chapters: { hrefs: ['/chapters/1'] },
      }
      const cleared = { author: null, chapters: null }
      const data = {
        author: wrapper('/authors/2'),
        chapters: [wrapper('/chapters/2')],
        title: '/somewhere',
      }

      expect(
        recordPatchFor(
          source === 'visible' ? references : cleared,
          data,
          Object.keys(data),
          context,
          source === 'confirmed' ? references : cleared
        )
      ).toEqual({
        author: { href: '/authors/2' },
        chapters: { hrefs: ['/chapters/2'] },
        title: '/somewhere',
      })
    }
  )
})

describe('MutationQueue', () => {
  const record: EntityRecord = {
    uri: '/activities',
    data: { title: 'x', items: { hrefs: ['/activities/1'] } },
    meta: { version: 1, status: 'loaded' },
  }

  it('merges pending optimistic changes and temporary items', () => {
    const queue = new MutationQueue()
    queue.add({
      id: '1',
      kind: 'patch',
      uri: '/activities',
      optimistic: true,
      dirty: { title: 'y' },
    })
    queue.add({
      id: '2',
      kind: 'post',
      uri: '/activities',
      optimistic: true,
      tempUri: 'urn:tmp:2',
    })
    queue.add({
      id: '3',
      kind: 'patch',
      uri: '/activities',
      optimistic: false,
      dirty: { title: 'z' },
    })
    queue.add({
      id: '4',
      kind: 'patch',
      uri: '/other',
      optimistic: true,
      dirty: { title: 'o' },
    })

    expect(queue.dirtyFor(record)).toEqual({
      title: 'y',
      items: { hrefs: ['/activities/1', 'urn:tmp:2'] },
    })
    queue.remove(queue.pending[0])
    queue.remove(queue.pending[0])
    expect(queue.dirtyFor(record)).toBeUndefined()
    expect(queue.nextId()).not.toBe(queue.nextId())
  })

  it('runs tasks of the same URI one after another, others in parallel', async () => {
    const queue = new MutationQueue()
    const log: string[] = []
    const task = (name: string, ms: number) => () =>
      new Promise<string>((resolve) =>
        setTimeout(() => {
          log.push(name)
          resolve(name)
        }, ms)
      )

    const failing = queue.run('/a', () => Promise.reject(new Error('first fails')))
    const results = Promise.all([
      queue.run('/a', task('a1', 10)),
      queue.run('/a', task('a2', 1)),
      queue.run('/b', task('b1', 5)),
    ])
    await expect(failing).rejects.toThrow('first fails')
    await expect(results).resolves.toEqual(['a1', 'a2', 'b1'])
    expect(log).toEqual(['b1', 'a1', 'a2'])
    await queue.settled('/a')
  })

  it('reapplies remaining deltas after rollback, merging objects and replacing arrays and relations', () => {
    const book: EntityRecord = {
      uri: '/books/1',
      data: {
        settings: { left: 'old', nested: { kept: 1, removed: 2 } },
        tags: ['old'],
        author: { href: '/authors/1' },
        chapters: { hrefs: ['/chapters/1'] },
      },
      meta: { version: 1, status: 'loaded' },
    }
    const queue = new MutationQueue()
    const first = {
      id: '1',
      kind: 'patch' as const,
      uri: book.uri,
      optimistic: true,
      dirty: { settings: null },
      patch: { settings: null },
    }
    const second = {
      id: '2',
      kind: 'patch' as const,
      uri: book.uri,
      optimistic: true,
      dirty: { settings: { nested: { next: 3 } } },
      patch: {
        settings: { nested: { removed: null, next: 3 } },
        tags: ['new'],
        author: { href: '/authors/2' },
        chapters: { hrefs: ['/chapters/2'] },
      },
    }
    queue.add(first)
    queue.add(second)
    expect(queue.dirtyFor(book)).toEqual({
      settings: { nested: { next: 3 } },
      tags: ['new'],
      author: { href: '/authors/2' },
      chapters: { hrefs: ['/chapters/2'] },
    })

    queue.remove(first)
    expect(queue.dirtyFor(book)).toEqual({
      settings: { left: 'old', nested: { kept: 1, next: 3 } },
      tags: ['new'],
      author: { href: '/authors/2' },
      chapters: { hrefs: ['/chapters/2'] },
    })
    queue.remove(second)
    expect(queue.dirtyFor(book)).toBeUndefined()
    expect(book.data.settings).toEqual({ left: 'old', nested: { kept: 1, removed: 2 } })
  })
})

describe('util', () => {
  it('compares JSON values structurally', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(deepEqual([1], { 0: 1 })).toBe(false)
    expect(deepEqual(null, {})).toBe(false)
    expect(deepEqual(NaN, NaN)).toBe(true)
  })

  it('freezes recursively', () => {
    const value = deepFreeze({ a: { b: [1] } })
    expect(Object.isFrozen(value.a.b)).toBe(true)
  })
})

describe('diffForPatch with nested objects', () => {
  const current = {
    data: { sections: { a: { column1: 'A1', column2: 'A2' }, b: { column1: 'B1' } } },
  }

  it('merges the patch into the current object for the optimistic value (RFC 7386)', () => {
    const diff = diffForPatch(
      current,
      { data: { sections: { a: { column1: 'NEW' }, b: null } } },
      context
    )

    expect(diff.body).toEqual({ data: { sections: { a: { column1: 'NEW' }, b: null } } })
    expect(diff.dirty).toEqual({
      data: { sections: { a: { column1: 'NEW', column2: 'A2' } } },
    })
  })

  it('sends nothing when the merge changes nothing', () => {
    expect(
      diffForPatch(current, { data: { sections: { a: { column1: 'A1' } } } }, context)
        .body
    ).toEqual({})
  })

  it.each([
    { value: null },
    { value: 1 },
    { value: 'old' },
    { value: ['old'] },
    { value: undefined },
  ])('applies object patches to $value using an empty object', ({ value }) => {
    expect(
      diffForPatch({ data: value }, { data: { removed: null, kept: 'new' } }, context)
    ).toEqual({
      body: { data: { removed: null, kept: 'new' } },
      dirty: { data: { kept: 'new' } },
    })
  })

  it('replaces arrays and primitives', () => {
    expect(mergePatch({ a: [1, 2], b: 1 }, { a: [3], b: { c: 1 } })).toEqual({
      a: [3],
      b: { c: 1 },
    })
  })
})
