const { app } = require("electron");
const { autoUpdater } = require("electron-updater");
const storage = require("./storage");

const LAUNCHER_UPDATE_URL = "https://raw.githubusercontent.com/KNoe24/eclipse-updates/launcher/";

let mainWindow = null;
let updateInfo = null;
let eventsBound = false;
let feedConfigured = false;

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

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

  if (type === "dev-mode") {
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

async function check() {
  configureFeed();

  sendStatus("manual-check-started", {
    packaged: app.isPackaged,
    updateUrl: LAUNCHER_UPDATE_URL,
    appVersion: app.getVersion(),
  });

  if (storage.isPortable()) {
    const message =
      "Auto-update is off in portable mode. Download the new portable version to update.";

    sendStatus("dev-mode", { message });

    return {
      ok: false,
      portable: true,
      message,
    };
  }

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
  download,
  install,
};
