const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");

const storage = require("./storage");
const javaService = require("./java");

const RUNTIME_INDEX_URL =
  "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";
const VERSION_MANIFEST_URL = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
const INSTALL_MARKER = ".eclipse-java.json";
const DOWNLOAD_CONCURRENCY = 8;

const COMPONENT_BY_MAJOR = {
  8: "jre-legacy",
  16: "java-runtime-alpha",
  17: "java-runtime-gamma",
  21: "java-runtime-delta",
  25: "java-runtime-epsilon",
};

const installsInProgress = new Map();
let installedJavaCache = null;

function platformKey() {
  const arch = process.arch;

  if (process.platform === "win32") {
    if (arch === "arm64") return "windows-arm64";
    if (arch === "ia32") return "windows-x86";
    return "windows-x64";
  }

  if (process.platform === "darwin") {
    return arch === "arm64" ? "mac-os-arm64" : "mac-os";
  }

  return arch === "ia32" ? "linux-i386" : "linux";
}

function getJavaRuntimeRoot() {
  return storage.ensureDir(path.join(storage.getRootDir(), "java-runtime"));
}

async function requestJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });

  if (!response.ok) {
    throw new Error(`Download failed (HTTP ${response.status}) for ${url}`);
  }

  return response.json();
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map((part) => Number(part) || 0);
  const pb = String(b).split(/[.-]/).map((part) => Number(part) || 0);

  for (let index = 0; index < Math.max(pa.length, pb.length); index += 1) {
    const diff = (pa[index] || 0) - (pb[index] || 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

function fallbackJavaForVersion(minecraftVersion) {
  const version = String(minecraftVersion || "");

  if (!/^\d+\.\d+/.test(version)) return { component: COMPONENT_BY_MAJOR[21], majorVersion: 21 };
  if (/^\d{2}\./.test(version)) return { component: COMPONENT_BY_MAJOR[25], majorVersion: 25 };
  if (compareVersions(version, "1.20.5") >= 0) return { component: COMPONENT_BY_MAJOR[21], majorVersion: 21 };
  if (compareVersions(version, "1.18") >= 0) return { component: COMPONENT_BY_MAJOR[17], majorVersion: 17 };
  if (compareVersions(version, "1.17") >= 0) return { component: COMPONENT_BY_MAJOR[16], majorVersion: 16 };

  return { component: COMPONENT_BY_MAJOR[8], majorVersion: 8 };
}

function normalizeJavaVersion(javaVersion) {
  const major = Number(javaVersion?.majorVersion) || 0;
  if (!major) return null;

  return {
    component: String(javaVersion.component || COMPONENT_BY_MAJOR[major] || ""),
    majorVersion: major,
  };
}

function findLocalJavaVersion(versionId) {
  const versionsDir = storage.getRuntimeVersionsDir();
  const seen = new Set();
  let currentId = versionId;

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);

    const json = readJsonFile(path.join(versionsDir, currentId, `${currentId}.json`));
    if (!json) return null;

    const found = normalizeJavaVersion(json.javaVersion);
    if (found) return found;

    currentId = json.inheritsFrom || "";
  }

  return null;
}

async function getRequiredJava(profile, customVersionId = "") {
  const local =
    (customVersionId && findLocalJavaVersion(customVersionId)) ||
    findLocalJavaVersion(profile.minecraftVersion);

  if (local) return local;

  try {
    const manifest = await requestJson(VERSION_MANIFEST_URL);
    const entry = (manifest.versions || []).find((version) => version.id === profile.minecraftVersion);

    if (entry?.url) {
      const versionJson = await requestJson(entry.url);
      const remote = normalizeJavaVersion(versionJson.javaVersion);
      if (remote) return remote;
    }
  } catch {
    return fallbackJavaForVersion(profile.minecraftVersion);
  }

  return fallbackJavaForVersion(profile.minecraftVersion);
}

async function findInstalledJava(majorVersion) {
  if (!installedJavaCache) {
    try {
      installedJavaCache = await javaService.listInstalledJava();
    } catch {
      installedJavaCache = [];
    }
  }

  return installedJavaCache.find((java) => java.major === majorVersion && fs.existsSync(java.path)) || null;
}

function javaExecutableIn(installDir, files) {
  const names =
    process.platform === "win32" ? ["bin/javaw.exe", "bin/java.exe"] : ["bin/java"];

  for (const name of names) {
    const match = Object.keys(files || {}).find(
      (file) => file === name || file.endsWith(`/${name}`)
    );

    if (match) return path.join(installDir, ...match.split("/"));
  }

  return "";
}

function installedRuntime(component) {
  const installDir = path.join(getJavaRuntimeRoot(), component);
  const marker = readJsonFile(path.join(installDir, INSTALL_MARKER));

  if (marker?.javaPath && fs.existsSync(marker.javaPath)) {
    return { installDir, javaPath: marker.javaPath, marker };
  }

  return null;
}

function sha1Transform(hash) {
  return new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
}

async function downloadFile(url, destination, expectedSha1) {
  const tempFile = `${destination}.part`;
  const response = await fetch(url);

  if (!response.ok || !response.body) {
    throw new Error(`Download failed (HTTP ${response.status}).`);
  }

  const hash = crypto.createHash("sha1");

  await pipeline(Readable.fromWeb(response.body), sha1Transform(hash), fs.createWriteStream(tempFile));

  const actual = hash.digest("hex");

  if (expectedSha1 && actual !== expectedSha1) {
    fs.rmSync(tempFile, { force: true });
    throw new Error(`Checksum mismatch for ${path.basename(destination)}.`);
  }

  fs.renameSync(tempFile, destination);
}

async function runLimited(items, limit, worker) {
  let next = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await worker(item);
    }
  });

  await Promise.all(runners);
}

async function downloadRuntime(component, log, onProgress) {
  const platform = platformKey();
  const index = await requestJson(RUNTIME_INDEX_URL);
  const release = index?.[platform]?.[component]?.[0];

  if (!release?.manifest?.url) {
    throw new Error(
      `Mojang has no ${component} Java runtime for ${platform}. Install Java manually and set it in the installation's Java Path.`
    );
  }

  const installed = installedRuntime(component);

  if (installed && installed.marker.manifestSha1 === release.manifest.sha1) {
    return installed.javaPath;
  }

  const manifest = await requestJson(release.manifest.url);
  const files = manifest.files || {};
  const installDir = path.join(getJavaRuntimeRoot(), component);
  const tempDir = `${installDir}.download`;

  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });

  const entries = Object.entries(files);
  const downloads = entries.filter(([, info]) => info.type === "file" && info.downloads?.raw?.url);
  const totalBytes = downloads.reduce((sum, [, info]) => sum + (info.downloads.raw.size || 0), 0);
  let doneBytes = 0;
  let lastReported = -1;

  log(
    `[java] Downloading Java ${release.version?.name || component} (${Math.round(totalBytes / 1048576)} MB) from Mojang...`
  );
  onProgress({ percent: 0, doneBytes: 0, totalBytes, version: release.version?.name || component });

  for (const [file, info] of entries) {
    if (info.type === "directory") {
      fs.mkdirSync(path.join(tempDir, ...file.split("/")), { recursive: true });
    }
  }

  await runLimited(downloads, DOWNLOAD_CONCURRENCY, async ([file, info]) => {
    const destination = path.join(tempDir, ...file.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });

    let attempt = 0;

    while (true) {
      try {
        await downloadFile(info.downloads.raw.url, destination, info.downloads.raw.sha1);
        break;
      } catch (error) {
        attempt += 1;
        if (attempt >= 3) throw new Error(`Java download failed: ${error.message}`);
      }
    }

    if (info.executable && process.platform !== "win32") {
      fs.chmodSync(destination, 0o755);
    }

    doneBytes += info.downloads.raw.size || 0;
    const percent = totalBytes ? Math.floor((doneBytes / totalBytes) * 100) : 100;

    onProgress({ percent, doneBytes, totalBytes, version: release.version?.name || component });

    if (Math.floor(percent / 10) !== lastReported) {
      lastReported = Math.floor(percent / 10);
      log(`[java] Java download ${lastReported * 10}%`);
    }
  });

  if (process.platform !== "win32") {
    for (const [file, info] of entries) {
      if (info.type !== "link" || !info.target) continue;

      const linkPath = path.join(tempDir, ...file.split("/"));
      fs.mkdirSync(path.dirname(linkPath), { recursive: true });
      fs.rmSync(linkPath, { force: true });
      fs.symlinkSync(info.target, linkPath);
    }
  }

  const tempJava = javaExecutableIn(tempDir, files);

  if (!tempJava || !fs.existsSync(tempJava)) {
    throw new Error("The downloaded Java runtime has no java executable.");
  }

  fs.rmSync(installDir, { recursive: true, force: true });
  fs.renameSync(tempDir, installDir);

  const javaPath = javaExecutableIn(installDir, files);

  fs.writeFileSync(
    path.join(installDir, INSTALL_MARKER),
    JSON.stringify(
      {
        component,
        platform,
        version: release.version?.name || "",
        manifestSha1: release.manifest.sha1,
        javaPath,
        installedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  log(`[java] Java ${release.version?.name || component} installed.`);

  return javaPath;
}

async function installRuntime(component, log = () => {}, onProgress = () => {}) {
  if (!installsInProgress.has(component)) {
    const job = downloadRuntime(component, log, onProgress).finally(() =>
      installsInProgress.delete(component)
    );
    installsInProgress.set(component, job);
  }

  return installsInProgress.get(component);
}

async function checkJava(profile, customVersionId = "") {
  if (profile.javaPath) {
    if (!fs.existsSync(profile.javaPath)) {
      return {
        ok: false,
        reason: "custom-missing",
        message: `The Java Path set for ${profile.name} does not exist: ${profile.javaPath}. Clear it in the installation's settings to let the launcher pick Java automatically.`,
      };
    }

    return { ok: true, javaPath: profile.javaPath, source: "profile" };
  }

  const required = await getRequiredJava(profile, customVersionId);
  const bundled = installedRuntime(required.component);

  if (bundled) {
    return { ok: true, javaPath: bundled.javaPath, source: "launcher", required };
  }

  const installed = await findInstalledJava(required.majorVersion);

  if (installed) {
    return { ok: true, javaPath: installed.path, source: "system", label: installed.label, required };
  }

  return {
    ok: false,
    reason: "missing",
    required,
    canInstall: true,
    message: `Java ${required.majorVersion} was not found on this PC. Minecraft ${profile.minecraftVersion} needs it.`,
  };
}

async function resolveJavaForLaunch(profile, customVersionId, log = () => {}) {
  const result = await checkJava(profile, customVersionId);

  if (!result.ok) {
    const error = new Error(result.message);
    error.code = result.reason === "missing" ? "JAVA_MISSING" : "JAVA_PATH_MISSING";
    error.required = result.required;
    throw error;
  }

  if (result.source === "profile") log(`[java] Using the installation's Java Path: ${result.javaPath}`);
  if (result.source === "launcher") log(`[java] Using launcher Java ${result.required.majorVersion} (${result.required.component}).`);
  if (result.source === "system") log(`[java] Using installed ${result.label}`);

  return result.javaPath;
}

module.exports = {
  checkJava,
  installRuntime,
  resolveJavaForLaunch,
  getRequiredJava,
  platformKey,
  fallbackJavaForVersion,
};
