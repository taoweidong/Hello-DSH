// Flat config for dsh-codehub-dashboard.
//
// Scope: correctness rules only. The codebase intentionally mixes styles
// (index.js: 2-space + single quotes; client.js: tabs + double quotes) and
// the SPA in web/index.html is not lintable here, so stylistic rules are
// deliberately omitted to avoid churn.
export default [
  {
    files: ['**/*.js', '**/*.mjs'],
    ignores: ['node_modules/**'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // node (host half, test harness)
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortSignal: 'readonly',
        // browser (client half)
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        // cordis module wrapper
        module: 'writable',
        exports: 'writable',
        require: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unreachable': 'error',
      'no-fallthrough': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-prototype-builtins': 'error',
      'no-cond-assign': 'error',
      'no-self-assign': 'error',
      'no-func-assign': 'error',
      'valid-typeof': 'error',
      'no-global-assign': 'error',
      'no-delete-var': 'error',
      'no-redeclare': 'error',
      'no-use-before-define': ['error', { functions: false }],
    },
  },
]
