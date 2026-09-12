// swift-tools-version: 5.9
import PackageDescription

// Swift Package Manager manifest for the LIVETAP LiveStream plugin.
//
// NOT the path used today: apps/mobile is a Capacitor 7 / CocoaPods project, so `cap sync ios`
// writes a `pod 'LivetapCapacitorLiveStream'` line into the Podfile and CocoaPods consumes
// LivetapCapacitorLiveStream.podspec instead of this file. This manifest exists so the package is
// already SPM-shaped for the Capacitor 8 migration (Capacitor 8 defaults to SPM and needs
// Node >= 22 on the build host), and because SPM is the only way to reach HaishinKit 2.1+.
//
// UNVERIFIED: never resolved or built — there is no Swift toolchain on the build host.
let package = Package(
    name: "LivetapCapacitorLiveStream",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "LivetapCapacitorLiveStream",
            targets: ["LiveStreamPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "7.0.0"),
        .package(url: "https://github.com/shogo4405/HaishinKit.swift.git", from: "2.0.9")
    ],
    targets: [
        .target(
            name: "LiveStreamPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "HaishinKit", package: "HaishinKit.swift")
            ],
            path: "ios/Sources/LiveStreamPlugin")
    ]
)
