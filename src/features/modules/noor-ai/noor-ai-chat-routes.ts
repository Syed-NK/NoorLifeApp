import type { Href } from 'expo-router';

/**
 * The two Noor AI routes `NOORLIFE_PRODUCTION_WORKFLOW.md` §6 requires and this phase adds.
 *
 * ── `/ai/chat/:conversationId`, and the segment that is not an identifier ───
 * §6 declares the route with a parameter, and §K's AI-5 row requires it to exist. §H.5 is equally
 * clear that **no conversation is stored** — "on the device, in the database, or at the provider" —
 * and that conversation persistence is AI-8's, gated on a reviewed schema, an RLS policy, a
 * retention period and an export and deletion path. None of those exist.
 *
 * So there is a route that names a conversation and no conversation to name. The resolution here is
 * to satisfy the route's shape without inventing the thing it implies:
 *
 *   • The segment is the **fixed literal `new`**, not a generated id. A random or sequential id
 *     would look durable, would appear in a link somebody could share, and would be the first half
 *     of a persistence model nobody has approved. A constant cannot be mistaken for a handle to
 *     stored data, because it identifies nothing.
 *   • **Lifecycle, exactly:** the segment is written once, here, at build time. It is not minted,
 *     not stored, not read by the screen, not sent in any request body, not logged, and not varied
 *     between sessions. Navigating to the route twice produces the same URL and two independent,
 *     empty screens — there is no state that survives the second navigation, because the only state
 *     is React component state that unmounts with the screen.
 *   • **No user content ever enters a route parameter.** The question lives in component state and
 *     goes to exactly one place: the `ask` call. The screen reads no route parameter at all, which
 *     is why `useLocalSearchParams` appears nowhere in this feature.
 *
 * This is a **placeholder for an unbuilt persistence model, not a conversation id**, and it must
 * not be described as one. When AI-8 supplies real conversations, this constant is the single place
 * that changes.
 *
 * ── No new deep-link exposure ───────────────────────────────────────────────
 * The route is reachable by file-based routing, as every route in this app is. Nothing here
 * registers a scheme, an intent filter or a universal link, and `app.json`'s linking configuration
 * is untouched by this phase.
 */

/** The literal path segment `/ai/chat/:conversationId` is instantiated with. Not an identifier. */
export const NOOR_AI_EPHEMERAL_CHAT_SEGMENT = 'new';

/**
 * The conversation surface's path, as a plain string.
 *
 * Exported separately from the `Href` below because two callers need it as text rather than as a
 * navigation target: `AIRequestContext.currentScreen`, which is a `string` by declaration, and the
 * tests that assert the route carries no user content. It is a `string` and not a literal type on
 * purpose — nothing should be able to switch on it.
 */
export const NOOR_AI_CHAT_PATH: string = `/ai/chat/${NOOR_AI_EPHEMERAL_CHAT_SEGMENT}`;

/**
 * The Noor AI conversation surface.
 *
 * A single constant `Href` rather than a factory taking an id, so there is no parameter for a
 * caller to fill with something meaningful — which is the point.
 */
export const NOOR_AI_CHAT_ROUTE = NOOR_AI_CHAT_PATH as Href;

/** §6's "Report or rate response" route. Inert — see `noor-ai-feedback-screen.tsx`. */
export const NOOR_AI_FEEDBACK_ROUTE: Href = '/ai/feedback';

/** Noor AI's own home, which is where the composer that opens the chat lives. */
export const NOOR_AI_HOME_ROUTE: Href = '/ai';
