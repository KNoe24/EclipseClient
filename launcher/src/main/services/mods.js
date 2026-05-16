const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const https = require("https");
const { URL, URLSearchParams } = require("url");

const storage = require("./storage");
const profileService = require("./profiles");

const MODRINTH_API_BASE = "https://api.modrinth.com";
const MODRINTH_USER_AGENT = "eclipse-client/1.0";

function getModsDir(profile) {
  return storage.getProfileModsDir(profile.gameDir);
}

function safeModPath(modsDir, filename) {
  const clean = path.basename(filename);
  const full = path.resolve(modsDir, clean);
  const root = path.resolve(modsDir);

  if (!full.startsWith(root + path.sep)) {
    throw new Error("Invalid mod filename.");
  }

  return full;
}

function requestBuffer(urlString, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error("Too many redirects."));
      return;
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(urlString);
    } catch {
      reject(new Error("Invalid URL."));
      return;
    }

    if (parsedUrl.protocol !== "https:") {
      reject(new Error("Only HTTPS downloads are allowed."));
      return;
    }

    const req = https.get(
      parsedUrl,
      {
        headers: {
          "User-Agent": MODRINTH_USER_AGENT,
          Accept: "application/json",
        },
      },
      (response) => {
        const statusCode = response.statusCode || 0;

        if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
          response.resume();

          const redirectUrl = new URL(response.headers.location, parsedUrl);
          requestBuffer(redirectUrl.toString(), redirectCount + 1)
            .then(resolve)
            .catch(reject);

          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`Request failed with HTTP ${statusCode}.`));
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

    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error("Request timed out."));
    });
  });
}

async function getJson(urlPath) {
  const buffer = await requestBuffer(`${MODRINTH_API_BASE}${urlPath}`);
  return JSON.parse(buffer.toString("utf8"));
}

async function downloadFile(urlString, targetPath) {
  const tempPath = `${targetPath}.download`;

  try {
    const buffer = await requestBuffer(urlString);

    if (!buffer || buffer.length === 0) {
      throw new Error("Downloaded file was empty.");
    }

    await fsp.writeFile(tempPath, buffer);
    await fsp.rename(tempPath, targetPath);

    return true;
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

function extractCollectionId(collectionInput) {
  const value = String(collectionInput || "").trim();

  if (!value) {
    throw new Error("Modrinth collection URL or ID is required.");
  }

  const match = value.match(/(?:https?:\/\/)?(?:www\.)?modrinth\.com\/collection\/([^/?#\s]+)/);

  const collectionId = match ? match[1] : value;

  if (!/^[A-Za-z0-9]+$/.test(collectionId)) {
    throw new Error("Invalid Modrinth collection ID.");
  }

  return collectionId;
}

function normalizeCollectionProjectIds(collection) {
  const projects = Array.isArray(collection?.projects) ? collection.projects : [];

  return projects
    .map((project) => {
      if (typeof project === "string") return project;
      return project?.id || project?.project_id || project?.projectId || project?.slug || "";
    })
    .map((projectId) => String(projectId || "").trim())
    .filter(Boolean);
}

function getExistingMods(directory) {
  if (!fs.existsSync(directory)) {
    return {};
  }

  const existingMods = {};

  for (const item of fs.readdirSync(directory)) {
    const itemPath = path.join(directory, item);

    if (!fs.statSync(itemPath).isFile()) {
      continue;
    }

    const lower = item.toLowerCase();

    if (!lower.endsWith(".jar") && !lower.endsWith(".nojar")) {
      continue;
    }

    const parts = item.split(".");

    if (parts.length < 3) {
      continue;
    }

    const modId = parts[parts.length - 2];

    existingMods[modId] = {
      id: modId,
      filename: item,
      enabled: lower.endsWith(".jar"),
    };
  }

  return existingMods;
}

function getPrimaryFile(versionData) {
  const files = Array.isArray(versionData?.files) ? versionData.files : [];

  return (
    files.find((file) => file.primary && file.url && file.filename) ||
    files.find((file) => file.url && file.filename) ||
    null
  );
}

function makeFilenameWithProjectId(filename, projectId, enabled = true) {
  const ext = path.extname(filename) || ".jar";
  const base = filename.slice(0, filename.length - ext.length);

  if (enabled) {
    return `${base}.${projectId}${ext}`;
  }

  return `${base}.${projectId}.nojar`;
}

function sortVersionsNewestFirst(versions) {
  return [...versions].sort((a, b) => {
    const aTime = Date.parse(a.date_published || a.created_at || "") || 0;
    const bTime = Date.parse(b.date_published || b.created_at || "") || 0;
    return bTime - aTime;
  });
}

async function getLatestCompatibleVersion(projectId, minecraftVersion, loader) {
  const params = new URLSearchParams({
    game_versions: JSON.stringify([minecraftVersion]),
    loaders: JSON.stringify([loader]),
    include_changelog: "false",
  });

  const versions = await getJson(
    `/v2/project/${encodeURIComponent(projectId)}/version?${params.toString()}`
  );

  if (!Array.isArray(versions) || versions.length === 0) {
    return null;
  }

  return sortVersionsNewestFirst(versions)[0];
}

function getRequiredDependencyProjectIds(versionData) {
  const dependencies = Array.isArray(versionData?.dependencies) ? versionData.dependencies : [];

  return dependencies
    .filter((dependency) => dependency?.dependency_type === "required")
    .map((dependency) => dependency.project_id)
    .filter(Boolean);
}

async function processModrinthProject({
  projectId,
  modsDir,
  minecraftVersion,
  loader,
  existingMods,
  processedMods,
  stats,
  logs,
  failedMods,
  isDependency = false,
  parentProjectId = "",
}) {
  if (processedMods.has(projectId)) {
    return;
  }

  processedMods.add(projectId);

  const labelPrefix = isDependency ? "[dependency] " : "";

  try {
    const existingMod = existingMods[projectId] || null;
    const latestVersion = await getLatestCompatibleVersion(projectId, minecraftVersion, loader);

    if (!latestVersion) {
      const message = `${labelPrefix}No compatible version found for ${projectId} (${minecraftVersion}, ${loader})${
        parentProjectId ? ` required by ${parentProjectId}` : ""
      }.`;

      logs.push(message);
      failedMods.push(projectId);
      stats.failed += 1;

      return;
    }

    const requiredDependencies = getRequiredDependencyProjectIds(latestVersion);

    for (const dependencyProjectId of requiredDependencies) {
      await processModrinthProject({
        projectId: dependencyProjectId,
        modsDir,
        minecraftVersion,
        loader,
        existingMods,
        processedMods,
        stats,
        logs,
        failedMods,
        isDependency: true,
        parentProjectId: projectId,
      });
    }

    const primaryFile = getPrimaryFile(latestVersion);

    if (!primaryFile) {
      logs.push(`${labelPrefix}No downloadable primary file found for ${projectId}.`);
      failedMods.push(projectId);
      stats.failed += 1;
      return;
    }

    const shouldStayEnabled = existingMod ? existingMod.enabled : true;
    const targetFilename = makeFilenameWithProjectId(
      primaryFile.filename,
      projectId,
      shouldStayEnabled
    );

    const targetPath = safeModPath(modsDir, targetFilename);

    if (existingMod && existingMod.filename === targetFilename) {
      logs.push(`${labelPrefix}Skipped ${projectId}; latest file already installed.`);
      stats.skipped += 1;
      return;
    }

    if (!existingMod && fs.existsSync(targetPath)) {
      logs.push(`${labelPrefix}Skipped ${projectId}; target file already exists.`);
      stats.skipped += 1;
      return;
    }

    await downloadFile(primaryFile.url, targetPath);

    if (existingMod && existingMod.filename !== targetFilename) {
      const oldPath = safeModPath(modsDir, existingMod.filename);
      await fsp.rm(oldPath, { force: true }).catch(() => {});
      stats.updated += 1;
      logs.push(`${labelPrefix}Updated ${projectId}: ${existingMod.filename} → ${targetFilename}`);
    } else {
      logs.push(`${labelPrefix}Downloaded ${projectId}: ${targetFilename}`);
    }

    existingMods[projectId] = {
      id: projectId,
      filename: targetFilename,
      enabled: shouldStayEnabled,
    };

    stats.downloaded += 1;
  } catch (error) {
    const message = `${labelPrefix}Failed ${projectId}: ${error.message || error}`;

    logs.push(message);
    failedMods.push(projectId);
    stats.failed += 1;
  }
}

async function listMods(profileId) {
  const profile = await profileService.getProfileById(profileId);
  const modsDir = getModsDir(profile);

  const files = fs
    .readdirSync(modsDir)
    .filter((file) => {
      const lower = file.toLowerCase();
      return lower.endsWith(".jar") || lower.endsWith(".nojar");
    })
    .map((file) => {
      const full = path.join(modsDir, file);
      const stat = fs.statSync(full);
      const enabled = file.toLowerCase().endsWith(".jar");

      return {
        filename: file,
        displayName: enabled ? file : file.replace(/\.nojar$/i, ".jar"),
        path: full,
        enabled,
        sizeBytes: stat.size,
        updatedAt: stat.mtime.toISOString(),
      };
    });

  return files;
}

async function addMods(profileId, filePaths = []) {
  const profile = await profileService.getProfileById(profileId);
  const modsDir = getModsDir(profile);

  const added = [];

  for (const source of filePaths) {
    if (!source || !source.toLowerCase().endsWith(".jar")) continue;

    const filename = path.basename(source);
    const target = path.join(modsDir, filename);

    fs.copyFileSync(source, target);

    added.push({
      filename,
      path: target,
      enabled: true,
    });
  }

  return added;
}

async function updateFromModrinthCollection(profileId, collectionInput) {
  const profile = await profileService.getProfileById(profileId);
  const modsDir = getModsDir(profile);

  const minecraftVersion = String(profile.minecraftVersion || "").trim();
  const loader = String(profile.loaderType || "")
    .trim()
    .toLowerCase();

  if (!minecraftVersion) {
    throw new Error("This installation does not have a Minecraft version set.");
  }

  if (!loader || loader === "vanilla") {
    throw new Error(
      "Modrinth mod updates require a mod loader installation, such as fabric, forge, quilt, or neoforge."
    );
  }

  const collectionId = extractCollectionId(collectionInput);
  const collection = await getJson(`/v3/collection/${encodeURIComponent(collectionId)}`);
  const projectIds = normalizeCollectionProjectIds(collection);

  if (projectIds.length === 0) {
    throw new Error("That Modrinth collection has no projects.");
  }

  const existingMods = getExistingMods(modsDir);
  const processedMods = new Set();
  const logs = [];
  const failedMods = [];

  const stats = {
    collectionTotal: projectIds.length,
    downloaded: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };

  logs.push(
    `Found ${projectIds.length} project(s) in collection ${collectionId}. Target: Minecraft ${minecraftVersion}, loader ${loader}.`
  );

  for (const projectId of projectIds) {
    await processModrinthProject({
      projectId,
      modsDir,
      minecraftVersion,
      loader,
      existingMods,
      processedMods,
      stats,
      logs,
      failedMods,
    });
  }

  return {
    ok: stats.failed === 0,
    collectionId,
    minecraftVersion,
    loader,
    stats,
    logs,
    failedMods,
  };
}

async function setModEnabled(profileId, filename, enabled) {
  const profile = await profileService.getProfileById(profileId);
  const modsDir = getModsDir(profile);

  const currentFile = safeModPath(modsDir, filename);

  if (!fs.existsSync(currentFile)) {
    throw new Error("Mod file not found.");
  }

  const cleanName = path.basename(filename);
  const lower = cleanName.toLowerCase();

  let targetName = cleanName;

  if (enabled && lower.endsWith(".nojar")) {
    targetName = cleanName.replace(/\.nojar$/i, ".jar");
  }

  if (!enabled && lower.endsWith(".jar")) {
    targetName = cleanName.replace(/\.jar$/i, ".nojar");
  }

  const targetFile = safeModPath(modsDir, targetName);

  if (currentFile === targetFile) {
    return {
      ok: true,
      filename: targetName,
    };
  }

  if (fs.existsSync(targetFile)) {
    throw new Error("A mod with that target filename already exists.");
  }

  fs.renameSync(currentFile, targetFile);

  return {
    ok: true,
    filename: targetName,
  };
}

async function removeMod(profileId, filename) {
  const profile = await profileService.getProfileById(profileId);
  const modsDir = getModsDir(profile);

  const file = safeModPath(modsDir, filename);

  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }

  return { ok: true };
}

module.exports = {
  listMods,
  addMods,
  updateFromModrinthCollection,
  setModEnabled,
  removeMod,
};
