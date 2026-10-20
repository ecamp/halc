import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
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
      // `this: void` marks methods that may be called detached from their object.
      '@typescript-eslint/no-invalid-void-type': [
        'error',
        { allowAsThisParameter: true },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  // Dependencies point inward only: every subpath module may import from the core, the core
  // imports from none of them, and the subpath modules don't import each other. This keeps a
  // later split into separate packages mechanical.
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: adapters.map((adapter) => `../${adapter}/*`),
              message: 'The core must not depend on any adapter.',
            },
          ],
        },
      ],
    },
  },
  ...adapters.map((adapter) => ({
    files: [`src/${adapter}/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: adapters
                .filter((other) => other !== adapter)
                .map((other) => `../${other}/*`),
              message: 'Adapters may only depend on the core.',
            },
          ],
        },
      ],
    },
  })),
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
