Pod::Spec.new do |s|
  s.name           = 'NoorLifeTextRecognition'
  s.version        = '1.0.0'
  s.summary        = 'On-device Latin text recognition for Finance Receipts.'
  s.description    = 'Reads Latin text from a local image using Apple Vision. No third-party SDK.'
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

  # Vision and ImageIO are part of iOS. Nothing is vendored, downloaded or bundled — which is the
  # whole reason this platform has no ML Kit in it at all (issue #101).
  s.frameworks = 'Vision', 'ImageIO', 'CoreGraphics'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
