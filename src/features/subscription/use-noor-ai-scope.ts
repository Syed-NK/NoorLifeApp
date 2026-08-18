import { useCallback } from 'react';

import type { ModuleId } from '@ds/tokens';
import type { AIRequestContext, AIScope } from '@shared/permissions/ai-scope';

import {
  isNoorAILimited,
  noorAIModeFor,
  noorAIRequestContext,
  noorAIScopeFor,
  type NoorAIMode,
} from './domain/noor-ai-scope';
import { useEntitlement } from './services/entitlement-context';
import { noorAIFreeCopy } from './subscription-copy';

/**
 * The one place presentation asks "what may Noor AI be, for this user?".
 *
 * The counterpart to `useModuleLock`, for the assistant that is never locked. Noor AI is on the free
 * plan, so the question is not whether it opens but what it covers — and that answer comes from the
 * authoritative entitlement state, exactly as every lock decision does.
 *
 * Written as a hook over `useEntitlement` rather than a provider on the AI route: a route parameter
 * or a provider prop is something a caller could get wrong or a deep link could set, and the
 * entitlement is neither. Whatever opened Noor AI — the Main Home insight card, the centre
 * navigation control, a notification, a cold start on `/ai` — resolves to the same scope.
 */
export type NoorAIScope = {
  readonly mode: NoorAIMode;
  /** True when Noor AI is restricted to application guidance. */
  readonly isLimited: boolean;
  /** The scope every request carries. On a free plan its `permittedModules` excludes all six paid modules. */
  readonly scope: AIScope;
  /**
   * The scope to announce, e.g. "NoorLife app help only".
   *
   * Null when unlimited, so a caller cannot accidentally announce a restriction that is not there —
   * the same shape `ModuleLock.accessibilityLabel` uses.
   */
  readonly scopeLabel: string | null;
  /** The application-guidance body copy, or null when the personalized insight applies. */
  readonly limitedInsightBody: string | null;
  /**
   * Builds the request context for a real question.
   *
   * `grantedModules` are the user's own §06 permissions; the entitlement narrows them, never the
   * other way round.
   */
  readonly requestContext: (
    currentScreen: string,
    grantedModules: readonly ModuleId[],
  ) => AIRequestContext;
};

export function useNoorAIScope(): NoorAIScope {
  const { entitlement } = useEntitlement();

  const requestContext = useCallback(
    (currentScreen: string, grantedModules: readonly ModuleId[]) =>
      noorAIRequestContext(entitlement, currentScreen, grantedModules),
    [entitlement],
  );

  const isLimited = isNoorAILimited(entitlement);

  return {
    mode: noorAIModeFor(entitlement),
    isLimited,
    scope: noorAIScopeFor(entitlement),
    scopeLabel: isLimited ? noorAIFreeCopy.scopeLabel : null,
    limitedInsightBody: isLimited ? noorAIFreeCopy.insightBody : null,
    requestContext,
  };
}
