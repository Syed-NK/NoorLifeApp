package com.noorlife.textrecognition

import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android Latin text recognition, from the bundled ML Kit model — issue #101.
 *
 * ── One recogniser, chosen at build time ────────────────────────────────────
 * `TextRecognizerOptions.DEFAULT_OPTIONS` is the Latin recogniser, and it is the only one this
 * module's `build.gradle` declares. There is no script parameter: a script the caller can choose is
 * a setting that has to be explained, stored and migrated, and it would drag the other four models
 * back into the APK to make the choice meaningful.
 *
 * ── What is refused, and what is never said ────────────────────────────────
 * Anything that is not a local `file://` path is refused before an image is opened. ML Kit's own
 * `InputImage` will read a content URI and the community module it replaces would fetch an `http`
 * URL outright; a workflow that promises a receipt never leaves the device must not have a path that
 * pulls one onto it either.
 *
 * Every rejection carries a fixed message. The URI is app-owned, but the surrounding log is not, and
 * an ML Kit failure message is built from the image it failed on — so neither the path nor the
 * vendor's text is passed back. Nothing here logs.
 */
class NoorLifeTextRecognitionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NoorLifeTextRecognition")

    AsyncFunction("recognizeLatin") { uri: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject(CodedException("ERR_TEXT_RECOGNITION", "No application context.", null))
        return@AsyncFunction
      }

      if (!uri.trim().startsWith("file:///")) {
        promise.reject(
          CodedException("ERR_TEXT_RECOGNITION_NOT_LOCAL", "Only local files are read.", null),
        )
        return@AsyncFunction
      }

      try {
        val image = InputImage.fromFilePath(context, Uri.parse(uri.trim()))
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
          .process(image)
          .addOnSuccessListener { result -> promise.resolve(mapOf("text" to result.text)) }
          .addOnFailureListener {
            promise.reject(
              CodedException("ERR_TEXT_RECOGNITION", "That image could not be read.", null),
            )
          }
      } catch (_: Throwable) {
        promise.reject(
          CodedException("ERR_TEXT_RECOGNITION", "That image could not be read.", null),
        )
      }
    }
  }
}
