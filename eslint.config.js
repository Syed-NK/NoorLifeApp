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
            {
              // Every string the app *displays* is Poppins because AppText and its per-surface
              // siblings resolve the family from a type token. TextInput is a separate component
              // that none of them wrap, so before AppTextInput existed each input had to remember
              // the family by hand and 26 of 31 did not - leaving the text the user typed in Roboto
              // while the label directly above it was Poppins. This rule is what stops the next
              // input reintroducing it. Ref types come from AppTextInputHandle, so there is no
              // legitimate reason for a call site to name TextInput at all.
              name: 'react-native',
              importNames: ['TextInput'],
              message:
                'Import AppTextInput from @ds/typography/app-text-input so every input carries the Poppins face (spec 2.4). For a ref, use AppTextInputHandle.',
            },
          ],
        },
      ],
    },
  },
  {
    // The two sanctioned boundaries: AppIcon to the icon library, AppTextInput to TextInput.
    files: [
      'src/design-system/components/app-icon.tsx',
      'src/design-system/typography/app-text-input.tsx',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'jest.setup.ts'],
    rules: {
      'no-restricted-imports': 'off',
      /*
        `fireEvent` is async in React Native Testing Library 14, and firing two events in one test
        without awaiting them overlaps React`s act() scopes. That does not fail the test that did it —
        it leaves the renderer dead, so every later `render` in the same file yields an empty tree and
        every later query fails. The suite then passes only in its declared order, which is what
        issue #155 was reporting.

        Matching the bare statement is the whole rule: an awaited call is an `AwaitExpression`, so it
        never reaches this selector.
      */
      'no-restricted-syntax': [
        'error',
        {
          selector: "ExpressionStatement > CallExpression[callee.object.name='fireEvent']",
          message:
            'Await this fireEvent call. It is async in RNTL 14, and two un-awaited calls in one test overlap act() and break every later render in the file (#155). To fire in one tick on purpose - a double-tap a busy guard must swallow - keep it inside an act() batch and mark it `void fireEvent...`.',
        },
        {
          selector: "ExpressionStatement > CallExpression[callee.name='fireEvent']",
          message:
            'Await this fireEvent call. It is async in RNTL 14, and two un-awaited calls in one test overlap act() and break every later render in the file (#155). To fire in one tick on purpose - a double-tap a busy guard must swallow - keep it inside an act() batch and mark it `void fireEvent...`.',
        },
      ],
    },
  },
]);
