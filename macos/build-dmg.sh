#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

version="$(node -p 'require("./package.json").version')"
out="$(cd .. && pwd)/dist/macos"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/AppIcon.iconset" "$stage/image" "$out"

for size in 16 32 128 256 512; do
  sips -z "$size" "$size" assets/icon.png --out "$stage/AppIcon.iconset/icon_${size}x${size}.png" >/dev/null
  sips -z "$((size * 2))" "$((size * 2))" assets/icon.png --out "$stage/AppIcon.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$stage/AppIcon.iconset" -o "$stage/AppIcon.icns"

./node_modules/.bin/electron-packager . "Aurral Desktop" \
  --platform=darwin --arch=universal --out="$out" --overwrite --asar \
  --app-bundle-id=io.github.apollovulpez.aurral-desktop \
  --icon="$stage/AppIcon.icns" --extend-info=Info.plist \
  --ignore='^/(build-dmg\.sh|package-lock\.json|Info\.plist)$'

bundle="$out/Aurral Desktop-darwin-universal/Aurral Desktop.app"
cp ../LICENSE "$bundle/Contents/Resources/Aurral-LICENSE.txt"
codesign --force --deep --sign - "$bundle"
codesign --verify --deep --strict "$bundle"
lipo "$bundle/Contents/MacOS/Aurral Desktop" -verify_arch x86_64 arm64

ditto "$bundle" "$stage/image/Aurral Desktop.app"
ln -s /Applications "$stage/image/Applications"
dmg="$out/Aurral-Desktop-${version}-macOS-universal.dmg"
hdiutil create -ov -volname "Aurral Desktop" -srcfolder "$stage/image" -format UDZO -fs HFS+ "$dmg"
hdiutil verify "$dmg"
(cd "$out" && shasum -a 256 "$(basename "$dmg")" > "$(basename "$dmg").sha256")
