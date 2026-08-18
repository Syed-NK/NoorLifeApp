import type { IconName } from '@shared/models/icon';

/**
 * Semantic icon name → concrete glyph mapping.
 *
 * ── Single family ───────────────────────────────────────────────────────────
 * Every glyph comes from **MaterialCommunityIcons**. The Main Home implementation
 * lock (§8) mandates that library for module glyphs and forbids mixing Lucide,
 * Ionicons, emoji and Material icons; §13 names MCI glyphs for the bottom
 * navigation too. Rather than keep two families and rely on review to stop them
 * mixing, the registry is MCI-only — which also drops one glyph font from the
 * runtime payload.
 *
 * Poppins remains the only Latin *text* typeface (design spec §2.4); this glyph
 * font is an icon resource and carries no text.
 *
 * `satisfies Record<IconName, GlyphRef>` makes the mapping exhaustive: adding a
 * name to IconName without a glyph here is a compile error. Every glyph name below
 * was verified against the installed glyphmap.
 *
 * Only design-system/components/app-icon.tsx may consume this module — enforced by
 * the `no-restricted-imports` rule in eslint.config.js.
 */
export type IconFamily = 'material-community';

export type GlyphRef = {
  readonly family: IconFamily;
  readonly glyph: string;
};

const mci = (glyph: string): GlyphRef => ({ family: 'material-community', glyph });

export const iconRegistry = {
  // ── Global navigation and chrome (lock §13 for the five nav glyphs) ────────
  home: mci('home-variant'),
  modules: mci('view-grid-outline'),
  insights: mci('chart-line'),
  profile: mci('account-outline'),
  notification: mci('bell'),
  back: mci('arrow-left'),
  help: mci('help-circle-outline'),
  close: mci('close'),
  settings: mci('cog-outline'),
  search: mci('magnify'),
  'chevron-forward': mci('chevron-right'),
  'chevron-back': mci('chevron-left'),
  more: mci('dots-horizontal'),

  // ── Actions ───────────────────────────────────────────────────────────────
  add: mci('plus'),
  'add-circle': mci('plus-circle'),
  check: mci('check'),
  'check-circle': mci('check-circle'),
  retry: mci('refresh'),
  send: mci('send'),
  microphone: mci('microphone'),
  play: mci('play'),
  pause: mci('pause'),
  bookmark: mci('bookmark'),
  star: mci('star'),

  // ── Status and feedback ───────────────────────────────────────────────────
  error: mci('alert-circle'),
  warning: mci('alert'),
  info: mci('information'),
  offline: mci('wifi-off'),
  lock: mci('lock'),
  shield: mci('shield-check'),
  sparkle: mci('star-four-points'),

  // ── Module identities: locked by implementation-lock §8 ───────────────────
  'module-noor-ai': mci('robot'),
  'module-faith': mci('mosque'),
  'module-health': mci('heart-pulse'),
  'module-planner': mci('calendar-month'),
  'module-finance': mci('currency-usd'),
  'module-learning': mci('school'),
  'module-family': mci('account-group'),
  'module-goals': mci('target'),

  // ── Module bottom-navigation destinations ─────────────────────────────────
  robot: mci('robot'),
  history: mci('history'),
  today: mci('calendar-today'),
  calendar: mci('calendar-check'),
  quran: mci('book-open-page-variant'),
  worship: mci('hands-pray'),
  track: mci('shoe-print'),
  trends: mci('chart-line'),
  records: mci('file-document-outline'),
  tasks: mci('clipboard-check-outline'),
  routines: mci('repeat-variant'),
  transactions: mci('swap-horizontal'),
  budgets: mci('chart-donut'),
  learn: mci('book-open-variant'),
  library: mci('library'),
  progress: mci('chart-timeline-variant'),
  memories: mci('image-multiple-outline'),
  safety: mci('shield-account'),
  habits: mci('view-grid-outline'),
  wins: mci('trophy'),
  target: mci('bullseye-arrow'),

  // ── Content and timeline ──────────────────────────────────────────────────
  mosque: mci('mosque'),
  'school-bag': mci('bag-personal'),
  work: mci('briefcase'),
  meal: mci('silverware-fork-knife'),
  family: mci('account-group'),
  clock: mci('clock-outline'),
  leaf: mci('leaf'),
  wellness: mci('heart-pulse'),
  water: mci('water'),
  sleep: mci('weather-night'),
  steps: mci('shoe-print'),
  mood: mci('emoticon-happy-outline'),
  money: mci('wallet'),
  document: mci('file-document-outline'),
  image: mci('image-multiple-outline'),

  // ── Faith module surfaces (Phase 4A) ──────────────────────────────────────
  // 'Duas' reuses `worship` (hands-pray) and 'Prayer'/'Mosques' reuse `mosque`,
  // matching the reference, which also draws those two from the same subject.
  hadith: mci('script-text-outline'),
  qibla: mci('compass-outline'),
  tasbih: mci('circle-multiple-outline'),
  crescent: mci('moon-waning-crescent'),
  share: mci('share-variant-outline'),

  // ── Health module surfaces (Phase 4A) ─────────────────────────────────────
  medication: mci('pill'),
  weight: mci('scale-bathroom'),
  walk: mci('walk'),
  breathing: mci('spa-outline'),
  'chart-bar': mci('chart-bar'),
  'info-outline': mci('information-outline'),
} as const satisfies Record<IconName, GlyphRef>;
