// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'android/*', 'ios/*', '.expo/*', 'node_modules/*'],
  },
  {
    // NoorLife design-token lock: raw colour literals and magic spacing must not
    // appear outside the token layer. Enforced by review + the token tests; this
    // block only tightens correctness rules that the locked spec depends on.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@expo/vector-icons',
              message:
                'Import icons through @ds/components/app-icon (AppIcon) so the icon set stays centralised and typed.',
            },
          ],
        },
      ],
    },
  },
  {
    // AppIcon is the single sanctioned boundary to the icon library.
    files: ['src/design-system/components/app-icon.tsx'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'jest.setup.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
]);
