Pod::Spec.new do |s|
  s.name = 'HaskappNative'
  s.version = '1.0.0'
  s.summary = 'Native SwiftUI student planner for Haskapp'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Haskapp'
  s.homepage = 'https://github.com/O-kagami/haskapp'
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.swift_version = '5.0'
  s.source_files = '**/*.{h,m,mm,swift}'
end
