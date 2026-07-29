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
  | 'more'
  // ── Actions ──────────────────────────────────────────────────────────────
  | 'add'
  | 'add-circle'
  | 'check'
  | 'check-circle'
  | 'retry'
  | 'send'
  | 'microphone'
  | 'play'
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
  | 'document'
  | 'image';
