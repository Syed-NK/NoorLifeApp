import { toPermission } from '../data/notifications/expo-notifications.port';

/**
 * "Never asked" and "refused" are different things, and only one of them is the device's fault.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect this file was written against, found on a device ─────────────
 * The mapper required `status === UNDETERMINED` before it would report `undetermined`. **Android has
 * no UNDETERMINED runtime-permission status.** Before an app has ever asked, Android 13+ answers
 * `getPermissionsAsync()` with `status: DENIED` and `canAskAgain: true` — so every never-asked Android
 * user was classified `denied`.
 *
 * What that put on screen, observed on both targets with a freshly installed build that had never
 * asked for anything: *"Your device is not allowing NoorLife to send notifications, so nothing will
 * arrive"*, with an "Open system settings" button. Both halves were false. Nothing was blocking
 * anything, and the action that actually raises the prompt — switching a prayer on — was the one thing
 * the screen did not mention. A first run accused the device of refusing something it had never been
 * asked.
 *
 * No type could have caught it and no unit test did, because the mapper was correct for the shape iOS
 * returns and wrong for the shape Android returns.
 *
 * ── The rule now ───────────────────────────────────────────────────────────
 * `canAskAgain` alone. A prompt is either still available or it is not, which is the only thing the
 * caller does anything different about — and it is the one field both platforms answer honestly.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The shape `expo-notifications` returns, with only the fields the mapper reads. */
function response(fields: {
  readonly granted: boolean;
  readonly canAskAgain: boolean;
  readonly status: string;
}) {
  return {
    granted: fields.granted,
    canAskAgain: fields.canAskAgain,
    status: fields.status,
    expires: 'never',
  } as unknown as Parameters<typeof toPermission>[0];
}

describe('a permission that has never been asked for is not a refusal', () => {
  it('reads Android’s never-asked answer as undetermined', () => {
    /*
      The exact shape Android 13+ returns before the first request: DENIED, but still askable. This is
      the case that was wrong, and it is the common one — every new install starts here.
    */
    expect(response({ granted: false, canAskAgain: true, status: 'denied' })).toBeDefined();
    expect(toPermission(response({ granted: false, canAskAgain: true, status: 'denied' }))).toBe(
      'undetermined',
    );
  });

  it('reads iOS’s never-asked answer as undetermined too', () => {
    expect(
      toPermission(response({ granted: false, canAskAgain: true, status: 'undetermined' })),
    ).toBe('undetermined');
  });

  it('reads a real refusal as denied, on either platform', () => {
    /*
      `canAskAgain: false` is the platform saying a prompt will not appear. Reporting that as
      undetermined would put a control on screen that raises no dialog — the defect the location Grant
      control once had, and the reason this mapper exists at all.
    */
    expect(toPermission(response({ granted: false, canAskAgain: false, status: 'denied' }))).toBe(
      'denied',
    );
    expect(
      toPermission(response({ granted: false, canAskAgain: false, status: 'undetermined' })),
    ).toBe('denied');
  });

  it('reads a grant as granted, whatever else the response says', () => {
    // `granted` is checked first, so a platform reporting an odd status alongside it cannot confuse it.
    expect(toPermission(response({ granted: true, canAskAgain: false, status: 'granted' }))).toBe(
      'granted',
    );
    expect(toPermission(response({ granted: true, canAskAgain: true, status: 'denied' }))).toBe(
      'granted',
    );
  });

  it('never reports denied while a prompt is still available', () => {
    /*
      The property, rather than the four points above. Whatever the status string says, "a prompt is
      available" and "the device has refused" must not both be true — that combination is what told a
      first-time user their device was blocking them.
    */
    for (const status of ['denied', 'undetermined', 'granted', 'something-new']) {
      const mapped = toPermission(response({ granted: false, canAskAgain: true, status }));
      expect(mapped).not.toBe('denied');
    }
  });
});
