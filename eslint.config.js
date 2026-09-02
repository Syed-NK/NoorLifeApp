// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const AWAIT_RNTL =
  'Await this. `render`, `rerender`, `unmount` and `cleanup` are async in RNTL 14; assigning one without awaiting leaves its act scope open and silently swallows the next render (#157, #160).';

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
        /*
          `render`, `rerender`, `unmount` and `cleanup` are all async in RNTL 14 as well, and a floating
          one is worse than a floating `fireEvent`: an un-awaited `unmount()` tears the tree down while
          the next `render` is starting, and every later `findBy*` in the file then waits out its full
          timeout. One un-awaited `live.unmount()` in `faith-qibla-states.test.tsx` failed 37 of its 38
          cases under seed 404 while passing 38/38 in declared order — issue #157.
        */
        {
          selector: "ExpressionStatement > CallExpression[callee.property.name='unmount']",
          message:
            'Await this unmount(). It is async in RNTL 14, and an un-awaited one leaves every later findBy* in the file waiting out its timeout (#157).',
        },
        {
          selector: "ExpressionStatement > CallExpression[callee.property.name='rerender']",
          message:
            'Await this rerender(). It is async in RNTL 14, and an un-awaited one renders into a tree the next line assumes is settled (#157).',
        },
        {
          selector: "ExpressionStatement > CallExpression[callee.name='cleanup']",
          message: 'Await this cleanup(). It is async in RNTL 14 (#157).',
        },
        {
          selector: "ExpressionStatement > CallExpression[callee.name='render']",
          message:
            'Await this render(). It is async in RNTL 14, and `screen` throws "render function has not been called" until it settles (#157).',
        },
        /*
          The same four APIs, in the shape the statement selectors above cannot see: assigned rather
          than fired and forgotten. `const view = render(<X />)` leaves the render`s act scope open, so
          a later `rerender` on that view is **swallowed** — the component never re-renders, an effect
          keyed on changed props never re-runs, and the case fails for a reason nowhere near the cause.
          That is exactly how `quran-content-sync-due-timer` kept a due boundary armed across a
          sign-out it had been told about — issue #160. An `await` makes `init` an AwaitExpression, so
          a correct call never reaches these selectors.
        */
        { selector: "VariableDeclarator[init.callee.name='render']", message: AWAIT_RNTL },
        { selector: "VariableDeclarator[init.callee.name='cleanup']", message: AWAIT_RNTL },
        {
          selector: "VariableDeclarator[init.callee.property.name='rerender']",
          message: AWAIT_RNTL,
        },
        {
          selector: "VariableDeclarator[init.callee.property.name='unmount']",
          message: AWAIT_RNTL,
        },
        { selector: "AssignmentExpression[right.callee.name='render']", message: AWAIT_RNTL },
        {
          selector: "AssignmentExpression[right.callee.property.name='rerender']",
          message: AWAIT_RNTL,
        },
      ],
    },
  },
]);
