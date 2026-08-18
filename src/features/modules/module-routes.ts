import type { Href } from 'expo-router';

import type { FrameworkModuleId } from './module-tokens';

/**
 * The themed "not built yet" destination.
 *
 * ── Why a route rather than a disabled control ──────────────────────────────
 * Both approved references show controls whose screens do not exist yet — Tasbih, Qibla,
 * Quick Log, the metric cards. Leaving them inert would mean a screen full of taps that do
 * nothing, which reads as broken rather than unfinished. Disabling half of Faith would
 * misrepresent the approved design. So every control leads somewhere, and where the feature
 * does not exist this screen says so by name, in the module's colour, with a way back.
 *
 * The feature label travels as a parameter so the placeholder can say *which* thing the
 * user asked for: "Tasbih is on the way" is information, "Coming soon" is not.
 */
export function comingSoon(moduleId: FrameworkModuleId, feature: string): Href {
  return { pathname: '/module-coming-soon', params: { moduleId, feature } };
}
