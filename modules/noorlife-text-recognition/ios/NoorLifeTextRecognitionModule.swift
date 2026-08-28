import ExpoModulesCore
import ImageIO
import Vision

/**
 iOS Latin text recognition, from Apple Vision — issue #101.

 ── Why Vision and not ML Kit ───────────────────────────────────────────────
 Vision is part of iOS. It vendors nothing, bundles no model and downloads nothing, so the iOS side
 of Receipts carries no third-party OCR SDK at all — which is both the packaging fix this replaces
 the community module for, and a smaller privacy surface: there is no Google component on this
 platform to disclose.

 The community module could not be configured down to one script on iOS. Its podspec declares five
 GoogleMLKit pods, and CocoaPods offers a consumer no way to drop a dependency a podspec declares.

 ── What is refused, and what is never said ─────────────────────────────────
 Anything that is not a local `file://` path is refused before an image is opened, matching the
 Android implementation and the TypeScript port. Every rejection carries a fixed message: the path is
 app-owned but the surrounding log is not, and a decode failure's own description can name the file.

 ── Why language correction is off ──────────────────────────────────────────
 A receipt is not prose. `usesLanguageCorrection` exists to make recognised words more likely to be
 real words, and on a receipt the interesting tokens are amounts, dates and codes — the exact strings
 a language model is most likely to "improve" into something the receipt does not say.
 */
public class NoorLifeTextRecognitionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NoorLifeTextRecognition")

    AsyncFunction("recognizeLatin") { (uri: String, promise: Promise) in
      let trimmed = uri.trimmingCharacters(in: .whitespacesAndNewlines)

      guard trimmed.hasPrefix("file:///"), let url = URL(string: trimmed) else {
        promise.reject("ERR_TEXT_RECOGNITION_NOT_LOCAL", "Only local files are read.")
        return
      }

      guard
        let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
      else {
        promise.reject("ERR_TEXT_RECOGNITION", "That image could not be read.")
        return
      }

      let request = VNRecognizeTextRequest { request, error in
        if error != nil {
          promise.reject("ERR_TEXT_RECOGNITION", "That image could not be read.")
          return
        }
        let observations = request.results as? [VNRecognizedTextObservation] ?? []
        /*
          One line per observation, joined the way ML Kit joins its own blocks, so the TypeScript
          port receives the same shape from both platforms and the parser has one input format.
        */
        let text = observations
          .compactMap { $0.topCandidates(1).first?.string }
          .joined(separator: "\n")
        promise.resolve(["text": text])
      }
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = false
      request.recognitionLanguages = ["en-US"]

      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        } catch {
          promise.reject("ERR_TEXT_RECOGNITION", "That image could not be read.")
        }
      }
    }
  }
}
