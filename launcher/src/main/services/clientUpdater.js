const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const http = require("http");

const storage = require("./storage");
const profileService = require("./profiles");

const DEFAULT_MANIFEST_URL = "https://launcher.wawe.cc/launcher/default/manifest.json";

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;

    client
      .get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          fetchBuffer(response.headers.location).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Download failed: ${url} returned ${response.statusCode}`));
          return;
        }

        const chunks = [];

        response.on("data", (chunk) => {
          chunks.push(chunk);
        });

        response.on("end", () => {
          resolve(Buffer.concat(chunks));
        });
      })
      .on("error", reject);
  });
}

async function fetchJson(url) {
  const buffer = await fetchBuffer(url);
  return JSON.parse(buffer.toString("utf8"));
}

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;

  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);

  hash.update(data);
  return hash.digest("hex");
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeManifestPath(relativePath) {
  const normalized = path.normalize(relativePath);

  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`Unsafe manifest path: ${relativePath}`);
  }

  return normalized;
}

function removeDirContents(dir) {
  if (!fs.existsSync(dir)) return;

  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);

    fs.rmSync(fullPath, {
      recursive: true,
      force: true,
    });
  }
}

function readLocalManifest(gameDir) {
  const file = path.join(gameDir, ".launcher-default-manifest.json");

  if (!fs.existsSync(file)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

async function findOrCreateDefaultProfile(manifest) {
  const profilesData = await profileService.listProfiles();

  let profile = profilesData.profiles.find((item) => {
    return item.id === "default" || item.name.toLowerCase() === "default";
  });

  if (!profile) {
    profile = await profileService.createProfile({
      name: manifest.name || "Default",
      minecraftVersion: manifest.minecraftVersion || "1.21.1",
      versionType: manifest.versionType || "release",
      loaderType: manifest.loaderType || "custom",
      customVersionId: manifest.customVersionId || "default-client",
      minMemory: manifest.memory?.min || "2G",
      maxMemory: manifest.memory?.max || "4G",
      gameDir: path.join(storage.getRootDir(), ".launcher"),
    });
  }

  profile = await profileService.updateProfile(profile.id, {
    name: manifest.name || "Default",
    minecraftVersion: manifest.minecraftVersion || profile.minecraftVersion || "1.21.1",
    versionType: manifest.versionType || profile.versionType || "release",
    loaderType: manifest.loaderType || profile.loaderType || "custom",
    customVersionId: manifest.customVersionId || profile.customVersionId || "default-client",
    minMemory: manifest.memory?.min || profile.minMemory || "2G",
    maxMemory: manifest.memory?.max || profile.maxMemory || "4G",
  });

  return profile;
}

function hasClientVersionChanged(localManifest, remoteManifest) {
  if (!localManifest) return true;

  return String(localManifest.clientVersion || "") !== String(remoteManifest.clientVersion || "");
}

async function getDefaultClientUpdateInfo() {
  const manifest = await fetchJson(DEFAULT_MANIFEST_URL);
  const profile = await findOrCreateDefaultProfile(manifest);
  const localManifest = readLocalManifest(profile.gameDir);

  return {
    manifest,
    profile,
    localManifest,
    updateAvailable: hasClientVersionChanged(localManifest, manifest),
    localClientVersion: localManifest?.clientVersion || null,
    remoteClientVersion: manifest.clientVersion || null,
    updateMode: manifest.updateMode || "keep",
  };
}

async function syncDefaultClient(window, options = {}) {
  const send = (payload) => {
    if (window && !window.isDestroyed()) {
      window.webContents.send("clientUpdater:status", payload);
    }
  };

  send({
    type: "checking",
    message: "Checking default client files...",
  });

  const manifest = await fetchJson(DEFAULT_MANIFEST_URL);
  const profile = await findOrCreateDefaultProfile(manifest);
  const localManifest = readLocalManifest(profile.gameDir);
  const updateAvailable = hasClientVersionChanged(localManifest, manifest);

  const mode = options.mode || manifest.updateMode || "keep";

  if (!updateAvailable && !options.force) {
    send({
      type: "done",
      message: "Default client is already up to date.",
      updatedFiles: [],
      skippedFiles: [],
    });

    return {
      ok: true,
      updated: false,
      profile,
      updatedFiles: [],
      skippedFiles: [],
    };
  }

  if (mode === "delete") {
    send({
      type: "deleting",
      message: "Deleting old Default installation...",
    });

    removeDirContents(profile.gameDir);
  }

  const gameDir = profile.gameDir;
  storage.ensureDir(gameDir);

  const localManifestPath = path.join(gameDir, ".launcher-default-manifest.json");
  const updatedFiles = [];
  const skippedFiles = [];

  for (const file of manifest.files || []) {
    const relativePath = normalizeManifestPath(file.path);
    const targetPath = path.join(gameDir, relativePath);
    const currentHash = sha256File(targetPath);

    if (
      mode !== "delete" &&
      currentHash &&
      currentHash.toLowerCase() === file.sha256.toLowerCase()
    ) {
      skippedFiles.push(relativePath);
      continue;
    }

    send({
      type: "downloading",
      message: `Downloading ${relativePath}`,
      file: relativePath,
    });

    const buffer = await fetchBuffer(file.url);
    const downloadedHash = sha256Buffer(buffer);

    if (downloadedHash.toLowerCase() !== file.sha256.toLowerCase()) {
      throw new Error(`Hash mismatch for ${relativePath}`);
    }

    ensureParentDir(targetPath);
    fs.writeFileSync(targetPath, buffer);

    updatedFiles.push(relativePath);
  }

  fs.writeFileSync(localManifestPath, JSON.stringify(manifest, null, 2), "utf8");

  send({
    type: "done",
    message: `Default client updated. Updated ${updatedFiles.length} file(s).`,
    updatedFiles,
    skippedFiles,
  });

  return {
    ok: true,
    updated: true,
    profile,
    updatedFiles,
    skippedFiles,
  };
}

module.exports = {
  getDefaultClientUpdateInfo,
  syncDefaultClient,
};
