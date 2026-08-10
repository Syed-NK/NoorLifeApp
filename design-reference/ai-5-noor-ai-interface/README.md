# AI-5 — Noor AI conversation interface, Android emulator verification

Emulator verification of the Noor AI conversation surface: the composer, the answer states, the three
refusal kinds, the ten failure states, the layout cases, and the inert reporting screen.

**This pass found two real production defects and they were fixed, not documented and shipped.** The
composer's visible field was mostly untappable, and the Noor AI **home** screen rendered fabricated
conversation history alongside four other capabilities the build cannot serve. Both corrections are
in this commit with regression tests, and the home screenshot has been replaced. Nothing in this
folder presents the original home as a passing result.

Every state was produced by a **temporary fixture harness that has been completely removed**. No
Noor AI, hosted Supabase or OpenAI request was made at any point.

## Target

| | |
|---|---|
| Build | `android/app/build/outputs/apk/debug/app-debug.apk`, **debug** (`app:assembleDebug -PreactNativeArchitectures=x86_64`) |
| Dev server | Metro on port **8099** over `adb reverse tcp:8099 tcp:8099`; the dev client reported `Connected to: http://localhost:8099` |
| AVD | `NoorLife_AI5_Pixel7_API36` (Pixel 7 profile) |
| Device | Android emulator, `sdk_gphone64_x86_64` / `emu64xa`, **Android 16 (API 36)**, `x86_64`, serial `emulator-5554` |
| Viewport | 1080 × 2400 px |
| Density | 420 dpi → scale factor 2.625 → **411.4 × 914.3 dp** |
| Account | **Signed out.** No account was created, inspected or signed into |
| Storage | 6.5 GB free on `/data` at install time |
| Package state | `com.anonymous.NoorLifeApp` was **absent** before the first install; re-verification used `pm clear` on that package only |

Every value was read back from the connected device (`adb`, `dumpsys`, `wm size`, `wm density`,
`pm list packages`), not assumed from a specification. The AVD was created by the repository owner.

**This is an API 36 / Android 16 pass.** An earlier attempt targeted a Pixel 8 / API 37 AVD which was
lost before any screenshot was taken, so **no API 37 evidence exists** and none is claimed.

### First-boot instability, and why it does not affect these captures

The emulator's first boot produced four ANR records, two identified in `logcat` as
`ANR in com.android.systemui` (*executing service … waited 20001ms*) and
`ANR in com.google.android.gms.persistent` (*failed to complete startup*) — cold-first-boot ANRs in
system components, not in NoorLife. Stability was confirmed before any capture: no
"Application Not Responding" window, `topResumedActivity` the launcher, 180 ms UI round-trip.

### Emulator-only settings, all restored

`stylus_handwriting_enabled=0` was set because the emulator's "Try out your stylus" tutorial
intercepts `adb shell input text`. `debug.force_rtl` and a per-app `ar-SA` locale were set only for
the RTL attempt below. **All were restored to their original unset state.** No production
configuration was touched.

### A second, unrelated emulator was running

During re-verification the repository owner started a `LumiTale` AVD on `emulator-5556` with its own
Metro. Every command in this pass was addressed to `-s emulator-5554`, and that other emulator and
its Node processes were left untouched. Its startup explains the resource contention behind some slow
loads noted below.

## The temporary harness, and its removal

`src/app/ai/chat/[conversationId].tsx` was temporarily replaced with a body injecting a fixture
`NoorAIPort`. The first pass used a **source constant** `HARNESS_STATE` to select among nineteen
states; the re-verification pass needed only the composer and one answer, so it injected a single
fixture with no selector at all. In both cases there was no environment variable, remote flag, route
parameter, user input or persisted setting — editing the file was the only way to change it, and
committing it the only way to ship it.

**It was not committed.** Both times the file was restored and proven byte-identical:

| | |
|---|---|
| Baseline git blob | `765b052e662cd59ab15a9467c91402bb1b8694db` — matches |
| Baseline SHA-256 | `BD936D2C6BF2729B96B6F825B84C4F36D4BDAAB5B8199C9754594E262FD347AD` — matches |
| Line endings | LF preserved (0 CR bytes) |

The restored route contains no fixture import, no selector, no fallback and no port prop: it renders
`<NoorAIChatScreen />`, resolving the real `noorAIService`.

The repository's own guard proves the harness could not ship silently. While it was applied,
`noor-ai-ui-source-scan.test.ts` **failed on exactly the two tests written to catch it** — *"is not
imported by any application module"* and *"leaves the production route composing the real adapter with
no fallback"*. After removal that suite is **green**.

## Defect 1 — the composer's visible field was mostly untappable

**Found by hitting it.** Driving the UI, a tap in the middle of the composer did nothing.

| | Before | After |
|---|---|---|
| `EditText` bounds | `[100,1207]–[980,1257]` | `[68,1106]–[1012,1322]` |
| Interactive height | **50 px** (~19 dp, one line) | **216 px** (82 dp × 2.625) |
| Visible field height | ~84 dp | ~84 dp (**unchanged**) |
| Tap at y=1294 | `focused="false"` | **`focused="true"`** |
| Tap at y=1340 (near the bottom edge) | not interactive | **`focused="true"`** |

**Cause.** The wrapper `View` carried `minHeight: dp(84)` while the `TextInput` kept its natural
single-line height inside it, so a box that looked like a text field was inert below its first line.

**Fix.** The height *and* the text inset moved onto the input
(`moduleLayout.noorAIComposerInputHeight`, 82 dp) and the wrapper carries neither, so the input fills
the bordered box. `minHeight` remains a floor — there is no `height` or `maxHeight` anywhere in the
field — so a long question still grows it rather than clipping or scrolling inside it. The visible
geometry is unchanged, which is why the unaffected state captures below remain faithful.

**Guarded by** `noor-ai-composer-geometry.test.tsx`, which asserts the arrangement from the **rendered
style objects** (not from source text or comments) and is scale-independent, plus a source guard in
`noor-ai-ui-source-scan.test.ts` that reads **comment-stripped executable styling**.

## Defect 2 — the home screen showed fabricated conversation history

`noorAIHomeFixture` supplied a **Recent Conversations** card listing three invented questions with
invented timestamps — *"How can I improve my productivity? — Yesterday, 9:21 PM"* and two more —
rendered as the user's own history, one tap from a chat surface whose caption reads *"Nothing here is
saved."* Nothing produced them: `AI_CONVERSATION_STORAGE_EXISTS` is `false`.

**Fix.** The section, its data and its types are **removed outright** — not replaced with an empty
state, because an empty history still claims a history exists. No conversation id is generated and no
storage was added. **Conversation persistence remains absent, and AI-8 still owns real conversation
history** behind a reviewed schema, an RLS policy, a retention period and an export and deletion path.

## The home capability boundary, control by control

§12.8 requires that only capabilities AI-1's server can actually serve are enabled. Every control was
classified and acted on.

| Control | Classification | Action |
|---|---|---|
| Ask field | **Actual AI ask entry** | **Kept** — opens `/ai/chat/new` |
| Send control beside it | **Actual AI ask entry** | **Kept** — same route; with the field these remain the *one* approved entry point |
| Microphone | **Unavailable future capability**, presented as active (opened "coming soon") | **Removed.** Voice input does not exist. Removed rather than shown permanently disabled, because the reference does not require a visible disabled control and a greyed microphone still advertises a feature |
| "Find a feature" | **Misleading** — routed to "coming soon" although the chat already answers exactly this | **Removed** (a second, dead entry to a live capability) |
| "Explain my progress" | **Misleading** — wording implies AI analysis of progress records | **Removed.** It navigated to `/insights`, so the wording was the defect; that screen stays reachable from its own module |
| "Help me plan" | **Misleading** — implies AI planning over planner data | **Removed.** Navigated to `/planner`, which stays reachable from its own module |
| "App settings" | **Ordinary direct navigation**, honestly labelled | **Removed** with the grid — it broke no rule but duplicated the five-slot bar's own Settings destination, and one card alone in a four-column grid would have been worse |
| "Review my day" | **Misleading** — "a summary of today's activities" is a module read | **Removed** |
| "Balance my week" | **Misleading** — "where to improve your time" is a module read | **Removed** |
| "Family activity idea" | **Misleading** — implies family records | **Removed** |
| "View All" (suggestions) | **Unavailable** — opened "coming soon" | **Removed** with the section |
| Privacy / access card | **Truthful scope information + ordinary navigation** | **Kept, copy narrowed.** It said "You control what Noor AI can access / Manage your data and permissions anytime", promising management AI-6 has not built. It now reads **"Noor AI reads no module records / Nothing you have saved in a module is sent with your question"**, with the action **"What Noor AI can access"** |

**What remains on the home screen:** the hero, the ask entry, and the access card. Nothing implies
Noor AI reads progress, daily activity, family records, health data, planning data or any module
contents. **Voice input remains unavailable. Module reads remain unavailable.**

### Two adjacent overclaims, recorded and not fixed

Outside this bounded home correction, two section screens still describe capabilities that do not
exist, and they are reported rather than changed:

- `/ai/history` — *"Every question you have asked … Reopen a conversation, or pick up where one left
  off."* There is no history to reopen. It is reached from the five-slot bar, whose architecture this
  correction was told not to modify.
- `/ai/permissions` — *"You decide what Noor AI can read / Grant a module, or withdraw it, at any
  time."* Granting is AI-6's and `AI_GRANT_EDITING_AVAILABLE` is `false`. It is the access card's
  destination.

Each needs its own bounded correction.

## States observed

All 24 retained files were inspected at full resolution. Every chat capture uses the same fixed
synthetic draft, *"How do I change my language in NoorLife"*, and each answer state came from **one**
deliberate press of Send.

| # | State | File | Provenance |
|---|---|---|---|
| 1 | Home entry / composer (`/ai`) | `01-home-entry-composer.png` | **Replaced** after the home correction |
| 2 | Initial empty chat | `02-chat-initial-empty.png` | Retained — unchanged UI |
| 3 | Composing, Send enabled | `03-composing-draft.png` | Retained — unchanged UI |
| 4 | Loading — progress line, Stop, Send disabled | `04-loading-pending.png` | Retained |
| 5 | Complete answer | `05-answer-complete.png` | Retained |
| 6 | Length-limited answer | `06-answer-length-limited.png` | Retained |
| 7 | Refusal — safety boundary | `07-refusal-safety.png` | Retained |
| 8 | Refusal — permission required | `08-refusal-permission-required.png` | Retained |
| 9 | Refusal — out of scope | `09-refusal-out-of-scope.png` | Retained |
| 10 | Authentication required (the one failure with an action) | `10-failure-authentication-required.png` | Retained |
| 11 | Invalid request | `11-failure-invalid-request.png` | Retained |
| 12 | Temporarily limited | `12-failure-temporarily-limited.png` | Retained |
| 13 | Temporarily unavailable — **the state this deployment reaches** | `13-failure-temporarily-unavailable.png` | Retained |
| 14 | Network unavailable | `14-failure-network-unavailable.png` | Retained |
| 15 | Timed out | `15-failure-timed-out.png` | Retained |
| 16 | Cancelled — question still editable | `16-failure-cancelled.png` | Retained |
| 17 | Invalid server response | `17-failure-invalid-server-response.png` | Retained |
| 18 | Unknown failure | `18-failure-unknown.png` | Retained |
| 19 | No-module-access scope | in every chat capture; clearest in `02-chat-initial-empty.png` | — |
| 20 | Long-answer wrapping and scrolling | `20a-long-answer-top.png`, `20b-long-answer-scrolled.png` | Retained |
| 21 | Keyboard-open layout | `21-keyboard-open-layout.png` | Retained — unchanged UI |
| 22 | Pending / disabled submission | empty draft in `02`; in-flight in `04` | — |
| 23 | Inert feedback screen (`/ai/feedback`) | `23-feedback-inert.png` | Retained |
| 24 | RTL / Arabic layout | **not verified — not reachable; see below** | — |
| — | **Composer lower-area tap focuses the input** | `22-composer-lower-area-tap-focus.png` | **New**, post-fix |

**Why the retained chat captures are still faithful.** The composer fix changed *which element owns*
the field's height and inset, not the rendered result: the visible bordered box is the same 84 dp in
the same position, and the text sits at the same 12/8 dp inset. Only the home screenshot showed
content that changed, and it was replaced. `failed: not-configured` was not captured; it is not one of
the required states.

### 24 — RTL/Arabic: not reachable, so not claimed

RTL was attempted twice and reached neither. `AndroidManifest.xml` declares `supportsRtl="true"` and
`src/shared/utils/rtl.ts` reads `I18nManager.isRTL` per call, but the layout did not mirror under the
Android **force-RTL developer option**, nor with a **per-app `ar-SA` locale**. The cause is in the
source: `allowRTL` / `forceRTL` appear **nowhere** in `src/`, so React Native never enables RTL.
Arabic *text* is separately unreachable — no message catalogue exists and `LocalizationProvider` is
mounted with no `locale` prop, so it defaults to `en`. Reaching either needs a production source
change this pass was not permitted to make. **RTL verification remains unavailable, not passed**, and
no RTL capture is retained: an early attempt produced an unmirrored screen that would have been
mislabelled, and it was deleted.

## Defect 3 — two labels ellipsized at a large Android font scale

Re-tested deliberately at **`font_scale 1.30`** on the same API 36 emulator, at the emulator's own
1080 × 2400 / 420 dpi width, on the **production** route with no harness. Two labels lost words.

| | Before | After |
|---|---|---|
| Scope badge | `NoorLife questions …` — **truncated**, node width **433 px** | node width **477 px** |
| Composer Send | `Se…` — **truncated** | `flexShrink: 0`, keeps its label |
| Header title | `Ask Noor AI`, complete, band `[394,171]–[685,241]` | complete, band `[382,171]–[698,241]` |
| Back / Help / Profile | 116 × 116 px = **44 dp** | 116 × 116 px = **44 dp**, unchanged |

**Cause.** Both labels sat in a row beside a sibling carrying `flex: 1` and kept flexbox's default
`flexShrink: 1`, so the greedy sibling took the width first and compressed them below their content
size, at which point their single line ellipsized. For the badge, the sibling is the card heading,
which wraps to two lines at 1.30 and takes the room.

**Fix.** `Pill` and the composer's Send and Stop controls now set `flexShrink: 0`, so a
non-shrinkable item receives its content width and the flexible sibling yields instead. The scope
heading row also gains `flexWrap: 'wrap'`, so if a row genuinely runs out the badge drops to its own
row rather than compressing. **No font size was reduced** — the locked type ramp is untouched,
`allowFontScaling` stays on, and the header title's existing 1.3 growth cap is unchanged.

**What was measured versus what was seen.** The pre-fix truncation is visually confirmed. The
post-fix state is confirmed by **measurement, not by a screenshot**: the badge's node grew from 433 px
to 477 px, and because flexbox gives a `flexShrink: 0` item its hypothetical (content) size, 477 px is
the badge's content width, so the label is no longer compressed. A post-fix screenshot could not be
obtained — the emulator's renderer stopped producing frames in that instance, writing a blank
15.6 KB PNG **device-side** while the accessibility tree stayed fully populated, which is an emulator
surface fault rather than an app state. **No post-fix screenshot of the badge is retained or claimed.**

`noor-ai-responsive-chrome.test.tsx` guards all of it from the rendered style objects: `flexShrink: 0`
on the badge and on Send, the 44 dp minimum on Back, Help and Profile on both axes, the full approved
strings, and that the type ramp and font scaling were not weakened.

## A font-fallback condition affecting one capture

`22-composer-lower-area-tap-focus.png` shows the Send label and two scope-card sentences ellipsized.
That is **not** a layout defect and **not** caused by either fix.

`FontProvider` is deliberately built so a font-load failure is non-fatal: *"if a face cannot load,
`error` is set and `ready` still becomes true, so the app renders on system fonts … A missing font is
a visual regression; a permanent splash screen is a broken app."* After `pm clear` wiped the app's
data and Metro was restarted with `--clear`, some Poppins faces failed to load in that instance and
the wider system fallback ellipsized single-line labels.

**This was proven environmental by an A/B on the same device**: with the corrections stashed and the
committed code running, the identical truncation appeared and was *worse* — the header itself rendered
as "Ask Noor…" — while the `EditText` returned to `[100,1127]–[980,1177]`, 50 px, the original defect.
The capture is retained solely as the focus proof; the accessibility tree confirms the full strings
are intact (`text="NoorLife questions only"`), and `01` was captured with the faces loaded.

## What each capture was checked for

Each retained file was opened at full resolution and checked for all of the following.

- **NoorLife-authored copy only**, matching `noor-ai-chat-copy.ts` verbatim; `—` and `’` render
  correctly with no mojibake.
- **No raw error, provider or platform detail**; no status code, exception text, host, URL, function
  or configuration name.
- **No identifiers, tokens, costs or quota internals.** `temporarily-limited` names no count, limit or
  reset time.
- **No fabricated citations.** No "Sources" heading exists in any state, because `sources` can only be
  `[]`.
- **No fabricated conversation history and no timestamps** anywhere on the home screen.
- **No module records.** The "No module access" block states the opposite and is present throughout.
- **No unsafe HTML interpretation.** Answer text renders in a React Native `Text`, which has no HTML,
  Markdown or link-autodetection contract.
- **No clipping or overlap** of app content, and **correct scrolling** — `20b` reads paragraphs 6–12
  of a twelve-paragraph answer, proving the card grows and scrolls rather than clipping.
- **The keyboard hides no critical control.** In `21`, Send stays fully visible above the open Gboard.
- **Accessible control labels**, read from the view hierarchy: the field is `Your question for Noor
  AI`; Send is `Send your question to Noor AI` with `enabled="false"` while a request is in flight and
  while the draft is empty; Stop is `Stop waiting for this answer`; the progress line exposes
  `Noor AI is thinking…` as a polite live region.
- **Scope pill placement** — `NoorLife questions only`, directly above the composer.
- **Meaning is never carried by colour alone**: info ⓘ for refusals and `cancelled`, warning ⚠ for the
  warning failures, error ❗ for `invalid-server-response` and `unknown`, each with a text title.
- **No accidental duplicate invocation.** One Send press produced one outcome in every case.
- **No debug clutter.** The expo-dev-client "Tools button" was disabled before every retained capture.
  No capture contains a notification, account detail, device identifier, hostname or personal data.

## No NoorAI, hosted Supabase or OpenAI request occurred

Metro and the dev client do communicate, so this is **not** a claim of zero network traffic. It is a
claim about NoorAI, Supabase and provider requests, and it rests on the following.

**The route injected only the fixture port.** `noorAIService` was never referenced in either harness.

**The fixture dependency graph contains no networking.** `noor-ai-fixtures.ts` has exactly two imports
and **both are `import type`**, erased at emit, so its runtime graph is empty. It contains no `fetch`,
`XMLHttpRequest`, `WebSocket`, `EventSource`, Supabase client or `invoke`.

**The production adapter's request path was never entered.** Stated precisely: the screen imports
`noorAIService` statically, so the adapter module is in the bundle and its object literal exists. What
matters is that the module performs **no request at module scope** and its **single**
`functions.invoke` call site sits inside `ask()` — never called, because the harness always supplied a
fixture port.

**Fixture invocation counts match user actions.** Each fixture records its own calls; every capture
followed exactly one Send press, and Send is disabled while in flight.

**Runtime confirmation from the device.** Every socket owned by the app's UID (10216) had exactly one
remote port for the whole session: **8099**, Metro — `127.0.0.1:8099`, `10.0.2.2:8099` and the host's
LAN address on 8099. **Zero sockets on 443 or 80.** With no HTTPS socket open at any point, no request
to a hosted Supabase project or to OpenAI can have occurred. Per-UID byte counters are aggregate and
include the Metro bundle, so they are supporting context only and prove nothing alone.

**The kill switch never moved.** `supabase/functions/noor-ai/production.ts` keeps the literal
`enabled: false`.

### The failed network-isolation attempt, and the earlier connectivity probe

An earlier attempt to network-isolate the emulator **did not succeed**; the emulator was not isolated
and these captures were taken on a networked emulator. The absence of NoorAI, Supabase and provider
traffic therefore rests on the source and socket evidence above rather than on an air gap.

Separately, recorded so it is not discovered later and misread: a single **DNS/ICMP connectivity
probe** was previously directed at `api.openai.com`. It was a reachability check — **not HTTP, not an
API call**, carrying no key, prompt or payload — and it was not repeated. **No OpenAI API request has
been made.**

## What this verification does and does not close

- **Emulator verification: performed**, and re-performed after both fixes.
- **Physical Honor verification: unavailable, not passed.** No physical device was attached at any
  point. The standing both-targets rule is therefore unmet.
- **AI-5 remains incomplete** because of that physical-device gate, as does AI-4's device criterion.
- **RTL verification remains unavailable, not passed.**
- **Conversation persistence remains absent; AI-8 still owns real conversation history.**
- **Voice input remains unavailable; module reads remain unavailable.**
- The hosted Noor AI function **remains disabled**, real-user and public AI traffic **remain
  prohibited**, and **NoorLife is not production-ready.**
