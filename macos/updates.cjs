const { execFile } = require("node:child_process");
const { createHash } = require("node:crypto");
const { createWriteStream, renameSync } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { promisify } = require("node:util");

const run = promisify(execFile);
const repository = "ApolloVulpez/aurral-app";
const releaseApi = `https://api.github.com/repos/${repository}/releases?per_page=100`;
const bundleName = "Aurral App.app";
const bundleId = "io.github.apollovulpez.aurral-app";

function compareVersions(left, right) {
  const other = right.split(".").map(Number);
  for (const [index, part] of left.split(".").map(Number).entries()) {
    if (part !== other[index]) return part - other[index];
  }
  return 0;
}

function packageNames(version, platform, arch, appImage) {
  const name = `Aurral-App-${version}`;
  if (platform === "darwin") {
    const macArch = { arm64: "arm64", x64: "x64" }[arch];
    return macArch ? [`${name}-macOS-universal.dmg`, `${name}-macOS-${macArch}.dmg`] : [];
  }
  if (platform === "linux" && arch === "x64") {
    return appImage ? [`${name}-linux-x86_64.AppImage`, `${name}-linux-x64.AppImage`]
      : [`${name}-linux-amd64.deb`, `${name}-linux-x64.deb`];
  }
  return [];
}

async function checkForUpdate({ version: current, platform, arch, appImage }) {
  const response = await fetch(releaseApi, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": `Aurral-App/${current}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
  const releases = await response.json();
  const tagPrefix = platform === "darwin" ? "macos-" : "linux-";
  let newest;
  for (const release of releases) {
    const tag = release.tag_name.startsWith(tagPrefix) ? release.tag_name.slice(tagPrefix.length) : release.tag_name;
    const version = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(tag)?.[1];
    if (!version || release.draft || release.prerelease || compareVersions(version, newest?.version ?? current) <= 0) continue;

    for (const name of packageNames(version, platform, arch, appImage)) {
      const url = `https://github.com/${repository}/releases/download/${release.tag_name}/${name}`;
      const asset = release.assets.find(item => item.name === name && item.browser_download_url === url &&
        item.state === "uploaded" && Number.isSafeInteger(item.size) && item.size > 0);
      if (!asset) continue;
      newest = { version, name, url, size: asset.size, digest: asset.digest };
      break;
    }
  }
  return newest;
}

async function downloadUpdate(update, destination) {
  if (!/^sha256:[a-f\d]{64}$/i.test(update.digest)) {
    throw new Error("GitHub did not provide a checksum for this package.");
  }
  const signal = AbortSignal.timeout(15 * 60_000);
  const response = await fetch(update.url, { signal });
  if (!response.ok || !response.body) throw new Error(`GitHub returned HTTP ${response.status}.`);

  const hash = createHash("sha256");
  let size = 0;
  async function* verifyChunks(chunks) {
    for await (const chunk of chunks) {
      size += chunk.length;
      if (size > update.size) throw new Error("The download is larger than expected.");
      hash.update(chunk);
      yield chunk;
    }
  }
  await pipeline(Readable.fromWeb(response.body), verifyChunks,
    createWriteStream(destination, { flags: "wx", mode: 0o600 }), { signal });
  if (size !== update.size || hash.digest("hex") !== update.digest.slice(7).toLowerCase()) {
    throw new Error("The download failed its checksum check.");
  }
}

const removeStage = directory => fs.rm(directory, { recursive: true, force: true }).catch(() => {});
const cannotWrite = error => ["EACCES", "EPERM", "EROFS"].includes(error.code);

async function replaceAppImage(packageFile, executable) {
  // Follow a launcher symlink and replace the file it already points to.
  const target = await fs.realpath(executable);
  const original = await fs.stat(target);
  if (!original.isFile()) throw new Error("Aurral couldn't locate its running AppImage.");
  const stage = await fs.mkdtemp(path.join(path.dirname(target), ".aurral-update-"));
  try {
    const replacement = path.join(stage, "Aurral.AppImage");
    await fs.copyFile(packageFile, replacement);
    await fs.chmod(replacement, (original.mode & 0o777) | 0o100);
    await fs.rename(replacement, target);
  } finally {
    await removeStage(stage);
  }
}

async function replaceMacBundle(dmg, target, version, downloadDirectory) {
  const stage = await fs.mkdtemp(path.join(path.dirname(target), ".aurral-update-"));
  const mount = path.join(downloadDirectory, "mount");
  const replacement = path.join(stage, bundleName);
  const backup = path.join(stage, "previous.app");
  let keepBackup = false;
  try {
    await fs.mkdir(mount);
    await run("/usr/bin/hdiutil", ["attach", dmg, "-mountpoint", mount, "-readonly", "-nobrowse", "-quiet"]);
    try {
      await run("/usr/bin/ditto", [path.join(mount, bundleName), replacement]);
    } finally {
      await run("/usr/bin/hdiutil", ["detach", mount, "-quiet"]);
    }

    const plist = path.join(replacement, "Contents", "Info.plist");
    const readPlist = async key => (await run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plist])).stdout.trim();
    if (await readPlist("CFBundleIdentifier") !== bundleId || await readPlist("CFBundleShortVersionString") !== version) {
      throw new Error("The disk image contains an unexpected app bundle.");
    }
    await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", replacement]);

    renameSync(target, backup);
    try {
      renameSync(replacement, target);
    } catch (error) {
      try {
        renameSync(backup, target);
      } catch {
        keepBackup = true;
        throw new Error(`Aurral couldn't restore the previous app. The backup is at ${backup}.`, { cause: error });
      }
      throw error;
    }
  } finally {
    if (!keepBackup) await removeStage(stage);
  }
}

async function installDeb(packageFile) {
  try {
    await run("/usr/bin/pkexec", ["--disable-internal-agent", "/usr/bin/apt-get", "--yes", "--no-remove", "install", packageFile]);
    return "installed";
  } catch (error) {
    if (error.code === 126) return "canceled";
    if (error.code === 127 || error.code === "ENOENT") return "manual";
    throw new Error("The system package manager could not install the update.", { cause: error });
  }
}

async function installUpdate(update, { platform, executable, appImage, tempDirectory }) {
  const directory = await fs.mkdtemp(path.join(tempDirectory, "aurral-update-"));
  const packageFile = path.join(directory, update.name);
  let keepDownload = false;
  try {
    await downloadUpdate(update, packageFile);
    if (appImage) {
      try {
        await replaceAppImage(packageFile, appImage);
        return { executable: appImage };
      } catch (error) {
        if (!cannotWrite(error)) throw error;
        await fs.chmod(packageFile, 0o700);
      }
    } else if (platform === "darwin") {
      const bundle = path.resolve(executable, "../../..");
      if (bundle.endsWith(".app") && !bundle.includes("/AppTranslocation/")) {
        try {
          await replaceMacBundle(packageFile, bundle, update.version, directory);
          return { executable };
        } catch (error) {
          if (!cannotWrite(error)) throw error;
        }
      }
    } else {
      const result = await installDeb(packageFile);
      if (result === "installed") return { executable };
      if (result === "canceled") return {};
    }
    keepDownload = true;
    return { packageFile };
  } finally {
    if (!keepDownload) await removeStage(directory);
  }
}

module.exports = { checkForUpdate, installUpdate };
