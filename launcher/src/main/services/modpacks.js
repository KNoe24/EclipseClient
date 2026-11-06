const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const https = require("https");
const crypto = require("crypto");
const { URL, URLSearchParams } = require("url");

const storage = require("./storage");
const profileService = require("./profiles");

const MODRINTH_API_BASE = "https://api.modrinth.com";
const USER_AGENT = "eclipse-client/1.0";

const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "cdn.modrinth.com",
  "github.com",
  "raw.githubusercontent.com",
  "gitlab.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

const LOADER_KEYS = {
  "fabric-loader": "fabric",
  "quilt-loader": "quilt",
  forge: "forge",
  neoforge: "neoforge",
};

const SORTS = new Set(["relevance", "downloads", "follows", "newest", "updated"]);
const DOWNLOAD_CONCURRENCY = 6;

let installing = false;

function request(urlString, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error("Too many redirects."));
      return;
    }

    let parsed;

    try {
      parsed = new URL(urlString);
    } catch {
      reject(new Error("Invalid URL."));
      return;
    }

    if (parsed.protocol !== "https:") {
      reject(new Error("Only HTTPS downloads are allowed."));
      return;
    }

    const req = https.get(parsed, { headers: { "User-Agent": USER_AGENT } }, (response) => {
      const statusCode = response.statusCode || 0;

      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        response.resume();
        request(new URL(response.headers.location, parsed).toString(), redirectCount + 1)
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
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });

    req.on("error", reject);
    req.setTimeout(60000, () => {
      req.destroy(new Error("Request timed out."));
    });
  });
}

async function getJson(url) {
  const buffer = await request(url);
  return JSON.parse(buffer.toString("utf8"));
}

function modrinth(urlPath) {
  return getJson(`${MODRINTH_API_BASE}${urlPath}`);
}

function readZip(buffer) {
  const minEocd = 22;
  let eocd = -1;

  for (let i = buffer.length - minEocd; i >= Math.max(0, buffer.length - 65557); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }

  if (eocd < 0) {
    throw new Error("This is not a valid .mrpack (zip) file.");
  }

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();

  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("The modpack zip is damaged.");
    }

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    entries.set(name, { name, method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  const read = (entry) => {
    const local = entry.localOffset;

    if (buffer.readUInt32LE(local) !== 0x04034b50) {
      throw new Error("The modpack zip is damaged.");
    }

    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + entry.compressedSize);

    if (entry.method === 0) return Buffer.from(data);
    if (entry.method === 8) return zlib.inflateRawSync(data);

    throw new Error(`Unsupported zip compression in ${entry.name}.`);
  };

  return { entries, read };
}

function safeJoin(root, relativePath) {
  const clean = String(relativePath || "").replace(/\\/g, "/");

  if (
    !clean ||
    clean.startsWith("/") ||
    /^[a-zA-Z]:/.test(clean) ||
    clean.split("/").includes("..")
  ) {
    throw new Error(`Unsafe path in modpack: ${relativePath}`);
  }

  const full = path.resolve(root, clean);
  const base = path.resolve(root);

  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error(`Unsafe path in modpack: ${relativePath}`);
  }

  return full;
}

function parseIndex(zip) {
  const entry = zip.entries.get("modrinth.index.json");

  if (!entry) {
    throw new Error("This file has no modrinth.index.json. Is it a Modrinth modpack?");
  }

  const index = JSON.parse(zip.read(entry).toString("utf8"));

  if (index.game !== "minecraft") {
    throw new Error("This modpack is not for Minecraft.");
  }

  const dependencies = index.dependencies || {};
  const minecraftVersion = String(dependencies.minecraft || "").trim();

  if (!minecraftVersion) {
    throw new Error("The modpack does not say which Minecraft version it needs.");
  }

  let loaderType = "vanilla";
  let loaderVersion = "";

  for (const [key, type] of Object.entries(LOADER_KEYS)) {
    if (dependencies[key]) {
      loaderType = type;
      loaderVersion = String(dependencies[key]);
      break;
    }
  }

  const files = (Array.isArray(index.files) ? index.files : []).filter(
    (file) => file?.env?.client !== "unsupported"
  );

  return {
    name: String(index.name || "Modpack").trim() || "Modpack",
    versionId: String(index.versionId || ""),
    summary: String(index.summary || ""),
    minecraftVersion,
    loaderType,
    loaderVersion,
    files,
  };
}

async function installLoader(minecraftVersion, loaderType, loaderVersion, tempDir) {
  if (loaderType === "vanilla") {
    return { customVersionId: "" };
  }

  if (loaderType === "fabric" || loaderType === "quilt") {
    const url =
      loaderType === "fabric"
        ? `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(minecraftVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`
        : `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(minecraftVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;

    const json = await getJson(url);
    const versionId = String(
      json.id || `${loaderType}-loader-${loaderVersion}-${minecraftVersion}`
    );
    const versionDir = path.join(storage.getRuntimeVersionsDir(), versionId);

    await fsp.mkdir(versionDir, { recursive: true });
    await fsp.writeFile(
      path.join(versionDir, `${versionId}.json`),
      JSON.stringify(json, null, 2),
      "utf8"
    );

    return { customVersionId: versionId };
  }

  const installerUrl =
    loaderType === "forge"
      ? `https://maven.minecraftforge.net/net/minecraftforge/forge/${minecraftVersion}-${loaderVersion}/forge-${minecraftVersion}-${loaderVersion}-installer.jar`
      : `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;

  const installersDir = storage.ensureDir(
    path.join(storage.getRuntimeRootDir(), "loader-installers")
  );
  const installerPath = path.join(installersDir, path.basename(new URL(installerUrl).pathname));

  if (!fs.existsSync(installerPath)) {
    const buffer = await request(installerUrl);
    const temp = path.join(tempDir, path.basename(installerPath));
    await fsp.writeFile(temp, buffer);
    await fsp.copyFile(temp, installerPath);
  }

  return { customVersionId: "", forgeInstallerPath: installerPath };
}

function checkHash(buffer, hashes = {}) {
  if (hashes.sha512) {
    return (
      crypto.createHash("sha512").update(buffer).digest("hex") ===
      String(hashes.sha512).toLowerCase()
    );
  }

  if (hashes.sha1) {
    return (
      crypto.createHash("sha1").update(buffer).digest("hex") === String(hashes.sha1).toLowerCase()
    );
  }

  return true;
}

async function downloadPackFile(file, gameDir) {
  const target = safeJoin(gameDir, file.path);
  const urls = (Array.isArray(file.downloads) ? file.downloads : []).filter((url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname);
    } catch {
      return false;
    }
  });

  if (!urls.length) {
    throw new Error(`${file.path}: no allowed download link.`);
  }

  if (fs.existsSync(target) && checkHash(fs.readFileSync(target), file.hashes)) {
    return "skipped";
  }

  let lastError = null;

  for (const url of urls) {
    try {
      const buffer = await request(url);

      if (!checkHash(buffer, file.hashes)) {
        throw new Error("checksum did not match");
      }

      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(`${target}.download`, buffer);
      await fsp.rename(`${target}.download`, target);
      return "downloaded";
    } catch (error) {
      lastError = error;
      await fsp.rm(`${target}.download`, { force: true }).catch(() => {});
    }
  }

  throw new Error(`${file.path}: ${lastError?.message || "download failed"}`);
}

async function runPool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index], index);
    }
  });

  await Promise.all(runners);
}

function extractOverrides(zip, gameDir) {
  let count = 0;

  for (const prefix of ["overrides/", "client-overrides/"]) {
    for (const entry of zip.entries.values()) {
      if (!entry.name.startsWith(prefix) || entry.name.endsWith("/")) continue;

      const relative = entry.name.slice(prefix.length);
      if (!relative) continue;

      const target = safeJoin(gameDir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, zip.read(entry));
      count += 1;
    }
  }

  return count;
}

async function saveIcon(iconUrl) {
  if (!iconUrl) return {};

  try {
    const parsed = new URL(iconUrl);
    if (parsed.hostname !== "cdn.modrinth.com") return {};

    const buffer = await request(iconUrl);
    const isPng = buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504e47;
    if (!isPng) return {};

    const temp = path.join(
      os.tmpdir(),
      `eclipse-icon-${crypto.randomBytes(6).toString("hex")}.png`
    );
    fs.writeFileSync(temp, buffer);

    try {
      const icon = await profileService.importProfileIcon(temp);
      return { icon: icon.icon, iconPath: icon.iconPath };
    } finally {
      fs.rmSync(temp, { force: true });
    }
  } catch {
    return {};
  }
}

async function searchModpacks(options = {}) {
  const query = String(options.query || "")
    .trim()
    .slice(0, 200);
  const index = SORTS.has(options.sort) ? options.sort : "relevance";
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50);
  const offset = Math.max(Number(options.offset) || 0, 0);

  const facets = [["project_type:modpack"]];

  if (options.loader && Object.values(LOADER_KEYS).includes(options.loader)) {
    facets.push([`categories:${options.loader}`]);
  }

  if (options.minecraftVersion && /^[\w.\-]{1,32}$/.test(options.minecraftVersion)) {
    facets.push([`versions:${options.minecraftVersion}`]);
  }

  const params = new URLSearchParams({
    query,
    index,
    limit: String(limit),
    offset: String(offset),
    facets: JSON.stringify(facets),
  });

  const result = await modrinth(`/v2/search?${params.toString()}`);

  return {
    total: Number(result?.total_hits) || 0,
    offset,
    limit,
    hits: (Array.isArray(result?.hits) ? result.hits : []).map((hit) => ({
      projectId: hit.project_id,
      slug: hit.slug,
      title: hit.title || hit.slug || hit.project_id,
      author: hit.author || "",
      description: hit.description || "",
      iconUrl: hit.icon_url || "",
      downloads: Number(hit.downloads) || 0,
      categories: Array.isArray(hit.display_categories) ? hit.display_categories : [],
      latestVersion: hit.latest_version || "",
      gameVersions: Array.isArray(hit.versions) ? hit.versions : [],
    })),
  };
}

async function listModpackVersions(projectId) {
  const id = String(projectId || "").trim();

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new Error("Invalid Modrinth project id.");
  }

  const versions = await modrinth(`/v2/project/${encodeURIComponent(id)}/version`);

  return (Array.isArray(versions) ? versions : [])
    .map((version) => {
      const file =
        (version.files || []).find((item) => item.primary && /\.mrpack$/i.test(item.filename)) ||
        (version.files || []).find((item) => /\.mrpack$/i.test(item.filename));

      return {
        id: version.id,
        name: version.name || version.version_number,
        versionNumber: version.version_number || "",
        gameVersions: version.game_versions || [],
        loaders: version.loaders || [],
        type: version.version_type || "release",
        published: version.date_published || "",
        hasFile: Boolean(file),
      };
    })
    .filter((version) => version.hasFile)
    .sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
}

async function installModpack(source = {}, onProgress = () => {}) {
  if (installing) {
    throw new Error("A modpack is already being installed.");
  }

  installing = true;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eclipse-mrpack-"));
  const progress = (stage, extra = {}) => onProgress({ stage, ...extra });
  let createdProfileId = "";

  try {
    let packBuffer;
    let projectInfo = null;

    if (source.filePath) {
      if (!/\.mrpack$/i.test(source.filePath) || !fs.existsSync(source.filePath)) {
        throw new Error("Choose a .mrpack file.");
      }

      progress("reading", { message: "Reading modpack file..." });
      packBuffer = fs.readFileSync(source.filePath);
    } else {
      const versionId = String(source.versionId || "").trim();

      if (!/^[A-Za-z0-9_-]{1,64}$/.test(versionId)) {
        throw new Error("Pick a modpack version.");
      }

      progress("fetching", { message: "Getting modpack info..." });

      const version = await modrinth(`/v2/version/${encodeURIComponent(versionId)}`);
      const file =
        (version.files || []).find((item) => item.primary && /\.mrpack$/i.test(item.filename)) ||
        (version.files || []).find((item) => /\.mrpack$/i.test(item.filename));

      if (!file) {
        throw new Error("That version has no .mrpack file.");
      }

      try {
        projectInfo = await modrinth(`/v2/project/${encodeURIComponent(version.project_id)}`);
      } catch {
        projectInfo = null;
      }

      progress("fetching", { message: `Downloading ${file.filename}...` });
      packBuffer = await request(file.url);

      if (!checkHash(packBuffer, file.hashes)) {
        throw new Error("The modpack download is damaged (checksum mismatch). Try again.");
      }
    }

    const zip = readZip(packBuffer);
    const pack = parseIndex(zip);
    const name = String(source.name || projectInfo?.title || pack.name).trim() || pack.name;

    progress("loader", {
      message:
        pack.loaderType === "vanilla"
          ? "No mod loader needed."
          : `Installing ${pack.loaderType} ${pack.loaderVersion}...`,
    });

    const loader = await installLoader(
      pack.minecraftVersion,
      pack.loaderType,
      pack.loaderVersion,
      tempDir
    );
    const icon = await saveIcon(projectInfo?.icon_url || "");

    const profile = await profileService.createProfile({
      forgeInstallerPath: loader.forgeInstallerPath || "",
      name,
      minecraftVersion: pack.minecraftVersion,
      versionType: "release",
      loaderType: pack.loaderType,
      customVersionId: loader.customVersionId,
      minMemory: "2G",
      maxMemory: "6G",
      icon: icon.icon || "crafting",
      iconPath: icon.iconPath || "",
    });

    createdProfileId = profile.id;

    const gameDir = profile.gameDir;
    const total = pack.files.length;
    let done = 0;
    const failures = [];

    progress("files", { done, total, message: `Downloading ${total} files...` });

    await runPool(pack.files, DOWNLOAD_CONCURRENCY, async (file) => {
      try {
        await downloadPackFile(file, gameDir);
      } catch (error) {
        failures.push(error.message || String(error));
      }

      done += 1;
      progress("files", { done, total, message: `Downloaded ${done} of ${total} files` });
    });

    if (failures.length) {
      throw new Error(
        `${failures.length} file${failures.length === 1 ? "" : "s"} could not be downloaded:\n${failures.slice(0, 5).join("\n")}`
      );
    }

    progress("overrides", { message: "Copying configs and extras..." });
    const overrides = extractOverrides(zip, gameDir);

    fs.writeFileSync(
      path.join(gameDir, ".eclipse-modpack.json"),
      JSON.stringify(
        {
          source: source.filePath ? "file" : "modrinth",
          projectId: projectInfo?.id || "",
          versionId: source.versionId || "",
          name: pack.name,
          packVersion: pack.versionId,
          minecraftVersion: pack.minecraftVersion,
          loaderType: pack.loaderType,
          loaderVersion: pack.loaderVersion,
          installedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      "utf8"
    );

    progress("done", { message: "Modpack installed." });

    return {
      ok: true,
      profile: await profileService.getProfileById(profile.id),
      files: total,
      overrides,
      loaderType: pack.loaderType,
      loaderVersion: pack.loaderVersion,
      minecraftVersion: pack.minecraftVersion,
    };
  } catch (error) {
    if (createdProfileId) {
      try {
        const created = await profileService.getProfileById(createdProfileId);
        await profileService.deleteProfile(createdProfileId);

        if (created?.gameDir && created.gameDir.startsWith(storage.getProfilesRootDir())) {
          fs.rmSync(created.gameDir, { recursive: true, force: true });
        }
      } catch {
        error.profileId = createdProfileId;
      }
    }

    throw error;
  } finally {
    installing = false;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  installLoader,
  searchModpacks,
  listModpackVersions,
  installModpack,
  readZip,
  parseIndex,
};
