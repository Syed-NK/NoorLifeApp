import { AI_NAV_INDEX } from '@shared/models/module-theme';
import type { NoorAIPort } from '@services/ai/noor-ai.contract';
import { NOOR_AI_SURFACE_ALLOW_LIST } from '@services/ai/noor-ai.contract';
import { noorAIService } from '@services/ai/noor-ai.service';

import { ModuleScaffold } from '../components/module-scaffold';
import { getModuleDefinition } from '../module-registry';
import { FRAMEWORK_MODULE_IDS, type FrameworkModuleId } from '../module-tokens';
import { noorAIChatCopy } from './noor-ai-chat-copy';
import { NOOR_AI_CHAT_PATH } from './noor-ai-chat-routes';
import { NoorAIChatBody } from './noor-ai-chat-screen';

/**
 * **Noor AI, opened from a module** — issue #64, Stage 1.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this replaces, and why it was wrong ───────────────────────────────
 * `ModuleAIScreen` told six modules that the assistant "is not connected yet", and its docblock said
 * why: no provider SDK, no key, nothing to send a question to. That was true when it was written.
 *
 * It is not true now. `noor-ai.service.ts` exposes `ask`, `supabase/functions/noor-ai` is deployed,
 * and `/ai/chat/:id` has been calling the real service. So the honest-unavailable copy had become a
 * false claim in the other direction — understating the app to a user who would reasonably conclude
 * the assistant does not work at all.
 *
 * ── One surface, not six ───────────────────────────────────────────────────
 * This renders the **same** conversation body as `/ai/chat`, inside the originating module's
 * scaffold. Six copied chat implementations would be six chances to disagree about the double-press
 * guard, the offline state, the entitlement check or the privacy wording — and the one a reviewer
 * read would not be the one a user got. The body is imported, not reimplemented.
 *
 * ── What the module identity is allowed to be ──────────────────────────────
 * A closed identifier, validated against `FRAMEWORK_MODULE_IDS`, used for two things: the frame the
 * user sees, and the `surface` the request reports.
 *
 * `surface` is legitimate and needs no backend change. §C.5's allow-list already contains every
 * module's home path, the client's copy is mirrored from the server's own and drift-tested against
 * it, and a value not on the list is omitted so the server applies its default. So the module a
 * question came from travels as the one field the contract provides for exactly that, and nothing is
 * smuggled into the user's text.
 *
 * ── What it may never be ───────────────────────────────────────────────────
 * A reason to read anything. This file imports no module repository, no storage boundary, no
 * account-scoped hook and no record type — asserted by a source scan, not by intention. No task,
 * transaction, health entry, family member, Qur'an selection, prayer state or profile field is read
 * to build context, and there is no code path from here to one. Only what the user types is sent.
 *
 * Stage 2 — per-module permissions, an exact preview of what would be shared, revocation — is out of
 * scope until a real grant store exists. `/ai/permissions` and `/settings/ai-permissions` are both
 * placeholder screens today, so there is nothing to grant against and nothing to withdraw, and
 * wording that implied otherwise would be the same class of false claim this file removes.
 *
 * ── Failing closed ────────────────────────────────────────────────────────
 * An unrecognised module identifier does not invent a frame, a prompt or a route. It falls back to
 * the generic Noor AI surface, which is a real working conversation with no module framing — the
 * safe direction, because the failure mode of guessing is a screen that claims to be about a module
 * nobody defined.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type ModuleNoorAIScreenProps = {
  /** Where this conversation was opened from. Validated; an unknown value falls back. */
  readonly moduleId: string;
  /** Test seam, forwarded to the shared body. Production passes nothing. */
  readonly port?: NoorAIPort;
  readonly testID?: string;
};

/**
 * Whether this is a module the registry defines.
 *
 * A membership test against the declared set rather than a cast, so a route file with a typo, a
 * stale deep link or a renamed module produces the fallback instead of a `getModuleDefinition`
 * throw inside a screen's render.
 */
export function isFrameworkModuleId(candidate: string): candidate is FrameworkModuleId {
  return (FRAMEWORK_MODULE_IDS as readonly string[]).includes(candidate);
}

/**
 * The surface a module conversation reports, or the generic path when the module has none.
 *
 * Checked against §C.5's allow-list here as well as in the adapter. The adapter's check is the one
 * that protects the wire; this one is so a module whose home path is *not* allow-listed reports the
 * generic path rather than a value that would be silently dropped — the observable behaviour is the
 * same either way, and this makes which of the two happened knowable.
 */
export function moduleSurfacePath(moduleId: FrameworkModuleId): string {
  const home = getModuleDefinition(moduleId).routes.home;
  /*
    A string only. `Href` also admits an object form, and an object cannot be a `surface` — §C.2's
    field is a string and §C.5's allow-list holds strings. Narrowing here rather than stringifying
    keeps the failure mode "report the generic path" instead of "send something shaped like a route".
  */
  if (typeof home !== 'string') {
    return NOOR_AI_CHAT_PATH;
  }
  return NOOR_AI_SURFACE_ALLOW_LIST.includes(home) ? home : NOOR_AI_CHAT_PATH;
}

export function ModuleNoorAIScreen({
  moduleId,
  port = noorAIService,
  testID,
}: ModuleNoorAIScreenProps) {
  if (!isFrameworkModuleId(moduleId)) {
    /*
      Fail closed to the generic surface. No module frame, no module privacy line, and the generic
      chat path as the reported surface — a real conversation that claims nothing about a module.
    */
    return (
      <ModuleScaffold
        moduleId="noor-ai"
        activeKey={getModuleDefinition('noor-ai').navigation[AI_NAV_INDEX].key}
        title={noorAIChatCopy.title}
        testID={testID ?? 'noor-ai-module-fallback'}
      >
        <NoorAIChatBody port={port} surfacePath={NOOR_AI_CHAT_PATH} />
      </ModuleScaffold>
    );
  }

  const definition = getModuleDefinition(moduleId);

  return (
    <ModuleScaffold
      moduleId={moduleId}
      /*
        The module's own AI navigation key, so the bottom bar shows this tab as the active one and
        Back returns to the module rather than to Noor AI's stack. That is what keeps the
        conversation part of the module the user was in.
      */
      activeKey={definition.navigation[AI_NAV_INDEX].key}
      title={definition.ai.label}
      testID={testID ?? `${moduleId}-ai`}
    >
      <NoorAIChatBody
        port={port}
        surfacePath={moduleSurfacePath(moduleId)}
        originLabel={definition.name}
      />
    </ModuleScaffold>
  );
}
