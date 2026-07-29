# CLAUDE PHASE 2 — ENTRY & AUTHENTICATION

## Objective

Implement the locked NoorLife Entry and Authentication flow in `D:\Projects\NoorLifeApp`. The Main Home is already complete and locked. Do not modify it, its navigation, tokens, assets, or behavior.

This phase contains:

1. Splash
2. Onboarding — Family in Sync
3. Onboarding — Every Part of Life
4. Onboarding — AI That Understands
5. Welcome / Authentication Options
6. Login
7. Create Account
8. Verify Email
9. Forgot Password
10. Reset Link Sent
11. New Password
12. Account Ready

## Authoritative references

Read this document completely:

`D:\ChatGPT\NoorLife\design\production-mockups\01-entry-authentication-flow\ENTRY_AUTHENTICATION_DESIGN_LOCK.md`

Copy these immutable PNG references into:

`D:\Projects\NoorLifeApp\design-reference\01-entry-authentication-flow\`

References:

- `D:\ChatGPT\NoorLife\design\production-mockups\01-entry-authentication-flow\01-splash-locked-soft-mint.png`
- `D:\ChatGPT\NoorLife\design\production-mockups\01-entry-authentication-flow\01-entry-authentication-flow-soft-mint.png`
- `D:\ChatGPT\NoorLife\design\production-mockups\implementation-pack\main-home\09-png-pictogram-system-preview.png`
- `D:\ChatGPT\NoorLife\design\production-mockups\implementation-pack\main-home\hero-graphics-only-v2.png`

Copy the approved pictograms from:

`D:\ChatGPT\NoorLife\design\production-mockups\implementation-pack\main-home\png-pictograms\`

into:

`D:\Projects\NoorLifeApp\assets\images\pictograms\`

Required filenames:

- `noor-ai.png`
- `faith.png`
- `health.png`
- `planner.png`
- `finance.png`
- `learning.png`
- `family.png`
- `goals.png`

Do not substitute vector icons, emoji, text glyphs, MaterialCommunityIcons, Lucide, Font Awesome, or newly generated illustrations.

## Visual lock

- Baseline viewport: 393 × 852dp
- Maximum content width: 393dp
- Page padding: 16dp
- Background: Soft Mint
  - `#FAFFFD`
  - `#EEF9F4`
  - ambient glow `#DDF6F1`
- Card surface: `#FFFFFF`
- Primary text: `#14265F`
- Secondary text: `#667085`
- Primary action: `#1677FF` / `#2563EB`
- Focus: `#3B82F6`
- Error: `#E5484D`
- Success: `#18A66A`
- Cards: 14–16dp radius
- Inputs: 12dp radius, 48dp minimum height
- Primary buttons: 48dp height, 12dp radius
- Typography: the same installed Poppins fonts used by locked Main Home
- Headings: Poppins SemiBold, never ExtraBold
- Body: Poppins Regular
- Labels: Poppins Medium
- Do not upscale above the 393dp baseline:

```ts
const scale = Math.min(screenWidth / 393, 1);
```

Do not enlarge cards or fonts to fill tall devices.

## Asset rules

1. Use static React Native `require()` calls.
2. Keep all production assets under `assets/images/entry-auth/`.
3. Preserve aspect ratio with `resizeMode="contain"` unless the locked PNG is explicitly used as a full-screen cover.
4. Do not crop faces, the robot, pictograms, or the NoorLife wordmark.
5. Do not use a screenshot containing text as the interactive UI for onboarding or forms. Use extracted decorative artwork plus live accessible text and controls.
6. The Splash may use its locked full-screen PNG because it has no interactive controls.
7. If a required decorative asset cannot be extracted cleanly, report the missing asset instead of inventing a replacement.

## Navigation workflow

```text
Splash
  → Onboarding 1
  → Onboarding 2
  → Onboarding 3
  → Authentication Options
      ├─ Login
      │   ├─ Forgot Password
      │   │   → Reset Link Sent
      │   │   → New Password
      │   │   → Login
      │   └─ Main Home
      └─ Create Account
          → Verify Email
          → Account Ready
          → Main Home
```

Back behavior must follow this workflow. Android system Back must never exit unexpectedly from a form with unsaved input; show a confirmation only when data would be lost.

## Implementation order

Do not implement all screens blindly and present them together.

For every screen:

1. Inspect the reference.
2. Implement one screen.
3. Run TypeScript and lint.
4. Open it directly in the Pixel 8 emulator.
5. Capture a clean screenshot.
6. Compare it beside the approved overview/reference.
7. Measure padding, typography, controls, and illustration bounds.
8. Correct mismatches.
9. Only then continue to the next screen.

Do not ask for routine approval between screens.

## Screen requirements

### 01 Splash

- Use `01-splash-locked-soft-mint.png` unchanged.
- Full screen, edge-to-edge.
- Use `resizeMode="cover"` only if it does not crop meaningful artwork or copy on Pixel 8.
- Prefer a pre-sized Android splash asset and matching native background color to prevent a white flash.
- Duration: 1.5–2 seconds only while routing state is resolved.
- No fake progress spinner.
- Route returning authenticated users directly to Main Home.
- Route first-time unauthenticated users to Onboarding 1.
- Route returning unauthenticated users to Authentication Options.

### 02 Onboarding — Family in Sync

- Title: `Your family, beautifully in sync.`
- Supporting copy: `Bring your loved ones together and stay connected in meaningful ways.`
- Reuse the approved family and robot artwork.
- `Skip` text action at top-right.
- Three progress indicators; first active.
- Secondary `Skip` and primary `Next` controls at bottom only if both are present in the approved reference; avoid duplicate Skip actions.

### 03 Onboarding — Every Part of Life

- Title: `Every part of life, together.`
- Supporting copy: `From faith and health to goals and finances—manage it all in one place.`
- Use the seven approved circular module pictograms around Noor AI.
- Second progress indicator active.
- `Skip` and `Next`.

### 04 Onboarding — AI That Understands

- Title: `Helpful AI, with clear boundaries.`
- Supporting copy: `NoorLife’s AI is module-specific and privacy-first—built to support, never overstep.`
- Use Noor AI, privacy shield, and selected module pictograms.
- Third progress indicator active.
- Primary action: `Get Started`.

### 05 Authentication Options

- Title: `Welcome to NoorLife`
- Actions:
  - `Continue with Email`
  - `Continue with Google`
  - `Continue with Apple`
- Link: `Don’t have an account? Sign Up`
- Terms and Privacy text at bottom.
- Google and Apple buttons must follow provider branding rules.
- Do not imply Google/Apple authentication is functional unless configured.

### 06 Login

- Title: `Welcome back`
- Subtitle: `Sign in to continue to NoorLife.`
- Email
- Password with show/hide control
- Remember me
- Forgot password?
- `Sign In`
- Google and Apple alternatives
- Sign Up link
- Keyboard-safe, autofill-aware, and password-manager compatible.

### 07 Create Account

- Title: `Create your account`
- Full name
- Email
- Password
- Confirm password
- Terms and Privacy checkbox
- `Create Account`
- Sign In link
- Password validation must be visible before submission.

### 08 Verify Email

- Title: `Check your email`
- Six OTP boxes
- `Verify Email`
- `Resend code`
- Countdown
- `Change email`
- Support paste, backspace navigation, autofill, and expired-code state.

### 09 Forgot Password

- Title: `Reset your password`
- Email
- `Send Reset Link`
- `Back to Sign In`
- Always use privacy-safe success messaging that does not reveal whether an account exists.

### 10 Reset Link Sent

- Title: `Check your inbox`
- `Open Email App`
- `Resend Email`
- Countdown
- `Back to Sign In`
- Handle absence of an installed mail application gracefully.

### 11 New Password

- Title: `Create a new password`
- New password
- Confirm new password
- Show/hide controls
- Password-strength requirements
- `Reset Password`
- Handle expired/invalid reset link.

### 12 Account Ready

- Title: `You’re all set!`
- Supporting copy: `Your account is ready. Let’s make every day meaningful together.`
- Primary action: `Continue to NoorLife`
- Use family, robot, and success check artwork.
- Continue replaces the auth stack with Main Home; Back must not return to authentication.

## Required states

Each relevant screen must support:

- default
- focused input
- filled input
- disabled
- loading
- validation error
- API/server error
- offline
- slow network
- success
- keyboard open
- reduced-height device
- large text/accessibility check

Specific states:

- invalid email
- incorrect password
- password too weak
- passwords do not match
- terms not accepted
- incorrect OTP
- expired OTP
- resend cooldown
- expired reset link
- provider authentication cancelled
- provider authentication failed

Do not create a separate full-screen design for every inline validation error unless needed; use reusable input and banner components.

## Production architecture

- Reuse existing Expo Router architecture.
- Create an `(auth)` route group without modifying locked Main Home routes.
- Create reusable components:
  - `AuthScaffold`
  - `AuthHeader`
  - `AuthIllustration`
  - `AuthTextField`
  - `PasswordField`
  - `PrimaryButton`
  - `SocialAuthButton`
  - `OtpInput`
  - `ProgressDots`
  - `InlineError`
  - `AuthStatusBanner`
- Create shared auth design tokens rather than repeating numbers.
- Separate UI from authentication services.
- Use mock service adapters when backend/provider configuration is unavailable.
- Never store passwords or tokens in AsyncStorage.
- Do not log credentials, OTPs, or tokens.
- Use secure storage only for tokens when real authentication is connected.

## Accessibility

- Minimum touch target: 44 × 44dp.
- Inputs need visible labels; placeholders are not labels.
- Provide accessibility roles and labels.
- Maintain readable contrast.
- Respect reduced motion.
- Do not permanently disable font scaling on authentication forms.
- Screen-reader focus must move to validation errors and success messages appropriately.

## Pixel-accuracy rejection gates

Reject and correct if:

- The Soft Mint background is replaced by plain gray, lavender, or excessive blue.
- A heading is heavier than Poppins SemiBold.
- Generic vector illustrations replace approved PNG artwork.
- Flat generic icons replace selected 3D pictograms.
- Cards or fields stretch to fill screen height.
- Content is clipped when the keyboard opens.
- Buttons exceed 50dp height without accessibility reason.
- Page side padding differs materially from 16dp.
- The Splash is modified.
- Main Home is changed.
- A debug overlay appears in screenshots.

## Validation and evidence

For each screen provide:

- clean Pixel 8 screenshot
- side-by-side comparison with the overview/reference
- route path
- measured page padding
- heading font/size/line-height
- button height
- card radius
- TypeScript result
- lint result

Also validate one reduced-height Android device and one keyboard-open form.

## Permission and autonomy

You are authorized to perform routine development work inside `D:\Projects\NoorLifeApp`, including reading and editing project files, copying approved assets, installing required project dependencies, running formatting, type checking, lint, tests, Metro, Expo Android builds, ADB, emulator use, and screenshot capture.

Proceed without asking for confirmation between routine implementation steps.

This does not authorize deleting unrelated files, discarding unrelated Git changes, exposing credentials, publishing externally, production deployment, or paid services.

## Final delivery

Return:

1. Changed files
2. Route map
3. Asset registry and exact PNG paths
4. State handling implemented
5. TypeScript/lint/test/build results
6. Twelve clean Pixel 8 screenshots
7. Comparison board
8. Remaining backend/provider configuration
9. Confirmation that Main Home was not modified

