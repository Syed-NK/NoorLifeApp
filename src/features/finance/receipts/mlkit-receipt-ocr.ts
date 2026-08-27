import TextRecognition, { TextRecognitionScript } from '@react-native-ml-kit/text-recognition';

import {
  isLocalImageUri,
  normaliseRecognisedText,
  type ReceiptOcrOutcome,
  type ReceiptOcrPort,
  type ReceiptOcrRequest,
} from './receipt-ocr.port';

/**
 * **The one file in NoorLife that imports a text recogniser** — issue #101.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What runs on the device, and what the SDK may still do ─────────────────
 * Recognition itself is local. `com.google.mlkit:text-recognition` bundles its Latin model into the
 * APK, so the pixels of a receipt are read by code on the phone with no request of any kind — which
 * is why airplane-mode recognition is required evidence on #101 rather than a nice-to-have.
 *
 * That is **not** the same claim as "this SDK never touches the network". Google's ML Kit may
 * contact Google for SDK diagnostics, performance measurement and compatibility information, and
 * NoorLife does not control that traffic. The honest statement, and the one the disclosure on the
 * review screen makes, is narrower and true: *NoorLife never uploads the receipt image or the
 * recognised text*. Nothing in this file, and nothing behind this port, has a network client.
 *
 * ── Latin only, and why the script is not a setting ────────────────────────
 * `TextRecognitionScript.LATIN`, fixed. A script the user can choose is a setting that has to be
 * explained, stored, migrated and got wrong; and the Latin recogniser already reads the digits,
 * dates and currency codes this workflow looks for, which is the whole of what the parser uses. The
 * other four scripts ship in the vendor's own Gradle dependencies and this app never asks for them.
 *
 * ── Local files only ───────────────────────────────────────────────────────
 * The vendor's `recognize` accepts a URL and will fetch a remote one. That is precisely the
 * behaviour this workflow must not have, so a URI that is not a local `file://` path is refused here
 * before the native call — a guard rather than a convention, because the convention would be one
 * careless caller away from a receipt being downloaded from a server.
 *
 * ── Abort is a result, not a rejection ─────────────────────────────────────
 * The native call cannot be cancelled, so the signal is honoured on this side: an abort that arrives
 * first, or lands while the recogniser is working, resolves `aborted` and the result is dropped. The
 * screen therefore never has to distinguish "still running" from "no longer wanted", which is the
 * state that leaks OCR text onto a screen the user has already left.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type MlKitRecogniser = {
  recognize: (uri: string, script: TextRecognitionScript) => Promise<unknown>;
};

/**
 * The adapter.
 *
 * `recogniser` is injectable for the boundary test and for nothing else — production passes nothing
 * and gets the vendor module. A default parameter rather than a container: there is one
 * implementation, and a registry for one entry is indirection without a reader.
 */
export function createMlKitReceiptOcr(
  recogniser: MlKitRecogniser = TextRecognition,
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
        raw = await recogniser.recognize(uri.trim(), TextRecognitionScript.LATIN);
      } catch {
        /*
          Swallowed deliberately, and swallowed *whole*. A vendor error message can carry the file
          path, and the file path is app-owned but the surrounding log is not — #101 forbids receipt
          content reaching a log, and the safest reading of "content" includes anything the vendor
          chose to put in a message it built from the image.
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
