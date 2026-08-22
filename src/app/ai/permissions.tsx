import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/**
 * Noor AI → AI permissions, reached from the privacy card.
 *
 * ── Why the copy is careful here (issue #37) ─────────────────────────
 * This screen used to say “You decide what Noor AI can read — grant a module, or withdraw it, at any
 * time.” No such control exists. `@shared/permissions/ai-scope` is a pure policy function with no
 * persistence, there is no grant store anywhere in the codebase, and Profile’s own
 * `AIPermissionsSection` says so in its docblock: grants default to empty “because nothing persists
 * them”, and it deliberately declines to draw switches over a store that does not exist.
 *
 * A missing feature is a disappointment; a privacy control the user believes they exercised is a
 * different kind of harm. Someone could come away certain they had withdrawn an AI’s access to their
 * Finance or Health module when nothing had been recorded at all.
 *
 * So the headline is future tense, and the body states what is true **today**: the policy classes a
 * module as `permission-required`, which means Noor AI asks before each read. That matches the
 * approved Profile copy — “asks for your permission before it reads a module, every time” — minus its
 * “until you grant it” clause, which describes the persistence that does not exist.
 */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="noor-ai"
      activeKey="ask-ai"
      title="AI Permissions"
      heroTitle="Controls planned"
      heroBody="Not built yet. Today Noor AI asks before each module read."
    />
  );
}
