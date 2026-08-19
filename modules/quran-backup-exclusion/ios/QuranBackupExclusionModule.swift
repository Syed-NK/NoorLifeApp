import ExpoModulesCore

/**
 Marks the Qur'an generation root as excluded from iCloud and iTunes backup.

 ── Why this exists ─────────────────────────────────────────────────────────
 Quran Foundation's permission of 2026-08-18 allows retaining the complete Arabic text in *private
 application storage* and forbids export. On iOS the Documents directory is backed up to iCloud by
 default, and a backup is an export: the text would leave the device and sit outside NoorLife's
 control. `expo-file-system` exposes no way to set the flag, and `NSURLIsExcludedFromBackupKey` is a
 runtime resource value rather than an Info.plist entry, so it cannot be set from a config plugin.
 This is the smallest native surface that closes that gap.

 Android needs nothing: its backup rules declare `<include domain="sharedpref">` and nothing else, so
 the file domain is already out of scope. This module is therefore iOS-only by configuration.

 ── What it refuses ─────────────────────────────────────────────────────────
 A path outside the application sandbox, or one that is not the directory this app actually uses.
 Both are checked here rather than trusted from JavaScript: a native call that will happily mark any
 path on the device is a wider capability than the problem needs.
 */
public class QuranBackupExclusionModule: Module {
  /** The only directory this module will act on, relative to the app's Documents directory. */
  private static let allowedRelativePath = "quran-sync"

  public func definition() -> ModuleDefinition {
    Name("QuranBackupExclusion")

    /**
     Applies the exclusion and reports whether it is *confirmed*.

     Reads the flag back rather than trusting the write. A caller that fails closed needs to know the
     value is actually set, and a silently-ignored write would otherwise read as success.
     */
    Function("excludeFromBackup") { (path: String) -> Bool in
      guard let url = Self.resolveAllowed(path) else {
        return false
      }
      var target = url
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      do {
        try target.setResourceValues(values)
        let readBack = try target.resourceValues(forKeys: [.isExcludedFromBackupKey])
        return readBack.isExcludedFromBackup == true
      } catch {
        return false
      }
    }
  }

  /**
   Resolves a caller-supplied path to the one directory this module may touch.

   Accepts a `file://` URL or a plain path, resolves symlinks, and then requires the result to be
   exactly the app's own `Documents/quran-sync`. Anything else — another app's container, a parent
   directory, a traversal — resolves to something that is not equal, and is refused.
   */
  private static func resolveAllowed(_ path: String) -> URL? {
    let candidate: URL
    if path.hasPrefix("file://"), let parsed = URL(string: path) {
      candidate = parsed
    } else {
      candidate = URL(fileURLWithPath: path)
    }

    guard
      let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
    else {
      return nil
    }

    let allowed = documents.appendingPathComponent(allowedRelativePath)
    let resolvedCandidate = candidate.standardizedFileURL.resolvingSymlinksInPath()
    let resolvedAllowed = allowed.standardizedFileURL.resolvingSymlinksInPath()

    guard resolvedCandidate.path == resolvedAllowed.path else {
      return nil
    }
    guard FileManager.default.fileExists(atPath: resolvedAllowed.path) else {
      return nil
    }
    return resolvedAllowed
  }
}
