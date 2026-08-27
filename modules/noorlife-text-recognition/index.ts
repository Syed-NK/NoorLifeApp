import { requireNativeModule } from 'expo-modules-core';

/**
 * **Latin text recognition, on this device, and nothing else** — issue #101.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why NoorLife owns this instead of using the community package ──────────
 * `@react-native-ml-kit/text-recognition` works, and it was verified working on two Android targets.
 * It is replaced here for one reason that could not be fixed from outside it: it declares **all five**
 * ML Kit script artifacts on Android and **all five** GoogleMLKit pods on iOS, unconditionally, with
 * no configuration surface. NoorLife reads receipts in Latin script only.
 *
 * On Android that cost is small and could *almost* be excluded from outside — the measurement is in
 * the pull request, and it is 2.28 MiB. On iOS it cannot be excluded at all: CocoaPods has no
 * consumer-side way to drop a dependency a podspec declares, so four OCR resource bundles and four
 * recognisers' worth of engine link into the app whatever the caller asks for.
 *
 * A module this app owns declares exactly one recogniser per platform, so there is nothing to
 * exclude and nothing left dangling.
 *
 * ── The second reason, which matters more than the bytes ───────────────────
 * The community module reaches its four extra recognisers through classes its own compiled Java
 * references. Excluding those artifacts leaves that code referring to types that are no longer in
 * the APK — a dangling reference in a library this project does not control, whose failure mode is a
 * runtime error on a device rather than a compile error on a laptop. Owning the module removes the
 * question instead of testing around it.
 *
 * ── Two engines, one contract ──────────────────────────────────────────────
 * Android uses Google's **bundled** Latin ML Kit recogniser: the model ships inside the APK and no
 * download ever happens. iOS uses **Apple Vision**, which is part of the operating system — no
 * third-party SDK, no bundled model, and no Google code on iOS at all.
 *
 * That difference is deliberate and it changes what NoorLife can honestly say about telemetry. The
 * ML Kit disclosure is true on Android and would be false on iOS, so `finance-receipts-screen`
 * names Android explicitly rather than describing a Google component that is not there.
 *
 * ── The narrowest possible native surface ──────────────────────────────────
 * One function, one argument, one field back. No script parameter — Latin is the only script this
 * app reads, and a script argument would be a setting to explain, store and get wrong. No bounding
 * boxes, no confidence, no language guesses: `receipt-ocr.port.ts` would discard them, and a native
 * bridge that never carries them cannot leak them.
 *
 * Both implementations refuse anything that is not a local `file://` path, so the guard that keeps a
 * receipt from being fetched over the network exists in the native layer as well as the TypeScript
 * one. Neither implementation puts the path, the vendor's message or any recognised text into the
 * error it rejects with.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** What the native side returns. Deliberately one field. */
export type NativeRecognitionResult = {
  readonly text: string;
};

type NoorLifeTextRecognitionModule = {
  /**
   * Reads Latin text from a local image.
   *
   * Rejects — never resolves an error shape — when the URI is not local or the image cannot be read.
   * An image with no text in it resolves with an empty `text`, because that is an answer about the
   * photograph rather than a failure of the recogniser.
   */
  recognizeLatin(uri: string): Promise<NativeRecognitionResult>;
};

export default requireNativeModule<NoorLifeTextRecognitionModule>('NoorLifeTextRecognition');
