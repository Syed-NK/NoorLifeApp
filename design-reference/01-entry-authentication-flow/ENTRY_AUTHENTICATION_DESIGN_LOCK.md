# NoorLife — Entry & Authentication Design Lock

Status: **Splash locked; authentication flow direction approved for detailed design**

## Locked splash

Canonical asset:

- `01-splash-locked-soft-mint.png`

Do not change its family composition, robot, circular 3D pictograms, wordmark, tagline, background direction, or spacing without explicit approval.

Tagline:

> Your family, your day, beautifully in sync.

## Locked visual language

- Background: Soft Mint
  - `#FAFFFD`
  - `#EEF9F4`
  - ambient glow `#DDF6F1`
- Form/card surface: `#FFFFFF`
- Primary text: `#14265F`
- Secondary text: `#667085`
- Primary action: `#1677FF` to `#2563EB`
- Focus border: `#3B82F6`
- Typography: Poppins Regular, Medium, SemiBold
- Cards: 14–16dp radius
- Primary controls: approximately 48dp high
- Page padding: 16dp
- Illustration style: friendly polished 3D family and Noor AI robot
- Module treatment: detailed 3D pictograms on saturated circular module-color medallions

Do not substitute generic vector icon libraries for the selected pictograms.

## Flow inventory

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

## Canonical overview

- `01-entry-authentication-flow-soft-mint.png`

This overview locks hierarchy, style, screen inventory, and navigation intent. Individual full-size screens should be produced before implementation so text, spacing, keyboard behavior, accessibility, errors, disabled states, loading states, and validation states can be specified precisely.

## Workflow

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

## Next design session

1. Review the 12-screen overview.
2. Produce each screen as a full-size 393×852 reference.
3. Add interaction and validation variants.
4. Define keyboard-safe layouts and password rules.
5. Define loading, offline, error, resend-code, and expired-code states.
6. Package exact assets and implementation measurements for Claude.

