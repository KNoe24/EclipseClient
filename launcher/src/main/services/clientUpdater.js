const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const http = require("http");
const { URL } = require("url");

const storage = require("./storage");
const profileService = require("./profiles");

const CLIENT_UPDATE_BASE_URL =
  process.env.ECLIPSE_CLIENT_UPDATE_BASE_URL ||
  "https://raw.githubusercontent.com/KNoe24/eclipse-updates/client";

const DEFAULT_MANIFEST_URL =
  process.env.ECLIPSE_CLIENT_MANIFEST_URL || `${CLIENT_UPDATE_BASE_URL}/manifest.json`;

const MAX_REDIRECTS = 8;

const PROTECTED_ROOT_FILES = new Set([
  "account.json",
  "profiles.json",
  "skins.json",
  ".launcher-default-manifest.json",
]);

const PROTECTED_TOP_LEVEL_DIRS = new Set(["profiles", "profile-icons", "skins"]);

function getClientRootDir() {
  return storage.getRootDir();
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function encodePathForUrl(relativePath) {
  return String(relativePath || "")
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function joinUrl(baseUrl, relativePath) {
  const cleanBase = String(baseUrl || "").replace(/\/+$/, "");
  return `${cleanBase}/${encodePathForUrl(relativePath)}`;
}

function resolveDownloadUrl(file) {
  const url = String(file?.url || "").trim();

  if (isHttpUrl(url)) {
    return url;
  }

  if (url) {
    return joinUrl(CLIENT_UPDATE_BASE_URL, url);
  }

  return joinUrl(CLIENT_UPDATE_BASE_URL, file.path);
}

function fetchBuffer(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error(`Too many redirects while downloading ${url}`));
      return;
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(url);
    } catch {
      reject(new Error(`Invalid URL: ${url}`));
      return;
    }

    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      reject(new Error(`Unsupported URL protocol: ${parsedUrl.protocol}`));
      return;
    }

    const client = parsedUrl.protocol === "https:" ? https : http;

    const request = client.get(
      parsedUrl,
      {
        headers: {
          "User-Agent": "eclipse-client-launcher",
          Accept: "application/octet-stream, application/json, */*",
          "Cache-Control": "no-cache",
        },
      },
      (response) => {
        const statusCode = response.statusCode || 0;

        if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
          response.resume();

          const redirectUrl = new URL(response.headers.location, parsedUrl).toString();
          fetchBuffer(redirectUrl, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`Download failed: ${url} returned HTTP ${statusCode}`));
          return;
        }

        const chunks = [];

        response.on("data", (chunk) => {
          chunks.push(chunk);
        });

        response.on("end", () => {
          resolve(Buffer.concat(chunks));
        });
      }
    );

    request.on("error", reject);

    request.setTimeout(45000, () => {
      request.destroy(new Error(`Download timed out: ${url}`));
    });
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
  const normalized = path.normalize(String(relativePath || ""));

  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("..") ||
    path.isAbsolute(normalized)
  ) {
    throw new Error(`Unsafe manifest path: ${relativePath}`);
  }

  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  const topLevel = parts[0] || "";
  const basename = path.basename(normalized);

  if (parts.length === 1 && PROTECTED_ROOT_FILES.has(basename)) {
    throw new Error(`Manifest is not allowed to overwrite protected file: ${relativePath}`);
  }

  if (PROTECTED_TOP_LEVEL_DIRS.has(topLevel)) {
    throw new Error(`Manifest is not allowed to write inside protected folder: ${relativePath}`);
  }

  return normalized;
}

function readLocalManifest() {
  const file = path.join(getClientRootDir(), ".launcher-default-manifest.json");

  if (!fs.existsSync(file)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function getLocalManifestPath() {
  return path.join(getClientRootDir(), ".launcher-default-manifest.json");
}

function deleteManagedFilesFromManifest(manifest, clientRoot) {
  if (!manifest || !Array.isArray(manifest.files)) return [];

  const deleted = [];

  for (const file of manifest.files) {
    if (!file?.path) continue;

    const relativePath = normalizeManifestPath(file.path);
    const targetPath = path.join(clientRoot, relativePath);

    if (!targetPath.startsWith(path.resolve(clientRoot) + path.sep)) {
      continue;
    }

    if (!fs.existsSync(targetPath)) {
      continue;
    }

    fs.rmSync(targetPath, {
      recursive: true,
      force: true,
    });

    deleted.push(relativePath);
  }

  return deleted;
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
      customVersionId: manifest.customVersionId || "eclipse-client",
      minMemory: manifest.memory?.min || "2G",
      maxMemory: manifest.memory?.max || "4G",
      gameDir: getClientRootDir(),
    });
  }

  profile = await profileService.updateProfile(profile.id, {
    name: manifest.name || "Default",
    minecraftVersion: manifest.minecraftVersion || profile.minecraftVersion || "1.21.1",
    versionType: manifest.versionType || profile.versionType || "release",
    loaderType: manifest.loaderType || profile.loaderType || "custom",
    customVersionId: manifest.customVersionId || profile.customVersionId || "eclipse-client",
    minMemory: manifest.memory?.min || profile.minMemory || "2G",
    maxMemory: manifest.memory?.max || profile.maxMemory || "4G",
    gameDir: getClientRootDir(),
  });

  return profile;
}

function hasClientVersionChanged(localManifest, remoteManifest) {
  if (!localManifest) return true;

  return String(localManifest.clientVersion || "") !== String(remoteManifest.clientVersion || "");
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Client manifest is empty or invalid.");
  }

  if (!manifest.clientVersion) {
    throw new Error("Client manifest is missing clientVersion.");
  }

  if (!Array.isArray(manifest.files)) {
    throw new Error("Client manifest is missing files array.");
  }

  for (const file of manifest.files) {
    if (!file?.path) {
      throw new Error("Client manifest contains a file without a path.");
    }

    if (!file?.sha256) {
      throw new Error(`Client manifest file is missing sha256: ${file.path}`);
    }

    normalizeManifestPath(file.path);
  }
}

async function getRemoteManifest() {
  const manifest = await fetchJson(DEFAULT_MANIFEST_URL);
  validateManifest(manifest);
  return manifest;
}

async function getDefaultClientUpdateInfo() {
  const manifest = await getRemoteManifest();
  const profile = await findOrCreateDefaultProfile(manifest);
  const localManifest = readLocalManifest();

  return {
    manifest,
    profile,
    localManifest,
    updateAvailable: hasClientVersionChanged(localManifest, manifest),
    localClientVersion: localManifest?.clientVersion || null,
    remoteClientVersion: manifest.clientVersion || null,
    updateMode: manifest.updateMode || "keep",
    manifestUrl: DEFAULT_MANIFEST_URL,
    baseUrl: CLIENT_UPDATE_BASE_URL,
    clientRoot: getClientRootDir(),
  };
}

async function syncDefaultClient(window, options = {}) {
  const send = (payload) => {
    if (window && !window.isDestroyed()) {
      window.webContents.send("clientUpdater:status", payload);

      if (payload.message) {
        window.webContents.send("game:log", `[client updater] ${payload.message}`);
      }
    }
  };

  send({
    type: "checking",
    message: "Checking default client files...",
    manifestUrl: DEFAULT_MANIFEST_URL,
  });

  const manifest = await getRemoteManifest();
  const profile = await findOrCreateDefaultProfile(manifest);
  const localManifest = readLocalManifest();
  const updateAvailable = hasClientVersionChanged(localManifest, manifest);

  const mode = options.mode || manifest.updateMode || "keep";
  const clientRoot = getClientRootDir();

  storage.ensureDir(clientRoot);
  storage.ensureRuntimeDirs();
  storage.ensureProfileRuntimeDirs(clientRoot);

  if (!updateAvailable && !options.force) {
    send({
      type: "done",
      message: "Default client is already up to date.",
      updatedFiles: [],
      skippedFiles: [],
      clientRoot,
    });

    return {
      ok: true,
      updated: false,
      profile,
      updatedFiles: [],
      skippedFiles: [],
      clientRoot,
    };
  }

  let deletedFiles = [];

  if (mode === "delete") {
    send({
      type: "deleting",
      message: "Deleting old managed client files...",
      clientRoot,
    });

    deletedFiles = deleteManagedFilesFromManifest(localManifest || manifest, clientRoot);
  }

  const localManifestPath = getLocalManifestPath();
  const updatedFiles = [];
  const skippedFiles = [];

  for (const file of manifest.files) {
    const relativePath = normalizeManifestPath(file.path);
    const targetPath = path.join(clientRoot, relativePath);
    const currentHash = sha256File(targetPath);
    const expectedHash = String(file.sha256 || "").toLowerCase();

    if (mode !== "delete" && currentHash && currentHash.toLowerCase() === expectedHash) {
      skippedFiles.push(relativePath);
      continue;
    }

    const downloadUrl = resolveDownloadUrl(file);

    send({
      type: "downloading",
      message: `Downloading ${relativePath}`,
      file: relativePath,
      url: downloadUrl,
      clientRoot,
    });

    const buffer = await fetchBuffer(downloadUrl);
    const downloadedHash = sha256Buffer(buffer);

    if (downloadedHash.toLowerCase() !== expectedHash) {
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
    deletedFiles,
    clientRoot,
  });

  return {
    ok: true,
    updated: true,
    profile,
    updatedFiles,
    skippedFiles,
    deletedFiles,
    clientRoot,
  };
}

module.exports = {
  getDefaultClientUpdateInfo,
  syncDefaultClient,
};
