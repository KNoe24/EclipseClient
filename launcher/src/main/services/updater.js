const { app } = require("electron");
const { autoUpdater } = require("electron-updater");

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

function sendStatus(type, data = {}) {
  const payload = {
    type,
    ...data,
  };

  console.log("[launcher updater]", payload);

  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.webContents.send("updater:status", payload);
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

  sendStatus("manual-check-started");

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
    return {
      ok: false,
      error: "No update available.",
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
