# NoorLife Production UI Design Specification

Version: 1.0  
Status: Design lock for Claude development  
Reference: `design/noorlife-complete-app-screen-system.png`

## 1. Product and visual direction

NoorLife is a modular AI-integrated life companion. Preserve the friendly, rounded, polished style of the approved original design, but reduce the amount of blue across the application.

The system must follow these rules:

1. Use a warm neutral application background and neutral navigation surfaces.
2. Give each module one clearly owned color family.
3. Use the module color only for its hero card, active controls, charts, icons, selected navigation item, and small highlights.
4. Do not tint an entire module screen with its accent color.
5. Every module home screen, including Main Home and Noor AI, must contain one large illustrated hero card similar in prominence and polish to the approved Learning hero card.
6. Use the approved white robot with a dark face and cyan expression as the only AI mascot.
7. Use the robot head icon for compact AI actions and the full robot only in hero cards, onboarding, authentication help, and system states.
8. All AI functions must remain limited to NoorLife or to the module from which they are opened.

## 2. Locked design tokens

### 2.1 Neutral foundation

| Token | Value | Usage |
|---|---:|---|
| `color.canvas` | `#F7F8FA` | Main application background |
| `color.surface` | `#FFFFFF` | Cards, sheets, navigation |
| `color.surfaceSoft` | `#F1F3F6` | Secondary cards and grouped controls |
| `color.border` | `#E2E6EC` | Card and input borders |
| `color.divider` | `#E9ECF1` | List separators |
| `color.textPrimary` | `#172033` | Headings and important values |
| `color.textSecondary` | `#667085` | Supporting copy |
| `color.textMuted` | `#98A2B3` | Metadata and placeholders |
| `color.disabled` | `#C8CED8` | Disabled controls |
| `color.scrim` | `rgba(17,24,39,0.45)` | Modal background |

### 2.2 Semantic colors

| Token | Value | Usage |
|---|---:|---|
| `color.primary` | `#3157C8` | Global primary actions only |
| `color.success` | `#22A06B` | Success, confirmation |
| `color.warning` | `#E6A23C` | Warnings and attention |
| `color.error` | `#D92D4C` | Errors and destructive actions |
| `color.info` | `#3A8DDE` | Informational messages |

Do not use `color.primary` as a background for large areas. It is for buttons, links, focus states, and global active navigation.

### 2.3 Module palettes

| Module | Primary | Dark | Soft background | Supporting accent |
|---|---:|---:|---:|---:|
| Main Home | `#3949AB` | `#26337D` | `#EEF0FF` | `#F2B84B` |
| Noor AI | `#6556C8` | `#473A9E` | `#F0EDFF` | `#45BFD1` |
| Faith | `#23856D` | `#155E4D` | `#E9F6F1` | `#D5A94E` |
| Health | `#4A9FD8` | `#2875A8` | `#EAF6FC` | `#65C7B2` |
| Planner | `#5A72C9` | `#3C50A1` | `#EEF1FB` | `#87A7E8` |
| Finance | `#E38A32` | `#B7641F` | `#FFF3E6` | `#F1B75B` |
| Learning | `#7657D6` | `#5839B5` | `#F1EDFF` | `#B695F3` |
| Family | `#D95B82` | `#A93B60` | `#FDECF2` | `#F0A4B8` |
| Goals | `#269B94` | `#15716C` | `#E8F7F5` | `#67C9BE` |

Faith must always be green-led. Gold is a small supporting accent for Islamic geometry, premium details, and important worship moments.

Health must always be light-blue-led. Mint can support positive wellness indicators, but green must not dominate the Health module.

### 2.4 Typography

Use **Poppins** throughout the app.

Fallback stack:

```css
font-family: "Poppins", "Inter", "Segoe UI", Arial, sans-serif;
```

Use these weights only:

- Regular 400
- Medium 500
- SemiBold 600
- Bold 700

| Style | Size / line height | Weight | Usage |
|---|---|---:|---|
| Display | 32 / 40 | 700 | Splash and marketing only |
| Hero title | 24 / 31 | 700 | Hero-card headline |
| Screen title | 20 / 28 | 600 | App-bar title |
| Section title | 17 / 24 | 600 | Section headings |
| Card title | 15 / 22 | 600 | Card and list headings |
| Body | 14 / 21 | 400 | Main body content |
| Body medium | 14 / 21 | 500 | Emphasized content |
| Label | 12 / 17 | 500 | Form and navigation labels |
| Caption | 11 / 16 | 400 | Metadata |
| Data large | 34 / 40 | 600 | Scores, balances, progress |

Minimum supported body size is 14 px. Do not use all-uppercase text except short board labels or optional small badges.

### 2.5 Spacing, radius, elevation

Use an 8-point spacing system:

`4, 8, 12, 16, 24, 32, 40, 48`

- Screen horizontal padding: 20 px
- Card internal padding: 16 px
- Section gap: 24 px
- Related card gap: 12 px
- Minimum touch target: 44 × 44 px
- Standard card radius: 18 px
- Hero-card radius: 24 px
- Button and input radius: 12 px
- Pill radius: 999 px

Shadows:

```css
--shadow-card: 0 4px 16px rgba(23, 32, 51, 0.07);
--shadow-raised: 0 10px 28px rgba(23, 32, 51, 0.12);
--shadow-ai: 0 6px 20px rgba(101, 86, 200, 0.22);
```

Do not use heavy glassmorphism. Surfaces should remain readable on inexpensive devices.

### 2.6 Iconography and commissioned pictograms

Locked by issue #104. The machine-checkable half of this section is
`src/features/modules/assets/pictogram-manifest.ts` and
`src/features/modules/__tests__/pictogram-system-lock.test.ts`. **Any exception to this section
requires an explicit reviewed amendment to that manifest — a new optical policy, a new governed
directory or a changed class boundary is a diff somebody approves, never a local decision at a call
site.**

#### Three visual classes

NoorLife draws marks in exactly three classes. A mark belongs to one of them and nothing may move
between classes without an amendment.

**Class 1 — coloured raster pictograms.** Available module destinations and feature concepts: Main
Home's module tiles, module feature-grid tiles, module quick actions, and Faith's submenu and
dimensional slots. These are commissioned artwork, rendered as delivered.

**Class 2 — vector glyphs.** Controls, wayfinding and status. `back`, `help`, `close`, `add`,
`minus`, `check`, `check-circle`, the four chevrons, `search`, `settings`, `more`, `retry`,
`warning`, `error`, `info`, `info-outline`, `download`, `downloading`, the media transport
(`play`, `pause`, `skip-next`, `skip-previous`), `share`, `edit`, `delete`, `send`, `microphone`,
`notification`, `lock`, `bookmark`; **every bottom-navigation slot**; and trend arrows.

These stay glyphs because they mean the same thing everywhere. Commissioning them per module would
make "back" look like eight different actions, and a coloured pictogram on a destructive control
reads as decoration rather than as a warning. **A control, a status marker or a navigation slot must
never be reclassified as a pictogram in order to raise PNG coverage.** Coverage is not a goal; the
right mark for the surface is.

**Class 3 — hero illustrations.** Large artwork behind hero copy. A separate class with its own
contract: full-bleed field, its own scrim, no optical-box rule, no 256 px canvas. Hero files live in
`assets/images/modules/heroes/` and `assets/images/modules/faith/hero/` and **may not enter the
pictogram manifest** — a hero rendered at 40 dp in a feature tile is an unreadable smudge.

#### Canonical style

**Faith and Main Home are the reference family.** A new delivery is judged by whether it looks like
part of that set at the same rendered size.

- Dimensional, softly rounded 3D/clay treatment.
- Consistent three-quarter perspective.
- Upper-left soft studio lighting.
- Moderate gloss, tactile materials, mid-saturation.
- Compact single-object or tightly grouped silhouette.
- The module's own palette, with restrained cream, gold and navy supporting accents.
- **No** text, letters, numbers, Arabic script, currency symbols, logos, emoji, watermarks,
  trademarks or third-party branding.
- **No** baked canvas and no external drop shadow. The artwork sits on a transparent field; the
  surface behind it belongs to the screen.

New **Finance** artwork must move toward Faith's softer visual weight rather than becoming more
photorealistic. Finance is deliberately not flagged as a canonical reference in the manifest for
this reason.

#### Mechanical delivery

Enforced by `commissionedAssetViolations` and the manifest guard:

| Property | Required |
| --- | --- |
| Preserved source master | 1024 × 1024 or larger, kept outside the installed set |
| Installed file | exactly 256 × 256 |
| Format | PNG, 8-bit RGBA (colour type 6), non-interlaced |
| Corners | all four alpha values exactly 0 |
| Safety margin | ≥ 19 px transparent on every side |
| Optical box | ≤ 85% of the canvas on the longer edge |
| Optical centre | within 1 px of the canvas centre |
| Metadata | no `tEXt`, `iTXt`, `zTXt`, `eXIf`, `tIME` |
| Resolution | static literal Metro `require` only |
| Tint | none — `AppIcon`'s raster branch types `color` as `never` |
| Theme colour | never sampled from artwork |

Twenty-three of the thirty-six assets in the governed module directories predate these rules and
carry a **legacy optical policy**.
Those policies are a closed set, frozen by asset id. They exist so approved artwork is not re-exported
to satisfy a rule written after it was drawn; they are **not** available to new work. The only policy
open to a new delivery is `commissioned-256`.

#### Usage

- An **unavailable** capability always draws its neutral glyph and never full-colour artwork.
  `moduleRasterIcon` refuses artwork when `available` is false, by construction.
- **No asset is installed without a named production consumer.** A file on disk that nothing renders
  is either staged with a recorded reason or it does not belong in the repository.
- Mapping is keyed on **module plus semantic icon**, never on icon name alone. `add-circle` belongs
  to four modules and `robot` to seven; a name-only lookup would put Finance's wallet on Planner's
  add button.
- One asset may serve several consumers **only when their meaning is identical**.

Standing decisions, each machine-checked:

- **Receipts** artwork stays staged and unmapped until #101 makes Receipts available.
- **Bank sync** remains a disabled glyph.
- **`finance-track`** remains unused until an honest consumer exists.
- **`p3-reminder-bell`** remains held until notification delivery exists and is separately approved.

#### What CI cannot do

Every property above is mechanical, and a green build says only that the bytes and the wiring are
right. **CI cannot judge artistic quality**, and this specification does not claim it can: no test
can tell a drawing that belongs to the family from a competent drawing that does not.

A delivery is therefore gated on **a reference-sheet review by a person** — the new artwork placed
beside the canonical Faith and Main Home assets at the same rendered size, and accepted or rejected
as a set. A batch is integrated in one pass or not at all; half a batch puts approved artwork beside
stand-ins on the same screen, which reads as a design decision rather than as an unfinished state.


## 3. Application shell

### 3.0 Home-screen content-density rule

Main Home and every module home are complete dashboards, not sparse landing pages.

- Fill the visible viewport from hero card to bottom navigation with meaningful content.
- Do not leave an unexplained blank region larger than 24 px.
- Use deliberate spacing of 12–24 px between sections; spacing is not placeholder content.
- Each home screen must contain the shared hero card plus at least four distinct content sections.
- Each home screen must contain at least one live activity or recent-record section.
- Each home screen must contain at least one progress, trend, or status component.
- Each home screen must contain quick actions appropriate to the module.
- Each module home must contain a module-AI insight or suggestion card above bottom navigation.
- Use `View All` when a home section shows only a subset.
- Prefer 2-column card groups, compact metric rows, timelines, checklists, and recent-activity lists.
- Do not fill space with decorative illustrations after the hero; all remaining cards should be functional.
- When no data exists, replace the affected section with its designed empty state. Do not remove the section and leave blank space.

Recommended module-home structure:

1. Module top bar
2. Hero card
3. Metrics or primary shortcuts
4. Today's activity or live status
5. Progress, trends, or recent records
6. Upcoming items or recommendations
7. Quick actions
8. Module AI insight
9. Module bottom navigation

### 3.1 Global main shell

Main Home uses:

- Top row: profile image, greeting, notification button
- Main hero card
- Module grid
- Context sections
- Bottom navigation: `Home`, `Modules`, `Noor AI`, `Insights`, `Profile`
- Center Noor AI item uses the robot-head icon and is 52 × 52 px

### 3.2 Module shell

Every module uses the same top structure:

- Back button, 44 × 44 px, far left
- Profile photo, 36 × 36 px
- Module title
- Help button, 44 × 44 px, far right

Every module has its own five-item bottom navigation:

- Four normal destinations
- Center third destination reserved for module AI
- Module AI icon is 52 × 52 px
- AI ring uses the current module primary color
- Navigation surface is white with a top divider
- Only the active item uses module color; inactive items use `#7A8496`

### 3.3 Hero-card component

Every Main Home and module home must begin with a hero card after the top bar.

Hero structure:

1. Eyebrow or contextual label
2. Large title or value
3. One short supporting line
4. Purposeful illustration
5. Optional progress, badge, or primary action

Specifications:

- Minimum height: 180 px
- Radius: 24 px
- Padding: 20 px
- Illustration occupies 35–45% of the card
- Maximum two lines for the title
- Maximum two lines for supporting copy
- Use a controlled gradient from module dark to module primary
- Never combine more than two chromatic colors in one hero
- Text contrast must meet WCAG AA
- Avoid decorative elements behind important text

## 4. Screen-by-screen specification

## 01. Login / Sign In

Purpose: authenticate an existing user.

Structure:

- NoorLife logo or robot-head mark
- Title: `Welcome back!`
- Subtitle: `Sign in to continue`
- Email input
- Password input with show/hide control
- Remember me checkbox
- Forgot password link
- Primary button: `Sign In`
- Divider: `or continue with`
- Google and Apple buttons
- Footer: `Don't have an account? Sign Up`

States: default, focused, submitting, invalid credentials, disabled, offline.

Theme: neutral canvas, white form surface, global primary button. Do not use a large blue background.

## 02. Create Account / Sign Up

- Title: `Create your account`
- Full name
- Email
- Password
- Confirm password
- Password requirements displayed before submission
- Terms and Privacy checkbox
- Primary button: `Create Account`
- Footer link to Sign In

Validation occurs inline and on submit. Do not wait until the user leaves the screen to show password requirements.

## 03. Authentication Options

- Title: `Choose how you'd like to continue`
- Email and Password
- Continue with Google
- Continue with Apple
- Create Account
- Existing-account Sign In link

Use equal-height 52 px authentication buttons.

## 04. Forgot / Reset Password

- Back button
- Robot holding an envelope
- Title: `Reset your password`
- Explanation
- Email input
- Button: `Send Reset Link`
- Confirmation state with partially masked email address
- Resend timer

## 05. Main Home

Theme: Main Home indigo, used primarily in the hero and active navigation.

Hero card:

- Eyebrow: `Today with NoorLife`
- Title: `Your life, organized with NoorLife.`
- Supporting line based on current day
- Illustration: robot beside a calm day timeline with subtle sun/star elements
- Primary action: `View My Day`
- Optional micro-metrics: next prayer, tasks due, family check-in

Below hero:

- Eight-module grid on white neutral cards
- Each module icon uses its owned color, but card backgrounds stay white
- `Today at a glance`
- `Family`
- `Progress`

Navigation: `Home`, `Modules`, `Noor AI`, `Insights`, `Profile`

## 06. Noor AI

Theme: muted violet with cyan detail.

Scope: global assistant limited to NoorLife, navigation, module explanations, and permitted cross-module summaries.

Hero card:

- Full robot mascot waving
- Title: `How can I help with NoorLife?`
- Scope pill: `NoorLife questions only`
- Soft violet gradient
- No abstract orb

Content:

- Find a feature
- Explain my progress
- Help me plan
- App settings
- Recent conversations
- Input composer

Navigation: `Home`, `History`, `Ask AI`, `Saved`, `Settings`

AI safeguards:

- Show scope near composer
- Display which modules are being accessed
- Ask permission before accessing private module data
- Show sources for Faith content
- Never diagnose health conditions
- Never provide regulated financial advice

## 07. Faith

Theme: green-led with restrained gold.

Hero card:

- Eyebrow: `Next Prayer`
- Main value: `Dhuhr 12:35 PM`
- Supporting line: Hijri date and location
- Illustration: elegant green mosque silhouette with subtle gold geometry
- Secondary data: countdown or prayer progress
- Action: `View Prayer Times`

Core destinations:

- Quran
- Hadith
- Duas
- Prayer Times
- Qibla
- Tasbih
- Nearby Mosques
- Islamic Calendar
- Ramadan
- Hajj and Umrah

Home content order:

1. Hero
2. Worship shortcuts
3. Continue reading Quran
4. Daily Ayah
5. Ramadan or seasonal card
6. Bookmarks and recent activity

Navigation: `Today`, `Quran`, `Faith AI`, `Worship`, `More`

Faith AI:

- Uses approved Quran, Tafsir, Hadith, and scholarly sources
- Shows citations
- Distinguishes source text from AI explanation
- Avoids presenting disputed opinions as universal facts

## 08. Health

Theme: light blue with mint support.

Hero card:

- Eyebrow: `Today's Wellness`
- Main value: `Wellness Score 86`
- Supporting line: `You're building a balanced day.`
- Illustration: light-blue heart/pulse or friendly robot with a wellness dashboard
- Progress ring
- Action: `View Insights`

Core content:

- Steps
- Sleep
- Water
- Mood
- Medication reminders
- Appointments
- Weekly trends
- Mindfulness

Home content order:

1. Hero
2. Four quick metrics
3. Medication or appointment reminder
4. Today's focus
5. Weekly trend
6. Quick add

Navigation: `Overview`, `Track`, `Health AI`, `Trends`, `Records`

Health AI:

- Summarizes user-entered wellness data
- Suggests general healthy routines
- Does not diagnose, prescribe, or replace a clinician
- Escalates urgent symptoms to appropriate emergency guidance

## 09. Planner

Theme: periwinkle/indigo, not global bright blue.

Hero card:

- Eyebrow: `Your Day`
- Title: `3 priorities`
- Supporting line: next appointment and free-time window
- Illustration: layered calendar, clock, and checkmarks
- Action: `Optimize My Day`

Content:

- Timeline
- Calendar
- Tasks
- Routines
- Reminders
- Conflicts
- Family schedule

Navigation: `Today`, `Calendar`, `Plan AI`, `Tasks`, `Routines`

Plan AI can reorganize suggestions but must request confirmation before changing events.

## 10. Finance

Theme: warm amber and orange.

Hero card:

- Eyebrow: `May Budget`
- Main value: `$2,450 left`
- Supporting line: percentage spent
- Illustration: warm wallet, coins, or abstract budget chart
- Progress ring
- Action: `View Budget`

Content:

- Expenses
- Transactions
- Bills
- Savings
- Family budget
- Zakat
- Monthly overview

Navigation: `Overview`, `Transactions`, `Money AI`, `Budgets`, `Goals`

Money AI:

- Explains recorded spending
- Categorizes transactions with confirmation
- Creates budget suggestions
- Does not promise returns or provide investment, tax, or legal advice

## 11. Learning

Theme: violet and lilac. Preserve the approved visual style.

Hero card:

- Eyebrow: `Learning Streak`
- Main value: `12 days`
- Supporting line: `Keep it up!`
- Illustration: glowing open book with subtle stars
- Action: `Continue Learning`

Content:

- Continue Learning
- My Courses
- Study Plan
- Reading List
- Quiz
- Learning progress
- Quran-learning course

Navigation: `Learn`, `Library`, `Learn AI`, `Progress`, `Saved`

Learn AI can explain lessons, create quizzes, and build study plans using the current course context.

## 12. Family

Theme: rose and magenta.

Hero card:

- Eyebrow: `Family Connection`
- Main value: `Strong`
- Supporting line: weekly change
- Illustration: warm family portrait or connected avatars
- Action: `Family Check-in`

Content:

- Family Plan
- Check-in
- Parenting
- Activities
- Memories
- Permissions
- Family calendar
- Shared goals

Navigation: `Family`, `Calendar`, `Family AI`, `Memories`, `Safety`

Family AI:

- Provides age-aware family suggestions
- Respects private versus shared information
- Never summarizes a child's private entry to another member without explicit policy and consent
- Provides parenting guidance, not judgment

## 13. Goals

Theme: teal and turquoise.

Hero card:

- Eyebrow: `Overall Progress`
- Main value: `68%`
- Supporting line: `You're on track.`
- Illustration: target with progress path and small celebration detail
- Action: `View Weekly Steps`

Content:

- Active Goals
- Habits
- Weekly Steps
- Shared Goal
- Milestone
- Celebration history

Navigation: `Goals`, `Habits`, `Goal AI`, `Progress`, `Wins`

Goal AI breaks goals into steps, proposes deadlines, and adapts suggestions after user approval.

## 14. Subscription Overview

- Title: `Choose the plan that fits your life`
- Monthly/yearly segmented control
- `Save 20%` badge on yearly
- Free or current plan if applicable
- Premium Single
- Premium Family
- Feature-comparison link
- Restore purchase

Use a neutral background. Reserve gold for premium badges and the selected-plan border.

## 15. Premium Single

- One user
- Complete access to modules
- Personalized insights
- Advanced module AI
- Priority support
- Price and billing period
- Trial terms
- Primary CTA

Do not hide renewal information.

## 16. Premium Family

> **Superseded by Phase 5.** This section originally specified a four-seat plan ("Premium Family
> of 4", four member profiles). The Phase 5 subscription brief defines the plan as **six accounts
> total — one Family Organizer plus up to five additional members** — and forbids the
> superseded four-seat wording anywhere in the product. Phase 5 is the newer and more specific
> commercial instruction, so it governs. The conflict is recorded in
> `docs/PHASE_5_SUBSCRIPTION_AUDIT.md` §2.1; if four seats was in fact the intended model, that
> audit entry is the place to reverse this decision.

- Six accounts in total: one organizer plus up to five additional members
- Private personal profiles for every account
- Shared family features: calendar, events and tasks, goals, check-ins, memories
- Parent/guardian controls
- Individual privacy — Health, Finance, Goals and AI conversations are never shared by default
- Family AI
- Member invitation and management flow
- Price and billing period
- `Best Value` badge

Approved customer-facing wording: "Share NoorLife with up to 5 family members."
Supporting line: "One organizer and five additional members. Everyone gets their own private
account."

## 17. Yearly Plan Comparison

- Single yearly
- Family yearly
- Equivalent monthly amount
- Actual annual total
- Savings against monthly billing
- Included features
- Clear selection state

## 18. Manage Subscription

- Current plan
- Renewal date
- Members used
- Payment method
- Billing history
- Change billing period
- Switch plan
- Cancel subscription
- Restore purchase

Cancellation must be visually secondary but still easy to find.

## 19–28. System and feedback states

System states inherit the current module accent when opened inside a module. Global states use the neutral foundation and global primary.

### 19. Empty

- Robot holding an empty box
- Title: `Nothing here yet`
- Context-specific explanation
- Primary action: `Add New`

### 20. Loading

- Robot using a laptop
- Skeleton representation of expected content
- Message: `Preparing your experience…`
- Avoid blocking spinner-only screens longer than necessary

### 21. Error

- Concerned robot
- Title: `Something went wrong`
- Short recoverable explanation
- Primary action: `Try Again`
- Optional error reference in small text

### 22. No Internet

- Robot with disconnected Wi-Fi
- Title: `You're offline`
- Explain what remains available offline
- Primary action: `Retry`

### 23. Slow Network

- Waiting robot
- Title: `Connection is slow`
- Primary action: `Keep Waiting`
- Secondary action: `Work Offline`, when supported

### 24. No Search Results

- Robot with magnifier
- Title: `No results found`
- Show the query
- Suggest spelling or filters
- Primary action: `Clear Search`

### 25. Permission Required

- Robot with shield
- State which permission is needed and why
- Primary action: `Open Settings`
- Secondary action: `Not Now`

### 26. Session Expired

- Robot with clock
- Title: `Your session has expired`
- Explain that data is safe
- Primary action: `Sign In`

### 27. Form Validation

- Page-level summary
- Inline field errors
- Error icon and text, never color alone
- Move focus to the first invalid field
- Button: `Fix Errors`

### 28. Success

- Happy robot
- Emerald confirmation icon
- Title: `All done!`
- Short result description
- Primary action: `Continue`

## 5. Components to build once

Claude should implement these reusable primitives before feature screens:

1. `AppScaffold`
2. `GlobalTopBar`
3. `ModuleTopBar`
4. `HeroCard`
5. `ModuleBottomNavigation`
6. `RobotAIButton`
7. `SectionHeader`
8. `MetricCard`
9. `ActionTile`
10. `ProgressRing`
11. `ListRow`
12. `PrimaryButton`
13. `SecondaryButton`
14. `TextField`
15. `SegmentedControl`
16. `PlanCard`
17. `StateView`
18. `PermissionSheet`
19. `ConfirmationDialog`
20. `SkeletonCard`

Do not duplicate module screens with hard-coded styling. Pass a `ModuleTheme` object into shared components.

## 6. Module theme contract

Use one configuration object per module:

```ts
type ModuleTheme = {
  id:
    | "main"
    | "noor-ai"
    | "faith"
    | "health"
    | "planner"
    | "finance"
    | "learning"
    | "family"
    | "goals";
  name: string;
  primary: string;
  dark: string;
  soft: string;
  supporting: string;
  aiLabel: string;
  heroIllustration: string;
  navigation: [NavItem, NavItem, NavItem, NavItem, NavItem];
};
```

The third navigation item must always be the module AI item.

## 7. Motion

- Standard transition: 200 ms, ease-out
- Modal/sheet: 240 ms
- Button press: scale to 0.98 for 100 ms
- AI robot should use subtle expression or wave animation only
- Progress animations: 400–600 ms
- Respect reduced-motion system settings
- Never use continuous decorative animation behind text

## 8. Accessibility requirements

- WCAG AA contrast minimum
- 44 × 44 px minimum touch targets
- Dynamic text scaling without clipping
- Screen-reader labels for every icon button
- Do not communicate status with color alone
- Visible keyboard focus for web builds
- Support right-to-left layout for Arabic
- Quran Arabic text must use a dedicated Arabic typeface, not Poppins

Recommended Arabic/Quran font strategy:

- UI Arabic: `Noto Sans Arabic`
- Quran text: use an approved Uthmani Quran font appropriate to the licensed Quran dataset

## 9. Claude implementation lock

Paste the following instruction at the beginning of Claude development prompts:

> Implement NoorLife using `NOORLIFE_UI_DESIGN_SPEC.md` as the design source of truth. Do not introduce new colors, fonts, radii, shadows, navigation patterns, AI mascots, or module layouts without approval. Use Poppins for Latin UI, Noto Sans Arabic for Arabic UI, and an approved Uthmani font for Quran text. Keep the application canvas neutral and apply color only through the active module theme. Every Main Home and module home requires the shared Learning-style `HeroCard`. Faith is green-led; Health is light-blue-led. All compact AI actions use the approved robot-head icon, and all module bottom navigations reserve the center item for module-specific AI. Build reusable token-driven components; do not hard-code duplicate module UI.

## 10. Definition of visual completion

A screen is visually complete only when:

- It uses the locked tokens
- It supports loading, empty, error, offline, and success where relevant
- It handles long text and text scaling
- It supports light theme and RTL
- It uses the correct module theme
- Its hero card follows the shared specification
- Its AI scope is visible and correct
- It has no unexplained blue or off-palette values
- It is built from shared components
