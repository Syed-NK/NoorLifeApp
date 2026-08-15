/**
 * Semantic icon names used across NoorLife.
 *
 * This union is the source of truth for *what* an icon means. The mapping from a
 * semantic name to a concrete glyph lives in
 * design-system/components/icon-registry.ts and is compile-time checked to be
 * exhaustive against this union, so a name can never be referenced without a
 * glyph behind it.
 *
 * Screens and features must use these semantic names, never a raw glyph name.
 * That keeps the icon set swappable and stops emoji from leaking into the UI.
 */
export type IconName =
  // ── Global navigation and chrome ─────────────────────────────────────────
  | 'home'
  | 'modules'
  | 'insights'
  | 'profile'
  | 'notification'
  | 'back'
  | 'help'
  | 'close'
  | 'settings'
  | 'search'
  | 'chevron-forward'
  | 'chevron-back'
  | 'chevron-up'
  | 'chevron-down'
  | 'more'
  // ── Actions ──────────────────────────────────────────────────────────────
  | 'add'
  | 'minus'
  | 'add-circle'
  | 'check'
  | 'check-circle'
  | 'retry'
  /*
    Distinct from `retry` on purpose. Both are "go again" in the abstract, but a counter needs to
    offer *step back one* and *start over* side by side, and two refresh arrows next to each other
    say nothing about which is which — the whole point of the pair is that they are told apart at a
    glance by somebody who is not looking carefully.
  */
  | 'undo'
  | 'edit'
  | 'send'
  | 'microphone'
  | 'play'
  | 'pause'
  // Track-step controls, distinct from the chevrons: the reader's player steps whole ayat.
  | 'skip-previous'
  | 'skip-next'
  | 'bookmark'
  | 'star'
  // ── Status and feedback ──────────────────────────────────────────────────
  | 'error'
  | 'warning'
  | 'info'
  | 'offline'
  | 'lock'
  | 'shield'
  | 'sparkle'
  | 'tap'
  | 'octagram'
  // ── Module identities (Main Home grid) ───────────────────────────────────
  | 'module-noor-ai'
  | 'module-faith'
  | 'module-health'
  | 'module-planner'
  | 'module-finance'
  | 'module-learning'
  | 'module-family'
  | 'module-goals'
  // ── Module bottom-navigation destinations ────────────────────────────────
  | 'robot'
  | 'history'
  | 'today'
  | 'calendar'
  | 'quran'
  | 'worship'
  | 'track'
  | 'trends'
  | 'records'
  | 'tasks'
  | 'routines'
  | 'transactions'
  | 'budgets'
  | 'learn'
  | 'library'
  | 'progress'
  | 'memories'
  | 'safety'
  | 'habits'
  | 'wins'
  | 'target'
  // ── Content and timeline ─────────────────────────────────────────────────
  | 'mosque'
  | 'school-bag'
  | 'work'
  | 'meal'
  | 'family'
  | 'clock'
  | 'leaf'
  | 'wellness'
  | 'water'
  | 'sleep'
  | 'steps'
  | 'mood'
  | 'money'
  // ── Faith module surfaces (Phase 4A, from 03-faith.png) ──────────────────
  | 'hadith'
  | 'qibla'
  | 'location'
  | 'calibrate'
  | 'signal'
  | 'turn-left'
  | 'tasbih'
  | 'crescent'
  | 'share'
  /**
   * Offline recitation management, on the reciter catalogue and in the reader's player.
   *
   * Three glyphs rather than one state-dependent glyph: a download that has not started, one that is
   * running, and one that can be removed are three different actions, and drawing them all as an
   * arrow would make the destructive one look like the additive one.
   */
  | 'download'
  | 'downloading'
  | 'delete'
  /**
   * The two verse actions the reader's action sheet added, and neither reuses an existing name.
   *
   * `note` is the user's own writing about an ayah and `document` already means a stored record
   * elsewhere; `playlist` is an ordered listening queue and `library` already means a catalogue.
   * Reusing either would make two different actions draw the same glyph in the same sheet.
   */
  | 'note'
  | 'playlist'
  // ── Health module surfaces (Phase 4A, from 04-health.png) ────────────────
  | 'medication'
  | 'weight'
  | 'walk'
  | 'breathing'
  | 'chart-bar'
  | 'info-outline'
  | 'document'
  | 'image';
