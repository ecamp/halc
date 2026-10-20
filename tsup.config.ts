import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'hal/index': 'src/hal/index.ts',
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
