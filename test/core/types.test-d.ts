/**
 * Compile-time checks of the optional ResourceMap typing. Not run, only type checked by
 * `npm run typecheck`.
 */
import { expectTypeOf } from 'vitest'
import type {
  BaseOf,
  Collection,
  Entity,
  InferPreprocessed,
  Of,
  Resource,
  Templated,
} from '../../src/core/index.js'
import { createHalc } from '../../src/core/index.js'
import { hal } from '../../src/hal/index.js'

const preprocessors = {
  TypedCamp: (camp: BaseOf<'TypedCamp'>) => ({ isLong: camp.title.length > 10 }),
}

declare module '../../src/core/index.js' {
  interface ResourceMap {
    TypedCamp: Entity<
      { title: string; motto: string | null },
      {
        activities: Collection<'TypedActivity'>
        creator: 'TypedUser'
        collaborations: Templated<Collection<'TypedUser'>, { status?: string }>
      }
    >
    TypedActivity: Entity<{ title: string }, { camp: 'TypedCamp' }>
    TypedUser: Entity<{ name: string }>
  }
  // The augmentation pattern recommended in the docs.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface PreprocessedFields extends InferPreprocessed<typeof preprocessors> {}
}

const api = createHalc({ adapter: hal, preprocessors })

// Wrappers are typed from the ResourceMap, including derived fields.
const camp = api.get<'TypedCamp'>('/camps/1')
expectTypeOf(camp.title).toEqualTypeOf<string>()
expectTypeOf(camp.isLong).toEqualTypeOf<boolean>()
expectTypeOf(camp.creator().name).toEqualTypeOf<string>()
expectTypeOf(camp.activities().items[0].camp().title).toEqualTypeOf<string>()
expectTypeOf(camp.collaborations)
  .parameter(0)
  .toEqualTypeOf<{ status?: string } | undefined>()
expectTypeOf(camp.collaborations().items[0].name).toEqualTypeOf<string>()
type PatchData = Parameters<typeof camp.$patch>[0]
expectTypeOf<PatchData['title']>().toEqualTypeOf<string | undefined>()
expectTypeOf<PatchData['motto']>().toEqualTypeOf<string | null | undefined>()
expectTypeOf<{ creator: '/users/1' }>().toExtend<PatchData>()
expectTypeOf(api.get<'TypedUser'>('/users/1')._meta.load).resolves.toHaveProperty('name')

expectTypeOf(camp).not.toHaveProperty('unknownRelation')

// Without a ResourceMap entry, everything is the generic Resource.
const resource = api.get('/anything')
expectTypeOf(resource).toEqualTypeOf<Resource>()
expectTypeOf(resource.items).toEqualTypeOf<readonly Resource[]>()
expectTypeOf(resource.as<'TypedUser'>().name).toEqualTypeOf<string>()
expectTypeOf<Of<'NotInTheMap'>>().toEqualTypeOf<Resource>()

// Contextual typing of inline preprocessors: typed for ResourceMap entries...
createHalc({
  adapter: hal,
  preprocessors: {
    TypedCamp: (typedCamp) => {
      expectTypeOf(typedCamp.title).toEqualTypeOf<string>()
      return {}
    },
    // ...and unchecked for anything else.
    Other: (other) => ({ upper: String(other.title) }),
  },
})

// Derived fields survive _meta.load, $reload() and $patch(); relations can be patched with URIs.
export async function derivedFieldsAfterLoading() {
  const loaded = await api.get<'TypedCamp'>('/camps/1')._meta.load
  expectTypeOf(loaded.isLong).toEqualTypeOf<boolean>()
  expectTypeOf((await loaded.$reload()).isLong).toEqualTypeOf<boolean>()
  expectTypeOf(
    (await loaded.$patch({ title: 'x', creator: '/users/1' })).isLong
  ).toEqualTypeOf<boolean>()
  // @ts-expect-error -- not a property or relation of TypedCamp
  await loaded.$patch({ unknown: 1 })
}
