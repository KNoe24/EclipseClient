const { app } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");
const storage = require("./storage");
const settings = require("./settings");

const LAUNCHER_UPDATE_URL = "https://raw.githubusercontent.com/KNoe24/eclipse-updates/launcher/";

let mainWindow = null;
let updateInfo = null;
let eventsBound = false;
let feedConfigured = false;
let portableDownload = null;
let portableApplyOnQuit = false;

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = settings.getSettings().autoUpdateLauncher;

const PORTABLE_MANIFEST = "latest-portable.json";

function portableExecutable() {
  return process.platform === "win32" ? process.env.PORTABLE_EXECUTABLE_FILE || "" : "";
}

function pendingUpdatePaths() {
  const exe = portableExecutable();
  return exe ? { exe, file: `${exe}.update`, meta: `${exe}.update.json` } : null;
}

function compareVersions(a, b) {
  const pa = String(a || "0").split("-")[0].split(".").map((part) => Number(part) || 0);
  const pb = String(b || "0").split("-")[0].split(".").map((part) => Number(part) || 0);

  for (let index = 0; index < Math.max(pa.length, pb.length); index += 1) {
    const diff = (pa[index] || 0) - (pb[index] || 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

function readPendingPortableUpdate() {
  const paths = pendingUpdatePaths();
  if (!paths) return null;

  try {
    const meta = JSON.parse(fs.readFileSync(paths.meta, "utf8"));

    if (fs.existsSync(paths.file) && compareVersions(meta.version, app.getVersion()) > 0) {
      return { ...paths, version: meta.version };
    }
  } catch {
    return null;
  }

  return null;
}

function cleanupStalePortableUpdate() {
  const paths = pendingUpdatePaths();
  if (!paths || readPendingPortableUpdate()) return;

  fs.rmSync(paths.file, { force: true });
  fs.rmSync(paths.meta, { force: true });
  fs.rmSync(`${paths.file}.part`, { force: true });
}

async function downloadPortableFile(url, destination, expectedSha512, totalBytes) {
  const response = await fetch(url);

  if (!response.ok || !response.body) {
    throw new Error(`Download failed (HTTP ${response.status}).`);
  }

  const hash = crypto.createHash("sha512");
  const total = Number(response.headers.get("content-length")) || totalBytes || 0;
  let transferred = 0;
  let lastPercent = -1;

  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      transferred += chunk.length;

      const percent = total ? Math.floor((transferred / total) * 100) : 0;

      if (percent !== lastPercent && percent % 5 === 0) {
        lastPercent = percent;
        sendStatus("download-progress", { progress: { percent, transferred, total } });
      }

      callback(null, chunk);
    },
  });

  const partFile = `${destination}.part`;

  await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(partFile));

  if (hash.digest("hex") !== String(expectedSha512 || "").toLowerCase()) {
    fs.rmSync(partFile, { force: true });
    throw new Error("The downloaded update is damaged (checksum mismatch). Try again later.");
  }

  fs.renameSync(partFile, destination);
}

async function checkPortable() {
  const pending = readPendingPortableUpdate();

  if (pending) {
    updateInfo = { version: pending.version, portable: true };
    portableApplyOnQuit = settings.getSettings().autoUpdateLauncher;
    sendStatus("downloaded", { info: updateInfo });
    return { ok: true, portable: true, pending: true };
  }

  sendStatus("checking");

  const response = await fetch(`${LAUNCHER_UPDATE_URL}${PORTABLE_MANIFEST}`, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });

  if (!response.ok) {
    throw new Error(`Could not read ${PORTABLE_MANIFEST} (HTTP ${response.status}).`);
  }

  const manifest = await response.json();

  if (!manifest?.version || !manifest?.file || !manifest?.sha512) {
    throw new Error(`${PORTABLE_MANIFEST} is missing version, file or sha512.`);
  }

  if (compareVersions(manifest.version, app.getVersion()) <= 0) {
    sendStatus("not-available", { info: manifest });
    return { ok: true, portable: true, updateAvailable: false };
  }

  updateInfo = { ...manifest, portable: true };
  sendStatus("available", { info: updateInfo });

  if (!portableDownload) {
    const paths = pendingUpdatePaths();

    portableDownload = downloadPortableFile(
      `${LAUNCHER_UPDATE_URL}${encodeURIComponent(manifest.file)}`,
      paths.file,
      manifest.sha512,
      manifest.size
    )
      .then(() => {
        fs.writeFileSync(paths.meta, JSON.stringify({ version: manifest.version }, null, 2));
        portableApplyOnQuit = settings.getSettings().autoUpdateLauncher;
        sendStatus("downloaded", { info: updateInfo });
      })
      .catch((error) => {
        sendStatus("error", {
          message: error.message || String(error),
          stack: error.stack || "",
        });
      })
      .finally(() => {
        portableDownload = null;
      });
  }

  return { ok: true, portable: true, updateAvailable: true };
}

function applyPortableUpdate(restart) {
  const pending = readPendingPortableUpdate();
  if (!pending) return false;

  const script = path.join(os.tmpdir(), `eclipse-portable-update-${Date.now()}.cmd`);

  fs.writeFileSync(
    script,
    [
      "@echo off",
      "setlocal",
      "set /a TRIES=0",
      ":retry",
      `move /Y "${pending.file}" "${pending.exe}" >nul 2>&1`,
      "if not errorlevel 1 goto done",
      "set /a TRIES+=1",
      "if %TRIES% GEQ 90 goto end",
      "ping -n 2 127.0.0.1 >nul",
      "goto retry",
      ":done",
      `del "${pending.meta}" >nul 2>&1`,
      restart ? `start "" "${pending.exe}"` : "rem no restart",
      ":end",
      'del "%~f0"',
      "",
    ].join("\r\n")
  );

  spawn("cmd.exe", ["/d", "/c", script], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();

  return true;
}

function setAutoUpdateLauncher(enabled) {
  autoUpdater.autoInstallOnAppQuit = Boolean(enabled);
  portableApplyOnQuit = Boolean(enabled) && Boolean(readPendingPortableUpdate());
}

function configureFeed() {
  if (feedConfigured) return;

  feedConfigured = true;

  autoUpdater.setFeedURL({
    provider: "generic",
    url: LAUNCHER_UPDATE_URL,
  });
}

function sendToAppConsole(message) {
  console.log(message);

  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.webContents.send("game:log", message);
}

function sendStatus(type, data = {}) {
  const payload = {
    type,
    ...data,
  };

  console.log("[launcher updater]", payload);

  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.webContents.send("updater:status", payload);

  if (type === "manual-check-started") {
    sendToAppConsole(
      `[launcher updater] Checking launcher updates... Current version: ${data.appVersion || app.getVersion()}`
    );
  }

  if (type === "checking") {
    sendToAppConsole("[launcher updater] Contacting update server...");
  }

  if (type === "available") {
    sendToAppConsole(
      `[launcher updater] Update available: ${data.info?.version || "unknown version"}`
    );
  }

  if (type === "not-available") {
    sendToAppConsole("[launcher updater] Launcher is up to date.");
  }

  if (type === "download-progress") {
    const percent = Math.round(data.progress?.percent || 0);
    sendToAppConsole(`[launcher updater] Downloading launcher update: ${percent}%`);
  }

  if (type === "downloaded") {
    sendToAppConsole("[launcher updater] Launcher update downloaded. Restart to install.");
  }

  if (type === "dev-mode" || type === "disabled") {
    sendToAppConsole(`[launcher updater] ${data.message}`);
  }

  if (type === "error") {
    sendToAppConsole(`[launcher updater error] ${data.message}`);
  }
}

function bindWindow(window) {
  mainWindow = window;
  configureFeed();

  if (eventsBound) {
    return;
  }

  eventsBound = true;

  if (portableExecutable()) {
    cleanupStalePortableUpdate();

    app.on("will-quit", () => {
      if (portableApplyOnQuit) {
        portableApplyOnQuit = false;
        applyPortableUpdate(false);
      }
    });
  }

  autoUpdater.on("checking-for-update", () => {
    sendStatus("checking");
  });

  autoUpdater.on("update-available", (info) => {
    updateInfo = info;
    sendStatus("available", { info });
  });

  autoUpdater.on("update-not-available", (info) => {
    sendStatus("not-available", { info });
  });

  autoUpdater.on("error", (error) => {
    sendStatus("error", {
      message: error.message || String(error),
      stack: error.stack || "",
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    sendStatus("download-progress", {
      progress,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    updateInfo = info;
    sendStatus("downloaded", { info });
  });
}

async function check(options = {}) {
  configureFeed();

  const manual = Boolean(options.manual);

  if (!manual && !settings.getSettings().autoUpdateLauncher) {
    const message = "Launcher auto-update is off. Use Check for updates in Settings to update.";

    sendStatus("disabled", { message });

    return {
      ok: false,
      disabled: true,
      message,
    };
  }

  sendStatus("manual-check-started", {
    packaged: app.isPackaged,
    updateUrl: LAUNCHER_UPDATE_URL,
    appVersion: app.getVersion(),
  });

  if (!app.isPackaged) {
    sendStatus("dev-mode", {
      message: "Auto-updater only works in packaged builds.",
    });

    return {
      ok: false,
      devMode: true,
      message: "Auto-updater only works in packaged builds.",
    };
  }

  if (portableExecutable()) {
    try {
      return await checkPortable();
    } catch (error) {
      sendStatus("error", {
        message: error.message || String(error),
        stack: error.stack || "",
      });

      return {
        ok: false,
        error: error.message || String(error),
      };
    }
  }

  if (storage.isPortable() && !process.env.APPIMAGE) {
    const message =
      "This portable folder can't update itself. Use the portable .exe build, or replace the launcher files with the new version.";

    sendStatus("dev-mode", { message });

    return {
      ok: false,
      portable: true,
      message,
    };
  }

  try {
    const result = await autoUpdater.checkForUpdates();

    return {
      ok: true,
      result,
    };
  } catch (error) {
    sendStatus("error", {
      message: error.message || String(error),
      stack: error.stack || "",
    });

    return {
      ok: false,
      error: error.message || String(error),
    };
  }
}

async function download() {
  configureFeed();

  if (!updateInfo) {
    const error = "No update available.";

    sendStatus("error", {
      message: error,
    });

    return {
      ok: false,
      error,
    };
  }

  try {
    await autoUpdater.downloadUpdate();

    return {
      ok: true,
    };
  } catch (error) {
    sendStatus("error", {
      message: error.message || String(error),
      stack: error.stack || "",
    });

    return {
      ok: false,
      error: error.message || String(error),
    };
  }
}

async function install() {
  try {
    if (portableExecutable()) {
      portableApplyOnQuit = false;

      if (!applyPortableUpdate(true)) {
        throw new Error("No downloaded update to install.");
      }

      app.quit();

      return {
        ok: true,
      };
    }

    autoUpdater.quitAndInstall(false, true);

    return {
      ok: true,
    };
  } catch (error) {
    sendStatus("error", {
      message: error.message || String(error),
      stack: error.stack || "",
    });

    return {
      ok: false,
      error: error.message || String(error),
    };
  }
}

module.exports = {
  bindWindow,
  check,
  setAutoUpdateLauncher,
  download,
  install,
};
