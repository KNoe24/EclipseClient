const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const crypto = require("crypto");

const storage = require("./storage");
const profileService = require("./profiles");
const modsService = require("./mods");
const modpacks = require("./modpacks");

const CODE_PREFIX = "ECLIPSE-SHARE-1:";
const OPTION_FILES = ["options.txt", "optionsof.txt", "optionsshaders.txt"];
const MAX_CONFIG_FILE_BYTES = 256 * 1024;
const MAX_CONFIG_TOTAL_BYTES = 3 * 1024 * 1024;
const DOWNLOAD_CONCURRENCY = 6;

function isText(buffer) {
  return !buffer.subarray(0, Math.min(buffer.length, 8000)).includes(0);
}

function parseLoaderVersion(profile) {
  const id = String(profile.customVersionId || "");
  const loader = String(profile.loaderType || "").toLowerCase();

  if (loader === "fabric" || loader === "quilt") {
    const match = id.match(/^(?:fabric|quilt)-loader-(.+)-([^-]+)$/i);
    if (match) return match[1];
  }

  const installer = path.basename(String(profile.forgeInstallerPath || ""));

  if (loader === "forge") {
    const match = installer.match(/^forge-[^-]+-(.+)-installer\.jar$/i);
    if (match) return match[1];
  }

  if (loader === "neoforge") {
    const match = installer.match(/^neoforge-(.+)-installer\.jar$/i);
    if (match) return match[1];
  }

  return "";
}

function walkFiles(root, relative = "") {
  const dir = path.join(root, relative);
  if (!fs.existsSync(dir)) return [];

  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;

    if (entry.isDirectory()) files.push(...walkFiles(root, rel));
    else if (entry.isFile()) files.push(rel);
  }

  return files;
}

function encodeCode(payload) {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  return CODE_PREFIX + zlib.deflateRawSync(json, { level: 9 }).toString("base64url");
}

function decodeCode(code) {
  const text = String(code || "").replace(/\s+/g, "");
  const start = text.indexOf(CODE_PREFIX);

  if (start < 0) {
    throw new Error("That is not an Eclipse share code. It should start with ECLIPSE-SHARE-1:");
  }

  let payload;

  try {
    const raw = zlib.inflateRawSync(
      Buffer.from(text.slice(start + CODE_PREFIX.length), "base64url"),
      {
        maxOutputLength: 64 * 1024 * 1024,
      }
    );
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error("The share code is incomplete or damaged. Copy the whole code and try again.");
  }

  if (!payload || payload.v !== 1 || !payload.profile?.minecraftVersion) {
    throw new Error("This share code is from a newer or unknown launcher version.");
  }

  return payload;
}

async function lookupMods(modsDir) {
  const files = fs.existsSync(modsDir)
    ? fs
        .readdirSync(modsDir)
        .filter((name) => /\.(jar|nojar)$/i.test(name))
        .filter((name) => fs.statSync(path.join(modsDir, name)).isFile())
    : [];

  const hashed = files.map((filename) => {
    const full = path.join(modsDir, filename);
    return {
      filename,
      enabled: /\.jar$/i.test(filename),
      sha1: modsService.sha1OfFile(full, fs.statSync(full)),
    };
  });

  let versions = {};

  if (hashed.length) {
    versions = await modsService.modrinthPostJson("/v2/version_files", {
      hashes: hashed.map((mod) => mod.sha1),
      algorithm: "sha1",
    });
  }

  const seen = new Set();

  return hashed
    .map((mod) => {
      const version = versions?.[mod.sha1];

      return version?.id
        ? { p: version.project_id, v: version.id, e: mod.enabled, n: mod.filename }
        : { e: mod.enabled, n: mod.filename, missing: true };
    })
    .filter((mod) => {
      if (mod.missing) return true;
      if (seen.has(mod.v)) return false;
      seen.add(mod.v);
      return true;
    });
}

async function exportProfile(profileId, options = {}) {
  const profile = await profileService.getProfileById(profileId);
  const gameDir = profile.gameDir;

  const mods = await lookupMods(modsService.getModsDir(profile));

  const files = {};

  for (const name of OPTION_FILES) {
    const full = path.join(gameDir, name);

    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      files[name] = fs.readFileSync(full, "utf8");
    }
  }

  let configBytes = 0;
  let configSkipped = 0;

  if (options.includeConfigs !== false) {
    for (const rel of walkFiles(path.join(gameDir, "config"))) {
      const full = path.join(gameDir, "config", rel);
      const size = fs.statSync(full).size;

      if (size > MAX_CONFIG_FILE_BYTES || configBytes + size > MAX_CONFIG_TOTAL_BYTES) {
        configSkipped += 1;
        continue;
      }

      const buffer = fs.readFileSync(full);

      if (!isText(buffer)) {
        configSkipped += 1;
        continue;
      }

      files[`config/${rel}`] = buffer.toString("utf8");
      configBytes += size;
    }
  }

  const payload = {
    v: 1,
    createdAt: new Date().toISOString(),
    profile: {
      name: profile.name,
      minecraftVersion: profile.minecraftVersion,
      versionType: profile.versionType || "release",
      loaderType: profile.loaderType || "vanilla",
      loaderVersion: parseLoaderVersion(profile),
      customVersionId: profile.customVersionId || "",
      minMemory: profile.minMemory,
      maxMemory: profile.maxMemory,
      width: profile.width,
      height: profile.height,
      fullscreen: Boolean(profile.fullscreen),
      extraJvmArgs: profile.extraJvmArgs || "",
      extraMcArgs: profile.extraMcArgs || "",
      icon: profile.icon === "custom" ? "grass" : profile.icon || "grass",
    },
    mods,
    files,
  };

  const code = encodeCode(payload);

  return {
    code,
    summary: {
      ...summarize(payload),
      configSkipped,
      length: code.length,
    },
  };
}

function summarize(payload) {
  const mods = Array.isArray(payload.mods) ? payload.mods : [];
  const files = payload.files || {};
  const fileNames = Object.keys(files);

  return {
    name: payload.profile.name,
    minecraftVersion: payload.profile.minecraftVersion,
    loaderType: payload.profile.loaderType,
    loaderVersion: payload.profile.loaderVersion || "",
    memory: `${payload.profile.minMemory || "2G"} – ${payload.profile.maxMemory || "4G"}`,
    mods: mods.length,
    modrinthMods: mods.filter((mod) => !mod.missing).length,
    disabledMods: mods.filter((mod) => !mod.e).length,
    missingMods: mods.filter((mod) => mod.missing).map((mod) => mod.n),
    hasOptions: fileNames.some((name) => OPTION_FILES.includes(name)),
    configFiles: fileNames.filter((name) => name.startsWith("config/")).length,
  };
}

function previewCode(code) {
  return summarize(decodeCode(code));
}

function safeTarget(root, relative) {
  const clean = String(relative || "").replace(/\\/g, "/");

  if (
    !clean ||
    clean.startsWith("/") ||
    /^[a-zA-Z]:/.test(clean) ||
    clean.split("/").includes("..")
  ) {
    throw new Error(`Unsafe path in share code: ${relative}`);
  }

  if (!OPTION_FILES.includes(clean) && !clean.startsWith("config/")) {
    throw new Error(`Unexpected file in share code: ${relative}`);
  }

  const full = path.resolve(root, clean);

  if (!full.startsWith(path.resolve(root) + path.sep)) {
    throw new Error(`Unsafe path in share code: ${relative}`);
  }

  return full;
}

async function resolveLoaderVersion(loaderType, minecraftVersion, loaderVersion) {
  if (loaderVersion) return loaderVersion;

  if (loaderType === "fabric" || loaderType === "quilt") {
    const url =
      loaderType === "fabric"
        ? `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(minecraftVersion)}`
        : `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(minecraftVersion)}`;

    const buffer = await modsService.downloadBuffer(url);
    const list = JSON.parse(buffer.toString("utf8"));
    const pick =
      (Array.isArray(list) ? list : []).find((item) => item?.loader?.stable !== false) || list?.[0];
    if (pick?.loader?.version) return pick.loader.version;
  }

  throw new Error(
    `The share code does not say which ${loaderType} version to use. Ask for a new code from an up-to-date launcher.`
  );
}

async function runPool(items, limit, worker) {
  let next = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        await worker(items[index], index);
      }
    })
  );
}

async function importCode(code, options = {}, onProgress = () => {}) {
  const payload = decodeCode(code);
  const shared = payload.profile;
  const progress = (stage, extra = {}) => onProgress({ stage, ...extra });

  const loaderType = String(shared.loaderType || "vanilla").toLowerCase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eclipse-share-"));
  let createdId = "";

  try {
    let loader = { customVersionId: "" };

    if (["fabric", "quilt", "forge", "neoforge"].includes(loaderType)) {
      const loaderVersion = await resolveLoaderVersion(
        loaderType,
        shared.minecraftVersion,
        shared.loaderVersion
      );
      progress("loader", { message: `Installing ${loaderType} ${loaderVersion}...` });
      loader = await modpacks.installLoader(
        shared.minecraftVersion,
        loaderType,
        loaderVersion,
        tempDir
      );
    } else if (loaderType === "custom" && shared.customVersionId) {
      loader = { customVersionId: shared.customVersionId };
    }

    const name =
      String(options.name || shared.name || "Shared Installation")
        .trim()
        .slice(0, 80) || "Shared Installation";

    const profile = await profileService.createProfile({
      name,
      minecraftVersion: shared.minecraftVersion,
      versionType: shared.versionType || "release",
      loaderType,
      customVersionId: loader.customVersionId || "",
      forgeInstallerPath: loader.forgeInstallerPath || "",
      minMemory: shared.minMemory || "2G",
      maxMemory: shared.maxMemory || "4G",
      width: Number(shared.width) || 854,
      height: Number(shared.height) || 480,
      fullscreen: Boolean(shared.fullscreen),
      extraJvmArgs: String(shared.extraJvmArgs || ""),
      extraMcArgs: String(shared.extraMcArgs || ""),
      icon: shared.icon && shared.icon !== "custom" ? String(shared.icon) : "grass",
    });

    createdId = profile.id;

    const gameDir = profile.gameDir;
    const modsDir = modsService.getModsDir(profile);
    const wanted = (Array.isArray(payload.mods) ? payload.mods : []).filter(
      (mod) => !mod.missing && /^[A-Za-z0-9_-]{1,64}$/.test(mod.v || "")
    );

    const versionsById = {};

    for (let i = 0; i < wanted.length; i += 80) {
      const ids = wanted.slice(i, i + 80).map((mod) => mod.v);
      const list = await modsService.modrinthGetJson(
        `/v2/versions?ids=${encodeURIComponent(JSON.stringify(ids))}`
      );

      for (const version of Array.isArray(list) ? list : []) {
        versionsById[version.id] = version;
      }
    }

    const failed = [];
    let done = 0;
    let downloaded = 0;

    progress("mods", {
      done,
      total: wanted.length,
      message: `Downloading ${wanted.length} mods...`,
    });

    await runPool(wanted, DOWNLOAD_CONCURRENCY, async (mod) => {
      try {
        const version = versionsById[mod.v];
        if (!version) throw new Error("version no longer on Modrinth");

        const files = version.files || [];
        const file =
          files.find(
            (item) => item.filename === String(mod.n || "").replace(/\.nojar$/i, ".jar")
          ) ||
          files.find((item) => item.primary) ||
          files[0];

        if (!file?.url) throw new Error("no file");

        const buffer = await modsService.downloadBuffer(file.url);
        const sha1 = crypto.createHash("sha1").update(buffer).digest("hex");

        if (file.hashes?.sha1 && sha1 !== String(file.hashes.sha1).toLowerCase()) {
          throw new Error("checksum mismatch");
        }

        const targetName = modsService.makeFilenameWithProjectId(
          file.filename,
          version.project_id,
          mod.e !== false
        );
        const target = path.join(modsDir, path.basename(targetName));

        await fsp.writeFile(`${target}.download`, buffer);
        await fsp.rename(`${target}.download`, target);
        downloaded += 1;
      } catch (error) {
        failed.push(`${mod.n || mod.p}: ${error.message || error}`);
      }

      done += 1;
      progress("mods", {
        done,
        total: wanted.length,
        message: `Downloaded ${done} of ${wanted.length} mods`,
      });
    });

    progress("files", { message: "Applying options and configs..." });

    let written = 0;

    for (const [relative, content] of Object.entries(payload.files || {})) {
      try {
        const target = safeTarget(gameDir, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, String(content), "utf8");
        written += 1;
      } catch (error) {
        failed.push(error.message || String(error));
      }
    }

    progress("done", { message: "Installation imported." });

    return {
      ok: true,
      profile: await profileService.getProfileById(profile.id),
      downloaded,
      failed,
      missingMods: (payload.mods || []).filter((mod) => mod.missing).map((mod) => mod.n),
      files: written,
    };
  } catch (error) {
    if (createdId) {
      try {
        const created = await profileService.getProfileById(createdId);
        await profileService.deleteProfile(createdId);

        if (created?.gameDir && created.gameDir.startsWith(storage.getProfilesRootDir())) {
          fs.rmSync(created.gameDir, { recursive: true, force: true });
        }
      } catch {
        error.profileId = createdId;
      }
    }

    throw error;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  exportProfile,
  previewCode,
  importCode,
  decodeCode,
};
