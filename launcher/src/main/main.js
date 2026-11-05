const path = require("path");
const fsp = require("fs/promises");
const fsSync = require("fs");
const os = require("os");
const crypto = require("crypto");
const https = require("https");
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require("electron");

const authService = require("./services/auth");
const launcherService = require("./services/launcher");
const profileService = require("./services/profiles");
const modsService = require("./services/mods");
const updaterService = require("./services/updater");
const clientUpdaterService = require("./services/clientUpdater");
const discordService = require("./services/discord");
const javaService = require("./services/java");
const storage = require("./services/storage");

if (storage.isPortable()) {
  app.setPath("userData", path.join(storage.getRootDir(), "electron"));
}

if (process.platform === "win32") {
  app.setAppUserModelId("cc.wawe.eclipse-launcher");
}

let mainWindow = null;

const SKINS_FILE = "skins.json";
const DEFAULT_STEVE_SKIN_RELATIVE_PATH = "./static/img/steve.png";

let skinUploadInProgress = false;
let cachedMinecraftProfile = null;
let cachedMinecraftProfileAt = 0;

const MINECRAFT_PROFILE_CACHE_MS = 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Window / App                                                               */
/* -------------------------------------------------------------------------- */

function firstExistingPath(paths) {
  return paths.find((filePath) => fsSync.existsSync(filePath)) || paths[0];
}

function getWindowIconPath() {
  if (process.platform === "win32") {
    return firstExistingPath([
      path.join(__dirname, "../renderer/static/img/icon.ico"),
      path.join(__dirname, "../../build/icon.ico"),
    ]);
  }

  if (process.platform === "darwin") {
    return firstExistingPath([
      path.join(__dirname, "../renderer/static/img/icon.icns"),
      path.join(__dirname, "../../build/icon.icns"),
    ]);
  }

  return firstExistingPath([
    path.join(__dirname, "../renderer/static/img/icon.png"),
    path.join(__dirname, "../../build/icon.png"),
  ]);
}

function sendClientUpdaterError(error) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.webContents.send("clientUpdater:status", {
    type: "error",
    message: error.message || "Failed to sync default client.",
  });
}

/* -------------------------------------------------------------------------- */
/* Skins                                                                      */
/* -------------------------------------------------------------------------- */

function defaultSkinsFile() {
  return {
    selectedSkinId: "",
    skins: [],
  };
}

function skinId() {
  return crypto.randomBytes(12).toString("hex");
}

function safeSkinName(value) {
  return (
    String(value || "Skin")
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 70) || "Skin"
  );
}

function normalizeSkinModel(value) {
  return value === "slim" ? "slim" : "wide";
}

function normalizeCapeId(value) {
  return String(value || "").trim();
}

function readSkinsFile() {
  const data = storage.readJson(SKINS_FILE, defaultSkinsFile());

  const skins = Array.isArray(data?.skins) ? data.skins : [];

  const selectedSkinId = skins.some((skin) => skin.id === data?.selectedSkinId)
    ? data.selectedSkinId
    : "";

  return {
    selectedSkinId,
    skins: skins.map((skin) => ({
      id: skin.id || skinId(),
      name: String(skin.name || "Skin"),
      model: normalizeSkinModel(skin.model),
      skinPath: storage.fromStoredPath(String(skin.skinPath || "")),
      sourceUrl: String(skin.sourceUrl || ""),
      capeId: normalizeCapeId(skin.capeId),
      createdAt: skin.createdAt || new Date().toISOString(),
      updatedAt: skin.updatedAt || new Date().toISOString(),
    })),
  };
}

function writeSkinsFile(data) {
  const normalized = {
    selectedSkinId: data?.selectedSkinId || "",
    skins: Array.isArray(data?.skins) ? data.skins : [],
  };

  storage.writeJson(SKINS_FILE, {
    ...normalized,
    skins: normalized.skins.map((skin) => ({
      ...skin,
      skinPath: storage.toStoredPath(skin.skinPath),
    })),
  });

  return normalized;
}

function skinDataUrlFor(skinPath) {
  if (!skinPath || !fsSync.existsSync(skinPath)) return "";

  try {
    const buffer = fsSync.readFileSync(skinPath);
    return `data:image/png;base64,${buffer.toString("base64")}`;
  } catch {
    return "";
  }
}

function withComputedSkinFields(skin) {
  return {
    ...skin,
    skinDataUrl: skinDataUrlFor(skin.skinPath),
    dataUrl: skinDataUrlFor(skin.skinPath) || skin.sourceUrl || "",
  };
}

function withComputedSkinsData(data) {
  return {
    selectedSkinId: data.selectedSkinId,
    skins: data.skins.map(withComputedSkinFields),
  };
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/png;base64,(.+)$/);

  if (!match) {
    throw new Error("Skin image must be a PNG data URL.");
  }

  return Buffer.from(match[1], "base64");
}

async function downloadUrlToBuffer(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download image: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function readRendererStaticFile(relativePath) {
  const cleanPath = String(relativePath || "")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");

  const resolvedPath = path.resolve(__dirname, "../renderer", cleanPath);
  const rendererRoot = path.resolve(__dirname, "../renderer");

  if (!resolvedPath.startsWith(rendererRoot + path.sep)) {
    throw new Error("Invalid renderer static file path.");
  }

  return fsp.readFile(resolvedPath);
}

async function skinInputToBuffer(input) {
  const value = String(input || "").trim();

  if (!value) {
    throw new Error("No skin image was provided.");
  }

  if (value.startsWith("data:image/png;base64,")) {
    return parseDataUrl(value);
  }

  if (value.startsWith("https://") || value.startsWith("http://")) {
    return downloadUrlToBuffer(value);
  }

  if (value.startsWith("./static/") || value.startsWith("static/")) {
    return readRendererStaticFile(value);
  }

  if (path.isAbsolute(value)) {
    return fsp.readFile(value);
  }

  throw new Error("Skin image must be a PNG file, URL, or data URL.");
}

function safeSkinCopyName(buffer, prefix = "skin") {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 32);
  return `${safeSkinName(prefix)}-${hash}.png`;
}

async function importSkinBuffer(buffer, prefix = "skin") {
  if (!buffer || buffer.length === 0) {
    throw new Error("Skin file was empty.");
  }

  const targetName = safeSkinCopyName(buffer, prefix);
  const targetPath = path.join(storage.getSkinsDir(), targetName);

  await fsp.writeFile(targetPath, buffer);

  return targetPath;
}

async function importSkinInput(input, prefix = "skin") {
  const buffer = await skinInputToBuffer(input);
  return importSkinBuffer(buffer, prefix);
}

function toUndashedUuid(uuid) {
  return String(uuid || "")
    .replaceAll("-", "")
    .trim();
}

function forceHttpsTextureUrl(url) {
  return String(url || "").replace(/^http:\/\//i, "https://");
}

function decodeMojangTexturesProperty(profileResponse) {
  const texturesProperty = Array.isArray(profileResponse?.properties)
    ? profileResponse.properties.find((property) => property.name === "textures")
    : null;

  if (!texturesProperty?.value) {
    return null;
  }

  try {
    const decoded = Buffer.from(texturesProperty.value, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

async function getMojangSessionTextures(uuid) {
  const cleanUuid = toUndashedUuid(uuid);

  if (!cleanUuid) {
    return null;
  }

  const response = await fetch(
    `https://sessionserver.mojang.com/session/minecraft/profile/${encodeURIComponent(cleanUuid)}`
  );

  if (!response.ok) {
    return null;
  }

  const profile = await response.json();
  const decodedTextures = decodeMojangTexturesProperty(profile);

  if (!decodedTextures?.textures) {
    return null;
  }

  const skinUrl = forceHttpsTextureUrl(decodedTextures.textures.SKIN?.url || "");
  const capeUrl = forceHttpsTextureUrl(decodedTextures.textures.CAPE?.url || "");
  const model = decodedTextures.textures.SKIN?.metadata?.model === "slim" ? "SLIM" : "CLASSIC";

  return {
    profileId: decodedTextures.profileId || cleanUuid,
    profileName: decodedTextures.profileName || profile.name || "",
    skinUrl,
    capeUrl,
    model,
  };
}

async function getMinecraftProfileFromServices() {
  const now = Date.now();

  if (cachedMinecraftProfile && now - cachedMinecraftProfileAt < MINECRAFT_PROFILE_CACHE_MS) {
    return cachedMinecraftProfile;
  }

  const token = authService.getMinecraftAccessToken();
  const account = authService.getStoredAccount?.() || null;

  let profile = null;
  let profileError = "";

  try {
    const response = await fetch("https://api.minecraftservices.com/minecraft/profile", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      profileError = `Minecraft profile request failed. HTTP ${response.status}: ${text || response.statusText}`;
    } else {
      profile = await response.json();
    }
  } catch (error) {
    profileError = error.message || String(error);
  }

  const profileId = profile?.id || account?.uuid || "";
  const profileName = profile?.name || account?.username || "";
  const sessionTextures = await getMojangSessionTextures(profileId);

  const skins = Array.isArray(profile?.skins) ? [...profile.skins] : [];
  const capes = Array.isArray(profile?.capes) ? [...profile.capes] : [];

  const activeSkinExists = skins.some((skin) => skin.state === "ACTIVE");

  if (!activeSkinExists && sessionTextures?.skinUrl) {
    skins.unshift({
      id: "session-active-skin",
      state: "ACTIVE",
      url: sessionTextures.skinUrl,
      variant: sessionTextures.model || "CLASSIC",
      source: "sessionserver",
    });
  }

  const sessionCapeAlreadyListed = sessionTextures?.capeUrl
    ? capes.some((cape) => forceHttpsTextureUrl(cape.url) === sessionTextures.capeUrl)
    : true;

  if (sessionTextures?.capeUrl && !sessionCapeAlreadyListed) {
    capes.unshift({
      id: `session:${sessionTextures.capeUrl}`,
      state: "ACTIVE",
      url: sessionTextures.capeUrl,
      alias: "Mojang Cape",
      source: "sessionserver",
    });
  }

  const result = {
    id: profileId,
    name: profileName,
    skins,
    capes,
    sessionTextures,
    warning: profileError,
  };

  cachedMinecraftProfile = result;
  cachedMinecraftProfileAt = now;

  return result;
}

function createMultipartSkinBody({ variant, filename, fileBuffer }) {
  const boundary = `EclipseClientBoundary${crypto.randomBytes(16).toString("hex")}`;

  const chunks = [
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="variant"\r\n\r\n` +
        `${variant}\r\n`,
      "utf8"
    ),

    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: image/png\r\n\r\n`,
      "utf8"
    ),

    fileBuffer,

    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ];

  return {
    boundary,
    body: Buffer.concat(chunks),
  };
}

function uploadSkinMultipartWithHttps({ token, multipart }) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        method: "POST",
        hostname: "api.minecraftservices.com",
        path: "/minecraft/profile/skins",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": `multipart/form-data; boundary=${multipart.boundary}`,
          "Content-Length": multipart.body.byteLength,
        },
      },
      (response) => {
        const chunks = [];

        response.on("data", (chunk) => {
          chunks.push(chunk);
        });

        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const statusCode = response.statusCode || 0;

          if (statusCode < 200 || statusCode >= 300) {
            reject(
              new Error(
                `Failed to upload skin. HTTP ${statusCode}: ${text || response.statusMessage}`
              )
            );
            return;
          }

          try {
            resolve(text ? JSON.parse(text) : { ok: true });
          } catch {
            resolve({ ok: true });
          }
        });
      }
    );

    request.on("error", reject);
    request.write(multipart.body);
    request.end();
  });
}

async function applyCape(capeId) {
  const token = authService.getMinecraftAccessToken();
  const safeCapeId = String(capeId || "");

  /*
    Sessionserver capes only provide texture URLs.
    Minecraft Services cape activation needs a real cape UUID.
  */
  if (safeCapeId.startsWith("session:")) {
    return {
      ok: true,
      skipped: true,
      reason: "Sessionserver cape texture is already visible but cannot be activated by capeId.",
    };
  }

  if (!safeCapeId) {
    const response = await fetch(
      "https://api.minecraftservices.com/minecraft/profile/capes/active",
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok && response.status !== 404) {
      const text = await response.text().catch(() => "");

      return {
        ok: false,
        warning: `Skin was applied, but cape could not be cleared. HTTP ${response.status}: ${
          text || response.statusText
        }`,
      };
    }

    return {
      ok: true,
    };
  }

  const response = await fetch("https://api.minecraftservices.com/minecraft/profile/capes/active", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      capeId: safeCapeId,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");

    return {
      ok: false,
      warning: `Skin was applied, but cape could not be activated. HTTP ${response.status}: ${
        text || response.statusText
      }`,
    };
  }

  return {
    ok: true,
  };
}

async function uploadSkinToMinecraft(skin) {
  const token = authService.getMinecraftAccessToken();

  let skinPath = skin.skinPath;

  if (!skinPath && skin.sourceUrl) {
    const buffer = await skinInputToBuffer(skin.sourceUrl);
    skinPath = await importSkinBuffer(buffer, skin.name || "skin");

    const data = readSkinsFile();
    const found = data.skins.find((item) => item.id === skin.id);

    if (found) {
      found.skinPath = skinPath;
      found.updatedAt = new Date().toISOString();
      writeSkinsFile(data);
    }
  }

  let buffer = null;

  if (skinPath && fsSync.existsSync(skinPath)) {
    buffer = await fsp.readFile(skinPath);
  } else {
    buffer = await skinInputToBuffer(DEFAULT_STEVE_SKIN_RELATIVE_PATH);
  }

  const multipart = createMultipartSkinBody({
    variant: skin.model === "slim" ? "slim" : "classic",
    filename: `${safeSkinName(skin.name || "skin")}.png`,
    fileBuffer: buffer,
  });

  return uploadSkinMultipartWithHttps({
    token,
    multipart,
  });
}

async function createSkin(data = {}) {
  const skinsData = readSkinsFile();
  const now = new Date().toISOString();

  let skinPath = "";

  if (data.skinDataUrl) {
    skinPath = await importSkinInput(data.skinDataUrl, data.name || "skin");
  }

  const skin = {
    id: skinId(),
    name: String(data.name || "New Skin").trim() || "New Skin",
    model: normalizeSkinModel(data.model),
    skinPath,
    sourceUrl: String(data.sourceUrl || ""),
    capeId: normalizeCapeId(data.capeId),
    createdAt: now,
    updatedAt: now,
  };

  skinsData.skins.push(skin);
  skinsData.selectedSkinId = skin.id;

  writeSkinsFile(skinsData);

  return withComputedSkinFields(skin);
}

async function updateSkin(skinIdValue, patch = {}) {
  const data = readSkinsFile();
  const skin = data.skins.find((item) => item.id === skinIdValue);

  if (!skin) {
    throw new Error("Skin not found.");
  }

  if (Object.prototype.hasOwnProperty.call(patch, "name")) {
    skin.name = String(patch.name || "Skin").trim() || "Skin";
  }

  if (Object.prototype.hasOwnProperty.call(patch, "model")) {
    skin.model = normalizeSkinModel(patch.model);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "capeId")) {
    skin.capeId = normalizeCapeId(patch.capeId);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "sourceUrl")) {
    skin.sourceUrl = String(patch.sourceUrl || "");
  }

  if (patch.skinDataUrl) {
    skin.skinPath = await importSkinInput(patch.skinDataUrl, skin.name || "skin");
    skin.sourceUrl = "";
  }

  skin.updatedAt = new Date().toISOString();

  writeSkinsFile(data);

  return withComputedSkinFields(skin);
}

async function duplicateSkin(skinIdValue) {
  const data = readSkinsFile();
  const original = data.skins.find((item) => item.id === skinIdValue);

  if (!original) {
    throw new Error("Skin not found.");
  }

  const now = new Date().toISOString();
  let copiedPath = "";

  if (original.skinPath && fsSync.existsSync(original.skinPath)) {
    const buffer = await fsp.readFile(original.skinPath);
    copiedPath = await importSkinBuffer(buffer, `${original.name}-copy`);
  }

  const copy = {
    ...original,
    id: skinId(),
    name: `${original.name} Copy`,
    skinPath: copiedPath,
    createdAt: now,
    updatedAt: now,
  };

  data.skins.push(copy);
  data.selectedSkinId = copy.id;

  writeSkinsFile(data);

  return withComputedSkinFields(copy);
}

async function deleteSkin(skinIdValue) {
  const data = readSkinsFile();
  const skin = data.skins.find((item) => item.id === skinIdValue);

  if (!skin) {
    throw new Error("Skin not found.");
  }

  data.skins = data.skins.filter((item) => item.id !== skinIdValue);

  if (data.selectedSkinId === skinIdValue) {
    data.selectedSkinId = data.skins[0]?.id || "";
  }

  writeSkinsFile(data);

  if (skin.skinPath) {
    await fsp.rm(skin.skinPath, { force: true }).catch(() => {});
  }

  return withComputedSkinsData(data);
}

async function useSkin(skinIdValue, options = {}) {
  if (skinUploadInProgress) {
    throw new Error("A skin upload is already running. Wait for it to finish.");
  }

  skinUploadInProgress = true;

  try {
    const data = readSkinsFile();
    const skin = data.skins.find((item) => item.id === skinIdValue);

    if (!skin) {
      throw new Error("Skin not found.");
    }

    const capeId = Object.prototype.hasOwnProperty.call(options, "capeId")
      ? normalizeCapeId(options.capeId)
      : normalizeCapeId(skin.capeId);

    await uploadSkinToMinecraft(skin);

    const capeResult = await applyCape(capeId);

    skin.capeId = capeId;
    skin.updatedAt = new Date().toISOString();
    data.selectedSkinId = skin.id;

    writeSkinsFile(data);

    cachedMinecraftProfile = null;
    cachedMinecraftProfileAt = 0;

    return {
      ok: true,
      skin: withComputedSkinFields(skin),
      capeResult,
    };
  } catch (error) {
    const message = error.message || String(error);

    if (message.includes("HTTP 429")) {
      throw new Error("Minecraft skin upload is rate-limited. Wait a few minutes and try again.");
    }

    throw error;
  } finally {
    skinUploadInProgress = false;
  }
}

/* -------------------------------------------------------------------------- */
/* Startup / Window                                                           */
/* -------------------------------------------------------------------------- */

async function checkDefaultClientOnStartup() {
  try {
    await discordService.setUpdatingActivity();

    const info = await clientUpdaterService.getDefaultClientUpdateInfo();

    if (!info.updateAvailable) {
      mainWindow.webContents.send("clientUpdater:status", {
        type: "done",
        message: "Default client is already up to date.",
        updatedFiles: [],
        skippedFiles: [],
      });

      await discordService.setLauncherActivity(info.profile?.name || "Default");
      return;
    }

    if (info.updateMode === "delete") {
      await clientUpdaterService.syncDefaultClient(mainWindow, {
        mode: "delete",
      });

      await discordService.setLauncherActivity(info.profile?.name || "Default");
      return;
    }

    if (info.updateMode === "keep") {
      await clientUpdaterService.syncDefaultClient(mainWindow, {
        mode: "keep",
      });

      await discordService.setLauncherActivity(info.profile?.name || "Default");
      return;
    }

    mainWindow.webContents.send("clientUpdater:status", {
      type: "choice-required",
      message: `Default client update available: ${
        info.localClientVersion || "none"
      } → ${info.remoteClientVersion || "new"}`,
      localClientVersion: info.localClientVersion,
      remoteClientVersion: info.remoteClientVersion,
    });

    await discordService.setLauncherActivity(info.profile?.name || "Default");
  } catch (error) {
    sendClientUpdaterError(error);

    try {
      const selected = await profileService.getSelectedProfile();
      await discordService.setLauncherActivity(selected?.name || "Launcher");
    } catch {
      await discordService.setLauncherActivity("Launcher");
    }
  }
}

async function updateDiscordForInstances(instances = []) {
  const running = instances.filter((instance) => instance.status === "running");

  try {
    if (running.length > 0) {
      const latest = running.reduce((a, b) => (b.startedAt > a.startedAt ? b : a));
      const extra = running.length > 1 ? ` (+${running.length - 1} more)` : "";

      await discordService.setPlayingActivity(`${latest.profileName}${extra}`, latest.versionId);
      return;
    }

    const selected = await profileService.getSelectedProfile();
    await discordService.setLauncherActivity(selected?.name || "Launcher");
  } catch (error) {
    console.warn("[discord] Failed to update activity:", error.message || error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 760,
    minWidth: 1300,
    minHeight: 760,
    title: "Eclipse Launcher",
    icon: getWindowIconPath(),
    backgroundColor: "#111318",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#111318",
      symbolColor: "#ffffff",
      height: 35,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  updaterService.bindWindow(mainWindow);

  mainWindow.webContents.once("did-finish-load", async () => {
    try {
      await updaterService.check();
    } catch (error) {
      console.warn("[updater] Startup update check failed:", error.message || error);
    }

    await checkDefaultClientOnStartup();
  });
}

/* -------------------------------------------------------------------------- */
/* IPC                                                                        */
/* -------------------------------------------------------------------------- */

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  await discordService.init();

  createWindow();

  launcherService.onInstancesChanged(updateDiscordForInstances);

  ipcMain.handle("system:getMemoryInfo", async () => {
    const totalBytes = os.totalmem();
    const totalGb = Math.max(1, Math.floor(totalBytes / 1024 / 1024 / 1024));

    return {
      totalBytes,
      totalGb,
    };
  });

  ipcMain.handle("system:getAppInfo", async () => {
    return {
      version: app.getVersion(),
      packaged: app.isPackaged,
      platform: process.platform,
      portable: storage.isPortable(),
      dataDir: storage.getRootDir(),
    };
  });

  ipcMain.handle("auth:login", async () => {
    return authService.loginMicrosoft();
  });

  ipcMain.handle("auth:loginOffline", async (_event, username) => {
    return authService.loginOffline(username);
  });

  ipcMain.handle("auth:getOfflineEligibility", async () => {
    return authService.getOfflineEligibility();
  });

  ipcMain.handle("auth:getAccount", async () => {
    return authService.getAccount();
  });

  ipcMain.handle("auth:logout", async () => {
    return authService.logout();
  });

  ipcMain.handle("links:openExternal", async (_event, url) => {
    const allowedUrls = [
      "https://wawe.cc",
      "https://dc.l.wawe.cc",
      "https://launcher.wawe.cc",
      "https://minecraft.net",
      "https://www.minecraft.net/en-us/articles",
      "https://launcher.wawe.cc/launcher/changelog/",
    ];

    if (!allowedUrls.includes(url)) {
      throw new Error("Blocked external URL.");
    }

    await shell.openExternal(url);

    return {
      ok: true,
    };
  });

  ipcMain.handle("folders:openPath", async (_event, folderPath) => {
    if (!folderPath || typeof folderPath !== "string") {
      throw new Error("Invalid folder path.");
    }

    const resolvedPath = path.resolve(folderPath);
    const result = await shell.openPath(resolvedPath);

    if (result) {
      throw new Error(result);
    }

    return {
      ok: true,
    };
  });

  ipcMain.handle("profiles:list", async () => {
    return profileService.listProfiles();
  });

  ipcMain.handle("profiles:create", async (_event, profile) => {
    const created = await profileService.createProfile(profile);
    await discordService.setLauncherActivity(created.name);
    return created;
  });

  ipcMain.handle("profiles:update", async (_event, id, patch) => {
    if (launcherService.isRunning(id) && patch) {
      const current = await profileService.getProfileById(id);
      const requestedName = "name" in patch ? String(patch.name || "").trim() : current.name;
      const requestedDir = "gameDir" in patch ? String(patch.gameDir || "").trim() : "";

      const renaming = requestedName !== current.name;
      const movingDir =
        Boolean(requestedDir) &&
        path.resolve(requestedDir).toLowerCase() !==
          path.resolve(current.gameDir || "").toLowerCase();

      if (renaming || movingDir) {
        throw new Error("Stop this installation before renaming it or changing its game folder.");
      }
    }

    const updated = await profileService.updateProfile(id, patch);

    const selected = await profileService.getSelectedProfile();
    if (selected && selected.id === updated.id) {
      await discordService.setLauncherActivity(updated.name);
    }

    return updated;
  });

  ipcMain.handle("profiles:delete", async (_event, id) => {
    const profilesData = await profileService.listProfiles();
    const profiles = Array.isArray(profilesData?.profiles) ? profilesData.profiles : [];

    if (profiles.length <= 1) {
      throw new Error("You must keep at least one installation.");
    }

    const profileToDelete = profiles.find((profile) => profile.id === id);

    if (!profileToDelete) {
      throw new Error("Installation not found.");
    }

    if (launcherService.isRunning(id)) {
      throw new Error("Stop this installation before deleting it.");
    }

    const gameDir = profileToDelete.gameDir || "";
    const resolvedGameDir = gameDir ? path.resolve(gameDir) : "";

    const result = await profileService.deleteProfile(id);

    const selected = await profileService.getSelectedProfile();
    await discordService.setLauncherActivity(selected?.name || "Launcher");

    let deletedGameDir = false;
    let skippedGameDirDeleteReason = "";
    let folderDeleteError = "";

    if (!resolvedGameDir) {
      skippedGameDirDeleteReason = "No game directory was set.";
    } else {
      const parsed = path.parse(resolvedGameDir);

      if (resolvedGameDir === parsed.root) {
        skippedGameDirDeleteReason = "Refused to delete a drive/root folder.";
      } else {
        const remainingProfilesData = await profileService.listProfiles();
        const remainingProfiles = Array.isArray(remainingProfilesData?.profiles)
          ? remainingProfilesData.profiles
          : [];

        const folderStillUsed = remainingProfiles.some((profile) => {
          if (!profile.gameDir) return false;
          return path.resolve(profile.gameDir) === resolvedGameDir;
        });

        if (folderStillUsed) {
          skippedGameDirDeleteReason = "Folder is still used by another installation.";
        } else {
          try {
            await fsp.rm(resolvedGameDir, {
              recursive: true,
              force: true,
            });

            deletedGameDir = true;
          } catch (error) {
            folderDeleteError = error.message || String(error);
          }
        }
      }
    }

    return {
      ...result,
      deletedGameDir,
      skippedGameDirDeleteReason,
      folderDeleteError,
    };
  });

  ipcMain.handle("profiles:setSelected", async (_event, id) => {
    const selected = await profileService.setSelectedProfile(id);
    await discordService.setLauncherActivity(selected.name);
    return selected;
  });

  ipcMain.handle("profiles:getSelected", async () => {
    return profileService.getSelectedProfile();
  });

  ipcMain.handle("profiles:listInstalledVersions", async () => {
    return profileService.listInstalledVersions();
  });

  ipcMain.handle("profiles:listMinecraftVersions", async (_event, options = {}) => {
    return profileService.listMinecraftVersions(options);
  });

  ipcMain.handle("profiles:pickGameDir", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose game folder",
      properties: ["openDirectory", "createDirectory"],
    });

    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("profiles:pickJava", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose Java executable",
      properties: ["openFile"],
    });

    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("profiles:pickCustomVersionJson", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose custom Minecraft version JSON",
      filters: [{ name: "Minecraft Version JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });

    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("profiles:pickIcon", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose installation icon PNG",
      filters: [{ name: "PNG Image", extensions: ["png"] }],
      properties: ["openFile"],
    });

    if (result.canceled || !result.filePaths[0]) return null;
    return profileService.importProfileIcon(result.filePaths[0]);
  });

  ipcMain.handle("java:list", async () => {
    return javaService.listInstalledJava();
  });

  ipcMain.handle("mods:list", async (_event, profileId) => {
    return modsService.listMods(profileId);
  });

  ipcMain.handle("mods:add", async (_event, profileId, filePaths = null) => {
    if (
      filePaths &&
      typeof filePaths === "object" &&
      !Array.isArray(filePaths) &&
      filePaths.source === "modrinth-collection"
    ) {
      return modsService.updateFromModrinthCollection(profileId, filePaths.collection);
    }

    if (Array.isArray(filePaths) && filePaths.length > 0) {
      return modsService.addMods(profileId, filePaths);
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Add mod jar files",
      filters: [{ name: "Minecraft Mods", extensions: ["jar"] }],
      properties: ["openFile", "multiSelections"],
    });

    if (result.canceled || result.filePaths.length === 0) return [];

    return modsService.addMods(profileId, result.filePaths);
  });

  ipcMain.handle("mods:remove", async (_event, profileId, filename) => {
    return modsService.removeMod(profileId, filename);
  });

  ipcMain.handle("mods:setEnabled", async (_event, profileId, filename, enabled) => {
    return modsService.setModEnabled(profileId, filename, enabled);
  });

  ipcMain.handle("skins:getMinecraftProfile", async () => {
    return getMinecraftProfileFromServices();
  });

  ipcMain.handle("skins:list", async () => {
    return withComputedSkinsData(readSkinsFile());
  });

  ipcMain.handle("skins:create", async (_event, data) => {
    return createSkin(data);
  });

  ipcMain.handle("skins:update", async (_event, id, patch) => {
    return updateSkin(id, patch);
  });

  ipcMain.handle("skins:duplicate", async (_event, id) => {
    return duplicateSkin(id);
  });

  ipcMain.handle("skins:delete", async (_event, id) => {
    return deleteSkin(id);
  });

  ipcMain.handle("skins:use", async (_event, id, options) => {
    return useSkin(id, options || {});
  });

  ipcMain.handle("skins:pickSkinFile", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose Minecraft skin PNG",
      filters: [{ name: "Minecraft Skin PNG", extensions: ["png"] }],
      properties: ["openFile"],
    });

    if (result.canceled || !result.filePaths[0]) return null;

    const sourcePath = result.filePaths[0];
    const buffer = await fsp.readFile(sourcePath);
    const targetPath = await importSkinBuffer(buffer, path.basename(sourcePath, ".png"));

    return {
      skinPath: targetPath,
      skinDataUrl: skinDataUrlFor(targetPath),
    };
  });

  ipcMain.handle("skins:saveEditorImage", async (_event, skinIdValue, dataUrl) => {
    const skinPath = await importSkinInput(dataUrl, skinIdValue || "skin-editor");

    return {
      skinPath,
      skinDataUrl: skinDataUrlFor(skinPath),
    };
  });

  ipcMain.handle("launcher:launch", async (_event, profileId) => {
    return launcherService.launch(profileId, mainWindow);
  });

  ipcMain.handle("launcher:isRunning", async (_event, profileId = null) => {
    return launcherService.isRunning(profileId);
  });

  ipcMain.handle("launcher:listInstances", async () => {
    return launcherService.listInstances();
  });

  ipcMain.handle("launcher:kill", async (_event, instanceId = null) => {
    return launcherService.kill(instanceId);
  });

  ipcMain.handle("updater:check", async () => {
    return updaterService.check();
  });

  ipcMain.handle("updater:download", async () => {
    return updaterService.download();
  });

  ipcMain.handle("updater:install", async () => {
    return updaterService.install();
  });

  ipcMain.handle("clientUpdater:getDefaultInfo", async () => {
    return clientUpdaterService.getDefaultClientUpdateInfo();
  });

  ipcMain.handle("clientUpdater:syncDefault", async (_event, options) => {
    await discordService.setUpdatingActivity();

    const result = await clientUpdaterService.syncDefaultClient(mainWindow, options || {});

    try {
      const selected = await profileService.getSelectedProfile();
      await discordService.setLauncherActivity(selected?.name || "Launcher");
    } catch {
      await discordService.setLauncherActivity("Launcher");
    }

    return result;
  });

  ipcMain.handle("discord:getStatus", async () => {
    return discordService.getStatus();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  Promise.resolve(discordService.destroy()).catch((error) => {
    console.warn("[discord] Failed to destroy RPC:", error.message || error);
  });
});

app.on("window-all-closed", () => {
  Promise.resolve(discordService.destroy()).catch((error) => {
    console.warn("[discord] Failed to destroy RPC:", error.message || error);
  });

  if (process.platform !== "darwin") {
    app.quit();
  }
});
