const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
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

function postJson(urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = https.request(
      `${MODRINTH_API_BASE}${urlPath}`,
      {
        method: "POST",
        headers: {
          "User-Agent": MODRINTH_USER_AGENT,
          Accept: "application/json",
          "Content-Type": "application/json",
          "Content-Length": payload.length,
        },
      },
      (response) => {
        const statusCode = response.statusCode || 0;
        const chunks = [];

        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`Request failed with HTTP ${statusCode}.`));
            return;
          }

          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error("Request timed out."));
    });
    req.end(payload);
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

const fileHashCache = new Map();
const hashProjectCache = new Map();

function sha1OfFile(filePath, stat) {
  const key = `${filePath}|${stat.size}|${stat.mtimeMs}`;

  if (!fileHashCache.has(key)) {
    fileHashCache.set(
      key,
      crypto.createHash("sha1").update(fs.readFileSync(filePath)).digest("hex")
    );
  }

  return fileHashCache.get(key);
}

async function getInstalledProjects(modsDir) {
  const installed = {};

  for (const mod of Object.values(getExistingMods(modsDir))) {
    installed[mod.id] = { ...mod, source: "filename" };
  }

  if (!fs.existsSync(modsDir)) {
    return installed;
  }

  const byHash = new Map();

  for (const item of fs.readdirSync(modsDir)) {
    const lower = item.toLowerCase();
    if (!lower.endsWith(".jar") && !lower.endsWith(".nojar")) continue;

    const full = path.join(modsDir, item);

    try {
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;
      byHash.set(sha1OfFile(full, stat), { filename: item, enabled: lower.endsWith(".jar") });
    } catch {
      continue;
    }
  }

  const unknown = [...byHash.keys()].filter((hash) => !hashProjectCache.has(hash));

  if (unknown.length) {
    try {
      const result = await postJson("/v2/version_files", { hashes: unknown, algorithm: "sha1" });

      for (const hash of unknown) {
        hashProjectCache.set(hash, result?.[hash]?.project_id || "");
      }
    } catch {
      return installed;
    }
  }

  for (const [hash, file] of byHash) {
    const projectId = hashProjectCache.get(hash);

    if (projectId && !installed[projectId]) {
      installed[projectId] = { id: projectId, ...file, source: "hash" };
    }
  }

  return installed;
}

async function resolveDependencyProjectId(dependency) {
  if (dependency?.project_id) return dependency.project_id;

  if (dependency?.version_id) {
    try {
      const version = await getJson(`/v2/version/${encodeURIComponent(dependency.version_id)}`);
      return version?.project_id || "";
    } catch {
      return "";
    }
  }

  return "";
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
  withDependencies = true,
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

    for (const dependencyProjectId of withDependencies ? requiredDependencies : []) {
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

const MODRINTH_SORTS = new Set(["relevance", "downloads", "follows", "newest", "updated"]);

function getModrinthTarget(profile) {
  const minecraftVersion = String(profile.minecraftVersion || "").trim();
  const loader = String(profile.loaderType || "")
    .trim()
    .toLowerCase();

  if (!minecraftVersion) {
    throw new Error("This installation does not have a Minecraft version set.");
  }

  if (!loader || loader === "vanilla") {
    throw new Error(
      "Modrinth mods need a mod loader installation, such as fabric, forge, quilt, or neoforge."
    );
  }

  return { minecraftVersion, loader };
}

async function searchModrinth(profileId, options = {}) {
  const profile = await profileService.getProfileById(profileId);
  const { minecraftVersion, loader } = getModrinthTarget(profile);

  const query = String(options.query || "")
    .trim()
    .slice(0, 200);
  const index = MODRINTH_SORTS.has(options.sort) ? options.sort : "relevance";
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50);
  const offset = Math.max(Number(options.offset) || 0, 0);

  const facets = [["project_type:mod"], [`categories:${loader}`], [`versions:${minecraftVersion}`]];

  const params = new URLSearchParams({
    query,
    index,
    limit: String(limit),
    offset: String(offset),
    facets: JSON.stringify(facets),
  });

  const result = await getJson(`/v2/search?${params.toString()}`);
  const installed = await getInstalledProjects(getModsDir(profile));

  const hits = (Array.isArray(result?.hits) ? result.hits : []).map((hit) => ({
    projectId: hit.project_id,
    slug: hit.slug,
    title: hit.title || hit.slug || hit.project_id,
    author: hit.author || "",
    description: hit.description || "",
    iconUrl: hit.icon_url || "",
    downloads: Number(hit.downloads) || 0,
    follows: Number(hit.follows) || 0,
    categories: Array.isArray(hit.display_categories)
      ? hit.display_categories
      : Array.isArray(hit.categories)
        ? hit.categories
        : [],
    clientSide: hit.client_side || "",
    serverSide: hit.server_side || "",
    updatedAt: hit.date_modified || "",
    installed: Boolean(installed[hit.project_id]),
    installedEnabled: Boolean(installed[hit.project_id]?.enabled),
  }));

  return {
    hits,
    offset: Number(result?.offset) || offset,
    limit: Number(result?.limit) || limit,
    total: Number(result?.total_hits) || 0,
    minecraftVersion,
    loader,
  };
}

function validProjectId(projectId) {
  const id = String(projectId || "").trim();

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new Error("Invalid Modrinth project id.");
  }

  return id;
}

async function getModrinthInstallPlan(profileId, projectId) {
  const id = validProjectId(projectId);
  const profile = await profileService.getProfileById(profileId);
  const { minecraftVersion, loader } = getModrinthTarget(profile);
  const modsDir = getModsDir(profile);

  const installed = await getInstalledProjects(modsDir);
  const version = await getLatestCompatibleVersion(id, minecraftVersion, loader);

  const plan = {
    projectId: id,
    minecraftVersion,
    loader,
    compatible: Boolean(version),
    versionNumber: version?.version_number || "",
    installed: installed[id]
      ? { filename: installed[id].filename, enabled: installed[id].enabled }
      : null,
    dependencies: [],
  };

  if (!version) {
    return plan;
  }

  const found = new Map();
  const queue = [{ version, parent: id, depth: 0 }];

  while (queue.length) {
    const { version: current, parent, depth } = queue.shift();
    const dependencies = Array.isArray(current?.dependencies) ? current.dependencies : [];

    for (const dependency of dependencies) {
      if (dependency?.dependency_type !== "required") continue;

      const depId = await resolveDependencyProjectId(dependency);
      if (!depId || depId === id || found.has(depId)) continue;

      const depVersion = await getLatestCompatibleVersion(depId, minecraftVersion, loader).catch(
        () => null
      );

      found.set(depId, {
        projectId: depId,
        requiredBy: parent,
        compatible: Boolean(depVersion),
        versionNumber: depVersion?.version_number || "",
        installed: installed[depId]
          ? { filename: installed[depId].filename, enabled: installed[depId].enabled }
          : null,
      });

      if (depVersion && depth < 3) {
        queue.push({ version: depVersion, parent: depId, depth: depth + 1 });
      }
    }
  }

  const ids = [id, ...found.keys()];
  const titles = {};

  try {
    const projects = await getJson(`/v2/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`);

    for (const project of Array.isArray(projects) ? projects : []) {
      titles[project.id] = {
        title: project.title || project.slug || project.id,
        iconUrl: project.icon_url || "",
      };
    }
  } catch {
    plan.titlesUnavailable = true;
  }

  plan.title = titles[id]?.title || id;
  plan.dependencies = [...found.values()].map((dependency) => ({
    ...dependency,
    title: titles[dependency.projectId]?.title || dependency.projectId,
    iconUrl: titles[dependency.projectId]?.iconUrl || "",
    requiredByTitle: titles[dependency.requiredBy]?.title || dependency.requiredBy,
  }));

  return plan;
}

async function installModrinthProject(profileId, projectId, options = {}) {
  const id = validProjectId(projectId);
  const profile = await profileService.getProfileById(profileId);
  const { minecraftVersion, loader } = getModrinthTarget(profile);
  const modsDir = getModsDir(profile);

  await fsp.mkdir(modsDir, { recursive: true });

  const chosen = Array.isArray(options?.dependencies)
    ? [...new Set(options.dependencies.map(validProjectId))].filter((dep) => dep !== id)
    : null;

  const existingMods = getExistingMods(modsDir);
  const processedMods = new Set();
  const logs = [];
  const failedMods = [];
  const stats = { downloaded: 0, updated: 0, skipped: 0, failed: 0 };

  const common = {
    modsDir,
    minecraftVersion,
    loader,
    existingMods,
    processedMods,
    stats,
    logs,
    failedMods,
    withDependencies: chosen === null,
  };

  await processModrinthProject({ ...common, projectId: id });

  for (const dependencyId of chosen || []) {
    await processModrinthProject({
      ...common,
      projectId: dependencyId,
      isDependency: true,
      parentProjectId: id,
    });
  }

  const ok = !failedMods.includes(id);

  return {
    ok,
    projectId: id,
    minecraftVersion,
    loader,
    stats,
    logs,
    failedMods,
    error: ok ? "" : logs.find((line) => line.includes(id)) || "Install failed.",
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
  modrinthGetJson: getJson,
  modrinthPostJson: postJson,
  downloadBuffer: requestBuffer,
  makeFilenameWithProjectId,
  sha1OfFile,
  getModsDir,
  listMods,
  addMods,
  updateFromModrinthCollection,
  searchModrinth,
  getModrinthInstallPlan,
  installModrinthProject,
  setModEnabled,
  removeMod,
};
