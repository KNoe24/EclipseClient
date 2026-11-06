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
    listAccounts: () => ipcRenderer.invoke("auth:listAccounts"),
    switchAccount: (uuid) => ipcRenderer.invoke("auth:switchAccount", uuid),
    removeAccount: (uuid) => ipcRenderer.invoke("auth:removeAccount", uuid),
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

  modpacks: {
    search: (options = {}) => ipcRenderer.invoke("modpacks:search", options),
    versions: (projectId) => ipcRenderer.invoke("modpacks:versions", projectId),
    pickFile: () => ipcRenderer.invoke("modpacks:pickFile"),
    install: (source) => ipcRenderer.invoke("modpacks:install", source),
    onProgress: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("modpacks:progress", listener);
      return () => ipcRenderer.removeListener("modpacks:progress", listener);
    },
  },

  share: {
    exportProfile: (profileId, options = {}) =>
      ipcRenderer.invoke("share:export", profileId, options),
    preview: (code) => ipcRenderer.invoke("share:preview", code),
    importCode: (code, options = {}) => ipcRenderer.invoke("share:import", code, options),
    onProgress: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("share:progress", listener);
      return () => ipcRenderer.removeListener("share:progress", listener);
    },
  },

  sharedFolders: {
    get: () => ipcRenderer.invoke("sharedFolders:get"),
    update: (patch) => ipcRenderer.invoke("sharedFolders:update", patch),
    choose: (folderId = "") => ipcRenderer.invoke("sharedFolders:choose", folderId),
    reset: (folderId = "") => ipcRenderer.invoke("sharedFolders:reset", folderId),
    add: (name, label = "") => ipcRenderer.invoke("sharedFolders:add", name, label),
    remove: (folderId) => ipcRenderer.invoke("sharedFolders:remove", folderId),
    getProfile: (profileId) => ipcRenderer.invoke("sharedFolders:getProfile", profileId),
    setProfile: (profileId, patch, options = {}) =>
      ipcRenderer.invoke("sharedFolders:setProfile", profileId, patch, options),
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

    searchModrinth: (profileId, options = {}) => {
      return ipcRenderer.invoke("mods:searchModrinth", profileId, options);
    },

    modrinthPlan: (profileId, projectId) => {
      return ipcRenderer.invoke("mods:modrinthPlan", profileId, projectId);
    },

    installModrinth: (profileId, projectId, options = {}) => {
      return ipcRenderer.invoke("mods:installModrinth", profileId, projectId, options);
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

  dev: {
    openDevTools: () => ipcRenderer.invoke("dev:openDevTools"),
    relaunch: () => ipcRenderer.invoke("dev:relaunch"),
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
