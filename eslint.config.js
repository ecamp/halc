import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import importX from 'eslint-plugin-import-x'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const adapters = ['hal', 'pinia', 'plain', 'testing', 'vue', 'vuex']

export default defineConfig(
  globalIgnores(['dist/', 'coverage/']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      // With an empty (augmentable) ResourceMap, `TypeName` is `never`, which this rule flags.
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  {
    // Dependencies point inward only: every subpath module may import from the core,
    // the core imports from none of them, and the subpath modules don't import each other.
    // This keeps a later split into separate packages mechanical.
    files: ['src/**/*.ts'],
    plugins: { 'import-x': importX },
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/core',
              from: adapters.map((adapter) => `./src/${adapter}`),
              message: 'The core must not depend on any adapter.',
            },
            ...adapters.map((adapter) => ({
              target: `./src/${adapter}`,
              from: adapters
                .filter((other) => other !== adapter)
                .map((other) => `./src/${other}`),
              message: 'Adapters may only depend on the core.',
            })),
          ],
        },
      ],
    },
  },
  {
    files: ['test/**/*.ts', 'bench/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  }
)
