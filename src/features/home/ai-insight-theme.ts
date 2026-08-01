/**
 * The Noor AI insight card's own two colours, locked by implementation-lock §11.
 *
 * ── Why they live here rather than in the card ──────────────────────────────
 * They are not in the design-spec token tables — a lighter violet tint and hairline than the Noor AI
 * `soft` (`#F0EDFF`) — and they belong to this one card rather than to the global palette. They were
 * declared inside `ai-insight-card.tsx` until that file was reopened for Phase 6B; a reopened
 * design-locked file must hard-code no colour of its own, so the approved values move out to keep
 * that guarantee while the card's markup is edited.
 *
 * Same two values, unchanged to the byte. Nothing about the card's appearance moves with them.
 */

/** The card fill. */
export const INSIGHT_BACKGROUND = '#F7F5FF';

/** The 1 dp card border. */
export const INSIGHT_BORDER = '#DCD7FF';
