#!/bin/zsh
set -euo pipefail
cd "${0:A:h}/../.."
TASK_BUILD="$PWD/companion/build"
TASK_APP="$TASK_BUILD/ACEGPT Companion.app"
mkdir -p "$TASK_APP/Contents/MacOS"
swiftc -O -parse-as-library -swift-version 5 -target arm64-apple-macosx14.0 companion/macos/Companion.swift -o "$TASK_APP/Contents/MacOS/ACEGPTCompanion" -framework SwiftUI -framework AppKit -framework ScreenCaptureKit -framework Network -framework ApplicationServices
cp companion/macos/Info.plist "$TASK_APP/Contents/Info.plist"
codesign --force --sign - "$TASK_APP"
"$TASK_APP/Contents/MacOS/ACEGPTCompanion" --self-test
mkdir -p public/downloads
ditto -c -k --sequesterRsrc --keepParent "$TASK_APP" public/downloads/ACEGPT-Companion-Mac.zip
