import type { IconName } from '@shared/models/icon';

/**
 * The shared asynchronous-state vocabulary.
 *
 * Source of truth: docs/NOORLIFE_PRODUCTION_WORKFLOW.md §15 and
 * docs/NOORLIFE_UI_DESIGN_SPEC.md §19–§28.
 *
 * §15 is explicit: "Do not build separate custom state components in each
 * module. Use the shared `StateView` with module theme injection." These kinds
 * are the only permitted state identities.
 */
export type AppStateKind =
  | 'loading'
  | 'empty'
  | 'first-use-empty'
  | 'error'
  | 'server-unavailable'
  | 'offline'
  | 'slow-network'
  | 'no-results'
  | 'permission-required'
  | 'permission-denied'
  | 'session-expired'
  | 'validation-error'
  | 'success'
  | 'ai-unavailable'
  | 'ai-safety-boundary';

/**
 * Which mascot pose a state calls for.
 *
 * Every §19–§28 state pairs its message with the robot. Until the artwork lands
 * (see illustrations/ASSETS-REQUIRED.md) the placeholder mascot is used for all
 * of them, but the intent is recorded per state so poses can be dropped in
 * without revisiting each call site.
 */
export type MascotPose =
  | 'laptop'
  | 'box'
  | 'flag'
  | 'concerned'
  | 'wrench'
  | 'offline'
  | 'waiting'
  | 'magnifier'
  | 'shield'
  | 'clock'
  | 'thumbs-up'
  | 'thinking';

/** The tone a state's accent should take. */
export type StateTone = 'neutral' | 'module' | 'success' | 'warning' | 'error' | 'ai';

export type StatePreset = {
  readonly kind: AppStateKind;
  readonly title: string;
  /** One or two sentences. Must stay recoverable and blame-free. */
  readonly message: string;
  readonly mascot: MascotPose;
  readonly tone: StateTone;
  /** Supporting glyph shown alongside the mascot. */
  readonly icon: IconName;
  /** Default primary action label; call sites supply the handler. */
  readonly primaryActionLabel?: string;
  /** Default secondary action label. */
  readonly secondaryActionLabel?: string;
};

/**
 * A discriminated union for feature data.
 *
 * Feature hooks return this so screens must handle loading and failure paths
 * explicitly — a screen cannot read `data` without first narrowing the status.
 */
export type AsyncState<TData> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly kind: AppStateKind; readonly reference?: string }
  | { readonly status: 'ready'; readonly data: TData };
