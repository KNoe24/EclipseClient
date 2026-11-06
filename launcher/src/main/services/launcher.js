const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const { Client } = require("minecraft-launcher-core");

const authService = require("./auth");
const profileService = require("./profiles");
const storage = require("./storage");
const javaRuntime = require("./javaRuntime");
const sharedFolders = require("./sharedFolders");

const instances = new Map();
const instanceListeners = new Set();
let nextInstanceNumber = 1;
let preparationQueue = Promise.resolve();

const PROGRESS_PERCENT_STEP = 10;
const DOWNLOAD_LOG_INTERVAL_MS = 1500;
const SEED_PROGRESS_INTERVAL_MS = 1000;
const SEED_COPY_CONCURRENCY = 96;

function sendGameLog(window, message) {
  if (!window || window.isDestroyed()) return;
  window.webContents.send("game:log", message);
}

function sendGameClose(window, code) {
  if (!window || window.isDestroyed()) return;
  window.webContents.send("game:close", { code });
}

function sleepImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

function splitArgs(text) {
  if (!text || typeof text !== "string") return [];

  return text.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((arg) => arg.replace(/^"|"$/g, "")) || [];
}

function samePath(a, b) {
  return (
    path.resolve(String(a || "")).toLowerCase() === path.resolve(String(b || "")).toLowerCase()
  );
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

async function pathExists(value) {
  try {
    await fsp.access(value);
    return true;
  } catch {
    return false;
  }
}

function pathExistsSync(value) {
  try {
    return Boolean(value && fs.existsSync(value));
  } catch {
    return false;
  }
}

async function dirExists(dir) {
  try {
    const stat = await fsp.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function dirExistsSync(dir) {
  try {
    return Boolean(dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory());
  } catch {
    return false;
  }
}

async function ensureParentDir(filePath) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
}

function readJsonFileSync(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function getOfficialMinecraftDir() {
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, ".minecraft");
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "minecraft");
  }

  return path.join(os.homedir(), ".minecraft");
}

function getDirectoryChildren(root) {
  try {
    if (!dirExistsSync(root)) return [];

    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function hasRuntimeCache(root) {
  if (!dirExistsSync(root)) return false;

  return (
    dirExistsSync(path.join(root, "assets")) ||
    dirExistsSync(path.join(root, "libraries")) ||
    dirExistsSync(path.join(root, "versions")) ||
    dirExistsSync(path.join(root, "cache"))
  );
}

async function collectRuntimeSeedRoots() {
  const runtimeRoot = storage.getRuntimeRootDir();
  const profilesRoot = storage.getProfilesRootDir();
  const legacyRoot = storage.getRootDir();
  const officialMinecraftDir = getOfficialMinecraftDir();

  const roots = [legacyRoot, officialMinecraftDir, ...getDirectoryChildren(profilesRoot)];

  try {
    const data = await profileService.listProfiles();

    for (const profile of data.profiles || []) {
      if (profile.gameDir) {
        roots.push(profile.gameDir);
      }
    }
  } catch {
    // Launch can continue without profile discovery.
  }

  return uniquePaths(roots).filter((root) => {
    if (samePath(root, runtimeRoot)) return false;
    if (samePath(root, profilesRoot)) return false;
    return hasRuntimeCache(root);
  });
}

function getRuntimeSeedMarkerPath() {
  return path.join(storage.getRuntimeRootDir(), ".launcher-runtime-seeded.json");
}

function getVersionJsonPath(root, versionId) {
  return path.join(root, "versions", versionId, `${versionId}.json`);
}

function getVersionDir(root, versionId) {
  return path.join(root, "versions", versionId);
}

function versionJsonExistsInRuntime(versionId) {
  if (!versionId) return true;
  return pathExistsSync(getVersionJsonPath(storage.getRuntimeRootDir(), versionId));
}

function readVersionJsonFromRoot(root, versionId) {
  if (!root || !versionId) return null;

  const versionDir = getVersionDir(root, versionId);
  const expectedPath = getVersionJsonPath(root, versionId);

  if (fs.existsSync(expectedPath)) {
    const json = readJsonFileSync(expectedPath, null);
    if (json) {
      return {
        id: versionId,
        path: expectedPath,
        root,
        json,
      };
    }
  }

  try {
    if (!fs.existsSync(versionDir)) return null;

    const jsonFile = fs
      .readdirSync(versionDir)
      .find((file) => file.toLowerCase().endsWith(".json"));

    if (!jsonFile) return null;

    const jsonPath = path.join(versionDir, jsonFile);
    const json = readJsonFileSync(jsonPath, null);

    if (!json) return null;

    return {
      id: json.id || versionId,
      path: jsonPath,
      root,
      json,
    };
  } catch {
    return null;
  }
}

function findVersionJson(versionId, sourceRoots = []) {
  const roots = uniquePaths([storage.getRuntimeRootDir(), ...sourceRoots]);

  for (const root of roots) {
    const found = readVersionJsonFromRoot(root, versionId);

    if (found) {
      return found;
    }
  }

  return null;
}

async function collectFilePairs(sourceDir, targetDir, window, label) {
  const pairs = [];
  const stack = [
    {
      source: sourceDir,
      target: targetDir,
    },
  ];

  let scannedFiles = 0;
  let scannedDirs = 0;
  let lastLog = Date.now();

  while (stack.length > 0) {
    const current = stack.pop();

    scannedDirs += 1;

    await fsp.mkdir(current.target, { recursive: true });

    let entries = [];

    try {
      entries = await fsp.readdir(current.source, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const source = path.join(current.source, entry.name);
      const target = path.join(current.target, entry.name);

      if (entry.isDirectory()) {
        stack.push({ source, target });
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      pairs.push({ source, target });
      scannedFiles += 1;

      const now = Date.now();

      if (now - lastLog >= SEED_PROGRESS_INTERVAL_MS) {
        lastLog = now;

        sendGameLog(
          window,
          `[launcher] Scanning ${label}: ${scannedFiles} file(s), ${scannedDirs} folder(s)...`
        );

        await sleepImmediate();
      }
    }

    if (scannedDirs % 100 === 0) {
      await sleepImmediate();
    }
  }

  sendGameLog(window, `[launcher] Scanned ${label}: ${scannedFiles} file(s).`);

  return pairs;
}

async function linkOrCopyFile(source, target, allowHardlink = true) {
  if (await pathExists(target)) {
    return {
      copied: false,
      bytes: 0,
    };
  }

  await ensureParentDir(target);

  try {
    if (allowHardlink) {
      await fsp.link(source, target);
    } else {
      await fsp.copyFile(source, target);
    }
  } catch (error) {
    if (error && error.code === "EEXIST") {
      return {
        copied: false,
        bytes: 0,
      };
    }

    try {
      await fsp.copyFile(source, target);
    } catch (copyError) {
      if (copyError && copyError.code === "EEXIST") {
        return {
          copied: false,
          bytes: 0,
        };
      }

      throw copyError;
    }
  }

  let bytes = 0;

  try {
    const stat = await fsp.stat(source);
    bytes = stat.size;
  } catch {
    bytes = 0;
  }

  return {
    copied: true,
    bytes,
  };
}

async function copyPairsConcurrently(pairs, window, label, options = {}) {
  const allowHardlink = options.allowHardlink !== false;
  const total = pairs.length;

  if (total === 0) {
    return {
      files: 0,
      bytes: 0,
      skipped: 0,
    };
  }

  let nextIndex = 0;
  let copiedFiles = 0;
  let skippedFiles = 0;
  let copiedBytes = 0;
  let lastLog = Date.now();

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= total) {
        return;
      }

      const pair = pairs[index];

      try {
        const result = await linkOrCopyFile(pair.source, pair.target, allowHardlink);

        if (result.copied) {
          copiedFiles += 1;
          copiedBytes += result.bytes;
        } else {
          skippedFiles += 1;
        }
      } catch {
        skippedFiles += 1;
      }

      const now = Date.now();

      if (now - lastLog >= SEED_PROGRESS_INTERVAL_MS) {
        lastLog = now;

        const done = copiedFiles + skippedFiles;
        const percent = Math.floor((done / total) * 100);

        sendGameLog(
          window,
          `[launcher] Preparing ${label}: ${done}/${total} (${percent}%) cached file(s)...`
        );

        await sleepImmediate();
      }
    }
  }

  const workers = [];
  const workerCount = Math.min(SEED_COPY_CONCURRENCY, total);

  for (let index = 0; index < workerCount; index += 1) {
    workers.push(worker());
  }

  await Promise.all(workers);

  sendGameLog(
    window,
    `[launcher] Prepared ${label}: ${copiedFiles} added, ${skippedFiles} already existed/skipped.`
  );

  return {
    files: copiedFiles,
    bytes: copiedBytes,
    skipped: skippedFiles,
  };
}

async function copyVersionDirFromRoots(versionId, sourceRoots, window) {
  if (!versionId) {
    return {
      files: 0,
      bytes: 0,
      skipped: 0,
    };
  }

  const targetDir = getVersionDir(storage.getRuntimeRootDir(), versionId);

  for (const sourceRoot of sourceRoots) {
    const sourceDir = getVersionDir(sourceRoot, versionId);

    if (!(await dirExists(sourceDir))) {
      continue;
    }

    const pairs = await collectFilePairs(sourceDir, targetDir, window, `version ${versionId}`);

    return copyPairsConcurrently(pairs, window, `version ${versionId}`, {
      allowHardlink: true,
    });
  }

  return {
    files: 0,
    bytes: 0,
    skipped: 0,
  };
}

async function seedNeededVersions(profile, customVersionId, sourceRoots, window) {
  const idsToSeed = uniquePaths([customVersionId, profile.minecraftVersion]);

  let totalFiles = 0;
  let totalBytes = 0;

  for (const versionId of idsToSeed) {
    const result = await copyVersionDirFromRoots(versionId, sourceRoots, window);
    totalFiles += result.files;
    totalBytes += result.bytes;
  }

  const discoveredIds = new Set(idsToSeed.filter(Boolean));

  for (let pass = 0; pass < 8; pass += 1) {
    let added = false;

    for (const versionId of Array.from(discoveredIds)) {
      const found = findVersionJson(versionId, sourceRoots);
      const inheritsFrom = found?.json?.inheritsFrom;

      if (inheritsFrom && !discoveredIds.has(inheritsFrom)) {
        discoveredIds.add(inheritsFrom);
        added = true;

        const result = await copyVersionDirFromRoots(inheritsFrom, sourceRoots, window);
        totalFiles += result.files;
        totalBytes += result.bytes;
      }
    }

    if (!added) {
      break;
    }
  }

  return {
    files: totalFiles,
    bytes: totalBytes,
    versionIds: Array.from(discoveredIds),
  };
}

function getVersionChain(versionIds, sourceRoots) {
  const result = [];
  const seen = new Set();

  for (const versionId of versionIds) {
    let currentId = versionId;

    for (let depth = 0; depth < 8; depth += 1) {
      if (!currentId || seen.has(currentId)) {
        break;
      }

      seen.add(currentId);

      const found = findVersionJson(currentId, sourceRoots);

      if (!found) {
        break;
      }

      result.push(found);

      currentId = found.json?.inheritsFrom || "";
    }
  }

  return result;
}

function findAssetIndexInfo(versionChain) {
  for (const item of versionChain) {
    const assetIndex = item?.json?.assetIndex;

    if (assetIndex && assetIndex.id) {
      return {
        id: String(assetIndex.id),
        url: assetIndex.url || "",
        sha1: assetIndex.sha1 || "",
      };
    }

    if (item?.json?.assets) {
      return {
        id: String(item.json.assets),
        url: "",
        sha1: "",
      };
    }
  }

  return null;
}

async function copyAssetIndexFromRoots(assetIndexId, sourceRoots, window) {
  if (!assetIndexId) {
    return null;
  }

  const targetPath = path.join(storage.getRuntimeAssetsDir(), "indexes", `${assetIndexId}.json`);

  if (await pathExists(targetPath)) {
    return targetPath;
  }

  for (const sourceRoot of sourceRoots) {
    const sourcePath = path.join(sourceRoot, "assets", "indexes", `${assetIndexId}.json`);

    if (!(await pathExists(sourcePath))) {
      continue;
    }

    await linkOrCopyFile(sourcePath, targetPath, true);

    sendGameLog(window, `[launcher] Prepared asset index ${assetIndexId}.`);

    return targetPath;
  }

  return null;
}

async function collectNeededAssetPairs(assetIndexPath, sourceRoots, window) {
  const indexJson = readJsonFileSync(assetIndexPath, null);

  if (!indexJson || !indexJson.objects || typeof indexJson.objects !== "object") {
    return [];
  }

  const hashes = Array.from(
    new Set(
      Object.values(indexJson.objects)
        .map((entry) => entry?.hash)
        .filter(Boolean)
        .map((hash) => String(hash))
    )
  );

  const pairs = [];
  const runtimeAssetsDir = storage.getRuntimeAssetsDir();

  let checked = 0;
  let found = 0;
  let lastLog = Date.now();

  for (const hash of hashes) {
    checked += 1;

    const prefix = hash.slice(0, 2);
    const target = path.join(runtimeAssetsDir, "objects", prefix, hash);

    if (await pathExists(target)) {
      found += 1;
      continue;
    }

    for (const sourceRoot of sourceRoots) {
      const source = path.join(sourceRoot, "assets", "objects", prefix, hash);

      if (await pathExists(source)) {
        pairs.push({ source, target });
        found += 1;
        break;
      }
    }

    const now = Date.now();

    if (now - lastLog >= SEED_PROGRESS_INTERVAL_MS) {
      lastLog = now;

      sendGameLog(
        window,
        `[launcher] Finding needed assets: ${checked}/${hashes.length}, ${found} found locally...`
      );

      await sleepImmediate();
    }
  }

  sendGameLog(
    window,
    `[launcher] Asset index requires ${hashes.length} object(s); ${found} found locally, ${pairs.length} need preparing.`
  );

  return pairs;
}

async function seedNeededAssets(assetIndexInfo, sourceRoots, window) {
  if (!assetIndexInfo || !assetIndexInfo.id) {
    sendGameLog(window, "[launcher] Could not determine asset index. MCLC will handle assets.");
    return {
      files: 0,
      bytes: 0,
      skipped: 0,
      assetIndexId: null,
    };
  }

  const assetIndexPath = await copyAssetIndexFromRoots(assetIndexInfo.id, sourceRoots, window);

  if (!assetIndexPath) {
    sendGameLog(
      window,
      `[launcher] Asset index ${assetIndexInfo.id} was not found locally. MCLC will download/check assets.`
    );

    return {
      files: 0,
      bytes: 0,
      skipped: 0,
      assetIndexId: assetIndexInfo.id,
    };
  }

  const pairs = await collectNeededAssetPairs(assetIndexPath, sourceRoots, window);

  const result = await copyPairsConcurrently(
    pairs,
    window,
    `assets for index ${assetIndexInfo.id}`,
    {
      allowHardlink: true,
    }
  );

  return {
    ...result,
    assetIndexId: assetIndexInfo.id,
  };
}

async function seedLibraries(sourceRoots, window) {
  let totalFiles = 0;
  let totalBytes = 0;
  let totalSkipped = 0;

  for (const sourceRoot of sourceRoots) {
    const sourceDir = path.join(sourceRoot, "libraries");

    if (!(await dirExists(sourceDir))) {
      continue;
    }

    const pairs = await collectFilePairs(
      sourceDir,
      storage.getRuntimeLibrariesDir(),
      window,
      `libraries from ${path.basename(sourceRoot) || sourceRoot}`
    );

    const result = await copyPairsConcurrently(
      pairs,
      window,
      `libraries from ${path.basename(sourceRoot) || sourceRoot}`,
      {
        allowHardlink: true,
      }
    );

    totalFiles += result.files;
    totalBytes += result.bytes;
    totalSkipped += result.skipped;
  }

  return {
    files: totalFiles,
    bytes: totalBytes,
    skipped: totalSkipped,
  };
}

async function seedCache(sourceRoots, window) {
  let totalFiles = 0;
  let totalBytes = 0;
  let totalSkipped = 0;

  for (const sourceRoot of sourceRoots) {
    const sourceDir = path.join(sourceRoot, "cache");

    if (!(await dirExists(sourceDir))) {
      continue;
    }

    const pairs = await collectFilePairs(
      sourceDir,
      storage.getRuntimeCacheDir(),
      window,
      `cache from ${path.basename(sourceRoot) || sourceRoot}`
    );

    const result = await copyPairsConcurrently(
      pairs,
      window,
      `cache from ${path.basename(sourceRoot) || sourceRoot}`,
      {
        allowHardlink: true,
      }
    );

    totalFiles += result.files;
    totalBytes += result.bytes;
    totalSkipped += result.skipped;
  }

  return {
    files: totalFiles,
    bytes: totalBytes,
    skipped: totalSkipped,
  };
}

function runtimeLooksReady(profile, customVersionId) {
  const markerPath = getRuntimeSeedMarkerPath();

  if (!fs.existsSync(markerPath)) {
    return false;
  }

  if (!dirExistsSync(storage.getRuntimeLibrariesDir())) {
    return false;
  }

  if (!dirExistsSync(storage.getRuntimeAssetsDir())) {
    return false;
  }

  if (customVersionId && !versionJsonExistsInRuntime(customVersionId)) {
    return false;
  }

  const mainVersion = profile.minecraftVersion;

  if (mainVersion && !versionJsonExistsInRuntime(mainVersion)) {
    // Custom Fabric versions often inherit from the main version, but if MCLC
    // already cached everything then this can be false only on old/incomplete cache.
    return false;
  }

  const indexesDir = path.join(storage.getRuntimeAssetsDir(), "indexes");
  const objectsDir = path.join(storage.getRuntimeAssetsDir(), "objects");

  return dirExistsSync(indexesDir) && dirExistsSync(objectsDir);
}

async function seedSharedRuntimeCaches(profile, customVersionId, window) {
  const runtimeRoot = storage.getRuntimeRootDir();

  storage.ensureRuntimeDirs();

  if (runtimeLooksReady(profile, customVersionId)) {
    return;
  }

  sendGameLog(window, "[launcher] Preparing shared runtime cache. First launch may take longer.");

  const sourceRoots = await collectRuntimeSeedRoots();

  if (sourceRoots.length === 0) {
    sendGameLog(
      window,
      "[launcher] No existing runtime cache found. Minecraft will download required files once."
    );

    await fsp.writeFile(
      getRuntimeSeedMarkerPath(),
      JSON.stringify(
        {
          seededAt: new Date().toISOString(),
          files: 0,
          bytes: 0,
          runtimeRoot,
          sources: [],
        },
        null,
        2
      ),
      "utf8"
    );

    return;
  }

  for (const sourceRoot of sourceRoots) {
    sendGameLog(window, `[launcher] Cache source available: ${sourceRoot}`);
  }

  let totalFiles = 0;
  let totalBytes = 0;
  let totalSkipped = 0;

  const versionResult = await seedNeededVersions(profile, customVersionId, sourceRoots, window);

  totalFiles += versionResult.files;
  totalBytes += versionResult.bytes;

  const versionChain = getVersionChain(
    uniquePaths([customVersionId, profile.minecraftVersion, ...versionResult.versionIds]),
    sourceRoots
  );

  const assetIndexInfo = findAssetIndexInfo(versionChain);
  const assetResult = await seedNeededAssets(assetIndexInfo, sourceRoots, window);

  totalFiles += assetResult.files;
  totalBytes += assetResult.bytes;
  totalSkipped += assetResult.skipped || 0;

  const libraryResult = await seedLibraries(sourceRoots, window);

  totalFiles += libraryResult.files;
  totalBytes += libraryResult.bytes;
  totalSkipped += libraryResult.skipped || 0;

  const cacheResult = await seedCache(sourceRoots, window);

  totalFiles += cacheResult.files;
  totalBytes += cacheResult.bytes;
  totalSkipped += cacheResult.skipped || 0;

  await fsp.writeFile(
    getRuntimeSeedMarkerPath(),
    JSON.stringify(
      {
        seededAt: new Date().toISOString(),
        files: totalFiles,
        bytes: totalBytes,
        skipped: totalSkipped,
        runtimeRoot,
        assetIndexId: assetResult.assetIndexId || null,
        versionIds: versionResult.versionIds || [],
        sources: sourceRoots,
      },
      null,
      2
    ),
    "utf8"
  );

  sendGameLog(
    window,
    `[launcher] Shared runtime cache ready. Added ${totalFiles} file(s), skipped ${totalSkipped}.`
  );
}

function getCustomVersionId(profile, installedCustomVersionId = "") {
  if (installedCustomVersionId) {
    return installedCustomVersionId;
  }

  if (profile.customVersionId) {
    return profile.customVersionId;
  }

  return "";
}

function copyMatchingJarIfPresent(sourceJsonPath, versionId, json, versionsRoot) {
  const sourceDir = path.dirname(sourceJsonPath);

  const candidates = [
    path.join(sourceDir, `${versionId}.jar`),
    json.id ? path.join(sourceDir, `${json.id}.jar`) : "",
  ].filter(Boolean);

  const sourceJar = candidates.find((candidate) => fs.existsSync(candidate));
  if (!sourceJar) return;

  const targetDir = path.join(versionsRoot, versionId);
  const targetJar = path.join(targetDir, `${versionId}.jar`);

  storage.ensureDir(targetDir);
  fs.copyFileSync(sourceJar, targetJar);
}

function installCustomVersionJson(profile) {
  if (!profile.customVersionJsonPath) return "";

  if (!fs.existsSync(profile.customVersionJsonPath)) {
    throw new Error("Custom version JSON was selected but does not exist.");
  }

  const raw = fs.readFileSync(profile.customVersionJsonPath, "utf8");
  const json = JSON.parse(raw);

  const versionId = profile.customVersionId || json.id;

  if (!versionId) {
    throw new Error("Custom version JSON must contain an id, or set Custom Version ID.");
  }

  const versionsRoot = storage.getRuntimeVersionsDir();
  const versionDir = path.join(versionsRoot, versionId);

  storage.ensureDir(versionDir);

  const targetJson = path.join(versionDir, `${versionId}.json`);

  fs.writeFileSync(targetJson, JSON.stringify({ ...json, id: versionId }, null, 2), "utf8");

  copyMatchingJarIfPresent(profile.customVersionJsonPath, versionId, json, versionsRoot);

  return versionId;
}

function buildVersionOptions(profile, customVersionId) {
  const minecraftVersion = profile.minecraftVersion || customVersionId;

  if (!minecraftVersion) {
    throw new Error("Profile is missing minecraftVersion.");
  }

  const versionOptions = {
    number: minecraftVersion,
    type: profile.versionType || "release",
  };

  if (customVersionId) {
    versionOptions.custom = customVersionId;
  }

  return versionOptions;
}

function sanitizeLauncherLog(line) {
  let text = String(line || "");

  text = text.replace(/--accessToken\s+\S+/g, "--accessToken <hidden>");
  text = text.replace(/--clientId\s+\S+/g, "--clientId <hidden>");
  text = text.replace(/--xuid\s+\S+/g, "--xuid <hidden>");

  if (text.includes("[MCLC]: Launching with arguments")) {
    return "[MCLC]: Launching Minecraft. Full classpath hidden to keep console fast.";
  }

  return text;
}

function createProgressLogger(log) {
  const lastBucketByType = new Map();

  return (progress) => {
    const type = String(progress?.type || "progress");
    const task = Number(progress?.task || 0);
    const total = Number(progress?.total || 0);

    if (total > 0) {
      const percent = Math.floor((task / total) * 100);
      const bucket = Math.floor(percent / PROGRESS_PERCENT_STEP) * PROGRESS_PERCENT_STEP;
      const previousBucket = lastBucketByType.get(type);

      if (task < total && previousBucket === bucket) {
        return;
      }

      lastBucketByType.set(type, bucket);
      log(`[progress] ${JSON.stringify(progress)}`);
      return;
    }

    const previousTask = lastBucketByType.get(type);

    if (previousTask === task) {
      return;
    }

    lastBucketByType.set(type, task);
    log(`[progress] ${JSON.stringify(progress)}`);
  };
}

function createDownloadLogger(log) {
  let count = 0;
  let lastLog = 0;
  let lastName = "";

  return (download) => {
    count += 1;
    lastName = String(download || "");

    const now = Date.now();

    if (now - lastLog < DOWNLOAD_LOG_INTERVAL_MS) {
      return;
    }

    lastLog = now;

    log(`[download] ${count} file(s) checked/downloaded. Latest: ${lastName}`);
  };
}

function sendInstanceLog(window, instance, message) {
  if (!window || window.isDestroyed()) return;

  window.webContents.send("instance:log", {
    instanceId: instance.instanceId,
    line: String(message ?? ""),
  });
}

function publicInstance(instance) {
  return {
    instanceId: instance.instanceId,
    number: instance.number,
    profileId: instance.profileId,
    profileName: instance.profileName,
    minecraftVersion: instance.minecraftVersion,
    versionId: instance.versionId,
    status: instance.status,
    pid: instance.child?.pid || null,
    startedAt: instance.startedAt,
  };
}

function listInstances() {
  return Array.from(instances.values()).map(publicInstance);
}

function notifyInstancesChanged(window) {
  const list = listInstances();

  if (window && !window.isDestroyed()) {
    window.webContents.send("launcher:instances", list);
  }

  for (const listener of instanceListeners) {
    try {
      listener(list);
    } catch (error) {
      console.warn("[launcher] Instance listener failed:", error.message || error);
    }
  }
}

function onInstancesChanged(listener) {
  instanceListeners.add(listener);
  return () => instanceListeners.delete(listener);
}

function isRunning(profileId = null) {
  if (!profileId) return instances.size > 0;

  return Array.from(instances.values()).some((instance) => instance.profileId === profileId);
}

function runPrepared(task) {
  const run = preparationQueue.then(task, task);
  preparationQueue = run.catch(() => {});
  return run;
}

async function launch(profileId, window) {
  const launchStartTime = Date.now();

  const profile = await profileService.getProfileById(profileId);
  await authService.refreshActiveAccountIfNeeded();
  const authorization = authService.getLaunchAuth();

  const instance = {
    instanceId: `${Date.now().toString(36)}-${nextInstanceNumber}`,
    number: nextInstanceNumber,
    profileId: profile.id,
    profileName: profile.name,
    minecraftVersion: profile.minecraftVersion,
    versionId: profile.customVersionId || profile.minecraftVersion,
    status: "preparing",
    startedAt: launchStartTime,
    child: null,
    killRequested: false,
  };

  nextInstanceNumber += 1;
  instances.set(instance.instanceId, instance);
  notifyInstancesChanged(window);

  const log = (message) => sendInstanceLog(window, instance, message);

  const removeInstance = (code) => {
    if (!instances.has(instance.instanceId)) return;

    instances.delete(instance.instanceId);

    if (window && !window.isDestroyed()) {
      window.webContents.send("game:close", {
        instanceId: instance.instanceId,
        profileId: instance.profileId,
        profileName: instance.profileName,
        code,
      });
    }

    notifyInstancesChanged(window);
  };

  const otherRunning = instances.size - 1;

  if (otherRunning > 0) {
    log(
      `[launcher] ${otherRunning} other instance(s) running. Waiting for shared files to be ready...`
    );
  }

  try {
    const result = await runPrepared(async () => {
      if (instance.killRequested) {
        throw new Error("Launch was cancelled.");
      }

      const shared = sharedFolders.applyToGameDir(profile.gameDir, {
        profileId: profile.id,
        unlinkDisabled: false,
      });
      shared.logs.forEach((line) => log(`[shared] ${line}`));
      shared.errors.forEach((line) => log(`[shared] Could not share ${line}`));

      storage.ensureProfileRuntimeDirs(profile.gameDir);
      storage.ensureRuntimeDirs();

      const installedCustomVersionId = installCustomVersionJson(profile);
      const customVersionId = getCustomVersionId(profile, installedCustomVersionId);

      instance.versionId = customVersionId || profile.minecraftVersion;

      await seedSharedRuntimeCaches(profile, customVersionId, window);

      const runtimeRoot = storage.getRuntimeRootDir();
      const profileRoot = profile.gameDir;
      const versionOptions = buildVersionOptions(profile, customVersionId);

      const client = new Client();

      let launchFailedMessage = "";
      const logProgress = createProgressLogger(log);
      const logDownload = createDownloadLogger(log);

      client.on("debug", (line) => {
        const text = sanitizeLauncherLog(line);
        log(`[debug] ${text}`);

        if (text.includes("Failed to start")) {
          launchFailedMessage = text;
        }
      });

      client.on("data", (line) => {
        log(String(line));
      });

      client.on("progress", (progress) => {
        logProgress(progress);
      });

      client.on("download", (download) => {
        const text = String(download || "");

        if (/^[a-f0-9]{40}$/i.test(text)) {
          return;
        }

        logDownload(download);
      });

      client.on("close", (code) => {
        log(`[close] Minecraft exited with code ${code}`);
        removeInstance(code);
      });

      const options = {
        authorization,

        root: runtimeRoot,

        version: versionOptions,

        memory: {
          min: profile.minMemory || "2G",
          max: profile.maxMemory || "4G",
        },

        window: {
          width: Number(profile.width || 854),
          height: Number(profile.height || 480),
          fullscreen: Boolean(profile.fullscreen),
        },

        overrides: {
          gameDirectory: profileRoot,
        },
      };

      options.javaPath = await javaRuntime.resolveJavaForLaunch(profile, customVersionId, log);

      if (profile.forgeInstallerPath && fs.existsSync(profile.forgeInstallerPath)) {
        options.forge = profile.forgeInstallerPath;
        log(`Loader installer: ${path.basename(profile.forgeInstallerPath)}`);
      }

      const jvmArgs = splitArgs(profile.extraJvmArgs);
      const mcArgs = splitArgs(profile.extraMcArgs);

      if (jvmArgs.length > 0) {
        options.jvmArgs = jvmArgs;
      }

      if (mcArgs.length > 0) {
        options.customArgs = mcArgs;
      }

      log(`Launching profile: ${profile.name} (instance #${instance.number})`);
      log(`Minecraft version: ${profile.minecraftVersion}`);
      log(`Custom version ID: ${customVersionId || "none"}`);
      log(`Shared runtime root: ${runtimeRoot}`);
      log(`Profile game directory: ${profileRoot}`);
      log(`Loader type: ${profile.loaderType}`);
      log(`Launch version options: ${JSON.stringify(versionOptions)}`);

      const child = await client.launch(options);

      log(
        `[timer] launcher.launch() returned after ${Math.round((Date.now() - launchStartTime) / 1000)}s`
      );

      if (launchFailedMessage) {
        throw new Error(launchFailedMessage);
      }

      if (!child) {
        throw new Error("Minecraft failed to start. No game process was returned.");
      }

      return { child, customVersionId };
    });

    instance.child = result.child;
    instance.status = "running";

    if (instance.killRequested) {
      result.child.kill();
    }

    notifyInstancesChanged(window);

    return {
      ok: true,
      instanceId: instance.instanceId,
      instanceNumber: instance.number,
      profileId: profile.id,
      profileName: profile.name,
      minecraftVersion: profile.minecraftVersion,
      customVersionId: result.customVersionId,
      versionId: instance.versionId,
    };
  } catch (error) {
    const message = error.message || String(error);
    log(`[launcher error] ${message}`);

    removeInstance(-1);

    throw error;
  }
}

async function checkJava(profileId) {
  const profile = await profileService.getProfileById(profileId);
  const customVersionId = getCustomVersionId(profile, "");

  return javaRuntime.checkJava(profile, customVersionId);
}

async function kill(instanceId = null) {
  const targets = instanceId
    ? [instances.get(instanceId)].filter(Boolean)
    : Array.from(instances.values());

  if (targets.length === 0) {
    return { ok: false, killed: 0 };
  }

  for (const instance of targets) {
    instance.killRequested = true;

    if (instance.child && typeof instance.child.kill === "function") {
      instance.child.kill();
    }
  }

  return { ok: true, killed: targets.length };
}

module.exports = {
  launch,
  checkJava,
  isRunning,
  listInstances,
  onInstancesChanged,
  kill,
};
