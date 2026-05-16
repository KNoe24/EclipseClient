const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const LAUNCHER_FOLDER_NAME = ".eclipse-client";

function ensureDir(dir) {
  if (!dir) return "";
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getRootDir() {
  const dir = path.join(app.getPath("appData"), LAUNCHER_FOLDER_NAME);
  ensureDir(dir);
  return dir;
}

/*
  Layout:

  .test-launcher/
    account.json
    profiles.json
    skins.json
    profile-icons/
    skins/
    profiles/
      .runtime/
        assets/
        cache/
        libraries/
        versions/
      ProfileName/
        config/
        logs/
        mods/
        resourcepacks/
        saves/
        screenshots/
        shaderpacks/

  Minecraft runtime files are shared in profiles/.runtime.
  Per-installation game data stays inside each profile folder.
*/

function getClientsDir() {
  return getRootDir();
}

function getProfilesRootDir() {
  const dir = path.join(getRootDir(), "profiles");
  ensureDir(dir);
  return dir;
}

function getRuntimeRootDir() {
  const dir = path.join(getProfilesRootDir(), ".runtime");
  ensureDir(dir);
  return dir;
}

function getRuntimeAssetsDir() {
  return ensureDir(path.join(getRuntimeRootDir(), "assets"));
}

function getRuntimeCacheDir() {
  return ensureDir(path.join(getRuntimeRootDir(), "cache"));
}

function getRuntimeLibrariesDir() {
  return ensureDir(path.join(getRuntimeRootDir(), "libraries"));
}

function getRuntimeVersionsDir() {
  return ensureDir(path.join(getRuntimeRootDir(), "versions"));
}

/*
  Legacy shared versions directory.
  Kept only so old installs can be detected and migrated.
*/
function getVersionsDir() {
  const dir = path.join(getRootDir(), "versions");
  ensureDir(dir);
  return dir;
}

function getProfileIconsDir() {
  const dir = path.join(getRootDir(), "profile-icons");
  ensureDir(dir);
  return dir;
}

function getSkinsDir() {
  const dir = path.join(getRootDir(), "skins");
  ensureDir(dir);
  return dir;
}

function getProfileSubDir(gameDir, name) {
  const dir = path.join(gameDir, name);
  ensureDir(dir);
  return dir;
}

function getProfileConfigDir(gameDir) {
  return getProfileSubDir(gameDir, "config");
}

function getProfileLogsDir(gameDir) {
  return getProfileSubDir(gameDir, "logs");
}

function getProfileModsDir(gameDir) {
  return getProfileSubDir(gameDir, "mods");
}

function getProfileResourcePacksDir(gameDir) {
  return getProfileSubDir(gameDir, "resourcepacks");
}

function getProfileSavesDir(gameDir) {
  return getProfileSubDir(gameDir, "saves");
}

function getProfileScreenshotsDir(gameDir) {
  return getProfileSubDir(gameDir, "screenshots");
}

function getProfileShaderPacksDir(gameDir) {
  return getProfileSubDir(gameDir, "shaderpacks");
}

function ensureRuntimeDirs() {
  getRuntimeRootDir();
  getRuntimeAssetsDir();
  getRuntimeCacheDir();
  getRuntimeLibrariesDir();
  getRuntimeVersionsDir();
}

function ensureProfileRuntimeDirs(gameDir) {
  ensureDir(gameDir);

  getProfileConfigDir(gameDir);
  getProfileLogsDir(gameDir);
  getProfileModsDir(gameDir);
  getProfileResourcePacksDir(gameDir);
  getProfileSavesDir(gameDir);
  getProfileScreenshotsDir(gameDir);
  getProfileShaderPacksDir(gameDir);

  ensureRuntimeDirs();

  return gameDir;
}

function getFilePath(name) {
  return path.join(getRootDir(), name);
}

function getClientPath(name) {
  return path.join(getClientsDir(), name);
}

function readJson(name, fallback) {
  const file = getFilePath(name);

  try {
    if (!fs.existsSync(file)) {
      writeJson(name, fallback);
      return fallback;
    }

    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Failed to read ${name}:`, error);
    return fallback;
  }
}

function writeJson(name, data) {
  const file = getFilePath(name);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  return data;
}

module.exports = {
  ensureDir,
  ensureRuntimeDirs,
  ensureProfileRuntimeDirs,

  getRootDir,
  getClientsDir,
  getProfilesRootDir,
  getRuntimeRootDir,
  getRuntimeAssetsDir,
  getRuntimeCacheDir,
  getRuntimeLibrariesDir,
  getRuntimeVersionsDir,
  getVersionsDir,
  getProfileIconsDir,
  getSkinsDir,

  getProfileSubDir,
  getProfileConfigDir,
  getProfileLogsDir,
  getProfileModsDir,
  getProfileResourcePacksDir,
  getProfileSavesDir,
  getProfileScreenshotsDir,
  getProfileShaderPacksDir,

  getFilePath,
  getClientPath,
  readJson,
  writeJson,
};
