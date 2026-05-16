const { app } = require("electron");
const { autoUpdater } = require("electron-updater");

let mainWindow = null;
let updateInfo = null;
let eventsBound = false;

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function sendStatus(type, data = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.webContents.send("updater:status", {
    type,
    ...data,
  });
}

function bindWindow(window) {
  mainWindow = window;

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

  const result = await autoUpdater.checkForUpdates();

  return {
    ok: true,
    result,
  };
}

async function download() {
  if (!updateInfo) {
    return {
      ok: false,
      error: "No update available.",
    };
  }

  await autoUpdater.downloadUpdate();

  return {
    ok: true,
  };
}

async function install() {
  autoUpdater.quitAndInstall(false, true);

  return {
    ok: true,
  };
}

module.exports = {
  bindWindow,
  check,
  download,
  install,
};
