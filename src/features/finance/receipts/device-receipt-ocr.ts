import NoorLifeTextRecognition from '../../../../modules/noorlife-text-recognition';

import {
  isLocalImageUri,
  normaliseRecognisedText,
  type ReceiptOcrOutcome,
  type ReceiptOcrPort,
  type ReceiptOcrRequest,
} from './receipt-ocr.port';

/**
 * **The one file in NoorLife that reaches a text recogniser** — issue #101.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What replaced what, and why ────────────────────────────────────────────
 * This adapter used to call `@react-native-ml-kit/text-recognition`. That package works — it was
 * verified reading receipts on two Android targets — and it is gone for a packaging reason it gave
 * no way to fix from outside: it declares **all five** ML Kit script artifacts on Android and **all
 * five** GoogleMLKit pods on iOS, unconditionally.
 *
 * NoorLife reads Latin only. On Android the four extra scripts could *almost* be excluded from
 * outside, and the measurement is in the pull request: 2.28 MiB, and empirically runtime-safe. On
 * iOS they could not be excluded at all — CocoaPods gives a consumer no way to drop a dependency a
 * podspec declares — so four OCR resource bundles and four recognisers linked into the app no matter
 * what the caller asked for.
 *
 * `modules/noorlife-text-recognition` declares one recogniser per platform instead. Nothing to
 * exclude, and nothing left referring to classes that are no longer there.
 *
 * ── What runs on each platform, and what that means for telemetry ──────────
 * **Android** uses Google's *bundled* Latin ML Kit recogniser: the model is inside the APK and no
 * download ever happens, which is why airplane-mode recognition is required evidence on #101. That
 * is not a claim the SDK never touches the network — Google's ML Kit may contact Google about
 * itself, for diagnostics, performance measurement and compatibility, and NoorLife does not control
 * that traffic.
 *
 * **iOS** uses Apple Vision, which is part of the operating system. There is no Google SDK on iOS at
 * all, so the ML Kit disclosure would be false there. The screen's copy names Android explicitly for
 * that reason.
 *
 * On both platforms the same thing is true and is the thing worth saying: NoorLife never uploads the
 * receipt image or the recognised text. There is no network client behind this port, and a source
 * scan asserts there is none.
 *
 * ── Local files only, checked twice ────────────────────────────────────────
 * Refused here *and* in both native implementations. The package this replaced would fetch an
 * `http` URL outright; a workflow that promises the image never leaves the device must not have a
 * path that pulls one onto it either, and a guard that exists on one side of a bridge is a guard one
 * refactor away from being the only one.
 *
 * ── Abort is a result, not a rejection ─────────────────────────────────────
 * Neither native recogniser can be cancelled, so the signal is honoured on this side: an abort that
 * arrives first, or lands while the recogniser is working, resolves `aborted` and the result is
 * dropped. The screen therefore never has to distinguish "still running" from "no longer wanted",
 * which is the state that leaks OCR text onto a screen the user has already left.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type DeviceRecogniser = {
  recognizeLatin: (uri: string) => Promise<unknown>;
};

/**
 * The adapter.
 *
 * `recogniser` is injectable for the boundary test and for nothing else — production passes nothing
 * and gets the native module. A default parameter rather than a container: there is one
 * implementation, and a registry for one entry is indirection without a reader.
 */
export function createDeviceReceiptOcr(
  recogniser: DeviceRecogniser = NoorLifeTextRecognition,
): ReceiptOcrPort {
  return {
    async recognise({ uri, signal }: ReceiptOcrRequest): Promise<ReceiptOcrOutcome> {
      /*
        Read through a function on every check, never captured into a local. `aborted` flips while
        this is awaiting, and a compiler that narrowed it once at the top would be describing a
        signal that no longer exists — which is exactly the state this guard is here to catch.
      */
      const aborted = (): boolean => signal?.aborted === true;

      if (aborted()) {
        return { kind: 'failed', reason: 'aborted' };
      }
      if (!isLocalImageUri(uri)) {
        /*
          Not `unreadable`. The recogniser was never asked, because the thing it was asked about was
          not a local file — reporting a recognition failure would describe an attempt that never
          happened.
        */
        return { kind: 'failed', reason: 'unavailable' };
      }

      let raw: unknown;
      try {
        raw = await recogniser.recognizeLatin(uri.trim());
      } catch {
        /*
          Swallowed deliberately, and swallowed *whole*. Both native implementations reject with a
          fixed message for this reason, but a native bridge can also fail in ways neither of them
          wrote — and #101 forbids receipt content reaching a log, so nothing from the failure is
          carried out of here.
        */
        return { kind: 'failed', reason: aborted() ? 'aborted' : 'unreadable' };
      }

      if (aborted()) {
        return { kind: 'failed', reason: 'aborted' };
      }

      const lines = normaliseRecognisedText(raw);
      if (lines === null) {
        return { kind: 'failed', reason: 'unreadable' };
      }
      return lines.length === 0 ? { kind: 'empty' } : { kind: 'recognised', lines };
    },
  };
}
