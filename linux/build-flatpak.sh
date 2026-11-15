#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

app_id=io.github.apollovulpez.aurral-app
runtime_version=25.08
version="$(node -p 'require("./package.json").version')"
output="../dist/linux/Aurral-App-${version}-linux-x86_64.flatpak"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

node build.cjs --flatpak
flatpak build-init --arch=x86_64 --base=org.electronjs.Electron2.BaseApp \
  --base-version="$runtime_version" "$work/build" "$app_id" \
  org.freedesktop.Sdk org.freedesktop.Platform "$runtime_version"

mkdir -p "$work/build/files/lib/aurral-app"
cp -a ../obj/flatpak-electron/linux-unpacked/. "$work/build/files/lib/aurral-app/"
install -Dm755 flatpak/run.sh "$work/build/files/bin/aurral-app"
install -Dm644 flatpak/aurral.desktop "$work/build/files/share/applications/$app_id.desktop"
install -Dm644 flatpak/aurral.metainfo.xml "$work/build/files/share/metainfo/$app_id.metainfo.xml"
for icon in icons/*.png; do
  size="$(basename "$icon" .png)"
  install -Dm644 "$icon" "$work/build/files/share/icons/hicolor/$size/apps/$app_id.png"
done

discord_sockets=()
for index in {0..9}; do
  discord_sockets+=("--filesystem=xdg-run/discord-ipc-$index:ro")
done

flatpak build-finish --command=aurral-app \
  --share=network --share=ipc --socket=wayland --socket=fallback-x11 \
  --socket=pulseaudio --device=dri --talk-name=org.kde.StatusNotifierWatcher \
  --talk-name=com.canonical.Unity --filesystem=xdg-run/app/com.discordapp.Discord:ro \
  "${discord_sockets[@]}" "$work/build"
flatpak build-export --arch=x86_64 "$work/repo" "$work/build" stable
mkdir -p "$(dirname "$output")"
flatpak build-bundle --arch=x86_64 --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo \
  "$work/repo" "$work/aurral.flatpak" "$app_id" stable
mv -- "$work/aurral.flatpak" "$output"
echo "Created $output"
