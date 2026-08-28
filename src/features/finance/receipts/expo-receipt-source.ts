import * as ImagePicker from 'expo-image-picker';

import type {
  ReceiptAcquisition,
  ReceiptSourceKind,
  ReceiptSourcePort,
} from './receipt-source.port';

/**
 * **`expo-image-picker`, behind the acquisition port** — issue #101.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What is asked for, and when ────────────────────────────────────────────
 * `requestCameraPermissionsAsync` runs only inside `acquire('camera')`, and
 * `requestMediaLibraryPermissionsAsync` only inside `acquire('library')`. There is no third path.
 * On Android 13 and above the system photo picker needs no permission at all and the library request
 * resolves granted without a prompt — which is the correct behaviour to keep rather than to
 * special-case, because the app should ask the OS and believe the answer instead of predicting it
 * from a version number.
 *
 * ── No editing, no base64, one image ───────────────────────────────────────
 * `allowsEditing` is off: a crop step is a second thing to explain and a second place for the user
 * to lose the total. `base64` is off and must stay off — the option exists to make an image easy to
 * put in a request body, and this workflow has no request body. Multiple selection is off because
 * one receipt is one transaction.
 *
 * ── Quality, and why it is not 1 ───────────────────────────────────────────
 * 0.8. The file is a working copy that lives for the length of one review unless the user asks to
 * keep it, and a full-quality capture from a modern phone camera is several megabytes of a thing
 * that is usually about to be deleted. Text recognition reads an 0.8 JPEG of a receipt without
 * difficulty; the storage and the copy time are real.
 * ═══════════════════════════════════════════════════════════════════════════
 */

type PickerResult = {
  readonly canceled: boolean;
  readonly assets?: readonly { readonly uri?: unknown }[] | null;
};

const PICKER_OPTIONS = {
  mediaTypes: ['images' as const],
  allowsEditing: false,
  allowsMultipleSelection: false,
  base64: false,
  exif: false,
  quality: 0.8,
};

function firstImage(result: PickerResult): ReceiptAcquisition {
  if (result.canceled) {
    return { kind: 'cancelled' };
  }
  const uri = result.assets?.[0]?.uri;
  /*
    A result that is not cancelled and has no usable asset is a failure, not a cancellation. Reporting
    it as a cancellation would tell the user they backed out of something they did not back out of.
  */
  return typeof uri === 'string' && uri.length > 0 ? { kind: 'acquired', uri } : { kind: 'failed' };
}

export function createExpoReceiptSource(picker = ImagePicker): ReceiptSourcePort {
  return {
    async acquire(kind: ReceiptSourceKind): Promise<ReceiptAcquisition> {
      try {
        const permission =
          kind === 'camera'
            ? await picker.requestCameraPermissionsAsync()
            : await picker.requestMediaLibraryPermissionsAsync();

        if (!permission.granted) {
          /*
            `canAskAgain` is the platform telling us whether a further prompt is possible. Passing it
            through rather than deciding here is what lets the screen offer "Try again" exactly when
            trying again can work, and Settings guidance when it cannot.
          */
          return { kind: 'denied', retryable: permission.canAskAgain !== false };
        }

        const result =
          kind === 'camera'
            ? await picker.launchCameraAsync(PICKER_OPTIONS)
            : await picker.launchImageLibraryAsync(PICKER_OPTIONS);

        return firstImage(result as PickerResult);
      } catch {
        /* Swallowed whole: a picker error can name the file it failed on. */
        return { kind: 'failed' };
      }
    },
  };
}
