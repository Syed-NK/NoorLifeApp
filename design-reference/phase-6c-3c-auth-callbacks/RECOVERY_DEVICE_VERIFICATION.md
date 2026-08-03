# Password recovery — end-to-end device verification

**2026-08-03.** A real emailed recovery link, delivered to a freshly installed release build, taken
through to a set password and a verified outcome set.

This closes the row the phase README listed as unreachable ("Recovery-ready, and the Set New Password
form") and it is the device evidence behind backlog **1.4**. It also confirms the fix for the
warm-callback defect described in `src/application/startup/use-callback-navigation.ts`.

## What is claimed, and what is not

**Claimed:** password recovery works end to end on the Pixel 8 emulator, with a real link, on a
release build, against the real Supabase project.

**Not claimed:**

- **Not production-ready email.** Delivery used Supabase's built-in **development** SMTP. It is
  rate-limited and not suitable for production. Custom SMTP (backlog 1.1) is still required before
  release.
- **Not both-target verified.** The physical Honor phone was unreachable for the whole session. See
  "The phone pass" below and backlog 5.4. One target, not two.
- **Nothing about the passwords themselves.** The account owner entered and confirmed the new password
  personally, and personally checked that it signs in and that the previously disclosed password is
  rejected. Neither password was generated, entered, read, logged or captured during this pass, and
  neither appears in any artefact of it.

## Which tree was tested

Read this before treating the commit that carries this report as "the verified build".

The APK under test was built from the full working tree, which at the time held **more than this
commit contains**. This commit is deliberately narrow: the warm-callback navigation fix, its
regression tests, the documentation corrections, and this report. Also present in the tested build,
and landing separately:

- `nl_rid`, NoorLife's own per-request flow discriminator (`src/services/auth/pending-auth-flow.ts`
  and the parser and service changes around it);
- `experimental.appendPkceFlowIdToRedirects` enabled in `src/lib/supabase.ts`, which is why the
  redirect carried `sb_flow_id`.

Nothing in the outcome set above depends on those two being absent or present — the navigation fix is
what decides whether a warm link reaches Set New Password, and the regression tests for it pass
against this commit alone (101 suites, 2793 tests, all green). But the *link* that was used carried
both, so a future reader reconstructing this run needs the whole tree, not just this commit.

## Target

| | |
|---|---|
| Build | `android/app/build/outputs/apk/release/app-release.apk`, **release** |
| Architectures | `arm64-v8a,x86_64` — one APK carrying both |
| Device | `emulator-5554`, `sdk_gphone64_x86_64`, 1080 × 2400 |
| Install | `adb install -r` followed by `pm clear` — a genuine first run |
| Account | The authorized test account, inbox reachable on the device itself |

The install order matters and is not incidental. `nl_rid` lives in storage that `pm clear` wipes, so
**a fresh install invalidates every outstanding link**. The email must be requested *after* the wipe,
never before. An older reset mail from earlier the same evening was left deliberately untouched in the
thread; using it would have tested nothing.

## Sequence

| Step | Observed |
|---|---|
| Build | `BUILD SUCCESSFUL in 1m 41s`, both ABIs |
| Fresh install and launch | Onboarding carousel — genuine first run |
| Skip → Continue with Email | Welcome back / sign-in |
| Forgot password → address → Send Reset Link | *Check your inbox*, with the non-committal "If that address has an account, a reset link is on its way" |
| Delivery | Real message from Supabase Auth in the device's inbox, ~30 s |
| Tap the link | Chrome Custom Tab → NoorLife in focus in ~4 s |
| **Destination** | **Set a new password, reached automatically** |
| Form state on arrival | Both fields empty, `Set Password` disabled |

The reset-sent copy is worth noting as correct: it does not confirm or deny that the address has an
account, so the form is not an account-existence oracle.

### Why this is the interesting delivery

The app was **already running** when the link was tapped, so this was a **warm** callback — the exact
case that used to fail. `MainActivity` is `launchMode="singleTask"`, so a second link re-enters the
running task rather than starting a process.

Before the fix, a warm link mounted `/auth/callback` **twice**: Expo Router routed to it (the scheme
is declared in `app.json` and `src/app/auth/callback.tsx` is a real route) and
`use-callback-navigation.ts` *also* pushed it. `claim()` is single-shot, so one instance ran the
exchange and the other got `null` and rendered `invalid-link` — "Link not valid" — on top of a
recovery that had actually succeeded underneath.

This pass reached Set New Password with **no "Link not valid" anywhere**. That is the fix, on a real
link, in a release build.

## Outcome set, after the password was set

The account owner set the password. Only the resulting state was then verified.

| Check | Result |
|---|---|
| Password update reports success | **Pass** — app advanced off the form to authenticated Main Home |
| Recovery grant consumed | **Pass** — `noorlifeapp://auth/set-new-password` now renders "This link is no longer active": no password field, no confirm field, no submit control |
| Callback replay rejected | **Pass** — the same link tapped again gives "Link expired". No session, and a single callback screen |
| Expected signed-in state | **Pass** — survives `am force-stop` and a cold relaunch; session persists |

The replay was refused **server-side**: GoTrue rejected the spent token and redirected with an error,
so the app never received a code at all and rendered the closed `AuthCallbackErrorCode` union. Nothing
the link contained appeared on screen in any state.

## Nothing secret was captured

The intermediate browser URL carries the recovery token, so it was never screenshotted. The handoff
was followed by polling `dumpsys window` for the focused **package name** only, and capture began once
NoorLife held focus.

A logcat scan afterwards, counting matches without printing them:

| Pattern | Hits | Source |
|---|---|---|
| `access_token` | 0 | — |
| `refresh_token` | 0 | — |
| `error_description` | 0 | — |
| `verifier` | 0 | — |
| `sb_flow_id` | 16 | `WindowManager`, `WindowManagerShell` |
| `code=` | 71 | `ActivityTaskManager` (60), `Keyboard`/`KeyboardDef` (9, `keyCode=`), `adbd` (1) |
| `auth/callback?` | 1 | `adbd` |

**Nothing under `ReactNativeJS` or any NoorLife tag.** The non-zero rows are Android logging deep-link
intent data for every app, plus this session's own `adb` commands — not an application leak. The
absence is meaningful rather than an artefact of a silent channel: `ReactNativeJS` lines do appear in
the same log.

Attribute by tag before concluding anything here. Grepping the message body would both mislead and
risk printing the very secret being looked for.

## `sb_flow_id` is now present, on purpose

`experimental.appendPkceFlowIdToRedirects` is enabled in `src/lib/supabase.ts` **in the tested tree**
(it lands in the follow-up commit, not this one — see "Which tree was tested"), so the redirect carried
`sb_flow_id`. That has a useful side effect: it proves the wildcard allow-list entry
`noorlifeapp://auth/callback?**` is live. With a query string present, a bare entry stops matching,
GoTrue substitutes the Site URL, and the link never reaches the app — but it did. Backlog **2.1a** is
confirmed by evidence, not by report.

## Defect found and deliberately not fixed here

**Open Email App reports "No email app is available on this device"** on a device where Gmail is
installed and the `CATEGORY_APP_EMAIL` intent resolves fine from `adb`. Almost certainly Android 11
package visibility with no `<queries>` element in the manifest.

It is a native manifest issue with nothing to do with the callback, so it was kept out of this commit
rather than folded into it. Tracked as backlog **2.3a**.

## The phone pass

**Outstanding, not done.** The Honor ALT-LX2 was unreachable for the entire session: `adb devices`
listed the emulator alone, `adb mdns services` discovered nothing, and `adb connect
192.168.0.238:5555` timed out. `deploy-both.js` reported one target and said so.

The APK already carries both ABIs, so nothing needs rebuilding — the phone needs wireless debugging
re-enabled and re-pairing, then `node scripts/deploy-both.js --no-build --clear` and a repeat of the
sequence above. The phone is 720 × 1600 at a lower density than the emulator's 1080 × 2400, so the Set
New Password layout and the callback status copy both want looking at rather than assuming. Tracked as
backlog **5.4**.
