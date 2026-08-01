import { useUpgradeSheet, useUpgradeSheetActions } from '../services/upgrade-sheet-context';
import { LockedModuleSheet } from './locked-module-sheet';

export type UpgradeSheetHostProps = {
  readonly testID?: string;
};

/**
 * The single rendering of the contextual upgrade explanation.
 *
 * ── One host, mounted beside a screen — never inside a row ───────────────────
 * `UpgradeSheetProvider` holds the request; this renders it. Keeping the two apart is what lets a
 * screen mount the controller once, above every surface that can ask for it, and draw the sheet
 * exactly once — rather than every timeline row and summary card carrying a modal it will almost
 * never show.
 *
 * ── Why nothing renders while there is no request ───────────────────────────
 * `LockedModuleSheet` needs a module to describe, and there is no honest placeholder for "no
 * module". Returning null keeps the mounted-sheet count equal to the open-request count, which is
 * zero or one by construction: the controller holds a single slot, so a second `requestUpgrade`
 * replaces the contents of the sheet already on screen instead of stacking another one.
 *
 * `LockedModuleSheet` remains the only presentation. This adds no chrome of its own.
 */
export function UpgradeSheetHost({ testID }: UpgradeSheetHostProps) {
  const { request, isVisible } = useUpgradeSheet();
  const { dismiss, viewPlans } = useUpgradeSheetActions();

  if (request === null) {
    return null;
  }

  return (
    <LockedModuleSheet
      visible={isVisible}
      moduleId={request.moduleId}
      moduleName={request.moduleName}
      // "Not now" and the scrim both dismiss without navigating; only "View plans" routes.
      onViewPlans={viewPlans}
      onNotNow={dismiss}
      {...(testID === undefined ? {} : { testID })}
    />
  );
}
