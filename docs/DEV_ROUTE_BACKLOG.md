# Development-only routes still present in the release bundle

Recorded in Phase 6C-3B. **Not fixed in this session** — the phase brief scopes the fix to the
Privacy & Security fixture harness and says explicitly not to redesign Module Gallery or the other
historical DEV routes here.

## The finding

Phase 6C-3A stated that `__DEV__` removed its fixture harness from the release bundle. That was
wrong, and the same mistake is load-bearing for two older routes.

An Expo Router route file like this:

```tsx
import { ModuleGalleryScreen } from '@features/modules/screens/module-gallery-screen';

export default function Screen() {
  if (!__DEV__) {
    return <Redirect href={globalRoutes.home} />;
  }
  return <ModuleGalleryScreen />;
}
```

does two separate things, and only one of them is a guard:

- **`__DEV__` prevents rendering.** In a release build the screen is never drawn, and a deep link
  to the route lands on Main Home. This part works.
- **`__DEV__` does not prevent inclusion.** The `import` is unconditional and sits at module scope,
  so Metro follows it while building the graph. The screen, every string in it and everything it
  imports are compiled into `index.android.bundle`. Metro's minifier will not drop the module: the
  route file is reachable from the router manifest, and the import has side effects as far as the
  bundler can prove.

The route also remains in the generated route manifest, so its path is discoverable by anyone who
unzips the APK, even though visiting it redirects.

## Routes affected

| Route file | Screen | Status |
|---|---|---|
| `src/app/module-gallery.tsx` | Module Gallery | Open |
| `src/app/hero-audit.tsx` | Hero audit harness | Open |
| ~~`src/app/profile/privacy-security/fixtures.tsx`~~ | Privacy & Security fixtures | **Fixed in 6C-3B** — route and screen deleted; the states moved to `src/test-support/account-security-fixtures.ts`, which is outside the production import graph and asserted to be un-importable from `src/app` and `src/features` |
| ~~`src/app/typography-probe.tsx`~~ | Typography probe | **Fixed in the Faith Phase 0 repair** — route deleted, so the screen is no longer reachable from any bundle root. Asserted by `src/features/modules/__tests__/typography-probe-route.test.ts`, which pins both halves the `__DEV__` guard conflated: no route file names it, and no production module imports it |

### The typography probe — fully removed

The probe arrived after this document was written and repeated the pattern exactly, which is the
argument for the procedure rather than for a better guard.

Both the route and the screen are gone:

| Removed | Was |
|---|---|
| `src/app/typography-probe.tsx` | The route. Deleting it is what takes the path out of the manifest and the screen out of Metro's graph. |
| `src/features/modules/screens/typography-probe-screen.tsx` | The diagnostic itself — measured height from `onLayout` against painted height from `onTextLayout`, to make a `ModuleText` measure/paint mismatch a number on screen. |

It was not moved to `src/test-support/` as step 2 suggests, because there was nothing left to
preserve for: no test imported it, so a relocation would have parked a 230-line unused screen in a
second directory. The defect it was built to diagnose is now covered by assertions rather than by a
harness somebody has to look at — `module-two-column-stacking.test.tsx` and the hero geometry suites
pin the measurements it used to display.

`use-module-metrics.ts` no longer cites it. The `fontScale` field it read stays exposed on its own
merit: `shouldStackTwoColumn` divides the measured half-column by it.

**If a measure/paint mismatch is ever suspected again,** rebuild the probe under `src/test-support/`
rather than under `src/features` — and note that the scan in
`src/features/profile/__tests__/privacy-security-source-scan.test.ts` forbids any file under
`src/app` or `src/features` from so much as naming `test-support`, so a comment pointing at it from
production code will fail that scan. Narrowing that rule from "mentions" to "imports" is the
prerequisite, and is a decision about the scan, not a mechanical move.

## Why the Privacy & Security one was treated as urgent and these two are not

The fixture harness carried a **fake account**: a summary with an email address, a verification
state and a last sign-in, plus five named security states including a global-sign-out failure. Those
strings sitting in a shipped bundle read as account data, and the harness was reachable by route
name. Module Gallery and the hero audit carry design scaffolding — tile inventories and layout
probes. Neither holds an account, a credential or a security state.

That is a difference in severity, not in correctness. Both routes should still be removed.

## The fix to apply when these are scheduled

The same one 6C-3B used, and it is not a smarter guard:

1. Delete the route file, so nothing in `src/app` references the screen. This is what removes it
   from both the route manifest and the module graph.
2. Move anything still worth keeping to a directory Expo Router does not scan and production code
   may not import — `src/test-support/` is the precedent.
3. Prove the states with render tests, which is where they belonged: a test asserts the state is
   right, whereas a harness only lets somebody look at it.
4. Add the identifiers to the release-bundle scan.

A `__DEV__`-guarded `require()` inside the component body would also keep the module out of the
release graph, but it defeats static analysis, breaks typed routes and leaves the path in the
manifest. Deleting the route is simpler and provable.

## How to verify

Build the release bundle and grep it. The fixture identifiers must be absent and the two open ones
will still be present until this backlog item is done:

```bash
npx expo export:embed --platform android --dev false --bundle-output /tmp/release.bundle --assets-dest /tmp/assets

grep -c "privacy-security-fixture" /tmp/release.bundle   # 0 — fixed in 6C-3B
grep -c "fixture.user@example.com" /tmp/release.bundle   # 0 — fixed in 6C-3B
grep -c "Module Gallery"           /tmp/release.bundle   # 1+ — open
grep -c "hero-audit"               /tmp/release.bundle   # 1+ — open
grep -c "service_role"             /tmp/release.bundle   # 0 — always
```
