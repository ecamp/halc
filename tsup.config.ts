import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as {
  version: string
}

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'hal/index': 'src/hal/index.ts',
    'plain/index': 'src/plain/index.ts',
    'vue/index': 'src/vue/index.ts',
    'pinia/index': 'src/pinia/index.ts',
    'vuex/index': 'src/vuex/index.ts',
    'testing/index': 'src/testing/index.ts',
    'testing/vitest': 'src/testing/vitest.ts',
  },
  format: ['esm'],
  target: 'es2022',
  platform: 'neutral',
  splitting: true,
  sourcemap: true,
  clean: true,
  dts: false,
  treeshake: true,
  define: { __HALC_VERSION__: JSON.stringify(version) },
})
