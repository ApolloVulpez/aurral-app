#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

app_id=io.github.apollovulpez.aurral-desktop
runtime_version=25.08
version="$(node -p 'require("./package.json").version')"
output="../dist/linux/Aurral-Desktop-${version}-linux-x86_64.flatpak"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
: "${AURRAL_FLATPAK_REPO:?Set the working directory for the signed Flatpak repository}"
: "${AURRAL_FLATPAK_GPG_HOME:?Set the directory containing the Flatpak signing key}"
: "${AURRAL_FLATPAK_GPG_KEY:?Set the Flatpak signing key fingerprint}"
gpg --batch --homedir "$AURRAL_FLATPAK_GPG_HOME" --export "$AURRAL_FLATPAK_GPG_KEY" > "$work/release.gpg"
test -s "$work/release.gpg"

node build.cjs --flatpak
flatpak build-init --arch=x86_64 --base=org.electronjs.Electron2.BaseApp \
  --base-version="$runtime_version" "$work/build" "$app_id" \
  org.freedesktop.Sdk org.freedesktop.Platform "$runtime_version"

mkdir -p "$work/build/files/lib/aurral-desktop"
cp -a ../obj/flatpak-electron/linux-unpacked/. "$work/build/files/lib/aurral-desktop/"
install -Dm755 flatpak/run.sh "$work/build/files/bin/aurral-desktop"
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

flatpak build-finish --command=aurral-desktop \
  --share=network --share=ipc --socket=wayland --socket=fallback-x11 \
  --socket=pulseaudio --device=dri --talk-name=org.kde.StatusNotifierWatcher \
  --own-name="org.mpris.MediaPlayer2.$app_id" \
  --talk-name=com.canonical.Unity --filesystem=xdg-run/app/com.discordapp.Discord:ro \
  "${discord_sockets[@]}" "$work/build"
flatpak build-export --arch=x86_64 --gpg-sign="$AURRAL_FLATPAK_GPG_KEY" --gpg-homedir="$AURRAL_FLATPAK_GPG_HOME" \
  "$AURRAL_FLATPAK_REPO" "$work/build" stable
mkdir -p "$(dirname "$output")"
flatpak build-bundle --arch=x86_64 --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo \
  --repo-url=https://raw.githubusercontent.com/ApolloVulpez/aurral-desktop/refs/heads/flatpak-stable-feed \
  --gpg-keys="$work/release.gpg" "$AURRAL_FLATPAK_REPO" "$work/aurral.flatpak" "$app_id" stable
mv -- "$work/aurral.flatpak" "$output"
echo "Created $output"
