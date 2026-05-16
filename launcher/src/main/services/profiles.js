const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const { URL } = require("url");
const storage = require("./storage");

const PROFILES_FILE = "profiles.json";
const MINECRAFT_VERSION_MANIFEST_URL =
  "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
const MINECRAFT_VERSION_MANIFEST_CACHE_MS = 5 * 60 * 1000;

let minecraftVersionManifestCache = null;
let minecraftVersionManifestCacheAt = 0;

const DEFAULT_INSTALLATION_ICON_IDS = ["grass", "dirt", "stone", "diamond", "crafting", "furnace"];

function id() {
  return crypto.randomBytes(12).toString("hex");
}

function safeFolderName(name) {
  return (
    String(name || "Installation")
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "Installation"
  );
}

function getProfilesRootDir() {
  return storage.getProfilesRootDir();
}

function normalizePathForCompare(value) {
  return path.resolve(String(value || ""));
}

function isInsideDir(parentDir, childDir) {
  const parent = normalizePathForCompare(parentDir);
  const child = normalizePathForCompare(childDir);
  const relative = path.relative(parent, child);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isManagedProfileGameDir(gameDir) {
  if (!gameDir) return false;
  return isInsideDir(getProfilesRootDir(), gameDir);
}

function ensureProfileFolders(gameDir) {
  storage.ensureProfileRuntimeDirs(gameDir);
}

function uniqueProfileGameDir(name, existingProfiles = [], ignoreProfileId = null) {
  const root = getProfilesRootDir();
  const base = safeFolderName(name);

  const used = new Set(
    existingProfiles
      .filter((profile) => profile.id !== ignoreProfileId)
      .map((profile) => profile.gameDir)
      .filter(Boolean)
      .map((dir) => path.resolve(dir))
  );

  let index = 1;
  let finalDir = path.join(root, base);

  while (used.has(path.resolve(finalDir)) || fs.existsSync(finalDir)) {
    index += 1;
    finalDir = path.join(root, `${base}_${index}`);
  }

  ensureProfileFolders(finalDir);
  return finalDir;
}

function uniqueManagedProfileGameDirForRename(
  name,
  profileId,
  existingProfiles = [],
  currentDir = ""
) {
  const root = getProfilesRootDir();
  const base = safeFolderName(name);
  const currentResolved = normalizePathForCompare(currentDir);

  const used = new Set(
    existingProfiles
      .filter((profile) => profile.id !== profileId)
      .map((profile) => profile.gameDir)
      .filter(Boolean)
      .map((dir) => path.resolve(dir))
  );

  let index = 1;
  let finalDir = path.join(root, base);

  while (
    used.has(path.resolve(finalDir)) ||
    (fs.existsSync(finalDir) && normalizePathForCompare(finalDir) !== currentResolved)
  ) {
    index += 1;
    finalDir = path.join(root, `${base}_${index}`);
  }

  return finalDir;
}

function defaultGameDir(name = "Default Vanilla") {
  const dir = path.join(getProfilesRootDir(), safeFolderName(name));
  ensureProfileFolders(dir);
  return dir;
}

function defaultProfilesFile() {
  const now = new Date().toISOString();

  return {
    selectedProfileId: "default",
    profiles: [
      {
        id: "default",
        name: "Default Vanilla",
        minecraftVersion: "1.21.1",
        versionType: "release",
        loaderType: "vanilla",
        customVersionId: "",
        customVersionJsonPath: "",
        gameDir: defaultGameDir("Default Vanilla"),
        javaPath: "",
        minMemory: "2G",
        maxMemory: "4G",
        fullscreen: false,
        width: 854,
        height: 480,
        extraJvmArgs: "",
        extraMcArgs: "",
        icon: "grass",
        iconPath: "",
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

function normalizeProfile(profile) {
  const normalized = {
    ...profile,
    icon: profile.icon || "grass",
    iconPath: profile.iconPath || "",
  };

  if (!DEFAULT_INSTALLATION_ICON_IDS.includes(normalized.icon) && normalized.icon !== "custom") {
    normalized.icon = "grass";
  }

  if (normalized.icon !== "custom") {
    normalized.iconPath = "";
  }

  return normalized;
}

function normalizeProfilesData(data) {
  const fallback = defaultProfilesFile();

  const profiles =
    Array.isArray(data?.profiles) && data.profiles.length > 0
      ? data.profiles.map(normalizeProfile)
      : fallback.profiles;

  const selectedProfileId = profiles.some((profile) => profile.id === data?.selectedProfileId)
    ? data.selectedProfileId
    : profiles[0].id;

  return {
    selectedProfileId,
    profiles,
  };
}

function readProfilesFile() {
  return normalizeProfilesData(storage.readJson(PROFILES_FILE, defaultProfilesFile()));
}

function writeProfilesFile(data) {
  const normalized = normalizeProfilesData(data);

  for (const profile of normalized.profiles) {
    if (profile.gameDir) {
      ensureProfileFolders(profile.gameDir);
    }
  }

  return storage.writeJson(PROFILES_FILE, normalized);
}

function iconDataUrlFor(iconPath) {
  if (!iconPath || !fs.existsSync(iconPath)) return "";

  const ext = path.extname(iconPath).toLowerCase();
  if (ext !== ".png") return "";

  try {
    const base64 = fs.readFileSync(iconPath).toString("base64");
    return `data:image/png;base64,${base64}`;
  } catch {
    return "";
  }
}

function withComputedProfileFields(profile) {
  const normalized = normalizeProfile(profile);

  return {
    ...normalized,
    customIconDataUrl: normalized.icon === "custom" ? iconDataUrlFor(normalized.iconPath) : "",
  };
}

function withComputedDataFields(data) {
  return {
    selectedProfileId: data.selectedProfileId,
    profiles: data.profiles.map(withComputedProfileFields),
  };
}

function safeCopyNameFromHash(buffer) {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 32);
  return `${hash}.png`;
}

async function importProfileIcon(sourcePath) {
  if (!sourcePath || typeof sourcePath !== "string") {
    throw new Error("No icon file selected.");
  }

  if (path.extname(sourcePath).toLowerCase() !== ".png") {
    throw new Error("Installation icons must be PNG files.");
  }

  if (!fs.existsSync(sourcePath)) {
    throw new Error("Selected icon file does not exist.");
  }

  const buffer = fs.readFileSync(sourcePath);
  const targetName = safeCopyNameFromHash(buffer);
  const targetPath = path.join(storage.getProfileIconsDir(), targetName);

  fs.writeFileSync(targetPath, buffer);

  return {
    icon: "custom",
    iconPath: targetPath,
    customIconDataUrl: iconDataUrlFor(targetPath),
  };
}

function requestJson(urlString) {
  return new Promise((resolve, reject) => {
    let parsedUrl;

    try {
      parsedUrl = new URL(urlString);
    } catch {
      reject(new Error("Invalid version manifest URL."));
      return;
    }

    if (parsedUrl.protocol !== "https:") {
      reject(new Error("Only HTTPS version manifests are allowed."));
      return;
    }

    const request = https.get(
      parsedUrl,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "eclipse-client/1.0",
        },
      },
      (response) => {
        const statusCode = response.statusCode || 0;

        if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
          response.resume();
          const redirectUrl = new URL(response.headers.location, parsedUrl);
          requestJson(redirectUrl.toString()).then(resolve).catch(reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`Version manifest request failed with HTTP ${statusCode}.`));
          return;
        }

        const chunks = [];

        response.on("data", (chunk) => {
          chunks.push(chunk);
        });

        response.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new Error("Version manifest returned invalid JSON."));
          }
        });
      }
    );

    request.on("error", reject);
    request.setTimeout(30000, () => {
      request.destroy(new Error("Version manifest request timed out."));
    });
  });
}

async function fetchOfficialMinecraftVersionManifest() {
  const now = Date.now();

  if (
    minecraftVersionManifestCache &&
    now - minecraftVersionManifestCacheAt < MINECRAFT_VERSION_MANIFEST_CACHE_MS
  ) {
    return minecraftVersionManifestCache;
  }

  const manifest = await requestJson(MINECRAFT_VERSION_MANIFEST_URL);

  minecraftVersionManifestCache = manifest;
  minecraftVersionManifestCacheAt = now;

  return manifest;
}

async function listMinecraftVersions(options = {}) {
  const includeSnapshots = Boolean(options.includeSnapshots);
  const manifest = await fetchOfficialMinecraftVersionManifest();
  const versions = Array.isArray(manifest?.versions) ? manifest.versions : [];

  return versions
    .filter((version) => {
      if (version?.type === "release") return true;
      if (includeSnapshots && version?.type === "snapshot") return true;
      return false;
    })
    .map((version) => ({
      id: String(version.id || ""),
      type: version.type === "snapshot" ? "snapshot" : "release",
      url: String(version.url || ""),
      time: String(version.time || ""),
      releaseTime: String(version.releaseTime || ""),
    }))
    .filter((version) => version.id);
}

function guessLoaderFromVersionJson(idValue, json) {
  const text = `${idValue || ""} ${json?.id || ""} ${json?.mainClass || ""}`.toLowerCase();

  if (text.includes("fabric")) return "fabric";
  if (text.includes("quilt")) return "quilt";
  if (text.includes("neoforge")) return "neoforge";
  if (text.includes("forge")) return "forge";
  if (text.includes("optifine")) return "custom";

  return "vanilla";
}

function isLikelyVanillaVersion(idValue, json, loaderType) {
  if (loaderType !== "vanilla") return false;
  if (json?.inheritsFrom) return false;

  const lower = String(idValue || json?.id || "").toLowerCase();

  return (
    !lower.includes("fabric") &&
    !lower.includes("forge") &&
    !lower.includes("quilt") &&
    !lower.includes("neoforge") &&
    !lower.includes("optifine")
  );
}

function readInstalledVersionFromDir(versionsRoot, folderName) {
  const versionDir = path.join(versionsRoot, folderName);
  const expectedJson = path.join(versionDir, `${folderName}.json`);

  let jsonPath = expectedJson;

  if (!fs.existsSync(jsonPath)) {
    const jsonFiles = fs
      .readdirSync(versionDir)
      .filter((file) => file.toLowerCase().endsWith(".json"));

    if (jsonFiles.length === 0) return null;
    jsonPath = path.join(versionDir, jsonFiles[0]);
  }

  try {
    const json = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const versionId = json.id || folderName;
    const loaderType = guessLoaderFromVersionJson(versionId, json);
    const isVanilla = isLikelyVanillaVersion(versionId, json, loaderType);

    return {
      id: versionId,
      folderName,
      path: jsonPath,
      versionsRoot,
      type: json.type || "release",
      inheritsFrom: json.inheritsFrom || "",
      baseVersion: json.inheritsFrom || versionId,
      loaderType,
      isVanilla,
    };
  } catch {
    return null;
  }
}

function listInstalledVersionsInRoot(versionsRoot) {
  if (!versionsRoot || !fs.existsSync(versionsRoot)) {
    return [];
  }

  return fs
    .readdirSync(versionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readInstalledVersionFromDir(versionsRoot, entry.name))
    .filter(Boolean);
}

async function listInstalledVersions() {
  const data = readProfilesFile();

  const roots = uniquePaths([
    ...data.profiles.map((profile) => {
      if (!profile.gameDir) return "";
      return path.join(profile.gameDir, "versions");
    }),
    storage.getVersionsDir(),
  ]);

  const byId = new Map();

  for (const root of roots) {
    for (const version of listInstalledVersionsInRoot(root)) {
      if (!byId.has(version.id)) {
        byId.set(version.id, version);
      }
    }
  }

  const entries = Array.from(byId.values());

  entries.sort((a, b) =>
    a.id.localeCompare(b.id, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );

  return entries;
}

function uniquePaths(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    if (!value) continue;

    const resolved = path.resolve(value).toLowerCase();
    if (seen.has(resolved)) continue;

    seen.add(resolved);
    result.push(value);
  }

  return result;
}

function renameManagedProfileDirIfNeeded(profile, oldName, data) {
  const oldDir = profile.gameDir;

  if (!oldDir || !isManagedProfileGameDir(oldDir)) {
    return;
  }

  if (safeFolderName(oldName) === safeFolderName(profile.name)) {
    return;
  }

  const targetDir = uniqueManagedProfileGameDirForRename(
    profile.name,
    profile.id,
    data.profiles,
    oldDir
  );

  if (normalizePathForCompare(targetDir) === normalizePathForCompare(oldDir)) {
    ensureProfileFolders(targetDir);
    return;
  }

  storage.ensureDir(path.dirname(targetDir));

  if (fs.existsSync(oldDir)) {
    fs.renameSync(oldDir, targetDir);
  } else {
    ensureProfileFolders(targetDir);
  }

  profile.gameDir = targetDir;
  ensureProfileFolders(profile.gameDir);
}

async function listProfiles() {
  return withComputedDataFields(readProfilesFile());
}

async function createProfile(profile = {}) {
  const data = readProfilesFile();

  const profileName = profile.name || "New Installation";
  const now = new Date().toISOString();

  const newProfile = {
    id: id(),
    name: profileName,
    minecraftVersion: profile.minecraftVersion || "1.21.1",
    versionType: profile.versionType || "release",
    loaderType: profile.loaderType || "vanilla",
    customVersionId: profile.customVersionId || "",
    customVersionJsonPath: profile.customVersionJsonPath || "",
    gameDir: profile.gameDir || uniqueProfileGameDir(profileName, data.profiles),
    javaPath: profile.javaPath || "",
    minMemory: profile.minMemory || "2G",
    maxMemory: profile.maxMemory || "4G",
    fullscreen: Boolean(profile.fullscreen),
    width: Number(profile.width || 854),
    height: Number(profile.height || 480),
    extraJvmArgs: profile.extraJvmArgs || "",
    extraMcArgs: profile.extraMcArgs || "",
    icon: profile.icon || "grass",
    iconPath: profile.iconPath || "",
    createdAt: now,
    updatedAt: now,
  };

  ensureProfileFolders(newProfile.gameDir);

  data.profiles.push(normalizeProfile(newProfile));
  data.selectedProfileId = newProfile.id;

  writeProfilesFile(data);
  return withComputedProfileFields(newProfile);
}

async function updateProfile(profileId, patch = {}) {
  const data = readProfilesFile();
  const profile = data.profiles.find((item) => item.id === profileId);

  if (!profile) {
    throw new Error("Profile not found.");
  }

  const oldName = profile.name;
  const oldGameDir = profile.gameDir;

  const allowed = [
    "name",
    "minecraftVersion",
    "versionType",
    "loaderType",
    "customVersionId",
    "customVersionJsonPath",
    "javaPath",
    "minMemory",
    "maxMemory",
    "fullscreen",
    "width",
    "height",
    "extraJvmArgs",
    "extraMcArgs",
    "icon",
    "iconPath",
  ];

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      profile[key] = patch[key];
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, "gameDir")) {
    const requestedGameDir = String(patch.gameDir || "").trim();

    if (
      requestedGameDir &&
      normalizePathForCompare(requestedGameDir) !== normalizePathForCompare(oldGameDir)
    ) {
      profile.gameDir = requestedGameDir;
    }
  }

  profile.name = String(profile.name || "Installation").trim() || "Installation";
  profile.minecraftVersion = String(profile.minecraftVersion || "1.21.1").trim() || "1.21.1";
  profile.versionType = String(profile.versionType || "release").trim() || "release";
  profile.loaderType = String(profile.loaderType || "vanilla").trim() || "vanilla";
  profile.customVersionId = String(profile.customVersionId || "").trim();
  profile.customVersionJsonPath = String(profile.customVersionJsonPath || "").trim();
  profile.javaPath = String(profile.javaPath || "").trim();
  profile.minMemory = String(profile.minMemory || "2G").trim() || "2G";
  profile.maxMemory = (profile.maxMemory || "4G").trim() || "4G";
  profile.extraJvmArgs = String(profile.extraJvmArgs || "").trim();
  profile.extraMcArgs = String(profile.extraMcArgs || "").trim();
  profile.width = Number(profile.width || 854);
  profile.height = Number(profile.height || 480);
  profile.fullscreen = Boolean(profile.fullscreen);

  Object.assign(profile, normalizeProfile(profile));

  if (normalizePathForCompare(profile.gameDir) === normalizePathForCompare(oldGameDir)) {
    renameManagedProfileDirIfNeeded(profile, oldName, data);
  }

  if (profile.gameDir) {
    ensureProfileFolders(profile.gameDir);
  }

  profile.updatedAt = new Date().toISOString();

  writeProfilesFile(data);
  return withComputedProfileFields(profile);
}

async function deleteProfile(profileId) {
  const data = readProfilesFile();

  if (data.profiles.length <= 1) {
    throw new Error("You must keep at least one installation.");
  }

  const exists = data.profiles.some((profile) => profile.id === profileId);

  if (!exists) {
    throw new Error("Profile not found.");
  }

  data.profiles = data.profiles.filter((profile) => profile.id !== profileId);

  if (data.selectedProfileId === profileId) {
    data.selectedProfileId = data.profiles[0].id;
  }

  writeProfilesFile(data);
  return withComputedDataFields(data);
}

async function setSelectedProfile(profileId) {
  const data = readProfilesFile();
  const exists = data.profiles.some((profile) => profile.id === profileId);

  if (!exists) {
    throw new Error("Profile not found.");
  }

  data.selectedProfileId = profileId;
  writeProfilesFile(data);

  return withComputedProfileFields(data.profiles.find((profile) => profile.id === profileId));
}

async function getSelectedProfile() {
  const data = readProfilesFile();
  return data.profiles.find((profile) => profile.id === data.selectedProfileId) || data.profiles[0];
}

async function getProfileById(profileId) {
  const data = readProfilesFile();
  const profile = data.profiles.find((item) => item.id === profileId);

  if (!profile) {
    throw new Error("Profile not found.");
  }

  ensureProfileFolders(profile.gameDir);

  return profile;
}

module.exports = {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  setSelectedProfile,
  getSelectedProfile,
  getProfileById,
  importProfileIcon,
  listInstalledVersions,
  listMinecraftVersions,
  DEFAULT_INSTALLATION_ICON_IDS,
};
