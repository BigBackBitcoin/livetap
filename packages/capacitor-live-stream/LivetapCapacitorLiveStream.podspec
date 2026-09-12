require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# ------------------------------------------------------------------------------------------------
# Pod name: LivetapCapacitorLiveStream — NOT LivetapLiveStream.
#
# The name is not free. `npx cap sync ios` writes the Podfile line itself, using the npm package id
# run through @capacitor/cli's `fixName()`
# (node_modules/@capacitor/cli/dist/plugin.js): '@' dropped, '/' and '-' turned into '_', each
# '_x' upper-cased, first letter upper-cased. So
#
#   @livetap/capacitor-live-stream  ->  LivetapCapacitorLiveStream
#
# and the generated Podfile contains
#   pod 'LivetapCapacitorLiveStream', :path => '../../../../packages/capacitor-live-stream'
#
# CocoaPods requires the podspec found at that path to declare exactly that `s.name`, so the
# podspec filename and `s.name` are both dictated by the npm package name. (Same rule produces
# CapacitorHaptics.podspec for @capacitor/haptics — verified against node_modules/@capacitor/haptics.)
# ------------------------------------------------------------------------------------------------
Pod::Spec.new do |s|
  s.name = 'LivetapCapacitorLiveStream'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = 'https://github.com/livetap/livetap'
  s.author = 'LIVETAP'
  s.source = { :git => 'https://github.com/livetap/livetap.git', :tag => package['name'] + '@' + package['version'] }
  s.source_files = 'ios/Sources/**/*.{swift,h,m,c,cc,mm,cpp}'
  # iOS 15.0 is the LIVETAP floor (HaishinKit 2.x's own floor is 13.0, but the AVAudioSession /
  # AVCaptureSession behaviour the encoder relies on is only stable from 15). Must stay in step with
  # `platform :ios, '15.0'` in apps/mobile/ios/App/Podfile and IPHONEOS_DEPLOYMENT_TARGET in
  # App.xcodeproj.
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  # HaishinKit.swift — BSD-3-Clause. 2.0.9 is the newest version published to CocoaPods trunk;
  # 2.1+/2.2+ are Swift Package Manager only. See apps/mobile/ios/App/Podfile for the full note and
  # docs/legal/THIRD_PARTY_LICENSES.md for the attribution obligation.
  s.dependency 'HaishinKit', '~> 2.0.9'
  s.swift_version = '5.9'
end
