const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("launcherAPI", {
  system: {
    getMemoryInfo: () => ipcRenderer.invoke("system:getMemoryInfo"),
    getAppInfo: () => ipcRenderer.invoke("system:getAppInfo"),
  },

  auth: {
    login: () => ipcRenderer.invoke("auth:login"),
    getAccount: () => ipcRenderer.invoke("auth:getAccount"),
    loginOffline: (username) => ipcRenderer.invoke("auth:loginOffline", username),
    getOfflineEligibility: () => ipcRenderer.invoke("auth:getOfflineEligibility"),
    logout: () => ipcRenderer.invoke("auth:logout"),
  },

  links: {
    openExternal: (url) => ipcRenderer.invoke("links:openExternal", url),
  },

  folders: {
    openPath: (folderPath) => ipcRenderer.invoke("folders:openPath", folderPath),
  },

  profiles: {
    list: () => ipcRenderer.invoke("profiles:list"),
    create: (profile) => ipcRenderer.invoke("profiles:create", profile),
    update: (id, patch) => ipcRenderer.invoke("profiles:update", id, patch),
    delete: (id) => ipcRenderer.invoke("profiles:delete", id),
    setSelected: (id) => ipcRenderer.invoke("profiles:setSelected", id),
    getSelected: () => ipcRenderer.invoke("profiles:getSelected"),
    listInstalledVersions: () => ipcRenderer.invoke("profiles:listInstalledVersions"),
    listMinecraftVersions: (options) =>
      ipcRenderer.invoke("profiles:listMinecraftVersions", options),
    pickGameDir: () => ipcRenderer.invoke("profiles:pickGameDir"),
    pickJava: () => ipcRenderer.invoke("profiles:pickJava"),
    pickCustomVersionJson: () => ipcRenderer.invoke("profiles:pickCustomVersionJson"),
    pickIcon: () => ipcRenderer.invoke("profiles:pickIcon"),
  },

  java: {
    list: () => ipcRenderer.invoke("java:list"),
    checkForProfile: (profileId) => ipcRenderer.invoke("java:checkForProfile", profileId),
    install: (component) => ipcRenderer.invoke("java:install", component),
    onInstallProgress: (callback) => {
      ipcRenderer.on("java:installProgress", (_event, data) => callback(data));
    },
  },

  mods: {
    list: (profileId) => ipcRenderer.invoke("mods:list", profileId),

    getDroppedFilePaths: (files) => {
      return Array.from(files || [])
        .map((file) => webUtils.getPathForFile(file))
        .filter(Boolean);
    },

    add: (profileId, filePaths = null) => {
      return ipcRenderer.invoke("mods:add", profileId, filePaths);
    },

    remove: (profileId, filename) => {
      return ipcRenderer.invoke("mods:remove", profileId, filename);
    },

    setEnabled: (profileId, filename, enabled) => {
      return ipcRenderer.invoke("mods:setEnabled", profileId, filename, enabled);
    },
  },

  skins: {
    getMinecraftProfile: () => ipcRenderer.invoke("skins:getMinecraftProfile"),

    list: () => ipcRenderer.invoke("skins:list"),

    create: (data) => {
      return ipcRenderer.invoke("skins:create", data);
    },

    update: (skinId, patch) => {
      return ipcRenderer.invoke("skins:update", skinId, patch);
    },

    duplicate: (skinId) => {
      return ipcRenderer.invoke("skins:duplicate", skinId);
    },

    delete: (skinId) => {
      return ipcRenderer.invoke("skins:delete", skinId);
    },

    use: (skinId, options = {}) => {
      return ipcRenderer.invoke("skins:use", skinId, options);
    },

    pickSkinFile: () => {
      return ipcRenderer.invoke("skins:pickSkinFile");
    },

    saveEditorImage: (skinId, dataUrl) => {
      return ipcRenderer.invoke("skins:saveEditorImage", skinId, dataUrl);
    },
  },

  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (key, value) => ipcRenderer.invoke("settings:set", key, value),
  },

  pvphq: {
    getStats: (player = "") => ipcRenderer.invoke("pvphq:getStats", player),
  },

  launcher: {
    launch: (profileId) => ipcRenderer.invoke("launcher:launch", profileId),
    isRunning: (profileId = null) => ipcRenderer.invoke("launcher:isRunning", profileId),
    listInstances: () => ipcRenderer.invoke("launcher:listInstances"),
    kill: (instanceId = null) => ipcRenderer.invoke("launcher:kill", instanceId),
  },

  updater: {
    check: () => ipcRenderer.invoke("updater:check"),
    download: () => ipcRenderer.invoke("updater:download"),
    install: () => ipcRenderer.invoke("updater:install"),
  },

  clientUpdater: {
    getDefaultInfo: () => ipcRenderer.invoke("clientUpdater:getDefaultInfo"),
    syncDefault: (options) => ipcRenderer.invoke("clientUpdater:syncDefault", options),
  },

  discord: {
    getStatus: () => ipcRenderer.invoke("discord:getStatus"),
  },

  events: {
    onGameLog: (callback) => {
      ipcRenderer.on("game:log", (_event, line) => callback(line));
    },

    onInstanceLog: (callback) => {
      ipcRenderer.on("instance:log", (_event, data) => callback(data));
    },

    onGameClose: (callback) => {
      ipcRenderer.on("game:close", (_event, data) => callback(data));
    },

    onInstancesChanged: (callback) => {
      ipcRenderer.on("launcher:instances", (_event, list) => callback(list));
    },

    onUpdaterStatus: (callback) => {
      ipcRenderer.on("updater:status", (_event, data) => callback(data));
    },

    onClientUpdaterStatus: (callback) => {
      ipcRenderer.on("clientUpdater:status", (_event, data) => callback(data));
    },
  },
});
