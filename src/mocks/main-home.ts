import type { MainHomeDashboard } from '@shared/models/dashboard';

/**
 * Typed local mock data for the Main Home proof screen.
 *
 * Every value matches the reference design at
 * design-reference/full-core-screens/01-main-noor-ai-faith.png, so the rendered
 * screen can be compared against the reference directly.
 *
 * Phase 1 uses local mock data only: no backend is connected, and each field is
 * annotated with the module that will own it once real services exist
 * (workflow §5).
 */
export const mockMainHomeDashboard: MainHomeDashboard = {
  hero: {
    eyebrow: 'Today with NoorLife',
    title: 'Your life, organized with NoorLife.',
    actionLabel: 'View My Day',
  },

  /**
   * Source: Planner. **Nothing is in this array any more, and nothing may be put back.**
   *
   * ── What was here, and why it had to go ─────────────────────────────────────
   * Four rows once lived here as fixtures. The first, `{ time: '12:35 PM', title: 'Dhuhr Prayer' }`,
   * outlived the prayer fixture it came from and left Main Home stating 12:35 PM while Faith
   * calculated 1:14 PM for the same place; it became live first, supplied by
   * `usePrayerTimelineEntry`.
   *
   * The remaining three — School drop-off 8:00, Work focus time 10:00, Family dinner 17:30 — were
   * kept on the argument that they were "placeholder events for modules that own no data". That
   * argument does not survive contact with the product: they were presented as the user's own day,
   * in the same rows and the same type as a real commitment, while Planner held zero tasks and
   * promised, two taps away, that *"NoorLife will not invent a schedule for you."* Nobody created
   * them, and nobody could complete or delete them. They are gone.
   *
   * The lock protects a *composition* — rows in order, with these accents — not these particular
   * events. Every measurement still comes from `LOCKED.today`, and the Planner rows are now supplied
   * by `usePlannerTimelineEntries` from the signed-in user's real tasks, with an honest sentence when
   * there are none. Family owned no task store, so its row is not claimed at all rather than
   * invented.
   *
   * ── Why this stays an empty array rather than being deleted ─────────────────
   * `MainHomeDashboard.timeline` is still the shape the screen consumes, and the composition in
   * `useMainHomeDashboard` appends the live rows to it. Keeping the field means the mock still
   * satisfies the model, and a source scan can assert this array holds nothing — a stronger
   * guarantee than the field's absence, because absence is easy to undo by accident.
   */
  timeline: [],

  // Source: Family module.
  familyCheckIn: {
    completed: 4,
    total: 5,
    statusLabel: 'complete',
  },

  // Source: Goals module.
  overallProgress: {
    percentage: 68,
    statusLabel: "You're on track",
  },

  // Source: Noor AI. Scope is always shown alongside the message (§06).
  aiInsight: {
    id: 'free-window',
    message: 'You have a free 30-minute window at 4 PM.',
    scopeLabel: 'NoorLife only',
    accessedModules: ['planner'],
  },

  // Each action navigates to the owning module; Main Home never edits records.
  quickActions: [
    { key: 'add-task', label: 'Add Task', icon: 'add-circle', sourceModule: 'planner' },
    { key: 'log-wellness', label: 'Log Wellness', icon: 'leaf', sourceModule: 'health' },
    { key: 'family-check-in', label: 'Family Check-in', icon: 'family', sourceModule: 'family' },
  ],
};
