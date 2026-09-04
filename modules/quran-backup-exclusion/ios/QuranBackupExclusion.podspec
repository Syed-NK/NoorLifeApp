Pod::Spec.new do |s|
  s.name           = 'QuranBackupExclusion'
  s.version        = '1.0.0'
  s.summary        = 'Excludes the Qur an generation root from iCloud and iTunes backup.'
  s.description    = 'Sets NSURLIsExcludedFromBackupKey on the app own Documents/quran-sync directory and reads the flag back. Foundation only; nothing is vendored, downloaded or bundled.'
  s.license        = 'MIT'
  s.author         = 'NoorLife'
  s.homepage       = 'https://github.com/Syed-NK/NoorLifeApp'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/Syed-NK/NoorLifeApp.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # NSURLIsExcludedFromBackupKey lives in Foundation, which every target already links. No extra
  # frameworks, no third-party SDK -- the same restraint the Receipts module documents.
  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
