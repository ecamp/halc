import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'hal/index': 'src/hal/index.ts',
    'plain/index': 'src/plain/index.ts',
    'vue/index': 'src/vue/index.ts',
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
})
