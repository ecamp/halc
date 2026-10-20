// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { createHalc } from '../../src/core/client.js'
import { noopReactivity } from '../../src/core/noopReactivity.js'
import { hal } from '../../src/hal/index.js'
import { collectionFixture, fixture, resetFixtureIds } from '../../src/testing/index.js'
import { createVueReactivity, halcVue, useApi } from '../../src/vue/index.js'
import { createApi, flush } from '../helpers.js'

beforeEach(() => {
  resetFixtureIds()
})

describe('halcVue', () => {
  it('provides this.api and useApi(), and switches to Vue reactivity', () => {
    const api = createHalc({ adapter: hal })
    expect(api.reactivity).toBe(noopReactivity)

    let injected: unknown
    const wrapper = mount(
      defineComponent({
        setup() {
          injected = useApi()
          return () => h('div')
        },
      }),
      { global: { plugins: [halcVue(api)] } }
    )

    expect((wrapper.vm as any).api).toBe(api)
    expect(injected).toBe(api)
    expect(api.reactivity).not.toBe(noopReactivity)
  })

  it('keeps a reactivity adapter that was configured explicitly', () => {
    const reactivity = createVueReactivity()
    const api = createHalc({ adapter: hal, reactivity })
    halcVue(api, { name: '$halc' })
    expect(api.reactivity).toBe(reactivity)
  })

  it('throws from useApi() without the plugin', () => {
    expect(() =>
      mount(defineComponent({ setup: () => (useApi(), () => h('div')) }))
    ).toThrow('No halc client provided')
  })

  it('re-renders only the components whose resources changed', async () => {
    const api = createApi()
    const activities = collectionFixture('Activity', [
      fixture('Activity', { title: 'a' }),
      fixture('Activity', { title: 'b' }),
    ])
    api.mock.get(activities)
    api.mock.patch('/api/activities/000000000002')

    const renders: Record<string, number | undefined> = {}
    const Item = defineComponent({
      props: { uri: { type: String, required: true } },
      render() {
        renders[this.uri] = (renders[this.uri] || 0) + 1
        return h('li', this.api.get(this.uri).title)
      },
    })
    const List = defineComponent({
      render() {
        renders.list = (renders.list ?? 0) + 1
        return h(
          'ul',
          this.api
            .get(activities._meta.self)
            .items.map((item: any) =>
              h(Item, { uri: item._meta.self, key: item._meta.self })
            )
        )
      },
    })

    const wrapper = mount(List, { global: { plugins: [halcVue(api)] } })
    await api.get(activities._meta.self)._meta.load
    await nextTick()
    expect(wrapper.text()).toBe('ab')
    const before = { ...renders }

    await api.patch('/activities/000000000002', { title: 'c' }, { optimistic: false })
    await flush()
    await nextTick()

    expect(wrapper.text()).toBe('ac')
    expect(renders.list).toBe(before.list)
    expect(renders['/activities/000000000001']).toBe(before['/activities/000000000001'])
    expect(renders['/activities/000000000002']).toBe(
      (before['/activities/000000000002'] ?? 0) + 1
    )
  })
})
