#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

variant=stable
if [[ $# == 1 && $1 == --testing ]]; then
  variant=testing
elif [[ $# != 0 ]]; then
  echo 'Usage: build-flatpak.sh [--testing]' >&2
  exit 2
fi
mapfile -t variant_values < <(node -e 'const v = require("./flatpak/variants.cjs")[process.argv[1]]; console.log([v.id, v.name, v.branch, v.suffix].join("\n"))' "$variant")
app_id="${variant_values[0]}"
app_name="${variant_values[1]}"
branch="${variant_values[2]}"
suffix="${variant_values[3]}"
runtime_version=25.08
version="$(node -p 'require("./package.json").version')"
output="../dist/linux/Aurral-App-${version}-linux-x86_64${suffix}.flatpak"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
repo="$work/repo"
export_options=()
bundle_options=()
if [[ "$variant" == testing ]]; then
  : "${AURRAL_TEST_REPO:?Set the working directory for the signed Flatpak testing repository}"
  : "${AURRAL_TEST_GPG_HOME:?Set the directory containing the Flatpak testing signing key}"
  : "${AURRAL_TEST_GPG_KEY:?Set the Flatpak testing signing key fingerprint}"
  repo="$AURRAL_TEST_REPO"
  gpg --batch --homedir "$AURRAL_TEST_GPG_HOME" --export "$AURRAL_TEST_GPG_KEY" > "$work/testing.gpg"
  test -s "$work/testing.gpg"
  export_options+=(--gpg-sign="$AURRAL_TEST_GPG_KEY" --gpg-homedir="$AURRAL_TEST_GPG_HOME")
  bundle_options+=(--repo-url=https://raw.githubusercontent.com/ApolloVulpez/aurral-app/refs/heads/codex/flatpak-testing-feed
    --gpg-keys="$work/testing.gpg")
fi

node build.cjs --flatpak "$@"
flatpak build-init --arch=x86_64 --base=org.electronjs.Electron2.BaseApp \
  --base-version="$runtime_version" "$work/build" "$app_id" \
  org.freedesktop.Sdk org.freedesktop.Platform "$runtime_version"

mkdir -p "$work/build/files/lib/aurral-app"
cp -a ../obj/flatpak-electron/linux-unpacked/. "$work/build/files/lib/aurral-app/"
install -Dm755 flatpak/run.sh "$work/build/files/bin/aurral-app"
mkdir -p "$work/build/files/share/applications" "$work/build/files/share/metainfo"
sed -e "s/io\.github\.apollovulpez\.aurral-app/$app_id/g" -e "s/^Name=Aurral App$/Name=$app_name/" \
  flatpak/aurral.desktop > "$work/build/files/share/applications/$app_id.desktop"
sed -e "s/io\.github\.apollovulpez\.aurral-app/$app_id/g" -e "s/<name>Aurral App<\/name>/<name>$app_name<\/name>/" \
  flatpak/aurral.metainfo.xml > "$work/build/files/share/metainfo/$app_id.metainfo.xml"
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
  --own-name="org.mpris.MediaPlayer2.$app_id" \
  --talk-name=com.canonical.Unity --filesystem=xdg-run/app/com.discordapp.Discord:ro \
  "${discord_sockets[@]}" "$work/build"
flatpak build-export --arch=x86_64 "${export_options[@]}" "$repo" "$work/build" "$branch"
mkdir -p "$(dirname "$output")"
flatpak build-bundle --arch=x86_64 --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo \
  "${bundle_options[@]}" "$repo" "$work/aurral.flatpak" "$app_id" "$branch"
mv -- "$work/aurral.flatpak" "$output"
echo "Created $output"
