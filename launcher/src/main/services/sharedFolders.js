const fs = require("fs");
const path = require("path");

const crypto = require("crypto");

const storage = require("./storage");

const CONFIG_FILE = "shared-folders.json";

const BUILT_IN_FOLDERS = [
  { id: "saves", label: "Worlds", description: "Singleplayer worlds (saves)", enabled: true },
  {
    id: "resourcepacks",
    label: "Resource packs",
    description: "Texture and resource packs",
    enabled: true,
  },
  {
    id: "shaderpacks",
    label: "Shader packs",
    description: "Iris / OptiFine shaders",
    enabled: true,
  },
  { id: "screenshots", label: "Screenshots", description: "F2 screenshots", enabled: true },
  {
    id: "schematics",
    label: "Schematics",
    description: "Litematica / WorldEdit schematics",
    enabled: false,
  },
  {
    id: "replay_recordings",
    label: "Replays",
    description: "ReplayMod recordings",
    enabled: false,
  },
];

const BUILT_IN_IDS = new Set(BUILT_IN_FOLDERS.map((folder) => folder.id));

const RESERVED_NAMES = new Set([
  "versions",
  "libraries",
  "assets",
  "natives",
  "bin",
  "java-runtime",
  "logs",
  "crash-reports",
]);

const NO_LINK_CODES = new Set([
  "EISDIR",
  "EPERM",
  "ENOTSUP",
  "EINVAL",
  "ENOSYS",
  "EACCES",
  "EIO",
  "UNKNOWN",
]);
const LEASE_SUFFIX = ".eclipse-lease.json";

let cached = null;
const linkSupport = new Map();

function defaultEntry(folder) {
  return {
    id: folder.id,
    label: folder.label,
    enabled: folder.enabled,
    path: "",
    custom: false,
  };
}

function defaultConfig() {
  return {
    enabled: true,
    root: "",
    folders: BUILT_IN_FOLDERS.map(defaultEntry),
    profiles: {},
  };
}

function cleanLabel(value, fallback) {
  const label = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);

  return label || fallback;
}

function validateFolderName(value) {
  const name = String(value || "").trim();

  if (!name) {
    throw new Error("Type a folder name.");
  }

  if (name === "." || name === ".." || !/^[A-Za-z0-9 _.\-]{1,64}$/.test(name)) {
    throw new Error("Folder names can only use letters, numbers, spaces, dots, - and _.");
  }

  if (RESERVED_NAMES.has(name.toLowerCase())) {
    throw new Error(`"${name}" is used by the launcher and cannot be shared.`);
  }

  return name;
}

function normalizeProfileEntry(entry) {
  const separate = Array.isArray(entry?.separate)
    ? [...new Set(entry.separate.map((id) => String(id || "")).filter(Boolean))]
    : [];

  return {
    useShared: entry?.useShared !== false,
    separate,
  };
}

function readConfig() {
  if (cached) return cached;

  const saved = storage.readJson(CONFIG_FILE, null) || {};
  const config = defaultConfig();

  if (typeof saved.enabled === "boolean") config.enabled = saved.enabled;
  if (typeof saved.root === "string") config.root = saved.root;

  const savedFolders = Array.isArray(saved.folders)
    ? saved.folders
    : saved.folders && typeof saved.folders === "object"
      ? Object.entries(saved.folders).map(([id, entry]) => ({ ...entry, id }))
      : [];

  const byId = new Map(config.folders.map((entry) => [entry.id, entry]));
  const ordered = [];

  for (const raw of savedFolders) {
    if (!raw || typeof raw !== "object") continue;

    const id = String(raw.id || "");
    let entry = byId.get(id);

    if (!entry) {
      if (!raw.custom) continue;

      try {
        validateFolderName(id);
      } catch {
        continue;
      }

      if (ordered.some((item) => item.id.toLowerCase() === id.toLowerCase())) continue;

      entry = { id, label: id, enabled: true, path: "", custom: true };
    }

    if (typeof raw.enabled === "boolean") entry.enabled = raw.enabled;
    if (typeof raw.path === "string") entry.path = raw.path;
    entry.label = cleanLabel(raw.label, entry.label);

    if (!ordered.includes(entry)) ordered.push(entry);
    byId.delete(id);
  }

  config.folders = [...ordered, ...byId.values()];

  if (saved.profiles && typeof saved.profiles === "object") {
    for (const [profileId, entry] of Object.entries(saved.profiles)) {
      config.profiles[profileId] = normalizeProfileEntry(entry);
    }
  }

  cached = config;
  return cached;
}

function writeConfig(config) {
  cached = config;
  storage.writeJson(CONFIG_FILE, config);
}

function cloneConfig() {
  return JSON.parse(JSON.stringify(readConfig()));
}

function getDefaultRoot() {
  return path.join(storage.getRootDir(), "shared");
}

function getRoot(config = readConfig()) {
  return config.root ? path.resolve(storage.fromStoredPath(config.root)) : getDefaultRoot();
}

function findFolder(config, id) {
  return config.folders.find((entry) => entry.id === id) || null;
}

function getFolderTarget(id, config = readConfig()) {
  const entry = findFolder(config, id);

  if (entry?.path) {
    return path.resolve(storage.fromStoredPath(entry.path));
  }

  return path.join(getRoot(config), id);
}

function getProfileEntry(config, profileId) {
  return normalizeProfileEntry(profileId ? config.profiles[profileId] : null);
}

function samePath(a, b) {
  const left = path.resolve(a);
  const right = path.resolve(b);

  if (process.platform === "win32") {
    return left.toLowerCase() === right.toLowerCase();
  }

  return left === right;
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

function readLinkTarget(linkPath) {
  try {
    const raw = fs.readlinkSync(linkPath);
    return path.resolve(path.dirname(linkPath), raw);
  } catch {
    return "";
  }
}

function createLink(target, linkPath) {
  fs.symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

function supportsLinks(dir) {
  const resolved = path.resolve(dir);
  const key = process.platform === "win32" ? path.parse(resolved).root.toLowerCase() : resolved;

  if (linkSupport.has(key)) return linkSupport.get(key);

  const probeId = crypto.randomBytes(5).toString("hex");
  const target = path.join(resolved, `.eclipse-link-target-${probeId}`);
  const link = path.join(resolved, `.eclipse-link-probe-${probeId}`);
  let supported = false;

  try {
    fs.mkdirSync(resolved, { recursive: true });
    fs.mkdirSync(target);
    createLink(target, link);
    supported = Boolean(lstatOrNull(link)?.isSymbolicLink());
  } catch (error) {
    if (!NO_LINK_CODES.has(error.code)) {
      supported = true;
    }
  } finally {
    try {
      if (lstatOrNull(link)?.isSymbolicLink()) fs.unlinkSync(link);
      else if (fs.existsSync(link)) fs.rmdirSync(link);
    } catch {}

    try {
      fs.rmdirSync(target);
    } catch {}
  }

  linkSupport.set(key, supported);
  return supported;
}

function leaseFile(target) {
  return `${path.resolve(target)}${LEASE_SUFFIX}`;
}

function readLease(target) {
  try {
    const lease = JSON.parse(fs.readFileSync(leaseFile(target), "utf8"));
    return lease && lease.gameDir ? lease : null;
  } catch {
    return null;
  }
}

function writeLease(target, lease) {
  fs.writeFileSync(
    leaseFile(target),
    JSON.stringify({ ...lease, since: new Date().toISOString() }, null, 2),
    "utf8"
  );
}

function clearLease(target) {
  fs.rmSync(leaseFile(target), { force: true });
}

function moveEntry(source, destination) {
  try {
    fs.renameSync(source, destination);
  } catch (error) {
    if (error.code !== "EXDEV" && error.code !== "EPERM") throw error;

    fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
    fs.rmSync(source, { recursive: true, force: true });
  }
}

function uniqueDestination(directory, name, suffix) {
  const isDirectory = fs.statSync(path.join(directory, name)).isDirectory();
  const extension = isDirectory ? "" : path.extname(name);
  const base = extension ? name.slice(0, -extension.length) : name;

  let candidate = `${base} (${suffix})${extension}`;
  let counter = 2;

  while (fs.existsSync(path.join(directory, candidate))) {
    candidate = `${base} (${suffix} ${counter})${extension}`;
    counter += 1;
  }

  return path.join(directory, candidate);
}

function mergeDirectoryInto(source, target, suffix) {
  let moved = 0;
  let renamed = 0;

  for (const name of fs.readdirSync(source)) {
    const from = path.join(source, name);
    let to = path.join(target, name);

    if (fs.existsSync(to)) {
      to = uniqueDestination(target, name, suffix);
      renamed += 1;
    }

    moveEntry(from, to);
    moved += 1;
  }

  return { moved, renamed };
}

function linkFolder(gameDir, id, target, logs) {
  const linkPath = path.join(gameDir, id);
  const stat = lstatOrNull(linkPath);

  if (samePath(linkPath, target)) {
    fs.mkdirSync(target, { recursive: true });
    return "self";
  }

  if (isInside(linkPath, target)) {
    throw new Error(
      `The shared ${id} folder cannot be inside this installation's own ${id} folder.`
    );
  }

  fs.mkdirSync(target, { recursive: true });

  if (stat?.isSymbolicLink()) {
    if (samePath(readLinkTarget(linkPath), target)) return "ok";

    fs.unlinkSync(linkPath);
    createLink(target, linkPath);
    logs.push(`Relinked ${id} → ${target}`);
    return "relinked";
  }

  if (stat?.isDirectory()) {
    const suffix = path.basename(gameDir) || "installation";
    const { moved, renamed } = mergeDirectoryInto(linkPath, target, suffix);

    fs.rmdirSync(linkPath);

    try {
      createLink(target, linkPath);
    } catch (error) {
      fs.mkdirSync(linkPath, { recursive: true });
      throw error;
    }

    logs.push(
      `Linked ${id} → ${target}${moved ? ` (moved ${moved} item${moved === 1 ? "" : "s"}${renamed ? `, ${renamed} renamed to avoid clashes` : ""})` : ""}`
    );
    return "merged";
  }

  if (stat) {
    throw new Error(`${linkPath} exists and is not a folder.`);
  }

  createLink(target, linkPath);
  logs.push(`Linked ${id} → ${target}`);
  return "linked";
}

function returnFolder(holderGameDir, id, target, logs) {
  const held = path.join(holderGameDir, id);
  const stat = lstatOrNull(held);

  if (stat?.isDirectory() && !stat.isSymbolicLink()) {
    if (fs.existsSync(target)) {
      mergeDirectoryInto(held, target, path.basename(holderGameDir) || "installation");
      fs.rmdirSync(held);
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      moveEntry(held, target);
    }

    fs.mkdirSync(held, { recursive: true });
  } else {
    fs.mkdirSync(target, { recursive: true });
  }

  clearLease(target);
  logs.push(`Moved ${id} back to the shared folder.`);
}

function moveModeFolder(gameDir, id, target, options, logs) {
  const linkPath = path.join(gameDir, id);

  if (samePath(linkPath, target)) {
    fs.mkdirSync(target, { recursive: true });
    return "self";
  }

  if (isInside(linkPath, target)) {
    throw new Error(
      `The shared ${id} folder cannot be inside this installation's own ${id} folder.`
    );
  }

  const stat = lstatOrNull(linkPath);

  if (stat?.isSymbolicLink()) {
    fs.unlinkSync(linkPath);
    fs.mkdirSync(linkPath, { recursive: true });
  }

  const lease = readLease(target);

  if (lease && samePath(lease.gameDir, gameDir)) {
    if (options.borrow || options.isBusy?.(lease.profileId)) return "held";

    returnFolder(gameDir, id, target, logs);
    return "returned";
  }

  if (lease) {
    if (options.isBusy?.(lease.profileId)) {
      if (options.borrow) {
        logs.push(
          `${id} is being used by another running installation, so this one uses its own ${id} folder this time.`
        );
      }
      return "busy";
    }

    returnFolder(lease.gameDir, id, target, logs);
  }

  fs.mkdirSync(target, { recursive: true });

  const own = lstatOrNull(linkPath);

  if (own?.isDirectory() && fs.readdirSync(linkPath).length) {
    const { moved, renamed } = mergeDirectoryInto(
      linkPath,
      target,
      path.basename(gameDir) || "installation"
    );
    logs.push(
      `Moved ${moved} item${moved === 1 ? "" : "s"} from ${id} into the shared folder${renamed ? ` (${renamed} renamed to avoid clashes)` : ""}.`
    );
  }

  if (!options.borrow) return "stored";

  if (fs.existsSync(linkPath)) fs.rmdirSync(linkPath);

  moveEntry(target, linkPath);
  writeLease(target, {
    gameDir: path.resolve(gameDir),
    profileId: options.profileId || "",
    folder: id,
  });
  logs.push(
    `Moved shared ${id} into this installation while it runs (this drive can't use folder links).`
  );
  return "borrowed";
}

function heldBy(gameDir, target) {
  const lease = readLease(target);
  return Boolean(lease && samePath(lease.gameDir, gameDir));
}

function unlinkFolder(gameDir, id, logs, options = {}) {
  const linkPath = path.join(gameDir, id);

  if (options.target && heldBy(gameDir, options.target)) {
    returnFolder(gameDir, id, options.target, logs);

    if (options.copy && fs.existsSync(options.target)) {
      fs.cpSync(options.target, linkPath, { recursive: true, force: false, errorOnExist: false });
      logs.push(`Copied the shared ${id} files into this installation.`);
    }

    return true;
  }

  const stat = lstatOrNull(linkPath);

  if (!stat?.isSymbolicLink()) return false;

  const target = readLinkTarget(linkPath);

  fs.unlinkSync(linkPath);
  fs.mkdirSync(linkPath, { recursive: true });

  if (options.copy && target && fs.existsSync(target)) {
    fs.cpSync(target, linkPath, { recursive: true, force: false, errorOnExist: false });
    logs.push(`Unlinked ${id}; copied the shared files into this installation.`);
  } else {
    logs.push(`Unlinked ${id}; this installation now has its own ${id} folder.`);
  }

  return true;
}

function applyToGameDir(gameDir, options = {}) {
  const config = readConfig();
  const profile = getProfileEntry(config, options.profileId);
  const logs = [];
  const errors = [];

  if (!gameDir) return { ok: true, logs, errors };

  const resolvedGameDir = path.resolve(gameDir);
  fs.mkdirSync(resolvedGameDir, { recursive: true });

  const canLink = supportsLinks(resolvedGameDir);

  for (const entry of config.folders) {
    const shouldLink =
      config.enabled && entry.enabled && profile.useShared && !profile.separate.includes(entry.id);
    const target = getFolderTarget(entry.id, config);

    try {
      if (shouldLink && canLink && !heldBy(resolvedGameDir, target)) {
        linkFolder(resolvedGameDir, entry.id, target, logs);
      } else if (shouldLink) {
        moveModeFolder(
          resolvedGameDir,
          entry.id,
          target,
          { ...options, profileId: options.profileId },
          logs
        );
      } else if (options.unlinkDisabled !== false || heldBy(resolvedGameDir, target)) {
        unlinkFolder(resolvedGameDir, entry.id, logs, {
          copy: Boolean(options.copyOnDetach),
          target,
        });
      }
    } catch (error) {
      errors.push(`${entry.id}: ${error.message || error}`);
    }
  }

  return { ok: errors.length === 0, logs, errors };
}

function detachFolder(gameDir, id) {
  const logs = [];
  if (!gameDir) return logs;
  unlinkFolder(path.resolve(gameDir), id, logs, { target: getFolderTarget(id) });
  return logs;
}

function returnBorrowed(gameDir) {
  const logs = [];
  const errors = [];
  if (!gameDir) return { logs, errors };

  const config = readConfig();

  for (const entry of config.folders) {
    const target = getFolderTarget(entry.id, config);

    try {
      if (heldBy(gameDir, target)) returnFolder(path.resolve(gameDir), entry.id, target, logs);
    } catch (error) {
      errors.push(`${entry.id}: ${error.message || error}`);
    }
  }

  return { logs, errors };
}

function recoverLeases(isBusy = () => false) {
  const config = readConfig();
  const logs = [];

  for (const entry of config.folders) {
    const target = getFolderTarget(entry.id, config);
    const lease = readLease(target);
    if (!lease || isBusy(lease.profileId)) continue;

    try {
      returnFolder(lease.gameDir, entry.id, target, logs);
    } catch (error) {
      logs.push(`Could not return ${entry.id}: ${error.message || error}`);
    }
  }

  return logs;
}

function detachAll(gameDir) {
  const detached = [];
  if (!gameDir || !fs.existsSync(gameDir)) return detached;

  returnBorrowed(gameDir);

  for (const name of fs.readdirSync(gameDir)) {
    const full = path.join(gameDir, name);
    const stat = lstatOrNull(full);

    if (stat?.isSymbolicLink()) {
      fs.unlinkSync(full);
      detached.push(name);
    }
  }

  return detached;
}

function isLinkedPath(gameDir, relativePath) {
  const first = String(relativePath || "")
    .split(/[\\/]+/)
    .filter(Boolean)[0];

  if (!first) return false;

  if (lstatOrNull(path.join(gameDir, first))?.isSymbolicLink()) return true;

  const config = readConfig();
  const entry = config.folders.find((item) => item.id.toLowerCase() === first.toLowerCase());

  return Boolean(entry && heldBy(gameDir, getFolderTarget(entry.id, config)));
}

function describeFolder(entry, config) {
  const builtIn = BUILT_IN_FOLDERS.find((folder) => folder.id === entry.id);

  return {
    id: entry.id,
    label: entry.label,
    description: builtIn ? builtIn.description : `${entry.id} folder`,
    enabled: Boolean(entry.enabled),
    custom: Boolean(entry.custom),
    path: getFolderTarget(entry.id, config),
    customPath: Boolean(entry.path),
  };
}

function getState() {
  const config = readConfig();

  let linksSupported = true;

  try {
    linksSupported = supportsLinks(path.dirname(getRoot(config)));
  } catch {
    linksSupported = true;
  }

  return {
    linksSupported,
    enabled: config.enabled,
    root: getRoot(config),
    defaultRoot: getDefaultRoot(),
    customRoot: Boolean(config.root),
    folders: config.folders.map((entry) => describeFolder(entry, config)),
  };
}

function getProfileState(profileId) {
  const config = readConfig();
  const profile = getProfileEntry(config, profileId);

  return {
    profileId,
    globalEnabled: config.enabled,
    useShared: profile.useShared,
    folders: config.folders.map((entry) => ({
      ...describeFolder(entry, config),
      shared: profile.useShared && !profile.separate.includes(entry.id),
      active:
        config.enabled &&
        entry.enabled &&
        profile.useShared &&
        !profile.separate.includes(entry.id),
    })),
  };
}

function updateConfig(patch = {}) {
  const config = cloneConfig();

  if (typeof patch.enabled === "boolean") config.enabled = patch.enabled;

  if (patch.root !== undefined) {
    config.root = patch.root ? storage.toStoredPath(path.resolve(String(patch.root))) : "";
  }

  if (patch.folder) {
    const entry = findFolder(config, patch.folder.id);

    if (!entry) {
      throw new Error("Unknown shared folder.");
    }

    if (typeof patch.folder.enabled === "boolean") entry.enabled = patch.folder.enabled;

    if (patch.folder.label !== undefined) {
      entry.label = cleanLabel(patch.folder.label, entry.custom ? entry.id : entry.label);
    }

    if (patch.folder.path !== undefined) {
      entry.path = patch.folder.path
        ? storage.toStoredPath(path.resolve(String(patch.folder.path)))
        : "";
    }
  }

  writeConfig(config);
  return getState();
}

function addFolder(name, label = "") {
  const id = validateFolderName(name);
  const config = cloneConfig();

  if (config.folders.some((entry) => entry.id.toLowerCase() === id.toLowerCase())) {
    throw new Error(`"${id}" is already in the list.`);
  }

  config.folders.push({ id, label: cleanLabel(label, id), enabled: true, path: "", custom: true });
  writeConfig(config);

  return getState();
}

function removeFolder(id) {
  const config = cloneConfig();
  const entry = findFolder(config, id);

  if (!entry) {
    throw new Error("Unknown shared folder.");
  }

  if (!entry.custom || BUILT_IN_IDS.has(id)) {
    throw new Error("Built-in folders can be turned off but not removed.");
  }

  config.folders = config.folders.filter((item) => item.id !== id);

  for (const profile of Object.values(config.profiles)) {
    profile.separate = profile.separate.filter((item) => item !== id);
  }

  writeConfig(config);
  return getState();
}

function setProfileSettings(profileId, patch = {}) {
  if (!profileId) {
    throw new Error("Missing installation.");
  }

  const config = cloneConfig();
  const entry = getProfileEntry(config, profileId);

  if (typeof patch.useShared === "boolean") entry.useShared = patch.useShared;

  if (patch.folder && findFolder(config, patch.folder.id)) {
    const separate = new Set(entry.separate);

    if (patch.folder.shared) separate.delete(patch.folder.id);
    else separate.add(patch.folder.id);

    entry.separate = [...separate];
  }

  if (entry.useShared && entry.separate.length === 0) {
    delete config.profiles[profileId];
  } else {
    config.profiles[profileId] = entry;
  }

  writeConfig(config);
  return getProfileState(profileId);
}

function forgetProfile(profileId) {
  const config = cloneConfig();
  if (!config.profiles[profileId]) return;
  delete config.profiles[profileId];
  writeConfig(config);
}

module.exports = {
  getState,
  getProfileState,
  updateConfig,
  addFolder,
  removeFolder,
  setProfileSettings,
  forgetProfile,
  getFolderTarget,
  applyToGameDir,
  detachFolder,
  detachAll,
  returnBorrowed,
  recoverLeases,
  supportsLinks,
  isLinkedPath,
};
