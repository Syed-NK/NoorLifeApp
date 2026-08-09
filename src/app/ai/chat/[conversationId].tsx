import { NoorAIChatScreen } from '@features/modules/noor-ai/noor-ai-chat-screen';

/**
 * `/ai/chat/:conversationId` — the Noor AI conversation surface required by
 * `NOORLIFE_PRODUCTION_WORKFLOW.md` §6 and by §K's AI-5 row.
 *
 * A real route rather than a modal, which §12.12 left open for this phase to decide. A route is
 * what §6 declares, it is what the rest of this application's screens are, and it gives the surface
 * the module header, back destination and five-slot navigation every other Noor AI screen has.
 *
 * ── The parameter is not read ───────────────────────────────────────────────
 * There is no `useLocalSearchParams` here and none in the feature. The dynamic segment exists
 * because §6's route declares one; it is instantiated with the fixed literal `new`, it identifies
 * nothing, and no conversation is stored under it — see `noor-ai-chat-routes.ts` for its exact
 * lifecycle and `docs/NOOR_AI_BACKEND_CONTRACT.md` §H.5 for why there is nothing to identify.
 *
 * No user content is ever placed in this path.
 *
 * ── Production composition ──────────────────────────────────────────────────
 * The screen is rendered with no `port`, so it resolves `noorAIService` — the real adapter against
 * the real, source-disabled Edge Function. There is no fixture, no fallback and no toggle: a
 * failed real request renders a failure state, never a fabricated answer.
 */
export default function Screen() {
  return <NoorAIChatScreen />;
}
