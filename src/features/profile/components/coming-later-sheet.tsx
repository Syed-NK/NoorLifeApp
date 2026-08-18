import { SecondaryButton } from '@features/entry-auth/components/secondary-button';

import { profileCopy } from '../profile-copy';
import { useComingLater, useComingLaterActions } from '../services/coming-later-context';
import { ProfileDialog } from './profile-dialog';

/**
 * The single rendering of "this is not built yet".
 *
 * ── One host, mounted once beside the screen ────────────────────────────────
 * `ComingLaterProvider` holds the request; this renders it. Keeping the two apart is what lets
 * Profile Home mount the controller once, above every row that can ask for it, and draw the note
 * exactly once — rather than three menu rows each carrying a modal they will almost never show.
 *
 * ── Why it names the feature ────────────────────────────────────────────────
 * "Preferences is coming later" is information; "Coming soon" is not. The same reasoning the
 * module coming-soon screen already applies, and the reason the request carries the row's own
 * label rather than a generic subject.
 *
 * Nothing renders while there is no request, so the mounted-dialog count equals the open-request
 * count — which is zero or one by construction.
 */
export function ComingLaterSheet({
  testID = 'profile-coming-later',
}: {
  readonly testID?: string;
}) {
  const { request, isVisible } = useComingLater();
  const { dismiss } = useComingLaterActions();

  if (request === null) {
    return null;
  }

  return (
    <ProfileDialog
      visible={isVisible}
      title={profileCopy.comingLater.title(request.feature)}
      body={profileCopy.comingLater.body(request.feature)}
      onRequestClose={dismiss}
      testID={testID}
    >
      <SecondaryButton
        label={profileCopy.comingLater.dismiss}
        onPress={dismiss}
        testID={`${testID}-dismiss`}
      />
    </ProfileDialog>
  );
}
