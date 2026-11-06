const DEFAULT_PLAYER_HEAD = "./static/img/default_logged_out_head.png";
const INSTALLATION_ICON_BASE_PATH = "./static/img/installation-icons/";
const DEFAULT_STEVE_SKIN = "./static/img/steve.png";

const MAX_CONSOLE_LINES = 1200;
const DEFAULT_MEMORY_TOTAL_GB = 8;

let detectedTotalMemoryGb = DEFAULT_MEMORY_TOTAL_GB;
let launchProgressTimer = null;
let clientUpdateProgressValue = 0;
let playerHeadRefreshToken = Date.now();
const wrongJavaCrashInstances = new Set();

let skinEditorViewer = null;
let currentSkinViewer = null;
let selectedSkinViewer = null;

const capePreviewColors = [
  "#d7497d",
  "#8a1f3b",
  "#6433d4",
  "#1aa2d4",
  "#e0b22f",
  "#7f58ff",
  "#3b8c44",
  "#b54838",
];

const LAUNCHER_SETTING_KEYS = {
  keepLauncherOpenOnLaunch: "launcher.keepLauncherOpenOnLaunch",
  openConsoleOnLaunch: "launcher.openConsoleOnLaunch",
};

const DEFAULT_INSTALLATION_ICONS = [
  { id: "grass", label: "Grass" },
  { id: "dirt", label: "Dirt" },
  { id: "stone", label: "Stone" },
  { id: "diamond", label: "Diamond" },
  { id: "crafting", label: "Crafting Table" },
  { id: "furnace", label: "Furnace" },
];

const CONSOLE_VIEW_ALL = "all";
const CONSOLE_VIEW_LAUNCHER = "launcher";

const consoleStore = {
  view: CONSOLE_VIEW_ALL,
  buffers: new Map([
    [CONSOLE_VIEW_ALL, []],
    [CONSOLE_VIEW_LAUNCHER, []],
  ]),
  instances: new Map(),
  dirty: new Set(),
};

let consoleRenderScheduled = false;

const state = {
  account: null,
  profilesData: null,
  selectedProfile: null,
  currentPage: "home",
  dropupOpen: false,
  installedVersions: [],
  minecraftVersions: [],
  javaInstallations: [],
  runningInstances: [],
  launcherUpdate: null,
  clientUpdateInfo: null,
  updateSettings: null,
  installationBackdropMouseDownOnBackdrop: false,
  installationEditor: {
    profileId: null,
    tab: "settings",
  },
  skins: {
    loaded: false,
    minecraftProfile: null,
    library: [],
    selectedSkinId: null,
    editorOpen: false,
    editorSkinId: null,
    editorImageDataUrl: "",
    editorCanvasDirty: false,
    previewRotation: 0,
    previewDragging: false,
    previewDragStartX: 0,
    previewDragStartRotation: 0,
    animationFrame: null,
  },
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function setStatus(text) {
  const status = $("#launcherStatus");
  if (status) status.textContent = text;
}

function setDiscordStatus(text) {
  const status = $("#discordStatus");
  if (status) status.textContent = text;
}

function setUpdateStatus(text) {
  const status = $("#updateStatus");
  if (status) status.textContent = text;
}

function readBooleanSetting(key, defaultValue) {
  const value = localStorage.getItem(key);

  if (value === null) {
    return defaultValue;
  }

  return value === "true";
}

function writeBooleanSetting(key, value) {
  localStorage.setItem(key, value ? "true" : "false");
}

function getLauncherSettings() {
  return {
    keepLauncherOpenOnLaunch: readBooleanSetting(
      LAUNCHER_SETTING_KEYS.keepLauncherOpenOnLaunch,
      true
    ),
    openConsoleOnLaunch: readBooleanSetting(LAUNCHER_SETTING_KEYS.openConsoleOnLaunch, false),
  };
}

function fillLauncherSettingsControls() {
  const settings = getLauncherSettings();

  const keepOpen = $("#settingKeepLauncherOpenOnLaunch");
  if (keepOpen) {
    keepOpen.checked = settings.keepLauncherOpenOnLaunch;
  }

  const openConsole = $("#settingOpenConsoleOnLaunch");
  if (openConsole) {
    openConsole.checked = settings.openConsoleOnLaunch;
  }
}

function saveLauncherSettingsControls() {
  const keepOpen = $("#settingKeepLauncherOpenOnLaunch");
  const openConsole = $("#settingOpenConsoleOnLaunch");

  if (keepOpen) {
    writeBooleanSetting(LAUNCHER_SETTING_KEYS.keepLauncherOpenOnLaunch, keepOpen.checked);
  }

  if (openConsole) {
    writeBooleanSetting(LAUNCHER_SETTING_KEYS.openConsoleOnLaunch, openConsole.checked);
  }

  setStatus("Launcher settings saved.");
  appendConsole("[settings] Saved launcher settings.");
}

function initLauncherSettingsEvents() {
  const keepOpen = $("#settingKeepLauncherOpenOnLaunch");
  if (keepOpen) {
    keepOpen.addEventListener("change", () => {
      writeBooleanSetting(LAUNCHER_SETTING_KEYS.keepLauncherOpenOnLaunch, keepOpen.checked);
    });
  }

  const openConsole = $("#settingOpenConsoleOnLaunch");
  if (openConsole) {
    openConsole.addEventListener("change", () => {
      writeBooleanSetting(LAUNCHER_SETTING_KEYS.openConsoleOnLaunch, openConsole.checked);
    });
  }

  fillLauncherSettingsControls();
}

function injectDynamicStyles() {
  // Styles are defined in newstyles.css.
}

function setPlayerHead(account, forceRefresh = false) {
  const head = $("#playerHead");
  if (!head) return;

  head.onerror = null;

  if (forceRefresh) {
    playerHeadRefreshToken = Date.now();
  }

  if (account && account.uuid && account.type !== "offline") {
    const url = playerFaceUrl(account.uuid);

    head.onerror = () => {
      head.onerror = null;
      head.src = DEFAULT_PLAYER_HEAD;
    };

    if (forceRefresh) {
      fetch(url, { cache: "reload", mode: "no-cors" })
        .catch(() => {})
        .then(() => {
          if (state.account?.uuid !== account.uuid) return;
          head.removeAttribute("src");
          head.src = url;
        });
    }

    head.src = url;

    return;
  }

  head.src = DEFAULT_PLAYER_HEAD;
}
function playerFaceUrl(uuid) {
  const id = String(uuid || "").replace(/-/g, "");
  return `https://api.mineatar.io/face/${encodeURIComponent(id)}?scale=32`;
}

function refreshLoginCardHeadAfterSkinChange() {
  setPlayerHead(state.account, true);

  setTimeout(() => {
    setPlayerHead(state.account, true);
  }, 2500);

  setTimeout(() => {
    setPlayerHead(state.account, true);
  }, 8000);
}
function pushConsoleLine(bufferKey, line) {
  let buffer = consoleStore.buffers.get(bufferKey);

  if (!buffer) {
    buffer = [];
    consoleStore.buffers.set(bufferKey, buffer);
  }

  buffer.push(line);

  if (buffer.length > MAX_CONSOLE_LINES + 200) {
    buffer.splice(0, buffer.length - MAX_CONSOLE_LINES);
  }

  consoleStore.dirty.add(bufferKey);
}

function renderConsole() {
  consoleRenderScheduled = false;

  const view = consoleStore.view;
  const forceScroll = consoleStore.dirty.has("__scroll");
  const needsRender = consoleStore.dirty.has(view) || consoleStore.dirty.has("__force");

  consoleStore.dirty.clear();

  if (!needsRender) return;

  const output = $("#consoleOutput");
  if (!output) return;

  const lines = consoleStore.buffers.get(view) || [];
  const visible = lines.length > MAX_CONSOLE_LINES ? lines.slice(-MAX_CONSOLE_LINES) : lines;

  const stickToBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 40;

  output.textContent = visible.join("\n") + (visible.length > 0 ? "\n" : "");

  if (stickToBottom || forceScroll) {
    output.scrollTop = output.scrollHeight;
  }
}

function scheduleConsoleRender() {
  if (consoleRenderScheduled) return;

  consoleRenderScheduled = true;

  requestAnimationFrame(() => {
    renderConsole();
  });
}

function appendConsole(line) {
  const text = String(line ?? "");

  pushConsoleLine(CONSOLE_VIEW_LAUNCHER, text);
  pushConsoleLine(CONSOLE_VIEW_ALL, text);

  scheduleConsoleRender();
  scheduleConsoleWidgetRefresh();
}

function instanceLabel(instance) {
  if (!instance) return "Instance";
  return `${instance.profileName || "Minecraft"} #${instance.number || "?"}`;
}

function appendInstanceConsole(instanceId, line) {
  const text = String(line ?? "");
  const instance = consoleStore.instances.get(instanceId);

  pushConsoleLine(instanceId, text);
  pushConsoleLine(CONSOLE_VIEW_ALL, `[${instanceLabel(instance)}] ${text}`);

  scheduleConsoleRender();
  scheduleConsoleWidgetRefresh();
}

function instanceStatusText(instance) {
  if (instance.status === "running") return "running";
  if (instance.status === "preparing") return "starting";
  if (instance.exitCode === 0) return "closed";
  if (instance.exitCode === undefined || instance.exitCode === null) return "closed";
  return `crashed (${instance.exitCode})`;
}

function renderConsoleInstanceSelect() {
  const select = $("#consoleInstanceSelect");
  if (!select) return;

  const options = [
    { value: CONSOLE_VIEW_ALL, label: "All logs" },
    { value: CONSOLE_VIEW_LAUNCHER, label: "Launcher" },
  ];

  const sortedInstances = Array.from(consoleStore.instances.values()).sort(
    (a, b) => (b.startedAt || 0) - (a.startedAt || 0)
  );

  for (const instance of sortedInstances) {
    options.push({
      value: instance.instanceId,
      label: `${instanceLabel(instance)} \u2014 ${instanceStatusText(instance)}`,
    });
  }

  if (!options.some((option) => option.value === consoleStore.view)) {
    consoleStore.view = CONSOLE_VIEW_ALL;
  }

  const signature = JSON.stringify([consoleStore.view, options]);

  if (select.dataset.signature === signature) {
    renderConsoleStopButton();
    return;
  }

  select.dataset.signature = signature;

  select.innerHTML = options
    .map(
      (option) =>
        `<option value="${escapeHtml(option.value)}"${
          option.value === consoleStore.view ? " selected" : ""
        }>${escapeHtml(option.label)}</option>`
    )
    .join("");

  renderConsoleStopButton();
}

function renderConsoleStopButton() {
  const button = $("#consoleStopInstanceBtn");
  if (!button) return;

  const instance = consoleStore.instances.get(consoleStore.view);
  const canStop = instance && (instance.status === "running" || instance.status === "preparing");
  const anyRunning = Array.from(consoleStore.instances.values()).some(
    (item) => item.status === "running" || item.status === "preparing"
  );

  if (instance) {
    button.textContent = "Stop";
    button.disabled = !canStop;
    button.classList.toggle("hidden", false);
  } else {
    button.textContent = "Stop all";
    button.disabled = !anyRunning;
    button.classList.toggle("hidden", !anyRunning);
  }
}

function setConsoleView(view) {
  consoleStore.view = consoleStore.buffers.has(view) ? view : CONSOLE_VIEW_ALL;

  const select = $("#consoleInstanceSelect");
  if (select && select.value !== consoleStore.view) {
    renderConsoleInstanceSelect();
  }

  renderConsoleStopButton();

  consoleStore.dirty.add("__force");
  consoleStore.dirty.add("__scroll");
  renderConsole();
}

function syncConsoleInstances(list = []) {
  const liveIds = new Set();

  for (const info of list) {
    liveIds.add(info.instanceId);

    const existing = consoleStore.instances.get(info.instanceId) || {};
    consoleStore.instances.set(info.instanceId, { ...existing, ...info });

    if (!consoleStore.buffers.has(info.instanceId)) {
      consoleStore.buffers.set(info.instanceId, []);
    }
  }

  for (const instance of consoleStore.instances.values()) {
    if (!liveIds.has(instance.instanceId) && instance.status !== "exited") {
      instance.status = "exited";
    }
  }

  state.runningInstances = list;

  renderConsoleInstanceSelect();
  renderProfilesList();
  refreshWidget("quickstart");
  renderDeveloperInstances();
}

function runningInstancesForProfile(profileId) {
  return (state.runningInstances || []).filter((instance) => instance.profileId === profileId);
}

function refreshConsole() {
  consoleStore.dirty.add("__force");
  renderConsole();
}

function clearConsole() {
  const view = consoleStore.view;

  if (view === CONSOLE_VIEW_ALL) {
    for (const key of consoleStore.buffers.keys()) {
      consoleStore.buffers.set(key, []);
    }

    for (const [id, instance] of consoleStore.instances) {
      if (instance.status === "exited") {
        consoleStore.instances.delete(id);
        consoleStore.buffers.delete(id);
      }
    }

    renderConsoleInstanceSelect();
  } else {
    consoleStore.buffers.set(view, []);
  }

  const output = $("#consoleOutput");
  if (output) output.textContent = "";
}

function loadNewsFrame(frame) {
  if (!frame) return;

  const src = frame.dataset.src;
  if (!src) return;

  if (!frame.getAttribute("src")) {
    frame.setAttribute("src", src);
  }
}

function loadActiveNewsFrame() {
  const activeFrame = $(".news-frame.active");
  loadNewsFrame(activeFrame);
}

function showHomeTab(name) {
  $$(".home-subpage").forEach((page) => {
    page.classList.toggle("active", page.dataset.homePage === name);
  });

  $$(".home-top-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.homeTab === name);
  });

  closeProfileDropup();

  if (name !== "home" && homeWidgets.editing) {
    closeCustomizePanel();
  }

  if (name === "skin") {
    loadSkinPageData();
  }
}

function initHomeTabs() {
  $$(".home-top-btn").forEach((button) => {
    button.addEventListener("click", () => {
      showHomeTab(button.dataset.homeTab);
    });
  });
}

const SIMPLE_MODE_KEY = "launcher.simpleMode";
const SIMPLE_MODE_HIDDEN_PAGES = new Set(["console", "changelog"]);

function isSimpleMode() {
  return document.body.classList.contains("simple-mode");
}

function applySimpleModeTexts(on) {
  $$("[data-simple]").forEach((element) => {
    if (on) {
      if (element.dataset.normalText === undefined)
        element.dataset.normalText = element.textContent;
      element.textContent = element.dataset.simple;
    } else if (element.dataset.normalText !== undefined) {
      element.textContent = element.dataset.normalText;
      delete element.dataset.normalText;
    }
  });
}

function setSimpleMode(on, options = {}) {
  const enabled = Boolean(on);

  document.body.classList.toggle("simple-mode", enabled);
  applySimpleModeTexts(enabled);

  try {
    localStorage.setItem(SIMPLE_MODE_KEY, enabled ? "true" : "false");
  } catch {}

  const devToggle = $("#devSimpleMode");
  if (devToggle) devToggle.checked = enabled;

  const exitToggle = $("#settingSimpleModeExit");
  if (exitToggle) exitToggle.checked = true;

  if (enabled && SIMPLE_MODE_HIDDEN_PAGES.has(state.currentPage)) {
    showPage("home");
  }

  if (enabled && state.installationEditor?.tab === "folders") {
    showEditorTab("settings");
  }

  if (!options.silent && typeof renderHomeWidgets === "function" && homeWidgets?.config) {
    renderHomeWidgets();
  }

  if (!options.silent) {
    setStatus(
      enabled ? "Baby Mode on: only the basics are shown." : "Baby Mode off: all options are back."
    );
  }
}

function initSimpleMode() {
  let saved = false;

  try {
    saved = localStorage.getItem(SIMPLE_MODE_KEY) === "true";
  } catch {}

  setSimpleMode(saved, { silent: true });

  $("#devSimpleMode")?.addEventListener("change", (event) => {
    setSimpleMode(event.target.checked);
  });

  $("#settingSimpleModeExit")?.addEventListener("change", (event) => {
    if (!event.target.checked) setSimpleMode(false);
  });
}

function showPage(name) {
  if (isSimpleMode() && SIMPLE_MODE_HIDDEN_PAGES.has(name)) {
    name = "home";
  }

  state.currentPage = name;

  $$(".page").forEach((page) => page.classList.remove("active"));

  const page = $(`#page-${name}`);
  if (page) page.classList.add("active");

  $$(".nav-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === name);
  });

  closeProfileDropup();

  if (name !== "home" && homeWidgets.editing) {
    closeCustomizePanel();
  }

  if (name === "console") {
    refreshConsole();
  }

  if (name === "mods") {
    renderMods();
  }

  if (name === "settings") {
    fillSettingsForm();
    fillLauncherSettingsControls();
  }

  if (name === "changelog") {
    loadActiveNewsFrame();
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function selectedProfileId() {
  const select = $("#profileSelect");
  return select?.value || state.profilesData?.selectedProfileId;
}

function findProfile(id) {
  return state.profilesData?.profiles.find((profile) => profile.id === id) || null;
}

function getSelectedProfile() {
  return findProfile(selectedProfileId());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeIconId(value) {
  const found = DEFAULT_INSTALLATION_ICONS.find((icon) => icon.id === value);
  return found ? found.id : "grass";
}

document.addEventListener(
  "error",
  (event) => {
    const img = event.target;

    if (!(img instanceof HTMLImageElement) || img.dataset.iconFallback === "done") return;
    if (!img.closest(".installation-icon-cube, .editor-icon-preview")) return;

    img.dataset.iconFallback = "done";
    img.src = `${INSTALLATION_ICON_BASE_PATH}grass.png`;
  },
  true
);

function renderInstallationIconHtml(profile, extraClass = "") {
  if (profile?.icon === "custom" && profile.customIconDataUrl) {
    return `
      <div class="installation-icon-cube custom-icon ${extraClass}">
        <img src="${escapeHtml(profile.customIconDataUrl)}" alt="" />
      </div>
    `;
  }

  const iconId = safeIconId(profile?.icon);
  const src = `${INSTALLATION_ICON_BASE_PATH}${iconId}.png`;

  return `
    <div class="installation-icon-cube icon-png installation-icon-${iconId} ${extraClass}">
      <img src="${escapeHtml(src)}" alt="${escapeHtml(iconId)}" />
    </div>
  `;
}

function resizeSelectedProfileName() {
  const label = $("#selectedProfileName");
  if (!label) return;

  const length = label.textContent.trim().length;

  label.classList.remove("profile-name-small", "profile-name-tiny", "profile-name-micro");

  if (length > 34) {
    label.classList.add("profile-name-micro");
  } else if (length > 24) {
    label.classList.add("profile-name-tiny");
  } else if (length > 14) {
    label.classList.add("profile-name-small");
  }
}

function renderSelectedProfileName() {
  const label = $("#selectedProfileName");
  if (!label) return;

  const profile = getSelectedProfile();
  label.textContent = profile ? profile.name : "Select Installation";

  resizeSelectedProfileName();
}

function renderAccountBox(account) {
  const accountName = $("#accountName");
  const accountSubtext = $("#accountSubtext");
  const loginBtn = $("#loginBtn");
  const logoutBtn = $("#logoutBtn");

  setPlayerHead(account);

  if (!accountName || !loginBtn || !logoutBtn) return;

  if (account && account.username) {
    accountName.textContent = account.username;

    if (accountSubtext) {
      accountSubtext.textContent = account.type === "offline" ? "Offline account" : "Logged in";
    }

    loginBtn.classList.add("hidden");
    logoutBtn.classList.remove("hidden");
  } else {
    accountName.textContent = "Not logged in";

    if (accountSubtext) {
      accountSubtext.textContent = "Microsoft account";
    }

    loginBtn.classList.remove("hidden");
    logoutBtn.classList.add("hidden");
  }
}

async function loadAccount() {
  try {
    state.account = await window.launcherAPI.auth.getAccount();
    renderAccountBox(state.account);
    return state.account;
  } catch (error) {
    appendConsole(`[auth error] Failed to load account: ${error.message || error}`);
    renderAccountBox(null);
    return null;
  }
}

async function loadDiscordStatus() {
  try {
    const status = await window.launcherAPI.discord.getStatus();

    if (!status.configured) {
      setDiscordStatus("Discord RPC: disabled, set Discord Client ID");
      return;
    }

    if (status.connecting) {
      setDiscordStatus("Discord RPC: connecting");
      return;
    }

    setDiscordStatus(status.connected ? "Discord RPC: connected" : "Discord RPC: not connected");
  } catch {
    setDiscordStatus("Discord RPC: unavailable");
  }
}
async function loadInstalledVersions() {
  try {
    state.installedVersions = await window.launcherAPI.profiles.listInstalledVersions();
    populateEditorMinecraftVersionSelect();
    return state.installedVersions;
  } catch (error) {
    appendConsole(`[versions error] Failed to load installed versions: ${error.message || error}`);
    state.installedVersions = [];
    populateEditorMinecraftVersionSelect();
    return [];
  }
}

async function loadMinecraftVersions() {
  try {
    if (!window.launcherAPI.profiles.listMinecraftVersions) {
      throw new Error("The preload API does not expose profiles.listMinecraftVersions.");
    }

    state.minecraftVersions = await window.launcherAPI.profiles.listMinecraftVersions({
      includeSnapshots: true,
    });

    populateEditorMinecraftVersionSelect();
    return state.minecraftVersions;
  } catch (error) {
    appendConsole(`[versions error] Failed to load Minecraft versions: ${error.message || error}`);
    state.minecraftVersions = [];
    populateEditorMinecraftVersionSelect();
    return [];
  }
}

async function loadEditorVersionData() {
  await Promise.all([loadInstalledVersions(), loadMinecraftVersions()]);

  populateEditorMinecraftVersionSelect();
}

async function loadJavaInstallations() {
  try {
    state.javaInstallations = await window.launcherAPI.java.list();
    populateEditorJavaSelect();
    return state.javaInstallations;
  } catch (error) {
    appendConsole(`[java error] Failed to find installed Java versions: ${error.message || error}`);
    state.javaInstallations = [];
    populateEditorJavaSelect();
    return [];
  }
}

async function loadProfiles() {
  state.profilesData = await window.launcherAPI.profiles.list();

  const select = $("#profileSelect");

  if (select) {
    select.innerHTML = "";

    for (const profile of state.profilesData.profiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.name;
      option.selected = profile.id === state.profilesData.selectedProfileId;
      select.appendChild(option);
    }
  }

  state.selectedProfile = findProfile(state.profilesData.selectedProfileId);

  renderSelectedProfileName();
  renderProfileDropup();
  renderSelectedProfileDetails();
  renderProfilesList();
  fillSettingsForm();

  if (homeWidgets.config) refreshWidget("quickstart");
}

function openProfileDropup() {
  const menu = $("#profileDropupMenu");
  const button = $("#profileDropupButton");

  if (!menu || !button) return;

  state.dropupOpen = true;
  menu.classList.remove("hidden");
  button.classList.add("open");
}

function closeProfileDropup() {
  const menu = $("#profileDropupMenu");
  const button = $("#profileDropupButton");

  if (!menu || !button) return;

  state.dropupOpen = false;
  menu.classList.add("hidden");
  button.classList.remove("open");
}

function toggleProfileDropup() {
  if (state.dropupOpen) {
    closeProfileDropup();
  } else {
    openProfileDropup();
  }
}

function renderProfileDropup() {
  const menu = $("#profileDropupMenu");
  if (!menu || !state.profilesData) return;

  menu.innerHTML = "";

  for (const profile of state.profilesData.profiles) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "profile-dropup-item";
    button.title = profile.name;
    button.innerHTML = `
      ${renderInstallationIconHtml(profile)}
      <span class="profile-dropup-item-text">
        <span class="profile-dropup-item-name mct">${escapeHtml(profile.name)}</span>
        <span class="profile-dropup-item-sub mcr">${escapeHtml(loaderLabel(profile.loaderType))} · ${escapeHtml(profile.minecraftVersion || "?")}</span>
      </span>
      <span class="mc-select-check" aria-hidden="true"></span>
    `;

    if (profile.id === selectedProfileId()) {
      button.classList.add("selected");
    }

    button.addEventListener("click", async () => {
      await selectProfile(profile.id);
      closeProfileDropup();
    });

    menu.appendChild(button);
  }
}

async function selectProfile(profileId) {
  await window.launcherAPI.profiles.setSelected(profileId);

  if (state.profilesData) {
    state.profilesData.selectedProfileId = profileId;
  }

  const select = $("#profileSelect");
  if (select) {
    select.value = profileId;
  }

  state.selectedProfile = findProfile(profileId);

  renderSelectedProfileName();
  renderProfileDropup();
  renderSelectedProfileDetails();
  renderProfilesList();
  fillSettingsForm();
  await loadDiscordStatus();
}

function renderSelectedProfileDetails() {
  const box = $("#selectedProfileDetails");
  if (!box) return;

  const profile = getSelectedProfile();

  if (!profile) {
    box.textContent = "No profile selected.";
    return;
  }

  box.innerHTML = `
    <div><strong>Name:</strong> ${escapeHtml(profile.name)}</div>
    <div><strong>Minecraft:</strong> ${escapeHtml(profile.minecraftVersion)}</div>
    <div><strong>Loader:</strong> ${escapeHtml(profile.loaderType)}</div>
    <div><strong>Version ID:</strong> ${escapeHtml(profile.customVersionId || profile.minecraftVersion)}</div>
    <div><strong>Memory:</strong> ${escapeHtml(profile.minMemory)} - ${escapeHtml(profile.maxMemory)}</div>
    <div><strong>Game directory:</strong> ${escapeHtml(profile.gameDir)}</div>
  `;
}

const LOADER_LABELS = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  quilt: "Quilt",
  forge: "Forge",
  neoforge: "NeoForge",
  custom: "Custom",
};

function loaderLabel(loaderType) {
  const key = String(loaderType || "vanilla").toLowerCase();
  return LOADER_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);
}

function renderProfilesList() {
  const root = $("#installations-list");
  if (!root || !state.profilesData) return;

  root.innerHTML = "";

  for (const profile of state.profilesData.profiles) {
    const selected = profile.id === selectedProfileId();
    const runningCount = runningInstancesForProfile(profile.id).length;
    const running = runningCount > 0;

    const card = document.createElement("div");
    card.className = "installations-cubed mcsection";
    card.tabIndex = 0;
    card.title = profile.name;

    card.classList.toggle("selected", selected);
    card.classList.toggle("running", running);

    const versionId = profile.customVersionId || profile.minecraftVersion || "";
    const showVersionId = versionId && versionId !== profile.minecraftVersion;

    card.innerHTML = `
      ${renderInstallationIconHtml(profile)}

      <div class="installation-info">
        <span class="whitetext mct installation-name">${escapeHtml(profile.name)}</span>
        <span class="mcr installation-version">
          ${escapeHtml(loaderLabel(profile.loaderType))} · ${escapeHtml(profile.minecraftVersion || "?")}
        </span>
        <span class="mcr installation-version-id${showVersionId ? "" : " is-empty"}">${showVersionId ? escapeHtml(versionId) : "&nbsp;"}</span>
      </div>

      <div class="installation-badges">
        ${selected ? `<span class="installation-badge selected mcr">Selected</span>` : ""}
        ${
          running
            ? `<span class="installation-badge running mcr">Running${runningCount > 1 ? ` ×${runningCount}` : ""}</span>`
            : ""
        }
      </div>

      <div class="installation-hover-panel">
        <button class="mcbtn installation-action-btn green" data-action="select" type="button"${
          selected ? " disabled" : ""
        }>${selected ? "Selected" : "Select"}</button>
        <button class="mcbtn installation-action-btn" data-action="edit" type="button">Edit</button>
        ${
          running
            ? `<button class="mcbtn installation-action-btn danger" data-action="stop" type="button">Stop</button>`
            : `<button class="mcbtn installation-action-btn danger" data-action="delete" type="button">Delete</button>`
        }
      </div>
    `;

    card.querySelector('[data-action="stop"]')?.addEventListener("click", async (event) => {
      event.stopPropagation();

      for (const instance of runningInstancesForProfile(profile.id)) {
        await window.launcherAPI.launcher.kill(instance.instanceId);
      }

      setStatus(`Stop signal sent to ${profile.name}.`);
    });

    card.addEventListener("keydown", (event) => {
      if (event.target === card && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        openInstallationEditor(profile.id);
      }
    });

    card.querySelector('[data-action="select"]').addEventListener("click", async (event) => {
      event.stopPropagation();
      await selectProfile(profile.id);
    });

    card.querySelector('[data-action="edit"]').addEventListener("click", (event) => {
      event.stopPropagation();
      openInstallationEditor(profile.id);
    });

    card.querySelector('[data-action="delete"]')?.addEventListener("click", async (event) => {
      event.stopPropagation();

      const profiles = state.profilesData?.profiles || [];

      if (profiles.length <= 1) {
        showAlert("You must keep at least one installation.");
        return;
      }

      const confirmed = await showConfirm(
        `Delete installation "${profile.name}"?\n\nThis will also delete its game folder if no other installation uses it.`,
        { title: "Delete installation", confirmText: "Delete", danger: true }
      );

      if (!confirmed) return;

      try {
        const result = await window.launcherAPI.profiles.delete(profile.id);

        await loadProfiles();

        if (result?.folderDeleteError) {
          showAlert(
            `Installation deleted, but the folder could not be deleted:\n${result.folderDeleteError}`,
            { title: "Folder not deleted", kind: "warning" }
          );
          return;
        }

        if (result?.skippedGameDirDeleteReason) {
          appendConsole(
            `[profiles] Deleted installation ${profile.name}. Folder not deleted: ${result.skippedGameDirDeleteReason}`
          );
          return;
        }

        if (result?.deletedGameDir) {
          appendConsole(`[profiles] Deleted installation ${profile.name} and its folder.`);
          return;
        }

        appendConsole(`[profiles] Deleted installation ${profile.name}.`);
      } catch (error) {
        showError(error.message || "Failed to delete installation.");
      }
    });

    card.addEventListener("click", () => {
      openInstallationEditor(profile.id);
    });

    root.appendChild(card);
  }
}

async function renderMods() {
  const root = $("#modsList");
  if (!root) return;

  const profileId = selectedProfileId();
  const mods = await window.launcherAPI.mods.list(profileId);

  root.innerHTML = "";

  if (mods.length === 0) {
    root.innerHTML = `<div class="empty">No mods installed for this installation.</div>`;
    return;
  }

  for (const mod of mods) {
    const row = document.createElement("div");
    row.className = "mod-row";

    row.innerHTML = `
      <div>
        <strong>${escapeHtml(mod.displayName || mod.filename)}</strong>
        <small>${formatBytes(mod.sizeBytes)} · ${escapeHtml(mod.updatedAt)}</small>
      </div>
      <button class="danger" data-filename="${escapeHtml(mod.filename)}">Remove</button>
    `;

    root.appendChild(row);
  }

  root.querySelectorAll("button[data-filename]").forEach((button) => {
    button.addEventListener("click", async () => {
      await window.launcherAPI.mods.remove(profileId, button.dataset.filename);
      await renderMods();
    });
  });
}

function fillSettingsForm() {
  const profile = getSelectedProfile();
  if (!profile) return;

  const fields = {
    "#settingName": profile.name || "",
    "#settingMcVersion": profile.minecraftVersion || "",
    "#settingVersionType": profile.versionType || "release",
    "#settingLoader": profile.loaderType || "vanilla",
    "#settingCustomVersionId": profile.customVersionId || "",
    "#settingCustomJson": profile.customVersionJsonPath || "",
    "#settingGameDir": profile.gameDir || "",
    "#settingJavaPath": profile.javaPath || "",
    "#settingMinMemory": profile.minMemory || "2G",
    "#settingMaxMemory": profile.maxMemory || "4G",
    "#settingWidth": profile.width || 854,
    "#settingHeight": profile.height || 480,
    "#settingJvmArgs": profile.extraJvmArgs || "",
    "#settingMcArgs": profile.extraMcArgs || "",
  };

  for (const [selector, value] of Object.entries(fields)) {
    const element = $(selector);
    if (element) element.value = value;
  }

  const fullscreen = $("#settingFullscreen");
  if (fullscreen) fullscreen.checked = Boolean(profile.fullscreen);
}

function getSettingsPatch() {
  return {
    name: $("#settingName")?.value.trim() || "Installation",
    minecraftVersion: $("#settingMcVersion")?.value.trim() || "1.21.1",
    versionType: $("#settingVersionType")?.value || "release",
    loaderType: $("#settingLoader")?.value || "vanilla",
    customVersionId: $("#settingCustomVersionId")?.value.trim() || "",
    customVersionJsonPath: $("#settingCustomJson")?.value.trim() || "",
    gameDir: $("#settingGameDir")?.value.trim() || "",
    javaPath: $("#settingJavaPath")?.value.trim() || "",
    minMemory: $("#settingMinMemory")?.value.trim() || "2G",
    maxMemory: $("#settingMaxMemory")?.value.trim() || "4G",
    width: Number($("#settingWidth")?.value || 854),
    height: Number($("#settingHeight")?.value || 480),
    fullscreen: Boolean($("#settingFullscreen")?.checked),
    extraJvmArgs: $("#settingJvmArgs")?.value.trim() || "",
    extraMcArgs: $("#settingMcArgs")?.value.trim() || "",
  };
}

function getEditorProfile() {
  return findProfile(state.installationEditor.profileId);
}

async function loadSystemMemoryInfo() {
  try {
    if (window.launcherAPI.system?.getMemoryInfo) {
      const info = await window.launcherAPI.system.getMemoryInfo();
      detectedTotalMemoryGb = Math.max(1, Number(info?.totalGb || DEFAULT_MEMORY_TOTAL_GB));
      return;
    }
  } catch {
    // Fall back below.
  }

  detectedTotalMemoryGb = Math.max(1, Number(navigator.deviceMemory || DEFAULT_MEMORY_TOTAL_GB));
}

function parseMemoryGb(value, fallbackGb) {
  const text = String(value || "")
    .trim()
    .toUpperCase();
  const number = Number((text.match(/[\d.]+/) || [fallbackGb])[0]);

  if (text.endsWith("M") || text.endsWith("MB")) {
    return Math.max(1, Math.round(number / 1024));
  }

  return Math.max(1, Math.round(number || fallbackGb));
}

function memoryGbToText(value) {
  return `${Math.max(1, Math.round(Number(value) || 1))}G`;
}
function ensureEditorMemorySliders() {
  const grid = $(".editor-form-grid");
  if (!grid || $("#editorMemorySliders")) return;

  const minMemoryLabel = $("#editorSettingMinMemory")?.closest("label");
  const maxMemoryLabel = $("#editorSettingMaxMemory")?.closest("label");

  if (minMemoryLabel) minMemoryLabel.classList.add("hidden");
  if (maxMemoryLabel) maxMemoryLabel.classList.add("hidden");

  const wrap = document.createElement("div");
  wrap.id = "editorMemorySliders";
  wrap.className = "editor-memory-wrap";
  wrap.innerHTML = `
    <p class="editor-memory-title whitetext mct">Memory</p>
    <p class="editor-memory-desc mcr">
      <span class="memory-dot green"></span>Green is minimum RAM.
      <span class="memory-dot red"></span>Red is maximum RAM.
      The slider limit is based on this device&apos;s detected RAM.
    </p>

    <div class="editor-memory-slider-row">
      <span class="whitetext mcr">Min</span>
      <input id="editorMinMemorySlider" class="settings-slider" type="range" min="1" max="8" value="2" />
      <span id="editorMinMemoryValue" class="whitetext mcr">2G</span>
    </div>

    <div class="editor-memory-slider-row">
      <span class="whitetext mcr">Max</span>
      <input id="editorMaxMemorySlider" class="settings-slider" type="range" min="1" max="8" value="4" />
      <span id="editorMaxMemoryValue" class="whitetext mcr">4G</span>
    </div>
  `;

  const maxInput = $("#editorSettingMaxMemory");
  const maxLabel = maxInput?.closest("label");

  if (maxLabel && maxLabel.nextSibling) {
    grid.insertBefore(wrap, maxLabel.nextSibling);
  } else {
    grid.appendChild(wrap);
  }

  const minSlider = $("#editorMinMemorySlider");
  const maxSlider = $("#editorMaxMemorySlider");

  function syncHiddenInputsFromSliders() {
    const minValue = Math.max(1, Number(minSlider?.value || 1));
    let maxValue = Math.max(1, Number(maxSlider?.value || 1));

    if (maxValue < minValue) {
      maxValue = minValue;
      if (maxSlider) maxSlider.value = String(maxValue);
    }

    const minInput = $("#editorSettingMinMemory");
    const maxInputEl = $("#editorSettingMaxMemory");

    if (minInput) minInput.value = memoryGbToText(minValue);
    if (maxInputEl) maxInputEl.value = memoryGbToText(maxValue);

    const minText = $("#editorMinMemoryValue");
    const maxText = $("#editorMaxMemoryValue");

    if (minText) minText.textContent = memoryGbToText(minValue);
    if (maxText) maxText.textContent = memoryGbToText(maxValue);
  }

  minSlider?.addEventListener("input", syncHiddenInputsFromSliders);
  maxSlider?.addEventListener("input", syncHiddenInputsFromSliders);
}

function fillEditorMemorySliders(profile) {
  ensureEditorMemorySliders();

  const minSlider = $("#editorMinMemorySlider");
  const maxSlider = $("#editorMaxMemorySlider");

  const totalGb = Math.max(1, detectedTotalMemoryGb);

  if (minSlider) minSlider.max = String(totalGb);
  if (maxSlider) maxSlider.max = String(totalGb);

  const minGb = Math.min(totalGb, parseMemoryGb(profile?.minMemory, 2));

  const maxGb = Math.min(totalGb, Math.max(minGb, parseMemoryGb(profile?.maxMemory, 4)));

  if (minSlider) minSlider.value = String(minGb);
  if (maxSlider) maxSlider.value = String(maxGb);

  const minInput = $("#editorSettingMinMemory");
  const maxInput = $("#editorSettingMaxMemory");

  if (minInput) minInput.value = memoryGbToText(minGb);
  if (maxInput) maxInput.value = memoryGbToText(maxGb);

  const minText = $("#editorMinMemoryValue");
  const maxText = $("#editorMaxMemoryValue");

  if (minText) minText.textContent = memoryGbToText(minGb);
  if (maxText) maxText.textContent = memoryGbToText(maxGb);
}

function ensureEditorExtraControls() {
  const grid = $(".editor-form-grid");
  if (!grid) return;

  const editorTopRow = $(".editor-top-row");

  if (editorTopRow && !$("#openInstallationFolderTopBtn")) {
    const openFolderBtn = document.createElement("button");
    openFolderBtn.id = "openInstallationFolderTopBtn";
    openFolderBtn.className = "linebtn";
    openFolderBtn.type = "button";
    openFolderBtn.textContent = "Folder";

    const saveButton = $("#saveInstallationBtn");

    if (saveButton) {
      editorTopRow.insertBefore(openFolderBtn, saveButton);
    } else {
      editorTopRow.appendChild(openFolderBtn);
    }
  }

  if ($("#editorExtraControlsInstalled")) {
    ensureEditorMemorySliders();
    return;
  }

  const iconLabel = document.createElement("label");
  iconLabel.className = "editor-extra-wide";
  iconLabel.innerHTML = `
    <span class="whitetext mcr">Installation Icon</span>
    <div class="editor-control-row">
      <div id="editorIconPreview" class="editor-icon-preview installation-icon-grass"></div>
      <select id="editorSettingIcon" class="editor-input grow-input">
        ${DEFAULT_INSTALLATION_ICONS.map((icon) => `<option value="${icon.id}">${escapeHtml(icon.label)}</option>`).join("")}
        <option value="custom">Custom PNG</option>
      </select>
      <button id="pickEditorIconBtn" class="mcbtn editor-small-btn" type="button">Upload PNG</button>
      <button id="resetEditorIconBtn" class="mcbtn editor-small-btn" type="button">Use Default</button>
    </div>
    <input id="editorSettingIconPath" class="editor-input" readonly />
  `;

  const versionLabel = document.createElement("label");
  versionLabel.id = "editorExtraControlsInstalled";
  versionLabel.className = "editor-extra-wide";
  versionLabel.innerHTML = `
    <span class="whitetext mcr">Version List</span>
    <div class="editor-control-row">
      <button id="refreshInstalledVersionsBtn" class="mcbtn editor-small-btn" type="button">Refresh Versions</button>
      <span id="editorInstalledVersionHelp" class="editor-help-text mcr">
        Vanilla versions come from Mojang and can be downloaded on launch. Loader builds come from downloaded version JSONs.
      </span>
    </div>
  `;

  const customJsonTools = document.createElement("label");
  customJsonTools.className = "editor-extra-wide";
  customJsonTools.innerHTML = `
    <span class="whitetext mcr">Custom Version JSON Tools</span>
    <div class="editor-control-row">
      <button id="pickEditorCustomJsonBtn" class="mcbtn editor-small-btn" type="button">Choose JSON</button>
      <span class="editor-help-text mcr">The selected JSON is copied into the shared versions folder on launch.</span>
    </div>
  `;

  const javaLabel = document.createElement("label");
  javaLabel.className = "editor-extra-wide";
  javaLabel.innerHTML = `
    <span class="whitetext mcr">Installed Java</span>
    <div class="editor-control-row">
      <select id="editorJavaSelect" class="editor-input grow-input">
        <option value="">Auto / launcher default</option>
      </select>
      <button id="refreshJavaBtn" class="mcbtn editor-small-btn" type="button">Refresh</button>
      <button id="pickEditorJavaBtn" class="mcbtn editor-small-btn" type="button">Browse</button>
    </div>
  `;

  versionLabel.dataset.advanced = "";
  customJsonTools.dataset.advanced = "";
  javaLabel.dataset.advanced = "";

  grid.insertBefore(javaLabel, grid.firstChild);
  grid.insertBefore(customJsonTools, grid.firstChild);
  grid.insertBefore(versionLabel, grid.firstChild);
  grid.insertBefore(iconLabel, grid.firstChild);

  ensureEditorMemorySliders();
}

function openInstallationEditor(profileId) {
  state.installationEditor.profileId = profileId;
  state.installationEditor.tab = "settings";

  const backdrop = $("#installationEditorBackdrop");
  if (backdrop) backdrop.classList.remove("hidden");

  const modsSearch = $("#editorModsSearch");
  if (modsSearch) modsSearch.value = "";
  setEditorFoldersNote("");

  showEditorTab("settings");
  fillEditorSettings();
  renderEditorMods();

  setEditorModrinthUpdateStatus("");

  loadEditorVersionData();
  loadJavaInstallations();
}

function closeInstallationEditor() {
  const backdrop = $("#installationEditorBackdrop");
  if (backdrop) backdrop.classList.add("hidden");

  state.installationEditor.profileId = null;
}

function showEditorTab(tab) {
  state.installationEditor.tab = tab;

  $$(".editor-subpage").forEach((page) => {
    page.classList.toggle("active", page.id === `editor-tab-${tab}`);
  });

  $$(".editor-tab-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.editorTab === tab);
  });

  if (tab === "mods") {
    renderEditorMods();
  }

  if (tab === "folders") {
    renderEditorFolders();
  }
}

function updateEditorIconPreview() {
  const preview = $("#editorIconPreview");
  const iconSelect = $("#editorSettingIcon");
  const iconPathInput = $("#editorSettingIconPath");
  const profile = getEditorProfile();

  if (!preview || !iconSelect) return;

  preview.className = "editor-icon-preview";
  preview.innerHTML = "";

  if (iconSelect.value === "custom") {
    preview.classList.add("custom-icon");

    const dataUrl =
      profile?.customIconDataUrl && iconPathInput?.value === profile.iconPath
        ? profile.customIconDataUrl
        : iconPathInput?.dataset.dataUrl;

    if (dataUrl) {
      const img = document.createElement("img");
      img.src = dataUrl;
      img.alt = "";
      preview.appendChild(img);
      return;
    }
  }

  const iconId = safeIconId(iconSelect.value);
  preview.classList.add("custom-icon");

  const img = document.createElement("img");
  img.src = `${INSTALLATION_ICON_BASE_PATH}${iconId}.png`;
  img.alt = iconId;
  preview.appendChild(img);
}

function normalizeLoaderType(value) {
  return (
    String(value || "vanilla")
      .trim()
      .toLowerCase() || "vanilla"
  );
}

function getOfficialVersionInfo(versionId) {
  const id = String(versionId || "");
  return state.minecraftVersions.find((version) => version.id === id) || null;
}

function getInstalledVersionType(version) {
  const official = getOfficialVersionInfo(version?.baseVersion || version?.id);

  if (official?.type) {
    return official.type;
  }

  return version?.type === "snapshot" ? "snapshot" : "release";
}

function getEditorSelectedLoader() {
  return normalizeLoaderType(
    $("#editorSettingLoader")?.value || getEditorProfile()?.loaderType || "vanilla"
  );
}

function getEditorShowSnapshots() {
  return Boolean($("#editorShowSnapshots")?.checked);
}

function getCurrentEditorMinecraftVersionValue() {
  const select = $("#editorSettingMcVersion");
  const profile = getEditorProfile();

  return (
    select?.dataset.selectedMinecraftVersion ||
    profile?.minecraftVersion ||
    select?.value ||
    "1.21.1"
  );
}

function addEditorVersionOption(
  select,
  {
    value,
    label,
    minecraftVersion,
    versionType = "release",
    loaderType = "vanilla",
    customVersionId = "",
    selected = false,
  }
) {
  const option = document.createElement("option");

  option.value = value;
  option.textContent = label;
  option.dataset.minecraftVersion = minecraftVersion;
  option.dataset.versionType = versionType;
  option.dataset.loaderType = loaderType;
  option.dataset.customVersionId = customVersionId;
  option.selected = selected;

  select.appendChild(option);
}

function addEditorEmptyVersionOption(select, text) {
  const option = document.createElement("option");
  option.value = "";
  option.textContent = text;
  option.disabled = true;
  option.selected = true;
  select.appendChild(option);
}

function populateEditorMinecraftVersionSelect() {
  const select = $("#editorSettingMcVersion");
  if (!select) return;

  const profile = getEditorProfile();
  const loader = getEditorSelectedLoader();
  const showSnapshots = getEditorShowSnapshots();
  const currentMinecraftVersion = getCurrentEditorMinecraftVersionValue();
  const customVersionIdInput = $("#editorSettingCustomVersionId");
  const currentCustomVersionId = customVersionIdInput?.value || profile?.customVersionId || "";

  select.innerHTML = "";

  let hasSelectedOption = false;

  if (loader === "vanilla") {
    const versions = state.minecraftVersions.filter((version) => {
      if (version.type === "release") return true;
      return showSnapshots && version.type === "snapshot";
    });

    for (const version of versions) {
      const selected = !currentCustomVersionId && version.id === currentMinecraftVersion;

      hasSelectedOption = hasSelectedOption || selected;

      addEditorVersionOption(select, {
        value: version.id,
        label: version.type === "snapshot" ? `${version.id} (snapshot)` : version.id,
        minecraftVersion: version.id,
        versionType: version.type,
        loaderType: "vanilla",
        customVersionId: "",
        selected,
      });
    }

    if (
      currentMinecraftVersion &&
      !versions.some((version) => version.id === currentMinecraftVersion)
    ) {
      addEditorVersionOption(select, {
        value: currentMinecraftVersion,
        label: `${currentMinecraftVersion} (current / not in list)`,
        minecraftVersion: currentMinecraftVersion,
        versionType: $("#editorSettingVersionType")?.value || profile?.versionType || "release",
        loaderType: "vanilla",
        customVersionId: "",
        selected: true,
      });

      hasSelectedOption = true;
    }

    if (versions.length === 0 && !hasSelectedOption) {
      addEditorVersionOption(select, {
        value: "1.21.1",
        label: "1.21.1 (fallback)",
        minecraftVersion: "1.21.1",
        versionType: "release",
        loaderType: "vanilla",
        customVersionId: "",
        selected: true,
      });

      hasSelectedOption = true;
    }
  } else {
    const versions = state.installedVersions.filter((version) => {
      const versionLoader = normalizeLoaderType(version.loaderType);
      const versionType = getInstalledVersionType(version);

      if (versionLoader !== loader) return false;
      if (versionType === "snapshot" && !showSnapshots) return false;

      return true;
    });

    for (const version of versions) {
      const baseVersion = version.baseVersion || version.inheritsFrom || version.id;
      const versionType = getInstalledVersionType(version);
      const selected =
        version.id === currentCustomVersionId ||
        (!currentCustomVersionId && baseVersion === currentMinecraftVersion);

      hasSelectedOption = hasSelectedOption || selected;

      addEditorVersionOption(select, {
        value: version.id,
        label: `${baseVersion} · ${version.id}${versionType === "snapshot" ? " (snapshot)" : ""}`,
        minecraftVersion: baseVersion,
        versionType,
        loaderType: version.loaderType || loader,
        customVersionId: version.isVanilla ? "" : version.id,
        selected,
      });
    }

    if (
      currentCustomVersionId &&
      !versions.some((version) => version.id === currentCustomVersionId)
    ) {
      addEditorVersionOption(select, {
        value: currentCustomVersionId,
        label: `${currentMinecraftVersion} · ${currentCustomVersionId} (current / not in list)`,
        minecraftVersion: currentMinecraftVersion,
        versionType: $("#editorSettingVersionType")?.value || profile?.versionType || "release",
        loaderType: loader,
        customVersionId: currentCustomVersionId,
        selected: true,
      });

      hasSelectedOption = true;
    }

    if (versions.length === 0 && !hasSelectedOption) {
      addEditorEmptyVersionOption(
        select,
        `No downloaded ${loader} builds found${showSnapshots ? "" : " (enable snapshots to include snapshot builds)"}`
      );
    }
  }

  if (!hasSelectedOption && select.options.length > 0 && !select.options[0].disabled) {
    select.options[0].selected = true;
  }

  applyEditorMinecraftVersionSelection();
}

function getEditorMinecraftVersionSelection() {
  const select = $("#editorSettingMcVersion");
  const selectedOption = select?.selectedOptions?.[0] || null;

  if (selectedOption && !selectedOption.disabled) {
    return {
      minecraftVersion: selectedOption.dataset.minecraftVersion || selectedOption.value || "1.21.1",
      versionType: selectedOption.dataset.versionType || "release",
      loaderType: selectedOption.dataset.loaderType || getEditorSelectedLoader(),
      customVersionId: selectedOption.dataset.customVersionId || "",
    };
  }

  return {
    minecraftVersion:
      select?.dataset.selectedMinecraftVersion ||
      select?.value ||
      getEditorProfile()?.minecraftVersion ||
      "1.21.1",
    versionType:
      $("#editorSettingVersionType")?.value || getEditorProfile()?.versionType || "release",
    loaderType: getEditorSelectedLoader(),
    customVersionId:
      $("#editorSettingCustomVersionId")?.value.trim() || getEditorProfile()?.customVersionId || "",
  };
}

function applyEditorMinecraftVersionSelection() {
  const selection = getEditorMinecraftVersionSelection();
  const select = $("#editorSettingMcVersion");
  const versionType = $("#editorSettingVersionType");
  const customVersionId = $("#editorSettingCustomVersionId");

  if (select) {
    select.dataset.selectedMinecraftVersion = selection.minecraftVersion;
  }

  if (versionType) {
    versionType.value = selection.versionType;
  }

  if (customVersionId) {
    customVersionId.value = selection.customVersionId;
  }
}

function populateEditorInstalledVersionSelect() {
  populateEditorMinecraftVersionSelect();
}

function applyInstalledVersionSelection(versionId) {
  const select = $("#editorSettingMcVersion");
  if (!select) return;

  select.value = versionId;
  applyEditorMinecraftVersionSelection();
}

function populateEditorJavaSelect() {
  const select = $("#editorJavaSelect");
  if (!select) return;

  const profile = getEditorProfile();
  const currentJavaPath = profile?.javaPath || $("#editorSettingJavaPath")?.value || "";

  select.innerHTML = `<option value="">Auto / launcher default</option>`;

  for (const java of state.javaInstallations) {
    const option = document.createElement("option");
    option.value = java.path;
    option.textContent = java.label;
    option.selected = java.path === currentJavaPath;
    select.appendChild(option);
  }

  if (currentJavaPath && !state.javaInstallations.some((java) => java.path === currentJavaPath)) {
    const option = document.createElement("option");
    option.value = currentJavaPath;
    option.textContent = `Manual: ${currentJavaPath}`;
    option.selected = true;
    select.appendChild(option);
  }
}

function fillEditorSettings() {
  ensureEditorExtraControls();

  const profile = getEditorProfile();
  if (!profile) return;

  const fields = {
    "#editorSettingName": profile.name || "",
    "#editorSettingMcVersion": profile.minecraftVersion || "",
    "#editorSettingVersionType": profile.versionType || "release",
    "#editorSettingLoader": profile.loaderType || "vanilla",
    "#editorSettingCustomVersionId": profile.customVersionId || "",
    "#editorSettingCustomJson": profile.customVersionJsonPath || "",
    "#editorSettingGameDir": profile.gameDir || "",
    "#editorSettingJavaPath": profile.javaPath || "",
    "#editorSettingMinMemory": profile.minMemory || "2G",
    "#editorSettingMaxMemory": profile.maxMemory || "4G",
    "#editorSettingWidth": profile.width || 854,
    "#editorSettingHeight": profile.height || 480,
    "#editorSettingJvmArgs": profile.extraJvmArgs || "",
    "#editorSettingMcArgs": profile.extraMcArgs || "",
    "#editorSettingIcon": profile.icon || "grass",
    "#editorSettingIconPath": profile.iconPath || "",
  };

  for (const [selector, value] of Object.entries(fields)) {
    const element = $(selector);

    if (element) {
      element.value = value;

      if (selector === "#editorSettingMcVersion") {
        element.dataset.selectedMinecraftVersion = value;
      }
    }
  }

  const showSnapshots = $("#editorShowSnapshots");
  if (showSnapshots) {
    showSnapshots.checked = profile.versionType === "snapshot";
  }

  const iconPathInput = $("#editorSettingIconPath");
  if (iconPathInput) {
    iconPathInput.dataset.dataUrl = profile.customIconDataUrl || "";
  }

  const fullscreen = $("#editorSettingFullscreen");
  if (fullscreen) fullscreen.checked = Boolean(profile.fullscreen);

  populateEditorInstalledVersionSelect();
  populateEditorJavaSelect();
  updateEditorIconPreview();
  fillEditorMemorySliders(profile);
}
function getEditorSettingsPatch() {
  const versionSelection = getEditorMinecraftVersionSelection();

  return {
    name: $("#editorSettingName")?.value.trim() || "Installation",
    minecraftVersion: versionSelection.minecraftVersion || "1.21.1",
    versionType: versionSelection.versionType || $("#editorSettingVersionType")?.value || "release",
    loaderType: $("#editorSettingLoader")?.value || versionSelection.loaderType || "vanilla",
    customVersionId:
      versionSelection.customVersionId || $("#editorSettingCustomVersionId")?.value.trim() || "",
    customVersionJsonPath: $("#editorSettingCustomJson")?.value.trim() || "",
    gameDir: $("#editorSettingGameDir")?.value.trim() || "",
    javaPath: $("#editorSettingJavaPath")?.value.trim() || "",
    minMemory: $("#editorSettingMinMemory")?.value.trim() || "2G",
    maxMemory: $("#editorSettingMaxMemory")?.value.trim() || "4G",
    width: Number($("#editorSettingWidth")?.value || 854),
    height: Number($("#editorSettingHeight")?.value || 480),
    fullscreen: Boolean($("#editorSettingFullscreen")?.checked),
    extraJvmArgs: $("#editorSettingJvmArgs")?.value.trim() || "",
    extraMcArgs: $("#editorSettingMcArgs")?.value.trim() || "",
    icon: $("#editorSettingIcon")?.value || "grass",
    iconPath: $("#editorSettingIconPath")?.value.trim() || "",
  };
}

async function saveEditorSettings() {
  const profileId = state.installationEditor.profileId;
  if (!profileId) return;

  try {
    const updated = await window.launcherAPI.profiles.update(profileId, getEditorSettingsPatch());

    await loadProfiles();
    await selectProfile(updated.id);

    state.installationEditor.profileId = updated.id;

    fillEditorSettings();
    renderEditorMods();

    setStatus("Installation saved.");
    appendConsole(`[profiles] Saved installation ${updated.name}.`);
  } catch (error) {
    showError(error.message || "Failed to save installation.");
  }
}

async function renderEditorMods() {
  const root = $("#editorModsList");
  const profileId = state.installationEditor.profileId;

  if (!root || !profileId) return;

  const scrollers = [root, root.closest(".editor-subpage")].filter(Boolean);
  const savedScroll = scrollers.map((element) => element.scrollTop);

  if (!root.querySelector(".editor-mod-row")) {
    root.innerHTML = `<div class="whitetext mcr">Loading mods...</div>`;
  }

  const restoreScroll = () => {
    scrollers.forEach((element, index) => {
      element.scrollTop = savedScroll[index];
    });
  };

  try {
    const mods = await window.launcherAPI.mods.list(profileId);
    const fragment = document.createDocumentFragment();

    if (!mods || mods.length === 0) {
      root.innerHTML = `<div class="whitetext mcr">No mods installed for this installation.</div>`;
      applyEditorModsFilter();
      return;
    }

    for (const mod of mods) {
      const row = document.createElement("div");
      row.className = `editor-mod-row ${mod.enabled ? "" : "disabled"}`;
      row.dataset.search = `${mod.displayName || ""} ${mod.filename || ""}`.toLowerCase();

      row.innerHTML = `
        <div class="editor-mod-name mcr">
          ${escapeHtml(mod.displayName || mod.filename)}
          <small>
            ${mod.enabled ? "enabled" : "disabled"} · ${formatBytes(mod.sizeBytes)}
          </small>
        </div>

        <button class="mcbtn editor-mod-btn" data-action="toggle" type="button">
          ${mod.enabled ? "Disable" : "Enable"}
        </button>

        <button class="mcbtn editor-mod-btn danger" data-action="remove" type="button">
          Delete
        </button>
      `;

      row.querySelector('[data-action="toggle"]').addEventListener("click", async (event) => {
        event.currentTarget.disabled = true;

        try {
          await window.launcherAPI.mods.setEnabled(profileId, mod.filename, !mod.enabled);

          await renderEditorMods();
        } catch (error) {
          showError(error.message || "Failed to toggle mod.");
        }
      });

      row.querySelector('[data-action="remove"]').addEventListener("click", async () => {
        const confirmed = await showConfirm(`Delete mod "${mod.displayName || mod.filename}"?`, {
          title: "Delete mod",
          confirmText: "Delete",
          danger: true,
        });
        if (!confirmed) return;

        try {
          await window.launcherAPI.mods.remove(profileId, mod.filename);
          await renderEditorMods();
        } catch (error) {
          showError(error.message || "Failed to delete mod.");
        }
      });

      fragment.appendChild(row);
    }

    root.replaceChildren(fragment);
    applyEditorModsFilter();
    restoreScroll();
  } catch (error) {
    root.innerHTML = `<div class="whitetext mcr">Failed to load mods.</div>`;
  }
}

function applyEditorModsFilter() {
  const root = $("#editorModsList");
  const count = $("#editorModsCount");
  if (!root) return;

  const query = ($("#editorModsSearch")?.value || "").trim().toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const rows = [...root.querySelectorAll(".editor-mod-row")];
  let shown = 0;

  for (const row of rows) {
    const match = terms.every((term) => row.dataset.search.includes(term));
    row.classList.toggle("filtered-out", !match);
    if (match) shown += 1;
  }

  root.querySelector(".editor-mods-no-match")?.remove();

  if (terms.length && rows.length && shown === 0) {
    const empty = document.createElement("div");
    empty.className = "editor-mods-no-match whitetext mcr";
    empty.textContent = `No installed mods match "${query}".`;
    root.appendChild(empty);
  }

  if (count) {
    const enabled = rows.filter((row) => !row.classList.contains("disabled")).length;
    count.textContent = !rows.length
      ? ""
      : terms.length
        ? `${shown} of ${rows.length}`
        : `${rows.length} mods · ${enabled} on`;
  }
}

async function addModsToEditor(filePaths = []) {
  const profileId = state.installationEditor.profileId;
  if (!profileId) return;

  try {
    if (Array.isArray(filePaths) && filePaths.length > 0) {
      await window.launcherAPI.mods.add(profileId, filePaths);
    } else {
      await window.launcherAPI.mods.add(profileId);
    }

    await renderEditorMods();
  } catch (error) {
    showError(error.message || "Failed to add mods.");
  }
}

function setEditorModrinthUpdateStatus(text) {
  const status = $("#editorModrinthUpdateStatus");
  if (status) status.textContent = text || "";
}

function summarizeModrinthUpdateResult(result) {
  if (!result) return "No update result returned.";

  const stats = result.stats || {};

  return [
    `Collection mods: ${stats.collectionTotal ?? 0}`,
    `Downloaded: ${stats.downloaded ?? 0}`,
    `Updated: ${stats.updated ?? 0}`,
    `Skipped: ${stats.skipped ?? 0}`,
    `Failed: ${stats.failed ?? 0}`,
  ].join(" · ");
}

function appendModrinthUpdateConsoleResult(result) {
  appendConsole("[modrinth] Update finished.");
  appendConsole(`[modrinth] ${summarizeModrinthUpdateResult(result)}`);

  if (Array.isArray(result?.logs)) {
    for (const line of result.logs) {
      appendConsole(`[modrinth] ${line}`);
    }
  }

  if (Array.isArray(result?.failedMods) && result.failedMods.length > 0) {
    appendConsole("[modrinth] Failed mods:");

    for (const failed of result.failedMods) {
      appendConsole(`  - ${failed}`);
    }
  }
}

async function updateEditorModsFromModrinthCollection() {
  const profileId = state.installationEditor.profileId;
  const profile = getEditorProfile();
  const input = $("#editorModrinthCollectionInput");
  const button = $("#updateEditorModsVersionBtn");

  if (!profileId || !profile) {
    showAlert("Open an installation first.");
    return;
  }

  const collectionInput = input?.value.trim() || "";

  if (!collectionInput) {
    showAlert("Paste a Modrinth collection URL or ID first.");
    input?.focus();
    return;
  }

  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Updating...";
    }

    const targetVersion = profile.minecraftVersion || "unknown";
    const targetLoader = profile.loaderType || "unknown";

    setEditorModrinthUpdateStatus(
      `Updating mods for Minecraft ${targetVersion} / ${targetLoader}...`
    );

    appendConsole(
      `[modrinth] Updating collection for ${profile.name} (${targetVersion}, ${targetLoader})...`
    );

    const result = await window.launcherAPI.mods.add(profileId, {
      source: "modrinth-collection",
      collection: collectionInput,
    });

    setEditorModrinthUpdateStatus(summarizeModrinthUpdateResult(result));
    appendModrinthUpdateConsoleResult(result);

    await renderEditorMods();
  } catch (error) {
    const message = error.message || "Failed to update mods from Modrinth.";
    setEditorModrinthUpdateStatus(message);
    appendConsole(`[modrinth error] ${message}`);
    showError(message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Update Version";
    }
  }
}

/* ----------------------------- Skin changer ----------------------------- */

function imageToDataUrl(url) {
  return new Promise((resolve) => {
    if (!url) {
      resolve("");
      return;
    }

    const image = new Image();
    image.crossOrigin = "anonymous";

    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;

        const context = canvas.getContext("2d");
        context.imageSmoothingEnabled = false;
        context.drawImage(image, 0, 0);

        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(url);
      }
    };

    image.onerror = () => resolve("");
    image.src = url;
  });
}
function getSkinSourceFromEntry(skin) {
  return skin?.dataUrl || skin?.skinDataUrl || skin?.url || "";
}
function getSkinPreviewSource(skin) {
  return getSkinSourceFromEntry(skin) || DEFAULT_STEVE_SKIN;
}

function getCurrentSkinFromMinecraftProfile() {
  const skins = state.skins.minecraftProfile?.skins || [];
  const active = skins.find((skin) => skin.state === "ACTIVE") || skins[0] || null;

  if (active?.url) {
    return {
      ...active,
      url: active.url.replace(/^http:\/\//i, "https://"),
    };
  }

  const sessionSkinUrl = state.skins.minecraftProfile?.sessionTextures?.skinUrl || "";

  if (sessionSkinUrl) {
    return {
      id: "session-active-skin",
      state: "ACTIVE",
      url: sessionSkinUrl.replace(/^http:\/\//i, "https://"),
      variant: state.skins.minecraftProfile?.sessionTextures?.model || "CLASSIC",
    };
  }

  return {
    id: "default-steve",
    state: "ACTIVE",
    url: DEFAULT_STEVE_SKIN,
    variant: "CLASSIC",
  };
}

function getActiveCapeFromMinecraftProfile() {
  const capes = state.skins.minecraftProfile?.capes || [];
  const active = capes.find((cape) => cape.state === "ACTIVE") || null;

  if (active?.url) {
    return {
      ...active,
      url: active.url.replace(/^http:\/\//i, "https://"),
    };
  }

  const sessionCapeUrl = state.skins.minecraftProfile?.sessionTextures?.capeUrl || "";

  if (sessionCapeUrl) {
    return {
      id: `session:${sessionCapeUrl}`,
      state: "ACTIVE",
      url: sessionCapeUrl.replace(/^http:\/\//i, "https://"),
      alias: "Mojang Cape",
    };
  }

  return null;
}

function getAvailableCapes() {
  const capes = Array.isArray(state.skins.minecraftProfile?.capes)
    ? state.skins.minecraftProfile.capes
    : [];

  const normalized = capes
    .filter((cape) => cape?.url)
    .map((cape) => ({
      id: cape.id || cape.alias || cape.url || "",
      name: cape.alias || cape.id || "Cape",
      url: String(cape.url || "").replace(/^http:\/\//i, "https://"),
      state: cape.state || "",
      source: "minecraft-services",
    }));

  const sessionCapeUrl = state.skins.minecraftProfile?.sessionTextures?.capeUrl || "";

  if (sessionCapeUrl) {
    const httpsSessionCapeUrl = sessionCapeUrl.replace(/^http:\/\//i, "https://");

    const alreadyListed = normalized.some((cape) => cape.url === httpsSessionCapeUrl);

    if (!alreadyListed) {
      normalized.unshift({
        id: `session:${httpsSessionCapeUrl}`,
        name: "Active Cape",
        url: httpsSessionCapeUrl,
        state: "ACTIVE",
        source: "sessionserver",
      });
    }
  }

  return normalized;
}

function drawSkinPart(context, image, source, target) {
  context.drawImage(
    image,
    source.x,
    source.y,
    source.w,
    source.h,
    target.x,
    target.y,
    target.w,
    target.h
  );
}

function drawDefaultSteve(context, width, height) {
  const scale = Math.floor(Math.min(width / 48, height / 72));
  const unit = Math.max(3, scale);
  const originX = Math.floor(width / 2 - 10 * unit);
  const originY = Math.floor(height / 2 - 24 * unit);

  context.imageSmoothingEnabled = false;

  context.fillStyle = "#8d5524";
  context.fillRect(originX + 6 * unit, originY + 2 * unit, 8 * unit, 6 * unit);

  context.fillStyle = "#3b2416";
  context.fillRect(originX + 6 * unit, originY, 8 * unit, 2 * unit);
  context.fillRect(originX + 6 * unit, originY, 2 * unit, 8 * unit);
  context.fillRect(originX + 12 * unit, originY, 2 * unit, 8 * unit);

  context.fillStyle = "#00a6b8";
  context.fillRect(originX + 6 * unit, originY + 8 * unit, 8 * unit, 12 * unit);
  context.fillRect(originX + 2 * unit, originY + 8 * unit, 4 * unit, 4 * unit);
  context.fillRect(originX + 14 * unit, originY + 8 * unit, 4 * unit, 4 * unit);

  context.fillStyle = "#8d5524";
  context.fillRect(originX + 2 * unit, originY + 12 * unit, 4 * unit, 8 * unit);
  context.fillRect(originX + 14 * unit, originY + 12 * unit, 4 * unit, 8 * unit);

  context.fillStyle = "#3b3b8f";
  context.fillRect(originX + 6 * unit, originY + 20 * unit, 4 * unit, 10 * unit);
  context.fillRect(originX + 10 * unit, originY + 20 * unit, 4 * unit, 10 * unit);

  context.fillStyle = "#272727";
  context.fillRect(originX + 6 * unit, originY + 30 * unit, 4 * unit, 2 * unit);
  context.fillRect(originX + 10 * unit, originY + 30 * unit, 4 * unit, 2 * unit);
}

function drawMinecraftSkin(canvas, skinSource, options = {}) {
  if (!canvas) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  const width = canvas.width;
  const height = canvas.height;
  const scale = Math.floor(Math.min(width / 48, height / 72));
  const unit = Math.max(3, scale);

  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = false;

  if (!skinSource) {
    drawDefaultSteve(context, width, height);
    return;
  }

  const image = new Image();

  image.onload = () => {
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = false;

    const rotation = (((options.rotation || 0) % 360) + 360) % 360;
    const isBack = rotation > 90 && rotation < 270;

    const slim = options.model === "slim";
    const armWidth = slim ? 3 : 4;

    const originX = Math.floor(width / 2 - 10 * unit);
    const originY = Math.floor(height / 2 - 24 * unit);

    const face = isBack ? { x: 24, y: 8, w: 8, h: 8 } : { x: 8, y: 8, w: 8, h: 8 };

    const headOverlay = isBack ? { x: 56, y: 8, w: 8, h: 8 } : { x: 40, y: 8, w: 8, h: 8 };

    const body = isBack ? { x: 32, y: 20, w: 8, h: 12 } : { x: 20, y: 20, w: 8, h: 12 };

    const rightArm = isBack
      ? { x: 52, y: 20, w: armWidth, h: 12 }
      : { x: 44, y: 20, w: armWidth, h: 12 };

    const leftArm = isBack
      ? { x: 44, y: 52, w: armWidth, h: 12 }
      : { x: 36, y: 52, w: armWidth, h: 12 };

    const rightLeg = isBack ? { x: 12, y: 20, w: 4, h: 12 } : { x: 4, y: 20, w: 4, h: 12 };

    const leftLeg = isBack ? { x: 28, y: 52, w: 4, h: 12 } : { x: 20, y: 52, w: 4, h: 12 };

    drawSkinPart(context, image, face, {
      x: originX + 6 * unit,
      y: originY,
      w: 8 * unit,
      h: 8 * unit,
    });

    drawSkinPart(context, image, headOverlay, {
      x: originX + 6 * unit,
      y: originY,
      w: 8 * unit,
      h: 8 * unit,
    });

    drawSkinPart(context, image, body, {
      x: originX + 6 * unit,
      y: originY + 8 * unit,
      w: 8 * unit,
      h: 12 * unit,
    });

    drawSkinPart(context, image, rightArm, {
      x: originX + (6 - armWidth) * unit,
      y: originY + 8 * unit,
      w: armWidth * unit,
      h: 12 * unit,
    });

    drawSkinPart(context, image, leftArm, {
      x: originX + 14 * unit,
      y: originY + 8 * unit,
      w: armWidth * unit,
      h: 12 * unit,
    });

    drawSkinPart(context, image, rightLeg, {
      x: originX + 6 * unit,
      y: originY + 20 * unit,
      w: 4 * unit,
      h: 12 * unit,
    });

    drawSkinPart(context, image, leftLeg, {
      x: originX + 10 * unit,
      y: originY + 20 * unit,
      w: 4 * unit,
      h: 12 * unit,
    });
  };

  image.onerror = () => {
    context.clearRect(0, 0, width, height);
    drawDefaultSteve(context, width, height);
  };

  image.src = skinSource;
}

function destroySkinViewer(viewer) {
  try {
    if (viewer && typeof viewer.dispose === "function") {
      viewer.dispose();
    }
  } catch {
    // Ignore viewer cleanup errors.
  }
}

function setupSkinViewerCanvas(canvas, skinSource, capeSource = "", options = {}) {
  if (!canvas || !window.skinview3d?.SkinViewer) {
    drawMinecraftSkin(canvas, skinSource, options);
    return null;
  }

  const viewer = new window.skinview3d.SkinViewer({
    canvas,
    width: canvas.width,
    height: canvas.height,
    skin: skinSource || DEFAULT_STEVE_SKIN,
    cape: capeSource || undefined,
  });

  viewer.background = null;

  if (viewer.controls) {
    viewer.controls.enableZoom = false;
    viewer.controls.enablePan = false;
  }

  if (viewer.playerObject) {
    viewer.playerObject.rotation.y = 0.35;
  }

  try {
    viewer.animation = new window.skinview3d.WalkingAnimation();
    viewer.animation.speed = 0.7;
  } catch {
    // Older skinview3d versions may expose animations differently.
  }

  return viewer;
}

function updateSkinEditorViewer() {
  const canvas = $("#skinEditorCanvas");
  if (!canvas) return;

  destroySkinViewer(skinEditorViewer);
  skinEditorViewer = null;

  const capeId = selectedSkinEditorCapeId();
  const cape = getAvailableCapes().find((item) => item.id === capeId);
  const capeUrl = cape?.url || "";

  skinEditorViewer = setupSkinViewerCanvas(
    canvas,
    state.skins.editorImageDataUrl || DEFAULT_STEVE_SKIN,
    capeUrl,
    {
      model: selectedSkinEditorModel(),
    }
  );
}

function updateCurrentSkinViewer() {
  const canvas = $("#currentSkinCanvas");
  if (!canvas) return;

  destroySkinViewer(currentSkinViewer);
  currentSkinViewer = null;

  const currentSkin = getCurrentSkinFromMinecraftProfile();
  const currentCape = getActiveCapeFromMinecraftProfile();

  currentSkinViewer = setupSkinViewerCanvas(
    canvas,
    currentSkin?.url || DEFAULT_STEVE_SKIN,
    currentCape?.url || "",
    {
      model: currentSkin?.variant === "SLIM" || currentSkin?.variant === "slim" ? "slim" : "wide",
    }
  );
}

function getSelectedLibrarySkin() {
  return state.skins.library.find((skin) => skin.id === state.skins.selectedSkinId) || null;
}

function updateSelectedSkinViewer() {
  const canvas = $("#selectedSkinCanvas");
  if (!canvas) return;

  destroySkinViewer(selectedSkinViewer);
  selectedSkinViewer = null;

  const selectedSkin = getSelectedLibrarySkin();
  const selectedCape = getAvailableCapes().find((cape) => cape.id === selectedSkin?.capeId);

  selectedSkinViewer = setupSkinViewerCanvas(
    canvas,
    getSkinSourceFromEntry(selectedSkin) || DEFAULT_STEVE_SKIN,
    selectedCape?.url || "",
    {
      model: selectedSkin?.model || "wide",
    }
  );
}

function drawCapePlaceholder(canvas, capeName = "", selected = false) {
  if (!canvas) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  const hash = String(capeName || "")
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);

  const color = capePreviewColors[hash % capePreviewColors.length];

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;

  context.fillStyle = "#202020";
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (!capeName) return;

  context.fillStyle = color;
  context.fillRect(18, 8, 44, 92);

  context.fillStyle = "rgba(255,255,255,0.25)";
  context.fillRect(24, 14, 12, 16);
  context.fillRect(42, 34, 14, 14);
  context.fillRect(28, 62, 24, 10);

  context.fillStyle = "rgba(0,0,0,0.25)";
  context.fillRect(18, 8, 6, 92);
  context.fillRect(56, 8, 6, 92);

  if (selected) {
    context.strokeStyle = "#55ff55";
    context.lineWidth = 3;
    context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  }
}

function drawCapeTextureFront(canvas, capeUrl, selected = false) {
  if (!canvas || !capeUrl) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  const image = new Image();
  image.crossOrigin = "anonymous";

  image.onload = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;

    /*
      Minecraft cape texture layout is usually 64x32.
      The main visible cape face is 10x16 pixels at x=1, y=1.
    */
    const sourceX = 1;
    const sourceY = 1;
    const sourceWidth = 10;
    const sourceHeight = 16;

    const scale = Math.floor(Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight));

    const targetWidth = sourceWidth * scale;
    const targetHeight = sourceHeight * scale;

    const targetX = Math.floor((canvas.width - targetWidth) / 2);
    const targetY = Math.floor((canvas.height - targetHeight) / 2);

    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      targetX,
      targetY,
      targetWidth,
      targetHeight
    );

    if (selected) {
      context.strokeStyle = "#55ff55";
      context.lineWidth = 3;
      context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    }
  };

  image.onerror = () => {
    drawCapePlaceholder(canvas, canvas.dataset.capeName || "", selected);
  };

  image.src = capeUrl;
}

function drawAllCapePreviews() {
  $$("[data-cape-url]").forEach((canvas) => {
    drawCapeTextureFront(canvas, canvas.dataset.capeUrl || "", canvas.dataset.selected === "true");
  });

  $$("[data-cape-preview]").forEach((canvas) => {
    drawCapePlaceholder(canvas, canvas.dataset.capeName || "", canvas.dataset.selected === "true");
  });
}

function startSkinPreviewAnimation() {
  // Library cards do not animate.
  // Current and editor previews are handled by skinview3d.
}

function stopSkinPreviewAnimation() {
  if (state.skins.animationFrame) {
    cancelAnimationFrame(state.skins.animationFrame);
    state.skins.animationFrame = null;
  }
}

function renderCapePreviewHtml(cape, selectedCapeId = "") {
  const capeId = cape?.id || "";
  const capeName = cape?.name || "Cape";
  const capeUrl = cape?.url || "";

  if (capeUrl) {
    return `
      <canvas
        class="skin-cape-preview-canvas"
        data-cape-url="${escapeHtml(capeUrl)}"
        data-cape-name="${escapeHtml(capeName)}"
        data-selected="${capeId === selectedCapeId ? "true" : "false"}"
        width="80"
        height="112"
      ></canvas>
    `;
  }

  return `
    <canvas
      class="skin-cape-preview-canvas"
      data-cape-preview="${escapeHtml(capeId || "none")}"
      data-cape-name="${escapeHtml(capeName)}"
      data-selected="${capeId === selectedCapeId ? "true" : "false"}"
      width="80"
      height="112"
    ></canvas>
  `;
}

function renderSkinPage() {
  const root = $("#home-tab-skin");
  if (!root) return;

  const currentSkin = getCurrentSkinFromMinecraftProfile();
  const currentCape = getActiveCapeFromMinecraftProfile();
  const library = state.skins.library || [];

  root.innerHTML = `
    <div class="skin-page">
      <section class="skin-current-panel">
        <div class="skin-current-block">
          <p class="skin-panel-title whitetext mct">Current</p>

          <div class="skin-current-preview-wrap">
            <canvas id="currentSkinCanvas" width="220" height="340" class="skin-current-canvas"></canvas>
          </div>

          <p class="skin-current-name whitetext mcr">
            ${escapeHtml(currentSkin?.variant || "Steve")}
            ${currentCape ? ` · Cape: ${escapeHtml(currentCape.alias || currentCape.name || currentCape.id || "Cape")}` : ""}
          </p>

          <button id="addCurrentSkinToLibraryBtn" class="primary mcbtn skin-add-current-btn" type="button">
            Add to library
          </button>
        </div>
      </section>

      <section class="skin-library-panel">
        <p class="skin-panel-title whitetext mct">Library</p>

        <div id="skinLibraryGrid" class="skin-library-grid">
          <button id="newSkinBtn" class="skin-library-card skin-new-card" type="button">
            <span class="skin-new-plus">+</span>
            <span class="whitetext mcr">New skin</span>
          </button>

          ${library
            .map(
              (skin) => `
            <div class="skin-library-card" data-skin-id="${escapeHtml(skin.id)}">
              <p class="skin-card-title whitetext mcr">${escapeHtml(skin.name || "Skin")}</p>
              <div class="skin-card-preview-wrap">
                <canvas class="skin-card-canvas" width="120" height="160"></canvas>
              </div>
              <div class="skin-card-hover-panel">
                <button class="mcbtn skin-card-action green" data-action="use" type="button">Use</button>
                <button class="mcbtn skin-card-action blue" data-action="edit" type="button">Edit</button>
                <button class="mcbtn skin-card-action gray" data-action="duplicate" type="button">Duplicate</button>
                <button class="mcbtn skin-card-action danger" data-action="delete" type="button">Delete</button>
              </div>
            </div>
          `
            )
            .join("")}
        </div>
      </section>
    </div>
  `;

  updateCurrentSkinViewer();

  const currentCanvas = $("#currentSkinCanvas");

  if (currentCanvas) {
    currentCanvas.addEventListener("mousedown", (event) => {
      state.skins.previewDragging = true;
      state.skins.previewDragStartX = event.clientX;
      state.skins.previewDragStartRotation = state.skins.previewRotation;
    });
  }

  document.addEventListener("mousemove", handleSkinPreviewMouseMove);
  document.addEventListener("mouseup", handleSkinPreviewMouseUp);

  $$(".skin-library-card[data-skin-id]").forEach((card) => {
    const skinId = card.dataset.skinId;
    const skin = library.find((item) => item.id === skinId);
    const canvas = card.querySelector(".skin-card-canvas");

    if (canvas) {
      requestAnimationFrame(() => {
        drawMinecraftSkin(canvas, getSkinPreviewSource(skin), {
          model: skin?.model || "wide",
          rotation: 0,
          animate: false,
        });
      });
    }

    card.querySelector('[data-action="use"]')?.addEventListener("click", async (event) => {
      event.stopPropagation();
      await useSkinFromLibrary(skinId);
    });

    card.querySelector('[data-action="edit"]')?.addEventListener("click", (event) => {
      event.stopPropagation();
      openSkinEditor(skinId);
    });

    card.querySelector('[data-action="duplicate"]')?.addEventListener("click", async (event) => {
      event.stopPropagation();
      await duplicateSkinInLibrary(skinId);
    });

    card.querySelector('[data-action="delete"]')?.addEventListener("click", async (event) => {
      event.stopPropagation();
      await deleteSkinFromLibrary(skinId);
    });

    card.addEventListener("click", () => {
      state.skins.selectedSkinId = skinId;
    });
  });

  $("#newSkinBtn")?.addEventListener("click", () => {
    openSkinEditor(null);
  });

  $("#addCurrentSkinToLibraryBtn")?.addEventListener("click", async () => {
    await addCurrentSkinToLibrary();
  });

  startSkinPreviewAnimation();
}

function handleSkinPreviewMouseMove(event) {
  if (!state.skins.previewDragging) return;

  const delta = event.clientX - state.skins.previewDragStartX;
  state.skins.previewRotation = state.skins.previewDragStartRotation + delta;

  const currentViewer = currentSkinViewer;
  if (currentViewer?.playerObject) {
    currentViewer.playerObject.rotation.y = state.skins.previewRotation / 90;
  }
}

function handleSkinPreviewMouseUp() {
  state.skins.previewDragging = false;
}

async function loadSkinPageData(force = false) {
  if (state.skins.loaded && !force) {
    renderSkinPage();
    return;
  }

  const root = $("#home-tab-skin");

  if (!state.account?.username || state.account.type === "offline") {
    renderSkinLoginRequired(root);
    return;
  }

  if (root) {
    root.innerHTML = `<div class="skin-loading whitetext mcr">Loading skins...</div>`;
  }

  try {
    const [minecraftProfile, library] = await Promise.all([
      window.launcherAPI.skins.getMinecraftProfile(),
      window.launcherAPI.skins.list(),
    ]);

    state.skins.minecraftProfile = minecraftProfile;
    state.skins.library = library?.skins || [];
    state.skins.loaded = true;

    renderSkinPage();

    if (force) remountWidget("skin");
  } catch (error) {
    const message = friendlyErrorMessage(error, "Failed to load skins.");

    if (/not logged in|login with microsoft/i.test(message)) {
      renderSkinLoginRequired(root);
      return;
    }

    if (root) {
      root.innerHTML = `
        <div class="skin-loading whitetext mcr">
          ${escapeHtml(message)}
        </div>
      `;
    }
  }
}

const appDialogQueue = [];
let appDialogActive = false;

function showAppDialog(options) {
  return new Promise((resolve) => {
    appDialogQueue.push({ ...options, resolve });
    pumpAppDialog();
  });
}

function pumpAppDialog() {
  if (appDialogActive || appDialogQueue.length === 0) return;

  const item = appDialogQueue.shift();
  const backdrop = $("#appDialogBackdrop");
  const dialog = $("#appDialog");
  const okBtn = $("#appDialogOkBtn");
  const cancelBtn = $("#appDialogCancelBtn");

  if (!backdrop || !dialog || !okBtn || !cancelBtn) {
    item.resolve(Boolean(item.cancelText) ? false : true);
    return;
  }

  appDialogActive = true;

  const previousFocus = document.activeElement;

  dialog.className = `app-dialog mcsection kind-${item.kind || "info"}`;
  $("#appDialogTitle").textContent = item.title || "Notice";
  $("#appDialogMessage").textContent = item.message || "";
  okBtn.textContent = item.confirmText || "OK";
  cancelBtn.textContent = item.cancelText || "Cancel";
  cancelBtn.classList.toggle("hidden", !item.cancelText);

  backdrop.classList.remove("hidden");
  okBtn.focus();

  const close = (value) => {
    backdrop.classList.add("hidden");
    okBtn.removeEventListener("click", onOk);
    cancelBtn.removeEventListener("click", onCancel);
    document.removeEventListener("keydown", onKey, true);

    appDialogActive = false;
    previousFocus?.focus?.();
    item.resolve(value);
    pumpAppDialog();
  };

  const onOk = () => close(true);
  const onCancel = () => close(false);

  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(item.cancelText ? false : true);
      return;
    }

    if (event.key === "Enter" && document.activeElement !== cancelBtn) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      (document.activeElement === okBtn && item.cancelText ? cancelBtn : okBtn).focus();
    }
  };

  okBtn.addEventListener("click", onOk);
  cancelBtn.addEventListener("click", onCancel);
  document.addEventListener("keydown", onKey, true);
}

function showAlert(message, options = {}) {
  return showAppDialog({
    title: options.title || "Notice",
    message: friendlyErrorMessage(message, ""),
    kind: options.kind || "info",
    confirmText: options.confirmText || "OK",
  });
}

function showError(message, options = {}) {
  return showAlert(message, {
    title: options.title || "Something went wrong",
    kind: "error",
    confirmText: options.confirmText || "OK",
  });
}

function showConfirm(message, options = {}) {
  return showAppDialog({
    title: options.title || "Are you sure?",
    message: String(message || ""),
    kind: options.danger ? "danger" : "warning",
    confirmText: options.confirmText || "Yes",
    cancelText: options.cancelText || "Cancel",
  });
}

function isLoginCancelled(message) {
  return /gui\.closed|user cancel|cancell?ed|closed by user/i.test(String(message || ""));
}

function friendlyErrorMessage(error, fallback = "Something went wrong.") {
  const raw = String(error?.message || error || "").trim();
  const cleaned = raw.replace(/^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/i, "");
  return cleaned || fallback;
}

function renderSkinLoginRequired(root) {
  const template = $("#skinLoginRequiredTemplate");
  if (!root || !template) return;

  root.innerHTML = "";
  root.appendChild(template.content.cloneNode(true));

  root.querySelector('[data-action="skin-login"]')?.addEventListener("click", async () => {
    const account = await handleLogin();

    if (account?.username) {
      state.skins.loaded = false;
      await loadSkinPageData(true);
    }
  });
}

async function addCurrentSkinToLibrary() {
  const currentSkin = getCurrentSkinFromMinecraftProfile();

  if (!currentSkin?.url || currentSkin.url === DEFAULT_STEVE_SKIN) {
    showAlert("No uploaded Minecraft skin was found.");
    return;
  }

  try {
    const dataUrl = await imageToDataUrl(currentSkin.url);

    await window.launcherAPI.skins.create({
      name: "Current Skin",
      model: currentSkin.variant === "SLIM" || currentSkin.variant === "slim" ? "slim" : "wide",
      skinDataUrl: dataUrl || "",
      sourceUrl: currentSkin.url || "",
      capeId: getActiveCapeFromMinecraftProfile()?.id || "",
    });

    await loadSkinPageData(true);
  } catch (error) {
    showError(error.message || "Failed to add current skin.");
  }
}

function openSkinEditor(skinId = null) {
  const existing = state.skins.library.find((skin) => skin.id === skinId) || null;

  state.skins.editorOpen = true;
  state.skins.editorSkinId = skinId;
  state.skins.editorImageDataUrl = getSkinSourceFromEntry(existing) || DEFAULT_STEVE_SKIN;
  state.skins.editorCanvasDirty = false;

  const backdrop = $("#skinEditorBackdrop");
  const title = $("#skinEditorTitle");
  const nameInput = $("#skinEditorName");
  const modelWide = $("#skinEditorModelWide");
  const modelSlim = $("#skinEditorModelSlim");

  if (backdrop) backdrop.classList.remove("hidden");
  if (title) title.textContent = skinId ? "Edit skin" : "Add new skin";
  if (nameInput) nameInput.value = existing?.name || "unnamed skin";

  if (modelWide) modelWide.checked = existing?.model !== "slim";
  if (modelSlim) modelSlim.checked = existing?.model === "slim";

  renderSkinEditorCapeOptions(existing?.capeId || "");
  renderSkinEditorCanvas();
}

function closeSkinEditor() {
  const backdrop = $("#skinEditorBackdrop");
  if (backdrop) backdrop.classList.add("hidden");

  destroySkinViewer(skinEditorViewer);
  skinEditorViewer = null;

  state.skins.editorOpen = false;
  state.skins.editorSkinId = null;
  state.skins.editorImageDataUrl = "";
  state.skins.editorCanvasDirty = false;
}

function selectedSkinEditorModel() {
  return $("#skinEditorModelSlim")?.checked ? "slim" : "wide";
}

function selectedSkinEditorCapeId() {
  const selected = document.querySelector('input[name="skinEditorCape"]:checked');
  return selected?.value || "";
}

function renderSkinEditorCapeOptions(selectedCapeId = "") {
  const root = $("#skinEditorCapeOptions");
  if (!root) return;

  const capes = getAvailableCapes();

  root.innerHTML = `
    <label class="skin-cape-option">
      <input type="radio" name="skinEditorCape" value="" ${!selectedCapeId ? "checked" : ""} />
      ${renderCapePreviewHtml({ id: "", name: "" }, selectedCapeId)}
      <span class="whitetext mcr">No cape</span>
    </label>

    ${capes
      .map(
        (cape) => `
      <label class="skin-cape-option">
        <input type="radio" name="skinEditorCape" value="${escapeHtml(cape.id)}" ${cape.id === selectedCapeId ? "checked" : ""} />
        ${renderCapePreviewHtml(cape, selectedCapeId)}
        <span class="whitetext mcr">${escapeHtml(cape.name)}</span>
      </label>
    `
      )
      .join("")}
  `;

  root.querySelectorAll('input[name="skinEditorCape"]').forEach((input) => {
    input.addEventListener("change", () => {
      renderSkinEditorCapeOptions(selectedSkinEditorCapeId());
      updateSkinEditorViewer();
    });
  });

  requestAnimationFrame(drawAllCapePreviews);
}

function renderSkinEditorCanvas() {
  updateSkinEditorViewer();
}

async function pickSkinFileForEditor() {
  try {
    const picked = await window.launcherAPI.skins.pickSkinFile();
    if (!picked) return;

    state.skins.editorImageDataUrl = picked.skinDataUrl || "";
    state.skins.editorCanvasDirty = false;
    renderSkinEditorCanvas();
  } catch (error) {
    showError(error.message || "Failed to pick skin file.");
  }
}

function openBasicSkinPainter() {
  const canvas = $("#skinPaintCanvas");
  const source = state.skins.editorImageDataUrl;

  if (!canvas || !source) {
    showAlert("Browse a skin file first.");
    return;
  }

  const wrap = $("#skinPaintWrap");
  if (wrap) wrap.classList.remove("hidden");

  const context = canvas.getContext("2d");
  const image = new Image();

  image.onload = () => {
    canvas.width = 512;
    canvas.height = 512;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  };

  image.src = source;
}

function bindSkinPainterEvents() {
  const canvas = $("#skinPaintCanvas");
  const colorInput = $("#skinPaintColor");
  const savePaintBtn = $("#skinPaintSaveBtn");
  const closePaintBtn = $("#skinPaintCloseBtn");

  if (!canvas || canvas.dataset.bound === "true") return;

  canvas.dataset.bound = "true";

  let drawing = false;

  function paint(event) {
    if (!drawing) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / (rect.width / 64));
    const y = Math.floor((event.clientY - rect.top) / (rect.height / 64));

    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = false;
    context.fillStyle = colorInput?.value || "#00ffff";
    context.fillRect(x * 8, y * 8, 8, 8);
  }

  canvas.addEventListener("mousedown", (event) => {
    drawing = true;
    paint(event);
  });

  canvas.addEventListener("mousemove", paint);

  document.addEventListener("mouseup", () => {
    drawing = false;
  });

  savePaintBtn?.addEventListener("click", () => {
    const small = document.createElement("canvas");
    small.width = 64;
    small.height = 64;

    const context = small.getContext("2d");
    context.imageSmoothingEnabled = false;
    context.drawImage(canvas, 0, 0, 64, 64);

    state.skins.editorImageDataUrl = small.toDataURL("image/png");
    state.skins.editorCanvasDirty = true;
    $("#skinPaintWrap")?.classList.add("hidden");
    renderSkinEditorCanvas();
  });

  closePaintBtn?.addEventListener("click", () => {
    $("#skinPaintWrap")?.classList.add("hidden");
  });
}

async function saveSkinEditor(useAfterSave = false) {
  const name = $("#skinEditorName")?.value.trim() || "Skin";
  const model = selectedSkinEditorModel();
  const capeId = selectedSkinEditorCapeId();

  if (!state.skins.editorImageDataUrl) {
    showAlert("Choose a skin PNG first.");
    return;
  }

  try {
    let saved;

    if (state.skins.editorSkinId) {
      saved = await window.launcherAPI.skins.update(state.skins.editorSkinId, {
        name,
        model,
        capeId,
        skinDataUrl: state.skins.editorImageDataUrl,
      });
    } else {
      saved = await window.launcherAPI.skins.create({
        name,
        model,
        capeId,
        skinDataUrl: state.skins.editorImageDataUrl,
      });
    }

    if (useAfterSave) {
      await window.launcherAPI.skins.use(saved.id, {
        capeId,
      });

      refreshLoginCardHeadAfterSkinChange();
    }

    closeSkinEditor();
    await loadSkinPageData(true);
  } catch (error) {
    showError(error.message || "Failed to save skin.");
  }
}

let skinUseInProgress = false;

async function useSkinFromLibrary(skinId) {
  if (skinUseInProgress) {
    return;
  }

  skinUseInProgress = true;

  try {
    const result = await window.launcherAPI.skins.use(skinId);

    refreshLoginCardHeadAfterSkinChange();

    await loadSkinPageData(true);
    appendConsole("[skins] Skin applied.");

    if (result?.capeResult?.warning) {
      appendConsole(`[skins warning] ${result.capeResult.warning}`);
      showAlert(result.capeResult.warning, { title: "Heads up", kind: "warning" });
    }
  } catch (error) {
    showError(error.message || "Failed to use skin.");
  } finally {
    skinUseInProgress = false;
  }
}

async function duplicateSkinInLibrary(skinId) {
  try {
    await window.launcherAPI.skins.duplicate(skinId);
    await loadSkinPageData(true);
  } catch (error) {
    showError(error.message || "Failed to duplicate skin.");
  }
}

async function deleteSkinFromLibrary(skinId) {
  const skin = state.skins.library.find((item) => item.id === skinId);
  const confirmed = await showConfirm(`Delete skin "${skin?.name || "Skin"}"?`, {
    title: "Delete skin",
    confirmText: "Delete",
    danger: true,
  });

  if (!confirmed) return;

  try {
    await window.launcherAPI.skins.delete(skinId);
    await loadSkinPageData(true);
  } catch (error) {
    showError(error.message || "Failed to delete skin.");
  }
}

function initSkinEditorEvents() {
  $("#closeSkinEditorBtn")?.addEventListener("click", closeSkinEditor);
  $("#cancelSkinEditorBtn")?.addEventListener("click", closeSkinEditor);
  $("#browseSkinFileBtn")?.addEventListener("click", pickSkinFileForEditor);
  $("#editSkinPixelsBtn")?.addEventListener("click", openBasicSkinPainter);
  $("#saveSkinEditorBtn")?.addEventListener("click", () => saveSkinEditor(false));
  $("#saveUseSkinEditorBtn")?.addEventListener("click", () => saveSkinEditor(true));

  $("#skinEditorModelWide")?.addEventListener("change", renderSkinEditorCanvas);
  $("#skinEditorModelSlim")?.addEventListener("change", renderSkinEditorCanvas);

  bindSkinPainterEvents();

  const backdrop = $("#skinEditorBackdrop");
  if (backdrop) {
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        closeSkinEditor();
      }
    });
  }
}

function getDroppedJarPaths(event) {
  const files = Array.from(event.dataTransfer?.files || []);

  if (window.launcherAPI?.mods?.getDroppedFilePaths) {
    return window.launcherAPI.mods
      .getDroppedFilePaths(files)
      .filter((filePath) => filePath.toLowerCase().endsWith(".jar"));
  }

  return files
    .filter((file) => file.name.toLowerCase().endsWith(".jar"))
    .map((file) => file.path)
    .filter(Boolean);
}

async function loadServerStatuses() {
  homeWidgets.serverStatusCache.clear();
  refreshDataWidgets();
}

async function syncDefaultClient(mode, force = true) {
  try {
    if (mode === "delete") {
      const confirmed = await showConfirm(
        "This will delete the old Default installation folder before downloading the new one. Continue?",
        { title: "Replace Default installation", confirmText: "Continue", danger: true }
      );

      if (!confirmed) return;
    }

    showPage("console");

    if (mode === "delete") {
      setStatus("Deleting and updating Default installation...");
      appendConsole("[client updater] Delete mode selected.");
    } else {
      setStatus("Updating Default installation and keeping existing files...");
      appendConsole("[client updater] Keep mode selected.");
    }

    await window.launcherAPI.clientUpdater.syncDefault({
      mode,
      force,
    });

    await loadProfiles();
  } catch (error) {
    setStatus(error.message || "Default client update failed.");
    appendConsole(`[client updater error] ${error.message || error}`);
    showError(error.message || "Default client update failed.");
  }
}

async function checkDefaultClientInfoManually(options = {}) {
  try {
    const info = await window.launcherAPI.clientUpdater.getDefaultInfo();

    state.clientUpdateInfo = info;
    refreshWidget("launcherupdate");

    if (!info.updateAvailable) {
      setUpdateStatus(
        `Default client is up to date. Version: ${info.remoteClientVersion || "unknown"}`
      );
      setStatus("Default client is already up to date.");
      return;
    }

    setUpdateStatus(
      `Default client update available: ${info.localClientVersion || "none"} → ${info.remoteClientVersion || "new"}. ` +
        `Server mode: ${info.updateMode || "keep"}.`
    );

    setStatus("Default client update available.");

    const autoClient = state.updateSettings?.autoUpdateClient !== false;

    if (options.manual || (autoClient && info.updateMode === "ask")) {
      showUpdateModePrompt(info);
    }
  } catch (error) {
    setUpdateStatus(`Default client check failed: ${error.message || error}`);
    setStatus("Default client check failed.");
    // Don't show alert on boot, just log it
    appendConsole(`[client updater] Check failed: ${error.message || error}`);
  }
}
function showUpdateModePrompt(info) {
  const backdrop = document.createElement("div");
  backdrop.className = "update-mode-backdrop";
  backdrop.innerHTML = `
    <div class="update-mode-dialog mcsection shadow">
      <p class="update-mode-title whitetext mct">Client Update Available</p>
      
      <p class="update-mode-message whitetext mcr">
        Would you like to install this update?<br/>
        <span class="update-version-info mcr">${escapeHtml(info.localClientVersion || "current")} → ${escapeHtml(info.remoteClientVersion || "new")}</span>
      </p>
      
      <div class="update-mode-buttons">
        <button id="updateModeKeepBtn" class=" update-mode-btn mcbtn primary" type="button">
          Keep Files
        </button>
        <button id="updateModeDeleteBtn" class=" update-mode-btn mcbtn danger" type="button">
          Delete & Install
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const keepBtn = backdrop.querySelector("#updateModeKeepBtn");
  const deleteBtn = backdrop.querySelector("#updateModeDeleteBtn");

  keepBtn.addEventListener("click", async () => {
    backdrop.remove();
    await syncDefaultClient("keep", true);
  });

  deleteBtn.addEventListener("click", async () => {
    backdrop.remove();
    await syncDefaultClient("delete", true);
  });

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      backdrop.remove();
    }
  });
}
async function handleLogin() {
  const loginBtn = $("#loginBtn");

  try {
    setStatus("Opening Microsoft login...");
    appendConsole("[auth] Login button clicked.");

    if (loginBtn) {
      loginBtn.disabled = true;
      loginBtn.textContent = "Opening login...";
    }

    const result = await window.launcherAPI.auth.login();

    appendConsole(`[auth] Backend returned: ${JSON.stringify(result)}`);

    if (!result || !result.ok) {
      const message = result?.error || "Login failed.";

      if (isLoginCancelled(message)) {
        setStatus("Sign-in cancelled.");
        appendConsole("[auth] Sign-in window closed before signing in.");
        return;
      }

      setStatus(message);
      appendConsole(`[auth error] ${message}`);
      showError(message, { title: "Sign-in failed" });
      return;
    }

    state.account = result.account;
    renderAccountBox(result.account);

    const refreshedAccount = await loadAccount();

    if (!refreshedAccount || !refreshedAccount.username) {
      setStatus("Login saved, but the UI could not reload the account.");
      appendConsole("[auth warning] Login saved, but getAccount returned empty.");
      showAlert("Login saved, but the UI could not reload the account. Restart the launcher.", {
        title: "Restart needed",
        kind: "warning",
      });
      return;
    }

    setStatus(`Logged in as ${refreshedAccount.username}.`);
    appendConsole(`[auth] Logged in as ${refreshedAccount.username}.`);

    state.skins.minecraftProfile = null;
    remountWidget("skin");
    refreshWidget("pvphq");
    playWelcomeAnimation(refreshedAccount);

    return refreshedAccount;
  } catch (error) {
    const message = error.message || String(error);

    if (isLoginCancelled(message)) {
      setStatus("Sign-in cancelled.");
      appendConsole("[auth] Sign-in window closed before signing in.");
      return;
    }

    setStatus(message);
    appendConsole(`[auth error] ${message}`);
    showError(message, { title: "Sign-in failed" });
  } finally {
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.textContent = "Login with Microsoft";
    }
  }
}

async function openExternalLink(url) {
  try {
    await window.launcherAPI.links.openExternal(url);
  } catch (error) {
    const message = error.message || String(error);
    appendConsole(`[link error] ${message}`);
    showError(message);
  }
}

async function openEditorInstallationFolder() {
  const inputPath = $("#editorSettingGameDir")?.value.trim();
  const profile = getEditorProfile();
  const folderPath = inputPath || profile?.gameDir || "";

  if (!folderPath) {
    showAlert("No game directory is set for this installation.");
    return;
  }

  try {
    if (!window.launcherAPI.folders?.openPath) {
      throw new Error("folders.openPath is not exposed in preload.");
    }

    await window.launcherAPI.folders.openPath(folderPath);
  } catch (error) {
    appendConsole(`[folder error] ${error.message || error}`);
    showError(error.message || "Failed to open installation folder.");
  }
}

function flyRocket() {
  const rocket = $("#launchRocket");
  if (!rocket) return;

  const rocketClone = rocket.cloneNode(true);
  const rocketRect = rocket.getBoundingClientRect();

  rocketClone.id = "";
  rocketClone.className = "flying-rocket";
  rocketClone.style.left = `${rocketRect.left}px`;
  rocketClone.style.top = `${rocketRect.top}px`;

  document.body.appendChild(rocketClone);

  setTimeout(() => {
    rocketClone.remove();
  }, 900);
}

function initNewsTabs() {
  const newsTabButtons = $$(".news-tab-btn");

  if (newsTabButtons.length === 0) return;

  const minecraftFrame = $("#minecraftNewsFrame");
  const launcherFrame = $("#launcherNewsFrame");

  newsTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.newsTab;

      newsTabButtons.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.newsTab === tab);
      });

      minecraftFrame?.classList.toggle("active", tab === "minecraft");
      launcherFrame?.classList.toggle("active", tab === "launcher");

      if (tab === "minecraft") {
        loadNewsFrame(minecraftFrame);
      }

      if (tab === "launcher") {
        loadNewsFrame(launcherFrame);
      }
    });
  });
}

function ensureLaunchProgressBar() {
  if ($("#launchProgressWrap")) return;

  const homePage = $("#page-home");
  if (!homePage) return;

  const wrap = document.createElement("div");
  wrap.id = "launchProgressWrap";
  wrap.className = "launch-progress-wrap hidden-progress";
  wrap.innerHTML = `<div id="launchProgressFill" class="launch-progress-fill"></div>`;

  homePage.appendChild(wrap);
}

function setLaunchProgress(percent) {
  ensureLaunchProgressBar();

  const wrap = $("#launchProgressWrap");
  const fill = $("#launchProgressFill");

  if (!wrap || !fill) return;

  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));

  wrap.classList.remove("hidden-progress");
  fill.style.width = `${safePercent}%`;
}

function hideLaunchProgress() {
  const wrap = $("#launchProgressWrap");
  const fill = $("#launchProgressFill");

  if (fill) fill.style.width = "0%";
  if (wrap) wrap.classList.add("hidden-progress");

  if (launchProgressTimer) {
    clearInterval(launchProgressTimer);
    launchProgressTimer = null;
  }
}

let launchProgressHideTimer = null;

function startFakeLaunchProgress() {
  clearTimeout(launchProgressHideTimer);
  hideLaunchProgress();

  let value = 4;
  setLaunchProgress(value);

  launchProgressTimer = setInterval(() => {
    value = Math.min(88, value + Math.max(1, Math.floor((92 - value) / 8)));
    setLaunchProgress(value);
  }, 450);
}

function finishLaunchProgress() {
  if (launchProgressTimer) {
    clearInterval(launchProgressTimer);
    launchProgressTimer = null;
  }

  setLaunchProgress(100);

  clearTimeout(launchProgressHideTimer);
  launchProgressHideTimer = setTimeout(() => {
    hideLaunchProgress();
  }, 1000);
}

function ensureClientUpdateOverlay() {
  if ($("#clientUpdateOverlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "clientUpdateOverlay";
  overlay.className = "client-update-overlay";
  overlay.innerHTML = `
    <div class="client-update-card">
      <p class="client-update-title whitetext mct">Updating Client</p>
      <p id="clientUpdateOverlayMessage" class="client-update-message mcr">
        Preparing update...
      </p>
      <div class="client-update-bar">
        <div id="clientUpdateOverlayFill" class="client-update-bar-fill"></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}

function showClientUpdateOverlay(message = "Preparing update...") {
  ensureClientUpdateOverlay();
  clearTimeout(clientUpdateHideTimer);

  const overlay = $("#clientUpdateOverlay");
  const messageElement = $("#clientUpdateOverlayMessage");

  if (messageElement) {
    messageElement.textContent = message;
  }

  if (overlay) {
    overlay.classList.add("active");
  }
}

let clientUpdateHideTimer = null;

function finishClientUpdateOverlay() {
  clientUpdateProgressValue = 100;
  setClientUpdateOverlayProgress(100);

  clearTimeout(clientUpdateHideTimer);
  clientUpdateHideTimer = setTimeout(() => {
    hideClientUpdateOverlay();
  }, 1000);
}

function hideClientUpdateOverlay() {
  clearTimeout(clientUpdateHideTimer);

  const overlay = $("#clientUpdateOverlay");

  if (overlay) {
    overlay.classList.remove("active");
  }

  clientUpdateProgressValue = 0;
  setClientUpdateOverlayProgress(0);
}

function setClientUpdateOverlayProgress(percent) {
  ensureClientUpdateOverlay();

  const fill = $("#clientUpdateOverlayFill");
  if (!fill) return;

  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  fill.style.width = `${safePercent}%`;
}

function bumpClientUpdateProgress() {
  clientUpdateProgressValue = Math.min(
    95,
    clientUpdateProgressValue + Math.max(2, Math.floor((100 - clientUpdateProgressValue) / 10))
  );

  setClientUpdateOverlayProgress(clientUpdateProgressValue);
}

function isWrongJavaVersionCrashLine(line) {
  const text = String(line || "");

  return (
    text.includes("ClassLoaders$AppClassLoader cannot be cast to class java.net.URLClassLoader") ||
    text.includes("UnsupportedClassVersionError") ||
    text.includes("has been compiled by a more recent version of the Java Runtime") ||
    text.includes("Unsupported major.minor version")
  );
}

async function initEvents() {
  injectDynamicStyles();
  ensureEditorExtraControls();
  initLauncherSettingsEvents();

  document.addEventListener("click", (event) => {
    const dropup = $("#profileDropup");

    if (dropup && !dropup.contains(event.target)) {
      closeProfileDropup();
    }
  });

  const discordBtn = $("#discordBtn");
  if (discordBtn) {
    discordBtn.addEventListener("click", async () => {
      await openExternalLink("https://dc.l.wawe.cc");
    });
  }

  const websiteBtn = $("#websiteBtn");
  if (websiteBtn) {
    websiteBtn.addEventListener("click", async () => {
      await openExternalLink("https://launcher.wawe.cc");
    });
  }

  const profileDropupButton = $("#profileDropupButton");
  if (profileDropupButton) {
    profileDropupButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleProfileDropup();
    });
  }

  $$(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.page));
  });

  initHomeTabs();
  initNewsTabs();
  initSkinEditorEvents();

  const closeInstallationEditorBtn = $("#closeInstallationEditorBtn");
  if (closeInstallationEditorBtn) {
    closeInstallationEditorBtn.addEventListener("click", closeInstallationEditor);
  }

  const installationEditorBackdrop = $("#installationEditorBackdrop");
  if (installationEditorBackdrop) {
    installationEditorBackdrop.addEventListener("mousedown", (event) => {
      state.installationBackdropMouseDownOnBackdrop = event.target === installationEditorBackdrop;
    });

    installationEditorBackdrop.addEventListener("click", (event) => {
      if (
        state.installationBackdropMouseDownOnBackdrop &&
        event.target === installationEditorBackdrop
      ) {
        closeInstallationEditor();
      }

      state.installationBackdropMouseDownOnBackdrop = false;
    });
  }

  $$(".editor-tab-btn").forEach((button) => {
    button.addEventListener("click", () => {
      showEditorTab(button.dataset.editorTab);
    });
  });

  const saveInstallationBtn = $("#saveInstallationBtn");
  if (saveInstallationBtn) {
    saveInstallationBtn.addEventListener("click", saveEditorSettings);
  }

  const openInstallationFolderTopBtn = $("#openInstallationFolderTopBtn");
  if (openInstallationFolderTopBtn) {
    openInstallationFolderTopBtn.addEventListener("click", async () => {
      await openEditorInstallationFolder();
    });
  }

  const editorSettingIcon = $("#editorSettingIcon");
  if (editorSettingIcon) {
    editorSettingIcon.addEventListener("change", () => {
      const iconPath = $("#editorSettingIconPath");

      if (editorSettingIcon.value !== "custom" && iconPath) {
        iconPath.value = "";
        iconPath.dataset.dataUrl = "";
      }

      updateEditorIconPreview();
    });
  }

  const pickEditorIconBtn = $("#pickEditorIconBtn");
  if (pickEditorIconBtn) {
    pickEditorIconBtn.addEventListener("click", async () => {
      try {
        const picked = await window.launcherAPI.profiles.pickIcon();
        if (!picked) return;

        const iconSelect = $("#editorSettingIcon");
        const iconPath = $("#editorSettingIconPath");

        if (iconSelect) iconSelect.value = "custom";

        if (iconPath) {
          iconPath.value = picked.iconPath || "";
          iconPath.dataset.dataUrl = picked.customIconDataUrl || "";
        }

        updateEditorIconPreview();
      } catch (error) {
        showError(error.message || "Failed to import icon.");
      }
    });
  }

  const resetEditorIconBtn = $("#resetEditorIconBtn");
  if (resetEditorIconBtn) {
    resetEditorIconBtn.addEventListener("click", () => {
      const iconSelect = $("#editorSettingIcon");
      const iconPath = $("#editorSettingIconPath");

      if (iconSelect) iconSelect.value = "grass";

      if (iconPath) {
        iconPath.value = "";
        iconPath.dataset.dataUrl = "";
      }

      updateEditorIconPreview();
    });
  }

  const editorSettingMcVersion = $("#editorSettingMcVersion");
  if (editorSettingMcVersion) {
    editorSettingMcVersion.addEventListener("change", applyEditorMinecraftVersionSelection);
  }

  const editorSettingLoader = $("#editorSettingLoader");
  if (editorSettingLoader) {
    editorSettingLoader.addEventListener("change", () => {
      populateEditorMinecraftVersionSelect();
    });
  }

  const editorShowSnapshots = $("#editorShowSnapshots");
  if (editorShowSnapshots) {
    editorShowSnapshots.addEventListener("change", () => {
      populateEditorMinecraftVersionSelect();
    });
  }

  const editorInstalledVersionSelect = $("#editorInstalledVersionSelect");
  if (editorInstalledVersionSelect) {
    editorInstalledVersionSelect.addEventListener("change", () => {
      applyInstalledVersionSelection(editorInstalledVersionSelect.value);
    });
  }

  const refreshInstalledVersionsBtn = $("#refreshInstalledVersionsBtn");
  if (refreshInstalledVersionsBtn) {
    refreshInstalledVersionsBtn.addEventListener("click", loadEditorVersionData);
  }

  const editorJavaSelect = $("#editorJavaSelect");
  if (editorJavaSelect) {
    editorJavaSelect.addEventListener("change", () => {
      const input = $("#editorSettingJavaPath");
      if (input) input.value = editorJavaSelect.value;
    });
  }

  const refreshJavaBtn = $("#refreshJavaBtn");
  if (refreshJavaBtn) {
    refreshJavaBtn.addEventListener("click", loadJavaInstallations);
  }

  const pickEditorJavaBtn = $("#pickEditorJavaBtn");
  if (pickEditorJavaBtn) {
    pickEditorJavaBtn.addEventListener("click", async () => {
      const javaPath = await window.launcherAPI.profiles.pickJava();
      const input = $("#editorSettingJavaPath");
      if (javaPath && input) input.value = javaPath;
      populateEditorJavaSelect();
    });
  }

  const pickEditorCustomJsonBtn = $("#pickEditorCustomJsonBtn");
  if (pickEditorCustomJsonBtn) {
    pickEditorCustomJsonBtn.addEventListener("click", async () => {
      const jsonPath = await window.launcherAPI.profiles.pickCustomVersionJson();
      const input = $("#editorSettingCustomJson");
      if (jsonPath && input) input.value = jsonPath;
    });
  }

  $("#editorModsSearch")?.addEventListener("input", applyEditorModsFilter);
  $("#editorModsSearch")?.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && event.target.value) {
      event.stopPropagation();
      event.target.value = "";
      applyEditorModsFilter();
    }
  });

  const addEditorModsBtn = $("#addEditorModsBtn");
  if (addEditorModsBtn) {
    addEditorModsBtn.addEventListener("click", async () => {
      await addModsToEditor([]);
    });
  }

  const updateEditorModsVersionBtn = $("#updateEditorModsVersionBtn");
  if (updateEditorModsVersionBtn) {
    updateEditorModsVersionBtn.addEventListener("click", updateEditorModsFromModrinthCollection);
  }

  const editorModsDropZone = $("#editorModsDropZone");
  if (editorModsDropZone) {
    ["dragenter", "dragover"].forEach((eventName) => {
      editorModsDropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
        editorModsDropZone.classList.add("drag-over");
      });
    });

    ["dragleave", "dragend"].forEach((eventName) => {
      editorModsDropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        editorModsDropZone.classList.remove("drag-over");
      });
    });

    editorModsDropZone.addEventListener("drop", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      editorModsDropZone.classList.remove("drag-over");

      const paths = [...new Set(getDroppedJarPaths(event))];

      if (paths.length === 0) {
        showAlert("Drop one or more .jar files from your file manager.");
        return;
      }

      await addModsToEditor(paths);
    });
  }

  const loginBtn = $("#loginBtn");
  if (loginBtn) {
    loginBtn.addEventListener("click", handleLogin);
  }

  const logoutBtn = $("#logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      const previous = state.account?.username || "";

      await window.launcherAPI.auth.logout();
      const active = await loadAccount();

      onAccountChanged(active);

      setStatus(
        active?.username
          ? `Logged out of ${previous}. Now using ${active.username}.`
          : "Logged out."
      );
      appendConsole(`[auth] Logged out${previous ? ` of ${previous}` : ""}.`);
    });
  }

  const profileSelect = $("#profileSelect");
  if (profileSelect) {
    profileSelect.addEventListener("change", async () => {
      await selectProfile(selectedProfileId());
    });
  }

  const launchBtn = $("#launchBtn");
  if (launchBtn) {
    launchBtn.addEventListener("click", async () => {
      try {
        await loadAccount();

        if (!state.account || !state.account.username) {
          setStatus("Please login with Microsoft first.");
          showAlert("Please login with Microsoft first.", {
            title: "Sign in first",
            kind: "warning",
          });
          return;
        }

        const selectedProfile = getSelectedProfile();

        if (!selectedProfile) {
          setStatus("Select an installation first.");
          showAlert("Select an installation first.");
          return;
        }

        const launcherSettings = getLauncherSettings();

        const alreadyRunning = runningInstancesForProfile(selectedProfile.id).length;

        if (alreadyRunning > 0) {
          const again = await showConfirm(
            `${selectedProfile.name} is already running (${alreadyRunning} instance${
              alreadyRunning > 1 ? "s" : ""
            }).\n\nStart another instance?`,
            { title: "Already running", confirmText: "Start another" }
          );

          if (!again) return;
        }

        const javaReady = await ensureJavaBeforeLaunch(selectedProfile);

        if (!javaReady) {
          setStatus("Launch cancelled: Java is needed to play.");
          return;
        }

        flyRocket();
        startFakeLaunchProgress();

        setStatus(`Launching ${selectedProfile.name}...`);
        appendConsole(`[launcher] Launching ${selectedProfile.name}...`);

        if (launcherSettings.openConsoleOnLaunch && !isSimpleMode()) {
          setTimeout(() => {
            showPage("console");
          }, 650);
        }

        const result = await window.launcherAPI.launcher.launch(selectedProfile.id);

        finishLaunchProgress();

        setStatus(`Launched ${result.profileName} #${result.instanceNumber}.`);
        appendConsole(
          `[launcher] Started ${result.profileName} #${result.instanceNumber} (version ${result.versionId}).`
        );

        if (launcherSettings.openConsoleOnLaunch) {
          setConsoleView(result.instanceId);
        }

        if (!launcherSettings.keepLauncherOpenOnLaunch) {
          setTimeout(() => {
            window.close();
          }, 900);
        }
      } catch (error) {
        hideLaunchProgress();
        setStatus(error.message || "Launch failed.");
        appendConsole(`[launcher error] ${error.message || error}`);
        showError(error.message || "Launch failed.");
      }
    });
  }

  const consoleInstanceSelect = $("#consoleInstanceSelect");
  if (consoleInstanceSelect) {
    consoleInstanceSelect.addEventListener("change", () => {
      setConsoleView(consoleInstanceSelect.value);
    });
  }

  const consoleStopInstanceBtn = $("#consoleStopInstanceBtn");
  if (consoleStopInstanceBtn) {
    consoleStopInstanceBtn.addEventListener("click", async () => {
      const instance = consoleStore.instances.get(consoleStore.view);

      if (!instance) {
        const stopAll = await showConfirm("Stop every running Minecraft instance?", {
          title: "Stop all instances",
          confirmText: "Stop all",
          danger: true,
        });

        if (!stopAll) return;

        await window.launcherAPI.launcher.kill();
        setStatus("Stop signal sent to all instances.");
        return;
      }

      await window.launcherAPI.launcher.kill(instance.instanceId);
      setStatus(`Stop signal sent to ${instanceLabel(instance)}.`);
    });
  }

  const newProfileBtn = $("#newProfileBtn");
  if (newProfileBtn) {
    newProfileBtn.addEventListener("click", async () => {
      const latestRelease =
        state.minecraftVersions.find((version) => version.type === "release")?.id || "1.21.1";

      const created = await window.launcherAPI.profiles.create({
        name: "New Custom Installation",
        minecraftVersion: latestRelease,
        versionType: "release",
        loaderType: "vanilla",
        minMemory: "2G",
        maxMemory: "4G",
        icon: "grass",
      });

      await loadProfiles();
      await selectProfile(created.id);
      openInstallationEditor(created.id);
    });
  }

  const saveSettingsBtn = $("#saveSettingsBtn");
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", () => {
      saveLauncherSettingsControls();
    });
  }

  const pickGameDirBtn = $("#pickGameDirBtn");
  if (pickGameDirBtn) {
    pickGameDirBtn.addEventListener("click", async () => {
      const dir = await window.launcherAPI.profiles.pickGameDir();
      const input = $("#settingGameDir");
      if (dir && input) input.value = dir;
    });
  }

  const pickJavaBtn = $("#pickJavaBtn");
  if (pickJavaBtn) {
    pickJavaBtn.addEventListener("click", async () => {
      const javaPath = await window.launcherAPI.profiles.pickJava();
      const input = $("#settingJavaPath");
      if (javaPath && input) input.value = javaPath;
    });
  }

  const pickCustomJsonBtn = $("#pickCustomJsonBtn");
  if (pickCustomJsonBtn) {
    pickCustomJsonBtn.addEventListener("click", async () => {
      const jsonPath = await window.launcherAPI.profiles.pickCustomVersionJson();
      const input = $("#settingCustomJson");
      if (jsonPath && input) input.value = jsonPath;
    });
  }

  const addModsBtn = $("#addModsBtn");
  if (addModsBtn) {
    addModsBtn.addEventListener("click", async () => {
      await window.launcherAPI.mods.add(selectedProfileId());
      await renderMods();
    });
  }

  const clearConsoleBtn = $("#clearConsoleBtn");
  if (clearConsoleBtn) {
    clearConsoleBtn.addEventListener("click", clearConsole);
  }

  const checkUpdatesBtn = $("#checkUpdatesBtn");
  if (checkUpdatesBtn) {
    checkUpdatesBtn.addEventListener("click", async () => {
      setUpdateStatus("Checking launcher updates...");
      await window.launcherAPI.updater.check();
    });
  }

  const downloadUpdateBtn = $("#downloadUpdateBtn");
  if (downloadUpdateBtn) {
    downloadUpdateBtn.addEventListener("click", async () => {
      setUpdateStatus("Downloading launcher update...");
      await window.launcherAPI.updater.download();
    });
  }

  const installUpdateBtn = $("#installUpdateBtn");
  if (installUpdateBtn) {
    installUpdateBtn.addEventListener("click", async () => {
      setUpdateStatus("Installing launcher update...");
      await window.launcherAPI.updater.install();
    });
  }

  const checkDefaultClientBtn = $("#checkDefaultClientBtn");
  if (checkDefaultClientBtn) {
    checkDefaultClientBtn.addEventListener("click", async () => {
      await checkDefaultClientInfoManually();
    });
  }

  const syncDefaultKeepBtn = $("#syncDefaultKeepBtn");
  if (syncDefaultKeepBtn) {
    syncDefaultKeepBtn.addEventListener("click", async () => {
      await syncDefaultClient("keep", true);
    });
  }

  const syncDefaultDeleteBtn = $("#syncDefaultDeleteBtn");
  if (syncDefaultDeleteBtn) {
    syncDefaultDeleteBtn.addEventListener("click", async () => {
      await syncDefaultClient("delete", true);
    });
  }

  window.launcherAPI.events.onGameLog((line) => {
    appendConsole(line);
  });

  window.launcherAPI.events.onInstanceLog(({ instanceId, line }) => {
    if (!consoleStore.instances.has(instanceId)) {
      consoleStore.instances.set(instanceId, { instanceId, status: "preparing" });
    }

    appendInstanceConsole(instanceId, line);

    if (isWrongJavaVersionCrashLine(line)) {
      wrongJavaCrashInstances.add(instanceId);
    }
  });

  window.launcherAPI.events.onInstancesChanged((list) => {
    syncConsoleInstances(list);
  });

  window.launcherAPI.events.onGameClose((data) => {
    const instance = consoleStore.instances.get(data.instanceId);
    const label = instance ? instanceLabel(instance) : data.profileName || "Minecraft";

    if (instance) {
      instance.status = "exited";
      instance.exitCode = data.code;
    }

    setStatus(`${label} closed with code ${data.code}.`);
    appendConsole(`[launcher] ${label} closed with code ${data.code}.`);

    if (Number(data.code) !== 0 && wrongJavaCrashInstances.has(data.instanceId)) {
      showAlert(`${label}: wrong Java version was used. Change it in Installations.`, {
        title: "Wrong Java version",
        kind: "warning",
      });
      setStatus("Wrong Java version was used. Change it in Installations.");
    }

    wrongJavaCrashInstances.delete(data.instanceId);

    renderConsoleInstanceSelect();
    loadDiscordStatus();
  });

  window.launcherAPI.events.onUpdaterStatus((data) => {
    if (data?.type && data.type !== "manual-check-started") {
      state.launcherUpdate = data;
      refreshWidget("launcherupdate");
    }

    handleLauncherUpdateStatus(data);

    const downloadBtn = $("#downloadUpdateBtn");
    const installBtn = $("#installUpdateBtn");

    if (data.type === "checking") {
      setUpdateStatus("Checking for launcher update...");
    }

    if (data.type === "available") {
      setUpdateStatus(`Launcher update available: ${data.info?.version || "unknown version"}`);
      downloadBtn?.classList.remove("hidden");
      installBtn?.classList.add("hidden");
    }

    if (data.type === "not-available") {
      setUpdateStatus("No launcher update available.");
      downloadBtn?.classList.add("hidden");
      installBtn?.classList.add("hidden");
    }

    if (data.type === "download-progress") {
      const percent = Math.round(data.progress?.percent || 0);
      setUpdateStatus(`Downloading launcher update: ${percent}%`);
    }

    if (data.type === "downloaded") {
      setUpdateStatus("Launcher update downloaded. Restart to install.");
      downloadBtn?.classList.add("hidden");
      installBtn?.classList.remove("hidden");
    }

    if (data.type === "dev-mode") {
      setUpdateStatus(data.message);
    }

    if (data.type === "error") {
      setUpdateStatus(`Launcher updater error: ${data.message}`);
    }
  });

  window.launcherAPI.events.onClientUpdaterStatus((data) => {
    const message = data.message || "";

    if (data.type === "checking") {
      showClientUpdateOverlay(message);
      setClientUpdateOverlayProgress(8);
      setStatus(message);
      appendConsole(`[client updater] ${message}`);
      return;
    }

    if (data.type === "choice-required") {
      hideClientUpdateOverlay();
      setStatus(message);
      appendConsole(`[client updater] ${message}`);
      setUpdateStatus(message);
      showPage("console");
      return;
    }

    if (data.type === "deleting") {
      showClientUpdateOverlay(message);
      setClientUpdateOverlayProgress(18);
      setStatus(message);
      appendConsole(`[client updater] ${message}`);
      return;
    }

    if (data.type === "downloading") {
      showClientUpdateOverlay(message);
      bumpClientUpdateProgress();
      setStatus(message);
      appendConsole(`[client updater] ${message}`);
      return;
    }

    if (data.type === "deleted") {
      appendConsole(`[client updater] ${message}`);
      return;
    }

    if (data.type === "disabled") {
      appendConsole(`[client updater] ${message}`);
      setUpdateStatus(message);
      return;
    }

    if (data.type === "done") {
      finishClientUpdateOverlay();

      setStatus(message);
      appendConsole(`[client updater] ${message}`);

      if (Array.isArray(data.updatedFiles) && data.updatedFiles.length > 0) {
        appendConsole("[client updater] Updated files:");

        for (const file of data.updatedFiles) {
          appendConsole(`  - ${file}`);
        }
      }

      loadProfiles();
      loadEditorVersionData();
      loadDiscordStatus();
      return;
    }

    if (data.type === "error") {
      hideClientUpdateOverlay();
      setStatus(`Default client update failed: ${message}`);
      appendConsole(`[client updater error] ${message}`);
      setUpdateStatus(`Default client update failed: ${message}`);
      loadDiscordStatus();
    }
  });
}

window.addEventListener("dragover", (event) => {
  event.preventDefault();
});

window.addEventListener("drop", (event) => {
  event.preventDefault();
});

const mcSelectState = {
  open: null,
  enhanced: new WeakMap(),
};

const nativeSelectValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
const nativeSelectIndex = Object.getOwnPropertyDescriptor(
  HTMLSelectElement.prototype,
  "selectedIndex"
);

function mcSelectTemplate(id) {
  return document.getElementById(id).content.firstElementChild.cloneNode(true);
}

function syncMcSelect(select) {
  const entry = mcSelectState.enhanced.get(select);
  if (!entry) return;

  const option = select.options[nativeSelectIndex.get.call(select)];
  entry.label.textContent = option ? option.textContent : "";
  entry.wrapper.classList.toggle("disabled", select.disabled);
  entry.button.disabled = select.disabled;
  entry.button.title = option ? option.textContent : "";

  if (mcSelectState.open?.select === select) renderMcSelectMenu(select);
}

function closeMcSelect() {
  const open = mcSelectState.open;
  if (!open) return;

  open.menu.remove();
  open.entry.wrapper.classList.remove("open", "open-up");
  open.entry.button.setAttribute("aria-expanded", "false");
  mcSelectState.open = null;
}

function chooseMcSelectOption(select, index) {
  const option = select.options[index];
  if (!option || option.disabled) return;

  const changed = nativeSelectIndex.get.call(select) !== index;
  nativeSelectIndex.set.call(select, index);
  syncMcSelect(select);
  closeMcSelect();

  mcSelectState.enhanced.get(select)?.button.focus();

  if (changed) {
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function renderMcSelectMenu(select) {
  const open = mcSelectState.open;
  if (!open) return;

  const { menu } = open;
  const selectedIndex = nativeSelectIndex.get.call(select);
  const focusedIndex = menu.contains(document.activeElement)
    ? document.activeElement.dataset.index
    : null;
  const scrollTop = menu.scrollTop;

  menu.innerHTML = "";

  let lastGroup = null;

  Array.from(select.options).forEach((option, index) => {
    const group = option.parentElement?.tagName === "OPTGROUP" ? option.parentElement : null;

    if (group && group !== lastGroup) {
      const header = mcSelectTemplate("mcSelectGroupTemplate");
      header.textContent = group.label;
      menu.appendChild(header);
    }

    lastGroup = group;

    const item = mcSelectTemplate("mcSelectOptionTemplate");
    item.querySelector(".mc-select-option-label").textContent = option.textContent;
    item.dataset.index = String(index);
    item.disabled = option.disabled;
    item.classList.toggle("selected", index === selectedIndex);
    item.setAttribute("aria-selected", index === selectedIndex ? "true" : "false");

    item.addEventListener("click", () => chooseMcSelectOption(select, index));
    menu.appendChild(item);
  });

  if (select.options.length === 0) {
    const empty = mcSelectTemplate("mcSelectGroupTemplate");
    empty.textContent = "Nothing to choose";
    menu.appendChild(empty);
  }

  menu.scrollTop = scrollTop;

  if (focusedIndex !== null) {
    menu.querySelector(`.mc-select-option[data-index="${focusedIndex}"]`)?.focus();
  }
}

function positionMcSelectMenu() {
  const open = mcSelectState.open;
  if (!open) return;

  const rect = open.entry.button.getBoundingClientRect();
  const menu = open.menu;
  const gap = 4;
  const margin = 8;

  menu.style.minWidth = `${rect.width}px`;
  menu.style.maxWidth = `${Math.max(rect.width, Math.min(28 * 16, window.innerWidth - margin * 2))}px`;

  const spaceBelow = window.innerHeight - rect.bottom - margin;
  const spaceAbove = rect.top - margin;
  const wanted = Math.min(menu.scrollHeight, 18 * 16);
  const openUp = spaceBelow < wanted && spaceAbove > spaceBelow;

  menu.style.maxHeight = `${Math.max(120, Math.min(18 * 16, openUp ? spaceAbove : spaceBelow) - gap)}px`;
  menu.style.top = openUp ? "" : `${rect.bottom + gap}px`;
  menu.style.bottom = openUp ? `${window.innerHeight - rect.top + gap}px` : "";

  const left = Math.min(rect.left, window.innerWidth - menu.offsetWidth - margin);
  menu.style.left = `${Math.max(margin, left)}px`;

  menu.classList.toggle("open-up", openUp);
  open.entry.wrapper.classList.toggle("open-up", openUp);
}

function openMcSelect(select) {
  const entry = mcSelectState.enhanced.get(select);
  if (!entry || select.disabled) return;

  closeMcSelect();
  closeProfileDropup?.();

  const menu = mcSelectTemplate("mcSelectMenuTemplate");
  document.body.appendChild(menu);

  mcSelectState.open = { select, entry, menu };
  entry.wrapper.classList.add("open");
  entry.button.setAttribute("aria-expanded", "true");

  renderMcSelectMenu(select);
  positionMcSelectMenu();

  menu.querySelector(".mc-select-option.selected")?.scrollIntoView({ block: "nearest" });
}

function moveMcSelectFocus(direction) {
  const open = mcSelectState.open;
  if (!open) return;

  const items = Array.from(open.menu.querySelectorAll(".mc-select-option:not(:disabled)"));
  if (items.length === 0) return;

  const current = items.indexOf(document.activeElement);
  const start =
    current === -1 ? items.findIndex((item) => item.classList.contains("selected")) : current;
  const next = items[(start + direction + items.length) % items.length];

  next.focus();
  next.scrollIntoView({ block: "nearest" });
}

function enhanceSelect(select) {
  if (mcSelectState.enhanced.has(select) || select.classList.contains("no-mc-select")) return;

  const wrapper = mcSelectTemplate("mcSelectTemplate");
  const button = wrapper.querySelector(".mc-select-button");
  const label = wrapper.querySelector(".mc-select-label");

  if (select.id) wrapper.dataset.for = select.id;
  wrapper.classList.add(...Array.from(select.classList).filter((name) => name !== "editor-input"));

  select.classList.add("mc-select-native");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  select.insertAdjacentElement("afterend", wrapper);

  mcSelectState.enhanced.set(select, { wrapper, button, label });

  Object.defineProperty(select, "value", {
    configurable: true,
    get() {
      return nativeSelectValue.get.call(this);
    },
    set(value) {
      nativeSelectValue.set.call(this, value);
      syncMcSelect(this);
    },
  });

  Object.defineProperty(select, "selectedIndex", {
    configurable: true,
    get() {
      return nativeSelectIndex.get.call(this);
    },
    set(value) {
      nativeSelectIndex.set.call(this, value);
      syncMcSelect(this);
    },
  });

  new MutationObserver(() => syncMcSelect(select)).observe(select, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "selected", "label"],
  });

  select.addEventListener("change", () => syncMcSelect(select));

  button.addEventListener("click", (event) => {
    event.stopPropagation();

    if (mcSelectState.open?.select === select) closeMcSelect();
    else openMcSelect(select);
  });

  button.addEventListener("keydown", (event) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();

      if (mcSelectState.open?.select !== select) openMcSelect(select);
      moveMcSelectFocus(event.key === "ArrowUp" ? -1 : 1);
    }
  });

  syncMcSelect(select);
}

function enhanceSelectsIn(root) {
  if (!root) return;

  if (root.tagName === "SELECT") {
    enhanceSelect(root);
    return;
  }

  root.querySelectorAll?.("select").forEach(enhanceSelect);
}

function initMcSelects() {
  enhanceSelectsIn(document.body);

  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) enhanceSelectsIn(node);
      });
    }
  }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener("mousedown", (event) => {
    const open = mcSelectState.open;
    if (!open) return;

    if (!open.menu.contains(event.target) && !open.entry.wrapper.contains(event.target)) {
      closeMcSelect();
    }
  });

  document.addEventListener(
    "keydown",
    (event) => {
      const open = mcSelectState.open;
      if (!open) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeMcSelect();
        open.entry.button.focus();
        return;
      }

      if (
        open.menu.contains(document.activeElement) ||
        document.activeElement === open.entry.button
      ) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          moveMcSelectFocus(event.key === "ArrowUp" ? -1 : 1);
        }

        if (event.key === "Tab") closeMcSelect();
      }
    },
    true
  );

  window.addEventListener("resize", positionMcSelectMenu);
  document.addEventListener(
    "scroll",
    (event) => {
      const open = mcSelectState.open;
      if (!open) return;

      const target = event.target;
      const movedButton =
        target === document ||
        target === document.documentElement ||
        (target instanceof Element && target.contains(open.entry.wrapper));

      if (movedButton) positionMcSelectMenu();
    },
    true
  );
}

const HOME_WIDGETS_KEY = "launcher.homeWidgets.v1";
const SERVER_STATUS_TTL_MS = 60 * 1000;
const MINECRAFT_NEWS_URL = "https://www.minecraft.net/en-us/articles";

const DEFAULT_SERVERS = [
  { name: "McPvP", ip: "mcpvp.club" },
  { name: "Starlight", ip: "mc.wawe.cc" },
  { name: "Hypixel", ip: "hypixel.net" },
  { name: "Hoplite", ip: "hoplite.gg" },
  { name: "DonutSMP", ip: "donutsmp.com" },
  { name: "pvpHQ", ip: "pvphq.com" },
];

const HOME_WIDGET_DEFS = {
  servers: {
    title: "Servers",
    defaultEnabled: true,
    weight: 2,
    defaults: () => ({ servers: DEFAULT_SERVERS.map((server) => ({ ...server })) }),
  },
  skin: {
    title: "Player skin",
    defaultEnabled: true,
    weight: 1,
    defaults: () => ({ animation: "walk", autoRotate: true, showCape: true, showName: true }),
  },
  pvphq: {
    title: "PvPHQ rating",
    defaultEnabled: true,
    weight: 1,
    defaults: () => ({
      player: "",
      ladder: "global",
      showElo: true,
      showTr: true,
      showPeak: false,
      showRecord: true,
      showPosition: true,
      showGlobal: true,
    }),
  },
  time: {
    title: "Time",
    defaultEnabled: true,
    weight: 1,
    defaults: () => ({ use24h: true, showSeconds: false, showDate: true }),
  },
  quickstart: {
    title: "Quick start",
    defaultEnabled: false,
    weight: 1,
    defaults: () => ({ profileIds: [] }),
  },
  players: {
    title: "Player count",
    defaultEnabled: false,
    weight: 1,
    defaults: () => ({ ip: "hypixel.net", label: "Hypixel", showMotd: true }),
  },
  mcupdate: {
    title: "Minecraft update",
    defaultEnabled: false,
    weight: 1,
    defaults: () => ({ showSnapshot: true }),
  },
  launcherupdate: {
    title: "Launcher update",
    defaultEnabled: false,
    weight: 1,
    defaults: () => ({}),
  },
  console: {
    title: "Console",
    defaultEnabled: false,
    weight: 2,
    defaults: () => ({ lines: 8, source: "all" }),
  },
};

const homeWidgets = {
  config: null,
  editing: false,
  mounted: new Map(),
  openSettingsId: null,
  serverStatusCache: new Map(),
  clockTimer: null,
  latestVersions: null,
  appInfo: null,
  pvphqResults: new Map(),
  dragId: null,
};

function defaultHomeWidgetConfig() {
  const ids = Object.keys(HOME_WIDGET_DEFS);

  return {
    order: ids,
    enabled: Object.fromEntries(ids.map((id) => [id, HOME_WIDGET_DEFS[id].defaultEnabled])),
    settings: Object.fromEntries(ids.map((id) => [id, HOME_WIDGET_DEFS[id].defaults()])),
    knownDefaultServers: DEFAULT_SERVERS.map((server) => server.ip),
  };
}

function loadHomeWidgetConfig() {
  const fallback = defaultHomeWidgetConfig();
  let saved = null;

  try {
    saved = JSON.parse(localStorage.getItem(HOME_WIDGETS_KEY) || "null");
  } catch {
    saved = null;
  }

  if (!saved || typeof saved !== "object") return fallback;

  const known = Object.keys(HOME_WIDGET_DEFS);
  const order = Array.isArray(saved.order) ? saved.order.filter((id) => known.includes(id)) : [];

  for (const id of known) {
    if (!order.includes(id)) order.push(id);
  }

  const enabled = {};
  const settings = {};

  for (const id of known) {
    enabled[id] =
      typeof saved.enabled?.[id] === "boolean" ? saved.enabled[id] : fallback.enabled[id];
    settings[id] = { ...fallback.settings[id], ...(saved.settings?.[id] || {}) };
  }

  const knownDefaultServers = Array.isArray(saved.knownDefaultServers)
    ? saved.knownDefaultServers
    : DEFAULT_SERVERS.filter((server) => server.ip !== "pvphq.com").map((server) => server.ip);

  const servers = settings.servers.servers;

  for (const server of DEFAULT_SERVERS) {
    const alreadyListed = servers.some((item) => item.ip.toLowerCase() === server.ip);

    if (!knownDefaultServers.includes(server.ip) && !alreadyListed) {
      servers.push({ ...server });
    }
  }

  return {
    order,
    enabled,
    settings,
    knownDefaultServers: DEFAULT_SERVERS.map((server) => server.ip),
  };
}

function saveHomeWidgetConfig() {
  try {
    localStorage.setItem(HOME_WIDGETS_KEY, JSON.stringify(homeWidgets.config));
  } catch (error) {
    console.warn("[widgets] Could not save layout:", error);
  }
}

function widgetSettings(id) {
  return homeWidgets.config.settings[id];
}

const SIMPLE_MODE_HIDDEN_WIDGETS = new Set(["console", "mcupdate", "launcherupdate", "players"]);

function enabledWidgetIds() {
  return homeWidgets.config.order.filter(
    (id) =>
      homeWidgets.config.enabled[id] && !(isSimpleMode() && SIMPLE_MODE_HIDDEN_WIDGETS.has(id))
  );
}

function cloneTemplate(id) {
  const template = document.getElementById(id);
  return template ? template.content.firstElementChild.cloneNode(true) : null;
}

function slot(root, name) {
  return root?.querySelector(`[data-slot="${name}"]`) || null;
}

function columnsForCount(count) {
  if (count <= 3) return Math.max(1, count);
  if (count === 4) return 2;
  if (count <= 6) return 3;
  return 4;
}

function computeWidgetLayout(ids) {
  const cols = columnsForCount(ids.length);
  const rows = [];
  let current = [];
  let used = 0;

  for (const id of ids) {
    const weight = cols >= 3 ? Math.min(HOME_WIDGET_DEFS[id].weight || 1, 2) : 1;

    if (used + weight > cols && current.length > 0) {
      rows.push(current);
      current = [];
      used = 0;
    }

    current.push({ id, weight });
    used += weight;
  }

  if (current.length > 0) rows.push(current);

  const placements = [];

  for (const row of rows) {
    const totalWeight = row.reduce((sum, item) => sum + item.weight, 0);
    let remaining = 12;

    row.forEach((item, index) => {
      const span =
        index === row.length - 1 ? remaining : Math.round((12 * item.weight) / totalWeight);
      remaining -= span;
      placements.push({ id: item.id, span });
    });
  }

  return { rows: rows.length, placements };
}

function applyWidgetLayout() {
  const board = $("#homeWidgetBoard");
  if (!board) return;

  const ids = enabledWidgetIds();
  const layout = computeWidgetLayout(ids);

  board.style.setProperty("--widget-rows", String(Math.max(1, layout.rows)));
  board.dataset.count = String(ids.length);

  for (const placement of layout.placements) {
    const mounted = homeWidgets.mounted.get(placement.id);
    if (mounted) mounted.element.style.gridColumn = `span ${placement.span}`;
  }
}

function unmountWidget(id) {
  const mounted = homeWidgets.mounted.get(id);
  if (!mounted) return;

  try {
    mounted.cleanup?.();
  } catch {}

  mounted.element.remove();
  homeWidgets.mounted.delete(id);
}

function mountWidget(id) {
  const def = HOME_WIDGET_DEFS[id];
  const element = cloneTemplate("widgetShellTemplate");
  const content = cloneTemplate(`widget-tpl-${id}`);

  if (!def || !element || !content) return null;

  element.dataset.widgetId = id;
  element.classList.add(`home-widget-${id}`);
  element.querySelector(".home-widget-title").textContent = def.title;

  const body = element.querySelector(".home-widget-body");
  body.appendChild(content);

  element.querySelector('[data-widget-action="hide"]').addEventListener("click", () => {
    setWidgetEnabled(id, false);
  });

  element.querySelector('[data-widget-action="settings"]').addEventListener("click", () => {
    openCustomizePanel(id);
  });

  bindBoardDrag(element, id);

  const mounted = { element, body, cleanup: null };
  homeWidgets.mounted.set(id, mounted);

  mounted.cleanup = WIDGET_RENDERERS[id]?.mount?.(body, widgetSettings(id)) || null;

  return element;
}

function renderHomeWidgets() {
  const board = $("#homeWidgetBoard");
  if (!board || !homeWidgets.config) return;

  const ids = enabledWidgetIds();

  for (const id of Array.from(homeWidgets.mounted.keys())) {
    if (!ids.includes(id)) unmountWidget(id);
  }

  for (const id of ids) {
    const element = homeWidgets.mounted.get(id)?.element || mountWidget(id);
    if (element) board.appendChild(element);
  }

  for (const mounted of homeWidgets.mounted.values()) {
    mounted.element.draggable = homeWidgets.editing;
  }

  board.classList.toggle("editing", homeWidgets.editing);
  board.classList.toggle("empty", ids.length === 0);

  applyWidgetLayout();
  updateWidgetClock();
}

function refreshWidget(id) {
  const mounted = homeWidgets.mounted.get(id);
  if (!mounted) return;

  WIDGET_RENDERERS[id]?.update?.(mounted.body, widgetSettings(id));
}

function remountWidget(id) {
  if (!homeWidgets.mounted.has(id)) return;

  unmountWidget(id);
  renderHomeWidgets();
}

function setWidgetEnabled(id, enabled) {
  homeWidgets.config.enabled[id] = Boolean(enabled);
  saveHomeWidgetConfig();
  renderHomeWidgets();
  renderWidgetList();
}

function moveWidget(id, targetIndex) {
  const order = homeWidgets.config.order.filter((item) => item !== id);
  const index = Math.max(0, Math.min(order.length, targetIndex));

  order.splice(index, 0, id);
  homeWidgets.config.order = order;

  saveHomeWidgetConfig();
  renderHomeWidgets();
  renderWidgetList();
}

async function getServerStatus(ip) {
  const address = String(ip || "")
    .trim()
    .toLowerCase();
  if (!address) return null;

  const cached = homeWidgets.serverStatusCache.get(address);
  const now = Date.now();

  if (cached?.data && now - cached.at < SERVER_STATUS_TTL_MS) return cached.data;
  if (cached?.promise) return cached.promise;

  const promise = fetch(`https://api.mcsrvstat.us/3/${encodeURIComponent(address)}`)
    .then((response) => (response.ok ? response.json() : { online: false }))
    .catch(() => ({ online: false }))
    .then((data) => {
      homeWidgets.serverStatusCache.set(address, { at: Date.now(), data });
      return data;
    });

  homeWidgets.serverStatusCache.set(address, { ...(cached || {}), promise });
  return promise;
}

function serverMotd(data) {
  const lines = data?.motd?.clean;
  return Array.isArray(lines) ? lines.join(" ").replace(/\s+/g, " ").trim() : "";
}

function formatPlayerNumber(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function widgetSkinSource() {
  if (!state.account?.username || state.account.type === "offline")
    return { skin: DEFAULT_STEVE_SKIN, cape: "", slim: false };

  const skin = getCurrentSkinFromMinecraftProfile();
  const cape = getActiveCapeFromMinecraftProfile?.();

  return {
    skin: skin?.url || DEFAULT_STEVE_SKIN,
    cape: cape?.url ? cape.url.replace(/^http:\/\//i, "https://") : "",
    slim: String(skin?.variant || "").toUpperCase() === "SLIM",
  };
}

async function ensureSkinProfileForWidgets() {
  if (!state.account?.username || state.account.type === "offline") return;
  if (state.skins.minecraftProfile) return;

  try {
    state.skins.minecraftProfile = await window.launcherAPI.skins.getMinecraftProfile();
  } catch {}
}

async function ensureLatestMinecraftVersions() {
  if (homeWidgets.latestVersions) return homeWidgets.latestVersions;

  try {
    const versions = await window.launcherAPI.profiles.listMinecraftVersions({
      includeSnapshots: true,
    });

    homeWidgets.latestVersions = {
      release: versions.find((version) => version.type === "release") || null,
      snapshot: versions.find((version) => version.type === "snapshot") || null,
    };
  } catch {
    homeWidgets.latestVersions = { release: null, snapshot: null, failed: true };
  }

  return homeWidgets.latestVersions;
}

function updateWidgetClock() {
  const needsClock = homeWidgets.mounted.has("time");

  if (needsClock && !homeWidgets.clockTimer) {
    homeWidgets.clockTimer = setInterval(() => refreshWidget("time"), 1000);
  }

  if (!needsClock && homeWidgets.clockTimer) {
    clearInterval(homeWidgets.clockTimer);
    homeWidgets.clockTimer = null;
  }
}

const WIDGET_RENDERERS = {
  servers: {
    mount(body, settings) {
      this.update(body, settings);
    },

    update(body, settings) {
      const rowsRoot = slot(body, "rows");
      const servers = (settings.servers || []).filter((server) => server.ip);

      slot(body, "empty")?.classList.toggle("hidden", servers.length > 0);
      rowsRoot.innerHTML = "";

      for (const server of servers) {
        const row = cloneTemplate("widget-row-tpl-servers");

        slot(row, "name").textContent = server.name || server.ip;
        slot(row, "ip").textContent = server.ip;
        rowsRoot.appendChild(row);

        getServerStatus(server.ip).then((data) => {
          const players = slot(row, "players");
          const icon = slot(row, "icon");

          if (!data?.online) {
            players.textContent = "Offline";
            players.classList.add("offline");
            return;
          }

          players.textContent = `${formatPlayerNumber(data.players?.online)}/${formatPlayerNumber(
            data.players?.max
          )}`;
          players.classList.remove("offline");

          if (data.icon && String(data.icon).startsWith("data:image/")) {
            icon.src = data.icon;
            icon.classList.remove("hidden");
          }
        });
      }
    },
  },

  players: {
    mount(body, settings) {
      this.update(body, settings);
    },

    update(body, settings) {
      const count = slot(body, "count");
      const max = slot(body, "max");
      const label = slot(body, "label");
      const motd = slot(body, "motd");
      const icon = slot(body, "icon");

      label.textContent = settings.label || settings.ip || "Server";

      if (!settings.ip) {
        count.textContent = "–";
        max.textContent = "Set a server IP in Customize.";
        motd.textContent = "";
        return;
      }

      getServerStatus(settings.ip).then((data) => {
        if (!data?.online) {
          count.textContent = "Offline";
          count.classList.add("offline");
          max.textContent = settings.ip;
          motd.textContent = "";
          icon.classList.add("hidden");
          return;
        }

        count.classList.remove("offline");
        count.textContent = formatPlayerNumber(data.players?.online);
        max.textContent = `of ${formatPlayerNumber(data.players?.max)} online`;
        motd.textContent = settings.showMotd ? serverMotd(data) : "";

        if (data.icon && String(data.icon).startsWith("data:image/")) {
          icon.src = data.icon;
          icon.classList.remove("hidden");
        }
      });
    },
  },

  pvphq: {
    mount(body, settings) {
      this.update(body, settings);
    },

    update(body, settings) {
      const key =
        String(settings.player || "")
          .trim()
          .toLowerCase() || `account:${state.account?.uuid || state.account?.username || ""}`;
      const cached = homeWidgets.pvphqResults.get(key);

      this.draw(body, settings, cached || { loading: true });

      window.launcherAPI.pvphq
        .getStats(settings.player || "")
        .then((result) => {
          homeWidgets.pvphqResults.set(key, { result });
          this.draw(body, settings, { result });
        })
        .catch((error) => {
          const message = friendlyErrorMessage(error, "Could not load PvPHQ stats.");

          if (cached?.result) {
            this.draw(body, settings, { ...cached, stale: message });
          } else {
            homeWidgets.pvphqResults.set(key, { error: message });
            this.draw(body, settings, { error: message });
          }
        });
    },

    draw(body, settings, { loading, result, error, stale }) {
      const message = slot(body, "message");
      const parts = ["top", "stats", "winrate", "chips", "footer"].map((name) => slot(body, name));

      const showMessage = (text) => {
        message.textContent = text;
        message.classList.remove("hidden");
        parts.forEach((part) => part.classList.add("hidden"));
      };

      if (loading) return showMessage("Loading PvPHQ stats...");
      if (error) return showMessage(error);

      if (!result?.found) {
        return showMessage(
          result?.reason === "player"
            ? `No Minecraft player called ${result.player}.`
            : `${result?.name || "This player"} has no PvPHQ ranked games yet.`
        );
      }

      message.classList.add("hidden");
      parts.forEach((part) => part.classList.remove("hidden"));

      const stats = slot(body, "stats");
      const chips = slot(body, "chips");
      stats.innerHTML = "";
      chips.innerHTML = "";

      const tierBadge = (ladder) => {
        const pair = cloneTemplate("widget-row-tpl-pvphq-tier");
        const badge = slot(pair, "tier");

        badge.textContent =
          ladder.tier ||
          (ladder.placed ? "—" : `${ladder.placementGames}/${ladder.placementTarget}`);

        if (ladder.tierColor) {
          badge.style.background = ladder.tierColor;
          badge.style.color = "#111";
        } else {
          badge.classList.add("unranked");
        }

        slot(pair, "kit").textContent = ladder.name;
        return pair;
      };

      const addFact = (label, value) => {
        const fact = cloneTemplate("widget-row-tpl-pvphq-stat");
        const valueSlot = slot(fact, "value");

        if (value instanceof Node) valueSlot.appendChild(value);
        else valueSlot.textContent = value;

        slot(fact, "label").textContent = label;
        stats.appendChild(fact);
      };

      const drawWinrate = (wins, losses) => {
        const games = wins + losses;
        const rate = games > 0 ? (wins / games) * 100 : 0;
        const bar = slot(body, "winbar");
        const filled = Math.round(rate / 5);

        bar.innerHTML = "";
        for (let index = 0; index < 20; index += 1) {
          const segment = document.createElement("span");
          segment.className = index < filled ? "on" : "";
          bar.appendChild(segment);
        }

        slot(body, "winrateValue").textContent = `${rate.toFixed(1)}%`;
        slot(body, "wins").textContent = `${formatPlayerNumber(wins)} W`;
        slot(body, "losses").textContent = `${formatPlayerNumber(losses)} L`;
        slot(body, "winrate").classList.toggle("hidden", !settings.showRecord || games === 0);
      };

      slot(body, "name").textContent = result.name || state.account?.username || "Player";

      if (settings.ladder === "global") {
        const best = result.ladders[0];
        const position = result.overallRank || result.globalPosition;

        slot(body, "sub").textContent = [result.globalRank && `Global ${result.globalRank}`]
          .filter(Boolean)
          .join(" · ");

        if (result.overallPoints) {
          slot(body, "score").textContent = formatPlayerNumber(result.overallPoints);
          slot(body, "scoreLabel").textContent =
            `Total points${position && settings.showPosition ? ` · #${formatPlayerNumber(position)} overall` : ""}`;
        } else {
          slot(body, "score").textContent =
            settings.showPosition && position ? `#${formatPlayerNumber(position)}` : "";
          slot(body, "scoreLabel").textContent =
            settings.showPosition && position ? "Global position" : "";
        }

        addFact(
          "Kits ranked",
          `${result.kitsRanked ?? result.ladders.filter((l) => l.placed).length} / ${result.totalLadders || 11}`
        );
        addFact("Matches", formatPlayerNumber(result.games));
        if (best) addFact("Best", tierBadge(best));

        drawWinrate(result.wins, result.losses);

        for (const ladder of result.ladders.slice(0, 11)) {
          chips.appendChild(tierBadge(ladder));
        }

        slot(body, "footer").textContent = stale || "";
        return;
      }

      const ladder =
        settings.ladder === "best"
          ? result.ladders[0]
          : result.ladders.find((item) => item.key === settings.ladder);

      if (!ladder) {
        const ladderName =
          document
            .getElementById("widget-settings-tpl-pvphq")
            ?.content.querySelector(`option[value="${settings.ladder}"]`)?.textContent ||
          settings.ladder;

        return showMessage(
          `${result.name || "This player"} has no ranked ${ladderName} games yet.`
        );
      }

      slot(body, "sub").textContent =
        `${ladder.name}${result.globalRank && settings.showGlobal ? ` · Global ${result.globalRank}` : ""}`;
      slot(body, "score").textContent =
        settings.showPosition && ladder.position ? `#${formatPlayerNumber(ladder.position)}` : "";
      slot(body, "scoreLabel").textContent =
        settings.showPosition && ladder.position ? `${ladder.name} position` : "";

      addFact("Tier", tierBadge({ ...ladder, name: "" }));
      if (!ladder.placed)
        addFact("Placements", `${ladder.placementGames}/${ladder.placementTarget}`);
      if (settings.showElo) addFact("Elo", formatPlayerNumber(ladder.rating));
      if (settings.showTr) addFact("TR", formatPlayerNumber(ladder.tr));
      if (settings.showPeak) addFact("Peak", formatPlayerNumber(ladder.peak));
      addFact("Matches", formatPlayerNumber(ladder.games));

      drawWinrate(ladder.wins, ladder.losses);

      const footer = [];
      if (settings.showGlobal && result.globalPosition) {
        footer.push(`Global #${formatPlayerNumber(result.globalPosition)}`);
      }
      if (stale) footer.push(stale);

      slot(body, "footer").textContent = footer.join(" · ");
    },
  },

  time: {
    mount(body, settings) {
      this.update(body, settings);
    },

    update(body, settings) {
      const now = new Date();

      slot(body, "time").textContent = now.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: settings.showSeconds ? "2-digit" : undefined,
        hour12: !settings.use24h,
      });

      const date = slot(body, "date");
      date.classList.toggle("hidden", !settings.showDate);
      date.textContent = now.toLocaleDateString([], {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
    },
  },

  quickstart: {
    mount(body, settings) {
      this.update(body, settings);
    },

    update(body, settings) {
      const list = slot(body, "list");
      const profiles = state.profilesData?.profiles || [];

      let ids = (settings.profileIds || []).filter((id) => profiles.some((p) => p.id === id));
      if (ids.length === 0) ids = profiles.slice(0, 3).map((profile) => profile.id);

      list.innerHTML = "";
      slot(body, "empty")?.classList.toggle("hidden", ids.length > 0);

      for (const id of ids.slice(0, 6)) {
        const profile = findProfile(id);
        if (!profile) continue;

        const item = cloneTemplate("widget-row-tpl-quickstart");
        const running = runningInstancesForProfile(profile.id).length;

        slot(item, "icon").innerHTML = renderInstallationIconHtml(profile);
        slot(item, "name").textContent = profile.name;
        slot(item, "sub").textContent = running
          ? `Running${running > 1 ? ` ×${running}` : ""}`
          : `${loaderLabel(profile.loaderType)} · ${profile.minecraftVersion || "?"}`;
        item.classList.toggle("running", running > 0);
        item.title = `Start ${profile.name}`;

        item.addEventListener("click", async () => {
          if (homeWidgets.editing) return;

          await selectProfile(profile.id);
          $("#launchBtn")?.click();
        });

        list.appendChild(item);
      }
    },
  },

  mcupdate: {
    mount(body, settings) {
      body.querySelector('[data-action="mc-news"]')?.addEventListener("click", () => {
        openExternalLink(MINECRAFT_NEWS_URL);
      });

      this.update(body, settings);
    },

    update(body, settings) {
      slot(body, "snapshotRow")?.classList.toggle("hidden", !settings.showSnapshot);

      ensureLatestMinecraftVersions().then((latest) => {
        const release = latest.release;
        const releaseDate = release?.releaseTime ? new Date(release.releaseTime) : null;
        const ageDays = releaseDate ? (Date.now() - releaseDate.getTime()) / 86400000 : Infinity;

        slot(body, "release").textContent = release?.id || (latest.failed ? "Offline" : "–");
        slot(body, "snapshot").textContent = latest.snapshot?.id || "–";
        slot(body, "releaseNew")?.classList.toggle("hidden", !(ageDays <= 14));
        slot(body, "releaseDate").textContent = releaseDate
          ? `Released ${releaseDate.toLocaleDateString()}`
          : "";
      });
    },
  },

  launcherupdate: {
    mount(body, settings) {
      body.querySelector('[data-action="check-updates"]')?.addEventListener("click", async () => {
        slot(body, "launcherStatus").textContent = "Checking...";
        await checkLauncherUpdateManually();
        await checkDefaultClientInfoManually({ manual: true });
        this.update(body, settings);
      });

      body.querySelector('[data-action="install-update"]')?.addEventListener("click", () => {
        window.launcherAPI.updater.install();
      });

      if (!homeWidgets.appInfo) {
        window.launcherAPI.system
          .getAppInfo?.()
          .then((info) => {
            homeWidgets.appInfo = info;
            this.update(body, settings);
          })
          .catch(() => {});
      }

      this.update(body, settings);
    },

    update(body) {
      const launcher = state.launcherUpdate || {};
      const client = state.clientUpdateInfo || null;

      slot(body, "launcherVersion").textContent = homeWidgets.appInfo?.version
        ? `v${homeWidgets.appInfo.version}`
        : "…";

      const launcherText = {
        checking: "Checking for updates...",
        available: `Update ${launcher.info?.version || ""} available.`,
        "not-available": "Up to date.",
        "download-progress": `Downloading update: ${Math.round(launcher.progress?.percent || 0)}%`,
        downloaded: "Update ready. Restart to install.",
        "dev-mode": launcher.message || "Updates only work in the installed app.",
        disabled: "Auto-update is off. Press Check to update.",
        error: "Update check failed.",
      }[launcher.type];

      slot(body, "launcherStatus").textContent = launcherText || "Not checked yet.";

      body
        .querySelector('[data-action="install-update"]')
        ?.classList.toggle("hidden", launcher.type !== "downloaded");

      slot(body, "clientVersion").textContent = client?.localClientVersion
        ? `v${client.localClientVersion}`
        : client?.remoteClientVersion
          ? `v${client.remoteClientVersion}`
          : "…";

      slot(body, "clientStatus").textContent = !client
        ? "Not checked yet."
        : client.updateAvailable
          ? `Update to v${client.remoteClientVersion} available.`
          : "Up to date.";
    },
  },

  console: {
    mount(body, settings) {
      slot(body, "output")?.addEventListener("click", () => {
        if (!homeWidgets.editing) showPage("console");
      });

      this.update(body, settings);
    },

    update(body, settings) {
      const output = slot(body, "output");
      if (!output) return;

      let key = settings.source === "launcher" ? CONSOLE_VIEW_LAUNCHER : CONSOLE_VIEW_ALL;

      if (settings.source === "latest") {
        const latest = Array.from(consoleStore.instances.values()).sort(
          (a, b) => (b.startedAt || 0) - (a.startedAt || 0)
        )[0];

        key = latest ? latest.instanceId : CONSOLE_VIEW_ALL;
      }

      const lines = consoleStore.buffers.get(key) || [];
      const count = Math.max(3, Math.min(20, Number(settings.lines) || 8));

      output.textContent = lines.slice(-count).join("\n") || "No output yet.";
    },
  },

  skin: {
    mount(body, settings) {
      const canvas = slot(body, "canvas");
      const nameEl = slot(body, "name");
      let viewer = null;
      let disposed = false;

      nameEl.textContent = state.account?.username || "Steve";
      nameEl.classList.toggle("hidden", !settings.showName);

      const canvasSize = () => {
        const rect = body.getBoundingClientRect();
        const padding = 16;
        return {
          width: Math.max(80, Math.floor(rect.width - padding)),
          height: Math.max(100, Math.floor(rect.height - padding - (settings.showName ? 28 : 0))),
        };
      };

      const build = () => {
        if (disposed || !canvas) return;

        const { width, height } = canvasSize();
        const source = widgetSkinSource();

        if (!window.skinview3d?.SkinViewer) {
          canvas.width = width;
          canvas.height = height;
          drawMinecraftSkin(canvas, source.skin);
          return;
        }

        viewer = new window.skinview3d.SkinViewer({ canvas, width, height });
        viewer.background = null;
        viewer.zoom = 0.85;

        if (viewer.controls) {
          viewer.controls.enableZoom = false;
          viewer.controls.enablePan = false;
        }

        Promise.resolve(
          viewer.loadSkin?.(source.skin, { model: source.slim ? "slim" : "default" })
        ).catch(() => viewer?.loadSkin?.(DEFAULT_STEVE_SKIN));

        if (settings.showCape && source.cape) {
          Promise.resolve(viewer.loadCape?.(source.cape)).catch(() => {});
        }

        const animations = {
          idle: "IdleAnimation",
          walk: "WalkingAnimation",
          run: "RunningAnimation",
          wave: "WaveAnimation",
          fly: "FlyingAnimation",
        };

        const AnimationClass = window.skinview3d[animations[settings.animation]];
        viewer.animation = AnimationClass ? new AnimationClass() : null;

        viewer.autoRotate = Boolean(settings.autoRotate);
        viewer.autoRotateSpeed = 0.9;
      };

      const resizeObserver = new ResizeObserver(() => {
        if (!viewer) return;
        const { width, height } = canvasSize();
        viewer.setSize?.(width, height);
      });

      resizeObserver.observe(body);
      ensureSkinProfileForWidgets().then(build);

      return () => {
        disposed = true;
        resizeObserver.disconnect();
        destroySkinViewer(viewer);
        viewer = null;
      };
    },
  },
};

function openCustomizePanel(settingsId = null) {
  homeWidgets.editing = true;
  homeWidgets.openSettingsId = settingsId;

  $("#homeCustomizePanel")?.classList.remove("hidden");
  $("#page-home")?.classList.add("home-editing");

  renderHomeWidgets();
  renderWidgetList();

  if (settingsId) {
    $(`.home-widget-row[data-widget-id="${settingsId}"]`)?.scrollIntoView({ block: "nearest" });
  }
}

function closeCustomizePanel() {
  homeWidgets.editing = false;
  homeWidgets.openSettingsId = null;

  $("#homeCustomizePanel")?.classList.add("hidden");
  $("#page-home")?.classList.remove("home-editing");

  renderHomeWidgets();
}

function renderWidgetList() {
  const list = $("#homeWidgetList");
  if (!list || !homeWidgets.editing) return;

  list.innerHTML = "";

  homeWidgets.config.order.forEach((id, index) => {
    const def = HOME_WIDGET_DEFS[id];
    const row = cloneTemplate("widgetListRowTemplate");

    row.dataset.widgetId = id;
    row.classList.toggle("disabled", !homeWidgets.config.enabled[id]);
    row.querySelector(".home-widget-row-name").textContent = def.title;

    const toggle = row.querySelector('[data-row-action="toggle"]');
    toggle.checked = Boolean(homeWidgets.config.enabled[id]);
    toggle.addEventListener("change", () => setWidgetEnabled(id, toggle.checked));

    const up = row.querySelector('[data-row-action="up"]');
    const down = row.querySelector('[data-row-action="down"]');
    up.disabled = index === 0;
    down.disabled = index === homeWidgets.config.order.length - 1;
    up.addEventListener("click", () => moveWidget(id, index - 1));
    down.addEventListener("click", () => moveWidget(id, index + 1));

    const settingsBox = row.querySelector(".home-widget-row-settings");
    const settingsBtn = row.querySelector('[data-row-action="settings"]');
    const hasSettings = Boolean(document.getElementById(`widget-settings-tpl-${id}`));

    settingsBtn.classList.toggle("invisible", !hasSettings);
    settingsBtn.addEventListener("click", () => {
      homeWidgets.openSettingsId = homeWidgets.openSettingsId === id ? null : id;
      renderWidgetList();
    });

    if (hasSettings && homeWidgets.openSettingsId === id) {
      settingsBox.classList.remove("hidden");
      settingsBtn.classList.add("active");
      settingsBox.appendChild(buildWidgetSettingsForm(id));
    }

    bindListDrag(row, id);
    list.appendChild(row);
  });
}

function buildWidgetSettingsForm(id) {
  const form = cloneTemplate(`widget-settings-tpl-${id}`);
  const settings = widgetSettings(id);

  form.querySelectorAll("[data-setting]").forEach((input) => {
    const key = input.dataset.setting;

    if (input.type === "checkbox") input.checked = Boolean(settings[key]);
    else input.value = settings[key] ?? "";

    const apply = () => {
      if (input.type === "checkbox") settings[key] = input.checked;
      else if (input.type === "range" || input.type === "number")
        settings[key] = Number(input.value);
      else settings[key] = input.value.trim();

      saveHomeWidgetConfig();

      if (id === "skin") remountWidget(id);
      else refreshWidget(id);
    };

    const isText = input.tagName === "INPUT" && !["checkbox", "range"].includes(input.type);
    input.addEventListener(isText ? "change" : "input", apply);
  });

  if (id === "servers") bindServerEditor(form);
  if (id === "quickstart") bindQuickstartChecks(form);

  return form;
}

function bindServerEditor(form) {
  const settings = widgetSettings("servers");
  const editor = slot(form, "serverEditor");

  const commit = () => {
    settings.servers = Array.from(editor.querySelectorAll(".widget-server-editor-row"))
      .map((row) => ({
        name: row.querySelector('[data-field="name"]').value.trim(),
        ip: row
          .querySelector('[data-field="ip"]')
          .value.trim()
          .replace(/^https?:\/\//i, "")
          .replace(/\/.*$/, ""),
      }))
      .filter((server) => server.name || server.ip);

    saveHomeWidgetConfig();
    refreshWidget("servers");
  };

  const addRow = (server = { name: "", ip: "" }) => {
    const row = cloneTemplate("widget-server-editor-row-tpl");

    row.querySelector('[data-field="name"]').value = server.name || "";
    row.querySelector('[data-field="ip"]').value = server.ip || "";
    row.querySelectorAll("input").forEach((input) => input.addEventListener("change", commit));
    row.querySelector('[data-action="remove-server"]').addEventListener("click", () => {
      row.remove();
      commit();
    });

    editor.appendChild(row);
    return row;
  };

  (settings.servers || []).forEach((server) => addRow(server));

  form.querySelector('[data-action="add-server"]')?.addEventListener("click", () => {
    if (editor.children.length >= 8) return;
    addRow().querySelector('[data-field="name"]').focus();
  });
}

function bindQuickstartChecks(form) {
  const settings = widgetSettings("quickstart");
  const box = slot(form, "profileChecks");
  const profiles = state.profilesData?.profiles || [];

  let selected = (settings.profileIds || []).filter((id) => profiles.some((p) => p.id === id));
  if (selected.length === 0) selected = profiles.slice(0, 3).map((profile) => profile.id);

  for (const profile of profiles) {
    const label = document.createElement("label");
    label.className = "widget-check";
    label.innerHTML = `<input type="checkbox" /><span class="mcr"></span>`;
    label.querySelector("span").textContent = profile.name;

    const input = label.querySelector("input");
    input.checked = selected.includes(profile.id);

    input.addEventListener("change", () => {
      const next = new Set(selected);

      if (input.checked) next.add(profile.id);
      else next.delete(profile.id);

      if (next.size > 6) {
        input.checked = false;
        return;
      }

      selected = profiles.map((p) => p.id).filter((pid) => next.has(pid));
      settings.profileIds = selected;
      saveHomeWidgetConfig();
      refreshWidget("quickstart");
    });

    box.appendChild(label);
  }
}

function dropIndexFromEvent(container, selector, event) {
  const items = Array.from(container.querySelectorAll(selector));

  for (let index = 0; index < items.length; index += 1) {
    const rect = items[index].getBoundingClientRect();
    const isGrid = container.id === "homeWidgetBoard";
    const before = isGrid
      ? event.clientY < rect.top + rect.height / 2 ||
        (event.clientY <= rect.bottom && event.clientX < rect.left + rect.width / 2)
      : event.clientY < rect.top + rect.height / 2;

    if (before) return index;
  }

  return items.length;
}

function clearDropMarkers() {
  $$(".drop-before, .drop-after, .dragging").forEach((element) =>
    element.classList.remove("drop-before", "drop-after", "dragging")
  );
}

function bindListDrag(row, id) {
  const grip = row.querySelector(".home-widget-grip");

  row.draggable = false;
  grip?.addEventListener("mousedown", () => {
    row.draggable = true;
  });

  row.addEventListener("dragstart", (event) => {
    homeWidgets.dragId = id;
    row.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  });

  row.addEventListener("dragend", () => {
    row.draggable = false;
    homeWidgets.dragId = null;
    clearDropMarkers();
  });

  row.addEventListener("dragover", (event) => {
    if (!homeWidgets.dragId || homeWidgets.dragId === id) return;

    event.preventDefault();
    const rect = row.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;

    row.classList.toggle("drop-before", before);
    row.classList.toggle("drop-after", !before);
  });

  row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after"));

  row.addEventListener("drop", (event) => {
    event.preventDefault();

    const dragged = homeWidgets.dragId;
    if (!dragged || dragged === id) return;

    const order = homeWidgets.config.order.filter((item) => item !== dragged);
    const rect = row.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    const targetIndex = order.indexOf(id) + (before ? 0 : 1);

    clearDropMarkers();
    moveWidget(dragged, targetIndex);
  });
}

function bindBoardDrag(element, id) {
  element.addEventListener("dragstart", (event) => {
    if (!homeWidgets.editing) {
      event.preventDefault();
      return;
    }

    homeWidgets.dragId = id;
    element.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  });

  element.addEventListener("dragend", () => {
    homeWidgets.dragId = null;
    clearDropMarkers();
  });

  element.addEventListener("dragover", (event) => {
    if (!homeWidgets.editing || !homeWidgets.dragId || homeWidgets.dragId === id) return;

    event.preventDefault();
    const rect = element.getBoundingClientRect();
    const before = event.clientX < rect.left + rect.width / 2;

    element.classList.toggle("drop-before", before);
    element.classList.toggle("drop-after", !before);
  });

  element.addEventListener("dragleave", () =>
    element.classList.remove("drop-before", "drop-after")
  );

  element.addEventListener("drop", (event) => {
    event.preventDefault();

    const dragged = homeWidgets.dragId;
    if (!dragged || dragged === id) return;

    const rect = element.getBoundingClientRect();
    const before = event.clientX < rect.left + rect.width / 2;
    const order = homeWidgets.config.order.filter((item) => item !== dragged);
    const targetIndex = order.indexOf(id) + (before ? 0 : 1);

    clearDropMarkers();
    moveWidget(dragged, targetIndex);
  });
}

function refreshDataWidgets() {
  for (const id of ["servers", "players", "pvphq"]) refreshWidget(id);
}

let consoleWidgetRefreshScheduled = false;

function scheduleConsoleWidgetRefresh() {
  if (consoleWidgetRefreshScheduled || !homeWidgets.mounted.has("console")) return;

  consoleWidgetRefreshScheduled = true;

  setTimeout(() => {
    consoleWidgetRefreshScheduled = false;
    refreshWidget("console");
  }, 250);
}

function initHomeWidgets() {
  homeWidgets.config = loadHomeWidgetConfig();

  $("#homeCustomizeBtn")?.addEventListener("click", () => {
    showPage("home");
    showHomeTab("home");
    openCustomizePanel();
  });

  $("#homeCustomizeDoneBtn")?.addEventListener("click", closeCustomizePanel);

  $("#homeWidgetsResetBtn")?.addEventListener("click", async () => {
    const reset = await showConfirm("Reset home widgets to the default layout?", {
      title: "Reset widgets",
      confirmText: "Reset",
      danger: true,
    });

    if (!reset) return;

    for (const id of Array.from(homeWidgets.mounted.keys())) unmountWidget(id);

    homeWidgets.config = defaultHomeWidgetConfig();
    homeWidgets.openSettingsId = null;
    saveHomeWidgetConfig();
    renderHomeWidgets();
    renderWidgetList();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && homeWidgets.editing) closeCustomizePanel();
  });

  document.addEventListener("mouseup", () => {
    $$('.home-widget-row[draggable="true"]').forEach((row) => {
      row.draggable = false;
    });
  });

  renderHomeWidgets();
}

let welcomeAnimationTimer = null;

function playWelcomeAnimation(account, options = {}) {
  const overlay = $("#welcomeOverlay");
  if (!overlay || !account?.username) return;

  $("#welcomeName").textContent = account.username;
  $("#welcomeGreeting").textContent = options.returning ? "Welcome back" : "Welcome";
  $("#welcomeKicker").textContent = options.returning ? "Good to see you again" : "Signed in";

  const welcomeHead = $("#welcomeHead");
  const sidebarHead = $("#playerHead");

  welcomeHead.onerror = () => {
    welcomeHead.onerror = null;
    welcomeHead.src = DEFAULT_PLAYER_HEAD;
  };

  welcomeHead.src =
    account.type === "offline" ? DEFAULT_PLAYER_HEAD : sidebarHead?.src || DEFAULT_PLAYER_HEAD;

  overlay.classList.add("hidden");
  void overlay.offsetWidth;
  overlay.classList.remove("hidden");

  clearTimeout(welcomeAnimationTimer);
  welcomeAnimationTimer = setTimeout(() => overlay.classList.add("hidden"), 2900);
}

const DEVELOPER_SEQUENCE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
];

let developerSequenceIndex = 0;
let pageBeforeDeveloper = "home";

function setDevStatus(text, kind = "") {
  const status = $("#devOfflineStatus");
  if (!status) return;

  status.textContent = text;
  status.classList.toggle("error", kind === "error");
  status.classList.toggle("ok", kind === "ok");
}

function renderDeveloperInstances() {
  const text = $("#devInstancesText");
  if (!text) return;

  const list = state.runningInstances || [];

  text.textContent =
    list.length === 0
      ? "None."
      : list
          .map(
            (instance) =>
              `${instance.profileName} #${instance.number} (${instance.status}, pid ${instance.pid || "?"})`
          )
          .join(" · ");
}

async function renderDeveloperVersions() {
  const list = $("#devVersionList");
  if (!list) return;

  let info = homeWidgets.appInfo;

  try {
    info = await window.launcherAPI.system.getAppInfo();
    homeWidgets.appInfo = info;
  } catch {
    info = info || {};
  }

  const client = state.clientUpdateInfo || {};
  const account = state.account;

  const values = {
    launcher: info.version ? `v${info.version}` : "unknown",
    client: client.localClientVersion
      ? `v${client.localClientVersion}${client.updateAvailable ? ` (v${client.remoteClientVersion} available)` : ""}`
      : client.remoteClientVersion
        ? `not installed (latest v${client.remoteClientVersion})`
        : "unknown",
    build: `${info.packaged ? "packaged" : "development"}${info.portable ? ", portable" : ""}`,
    electron: info.electron || "?",
    chrome: info.chrome || "?",
    node: info.node || "?",
    system: `${info.platform || "?"} ${info.arch || ""}`.trim(),
    account: account?.username
      ? `${account.username} (${account.type || "microsoft"})`
      : "not signed in",
    dataDir: info.dataDir || "?",
    executable: info.executable || "?",
  };

  list.querySelectorAll("[data-info]").forEach((cell) => {
    cell.textContent = values[cell.dataset.info] ?? "?";
    cell.title = cell.textContent;
  });

  return values;
}

async function copyDiagnostics() {
  const values = (await renderDeveloperVersions()) || {};
  const lines = consoleStore.buffers.get(CONSOLE_VIEW_ALL) || [];

  const text = [
    "Eclipse Launcher diagnostics",
    `Generated: ${new Date().toISOString()}`,
    ...Object.entries(values).map(([key, value]) => `${key}: ${value}`),
    `Running instances: ${(state.runningInstances || []).length}`,
    "",
    "Last console lines:",
    ...lines.slice(-200),
  ].join("\n");

  try {
    await navigator.clipboard.writeText(text);
    setStatus("Diagnostics copied to the clipboard.");
  } catch {
    showAlert(text, { title: "Diagnostics (copy manually)" });
  }
}

async function openDeveloperScreen() {
  if (state.currentPage !== "developer") {
    pageBeforeDeveloper = state.currentPage || "home";
  }

  showPage("developer");
  renderDeveloperInstances();
  renderDeveloperVersions();

  const button = $("#devOfflineLoginBtn");
  const input = $("#devOfflineName");

  try {
    const eligibility = await window.launcherAPI.auth.getOfflineEligibility();

    if (button) button.disabled = !eligibility.allowed;
    if (input) input.disabled = !eligibility.allowed;

    setDevStatus(
      eligibility.allowed
        ? state.account?.type === "offline"
          ? `Signed in offline as ${state.account.username}.`
          : "Ready."
        : "Locked: sign in once with a Microsoft account that owns Minecraft: Java Edition to unlock offline accounts.",
      eligibility.allowed ? "" : "error"
    );
  } catch (error) {
    setDevStatus(friendlyErrorMessage(error), "error");
  }

  appendConsole("[developer] Developer screen opened.");
}

function handleDeveloperSequence(event) {
  const expected = DEVELOPER_SEQUENCE[developerSequenceIndex];

  if (event.key === expected) {
    developerSequenceIndex += 1;

    if (developerSequenceIndex === DEVELOPER_SEQUENCE.length) {
      developerSequenceIndex = 0;
      event.preventDefault();
      openDeveloperScreen();
    }

    return;
  }

  developerSequenceIndex = event.key === DEVELOPER_SEQUENCE[0] ? 1 : 0;
}

async function loginOfflineFromDeveloperScreen() {
  const input = $("#devOfflineName");
  const button = $("#devOfflineLoginBtn");
  const name = String(input?.value || "").trim();

  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    setDevStatus("Use 3-16 characters: letters, numbers and underscores only.", "error");
    input?.focus();
    return;
  }

  if (button) button.disabled = true;

  try {
    const result = await window.launcherAPI.auth.loginOffline(name);

    if (!result?.ok) {
      setDevStatus(result?.error || "Offline login failed.", "error");
      return;
    }

    const account = await loadAccount();

    state.skins.loaded = false;
    state.skins.minecraftProfile = null;
    remountWidget("skin");
    refreshWidget("pvphq");

    setDevStatus(`Signed in offline as ${account?.username || name}.`, "ok");
    setStatus(`Offline account: ${account?.username || name}.`);
    appendConsole(`[developer] Offline account active: ${account?.username || name}.`);

    playWelcomeAnimation(account || { username: name });
  } catch (error) {
    setDevStatus(friendlyErrorMessage(error, "Offline login failed."), "error");
  } finally {
    if (button) button.disabled = false;
  }
}

function initDeveloperScreen() {
  document.addEventListener("keydown", handleDeveloperSequence, true);

  $("#closeDeveloperBtn")?.addEventListener("click", () => {
    showPage(pageBeforeDeveloper === "developer" ? "home" : pageBeforeDeveloper);
  });

  $("#devOfflineLoginBtn")?.addEventListener("click", loginOfflineFromDeveloperScreen);

  $("#devOfflineName")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.stopPropagation();
      loginOfflineFromDeveloperScreen();
    }
  });

  $("#devReplayWelcomeBtn")?.addEventListener("click", () => {
    playWelcomeAnimation(state.account?.username ? state.account : { username: "Player" });
  });

  $("#devResetOnboardingBtn")?.addEventListener("click", () => {
    localStorage.removeItem(ONBOARDING_DONE_KEY);
    setStatus("First-start setup will show on the next start.");
  });

  $("#devResetWidgetsBtn")?.addEventListener("click", () => {
    for (const id of Array.from(homeWidgets.mounted.keys())) unmountWidget(id);

    homeWidgets.config = defaultHomeWidgetConfig();
    saveHomeWidgetConfig();
    renderHomeWidgets();
    setStatus("Home widgets reset.");
  });

  $("#devCopyDiagnosticsBtn")?.addEventListener("click", copyDiagnostics);

  $("#devOpenDevToolsBtn")?.addEventListener("click", () => window.launcherAPI.dev.openDevTools());

  $("#devOpenDataBtn")?.addEventListener("click", () => {
    if (homeWidgets.appInfo?.dataDir)
      window.launcherAPI.folders.openPath(homeWidgets.appInfo.dataDir);
  });

  $("#devOpenLogsBtn")?.addEventListener("click", () => {
    if (homeWidgets.appInfo?.logsDir)
      window.launcherAPI.folders.openPath(homeWidgets.appInfo.logsDir);
  });

  $("#devPreviewUpdateBtn")?.addEventListener("click", () => {
    const current = homeWidgets.appInfo?.version || "1.0.0";
    const parts = current.split(".").map((part) => Number(part) || 0);
    parts[parts.length - 1] += 1;

    showLauncherUpdatePrompt("ask", { version: parts.join("."), currentVersion: current });
  });

  $("#devTestDialogsBtn")?.addEventListener("click", async () => {
    await showAlert("This is an info message.", { title: "Info dialog" });
    await showError("Error invoking remote method 'test:thing': Error: This is an error message.");
    const answer = await showConfirm("Do you like the new dialogs?", {
      title: "Confirm dialog",
      confirmText: "Yes",
      cancelText: "No",
    });
    setStatus(`Confirm dialog answered: ${answer ? "Yes" : "No"}.`);
  });

  $("#devRefreshWidgetsBtn")?.addEventListener("click", () => {
    homeWidgets.serverStatusCache.clear();
    homeWidgets.pvphqResults.clear();
    homeWidgets.latestVersions = null;

    for (const id of Array.from(homeWidgets.mounted.keys())) remountWidget(id);
    setStatus("Widgets refreshed.");
  });

  $("#devRelaunchBtn")?.addEventListener("click", async () => {
    const restart = await showConfirm("Close and reopen the launcher now?", {
      title: "Restart launcher",
      confirmText: "Restart",
      danger: true,
    });

    if (restart) window.launcherAPI.dev.relaunch();
  });

  $("#devReloadUiBtn")?.addEventListener("click", () => {
    window.location.reload();
  });

  $("#devStopAllBtn")?.addEventListener("click", async () => {
    const stopAll = await showConfirm("Stop every running Minecraft instance?", {
      title: "Stop all instances",
      confirmText: "Stop all",
      danger: true,
    });

    if (!stopAll) return;
    await window.launcherAPI.launcher.kill();
  });
}

const ONBOARDING_DONE_KEY = "launcher.onboardingComplete";
const ONBOARDING_STEPS = ["welcome", "account", "installation", "preferences", "done"];

const onboarding = {
  index: 0,
  selectedProfileId: null,
};

function isOnboardingComplete() {
  return localStorage.getItem(ONBOARDING_DONE_KEY) === "true";
}

function renderOnboardingAccount() {
  const box = $(".onboarding-account");
  const name = $("#onboardingAccountName");
  const sub = $("#onboardingAccountSub");
  const head = $("#onboardingAccountHead");
  const button = $("#onboardingLoginBtn");

  const account = state.account;
  const signedIn = Boolean(account && account.username);

  box?.classList.toggle("signed-in", signedIn);

  if (name) name.textContent = signedIn ? account.username : "Not signed in";
  if (sub) {
    sub.textContent = signedIn
      ? "Signed in with Microsoft."
      : "You can also do this later from the sidebar.";
  }

  if (head) {
    const sidebarHead = $("#playerHead");

    head.onerror = () => {
      head.onerror = null;
      head.src = DEFAULT_PLAYER_HEAD;
    };

    head.src = signedIn && sidebarHead?.src ? sidebarHead.src : DEFAULT_PLAYER_HEAD;
  }

  if (button) {
    button.textContent = signedIn ? "Use a different account" : "Login with Microsoft";
  }
}

function renderOnboardingProfiles() {
  const list = $("#onboardingProfileList");
  if (!list) return;

  const profiles = state.profilesData?.profiles || [];

  if (!onboarding.selectedProfileId) {
    onboarding.selectedProfileId = selectedProfileId() || profiles[0]?.id || null;
  }

  list.innerHTML = "";

  for (const profile of profiles) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "onboarding-profile";
    button.title = profile.name;
    button.classList.toggle("selected", profile.id === onboarding.selectedProfileId);

    button.innerHTML = `
      ${renderInstallationIconHtml(profile)}
      <span class="onboarding-profile-text">
        <span class="onboarding-profile-name mct">${escapeHtml(profile.name)}</span>
        <span class="onboarding-profile-sub mcr">${escapeHtml(loaderLabel(profile.loaderType))} · ${escapeHtml(profile.minecraftVersion || "?")}</span>
      </span>
    `;

    button.addEventListener("click", () => {
      onboarding.selectedProfileId = profile.id;
      renderOnboardingProfiles();
    });

    list.appendChild(button);
  }
}

function renderOnboardingSummary() {
  const summary = $("#onboardingSummary");
  if (!summary) return;

  const profile = findProfile(onboarding.selectedProfileId);
  const parts = [];

  parts.push(
    state.account?.username
      ? `Signed in as ${state.account.username}.`
      : "You're not signed in yet. Use the login button in the sidebar before you launch."
  );

  if (profile) {
    parts.push(`${profile.name} is selected. Press Start on the Home page to launch it.`);
  }

  summary.textContent = parts.join(" ");
}

function renderOnboardingStep() {
  const step = ONBOARDING_STEPS[onboarding.index];

  $$(".onboarding-step").forEach((section) => {
    section.classList.toggle("active", section.dataset.onboardingStep === step);
  });

  const count = $("#onboardingStepCount");
  if (count) count.textContent = `Step ${onboarding.index + 1} of ${ONBOARDING_STEPS.length}`;

  const dots = $("#onboardingDots");
  if (dots) {
    dots.innerHTML = ONBOARDING_STEPS.map((_, index) => {
      const cls = index === onboarding.index ? "current" : index < onboarding.index ? "done" : "";
      return `<span class="onboarding-dot ${cls}"></span>`;
    }).join("");
  }

  const back = $("#onboardingBackBtn");
  back?.classList.toggle("invisible", onboarding.index === 0);

  const next = $("#onboardingNextBtn");
  if (next) {
    if (step === "welcome") next.textContent = "Get started";
    else if (step === "account")
      next.textContent = state.account?.username ? "Next" : "Skip for now";
    else if (step === "done") next.textContent = "Finish";
    else next.textContent = "Next";
  }

  const skip = $("#onboardingSkipBtn");
  skip?.classList.toggle("hidden", step === "done");

  if (step === "account") renderOnboardingAccount();
  if (step === "installation") renderOnboardingProfiles();
  if (step === "done") renderOnboardingSummary();

  if (step === "preferences") {
    const settings = getLauncherSettings();
    const keepOpen = $("#onboardingKeepOpen");
    const openConsole = $("#onboardingOpenConsole");

    if (keepOpen) keepOpen.checked = settings.keepLauncherOpenOnLaunch;
    if (openConsole) openConsole.checked = settings.openConsoleOnLaunch;
  }
}

function openOnboarding() {
  onboarding.index = 0;
  onboarding.selectedProfileId = selectedProfileId() || null;

  $("#onboardingBackdrop")?.classList.remove("hidden");
  renderOnboardingStep();

  $("#onboardingNextBtn")?.focus();
}

function closeOnboarding() {
  localStorage.setItem(ONBOARDING_DONE_KEY, "true");
  $("#onboardingBackdrop")?.classList.add("hidden");
}

async function applyOnboardingStep(step) {
  if (step === "installation" && onboarding.selectedProfileId) {
    if (onboarding.selectedProfileId !== selectedProfileId()) {
      await selectProfile(onboarding.selectedProfileId);
    }
  }

  if (step === "preferences") {
    fillLauncherSettingsControls();
  }
}

async function onboardingNext() {
  const step = ONBOARDING_STEPS[onboarding.index];

  try {
    await applyOnboardingStep(step);
  } catch (error) {
    showError(error.message || "Could not save this step.");
    return;
  }

  if (onboarding.index >= ONBOARDING_STEPS.length - 1) {
    closeOnboarding();
    showPage("home");
    setStatus("Setup complete.");
    return;
  }

  onboarding.index += 1;
  renderOnboardingStep();
}

function onboardingBack() {
  if (onboarding.index === 0) return;

  onboarding.index -= 1;
  renderOnboardingStep();
}

async function initUpdateSettings() {
  const launcherSwitch = $("#settingAutoUpdateLauncher");
  const clientSwitch = $("#settingAutoUpdateClient");
  const status = $("#settingsUpdateStatus");

  try {
    state.updateSettings = await window.launcherAPI.settings.get();
  } catch {
    state.updateSettings = { autoUpdateLauncher: true, autoUpdateClient: true };
  }

  if (launcherSwitch) launcherSwitch.checked = state.updateSettings.autoUpdateLauncher;
  if (clientSwitch) clientSwitch.checked = state.updateSettings.autoUpdateClient;

  const bind = (input, key, label) => {
    input?.addEventListener("change", async () => {
      try {
        state.updateSettings = await window.launcherAPI.settings.set(key, input.checked);
        setStatus(`${label} auto-update ${input.checked ? "on" : "off"}.`);
        appendConsole(`[settings] ${label} auto-update ${input.checked ? "enabled" : "disabled"}.`);
      } catch (error) {
        input.checked = !input.checked;
        showError(friendlyErrorMessage(error, "Could not save the setting."));
      }
    });
  };

  bind(launcherSwitch, "autoUpdateLauncher", "Launcher");
  bind(clientSwitch, "autoUpdateClient", "Client");

  $("#checkUpdatesNowBtn")?.addEventListener("click", async () => {
    const button = $("#checkUpdatesNowBtn");

    button.disabled = true;
    if (status) status.textContent = "Checking the launcher and the client...";

    try {
      await checkLauncherUpdateManually();
      await checkDefaultClientInfoManually({ manual: true });

      const launcher = state.launcherUpdate || {};
      const client = state.clientUpdateInfo || {};

      const launcherText =
        launcher.type === "downloaded"
          ? "Launcher update ready. It installs when you close the launcher, or use Restart & update in the Launcher update widget."
          : launcher.type === "available"
            ? `Launcher update ${launcher.info?.version || ""} available.`
            : launcher.type === "download-progress"
              ? "Launcher update downloading..."
              : launcher.type === "error"
                ? "Launcher update check failed (see Console)."
                : launcher.message || "Launcher is up to date.";

      const clientText = client.updateAvailable
        ? `Client update ${client.remoteClientVersion || ""} available.`
        : "Client is up to date.";

      if (status) status.textContent = `${launcherText} ${clientText}`;
    } catch (error) {
      if (status) status.textContent = friendlyErrorMessage(error, "Update check failed.");
    } finally {
      button.disabled = false;
    }
  });
}

async function renderDataFolderSetting() {
  const pathText = $("#settingsDataDir");
  const badge = $("#settingsPortableBadge");

  try {
    const info = homeWidgets.appInfo || (await window.launcherAPI.system.getAppInfo());
    homeWidgets.appInfo = info;

    if (pathText) pathText.textContent = info.dataDir || "Unknown";
    badge?.classList.toggle("hidden", !info.portable);
  } catch {
    if (pathText) pathText.textContent = "Unknown";
  }
}

const sharedFoldersUi = {
  state: null,
  busy: false,
  open: false,
};

function setSharedFoldersStatus(text, isError = false) {
  const status = $("#sharedFoldersStatus");
  if (!status) return;
  status.textContent = text || "";
  status.classList.toggle("error", Boolean(isError));
}

function describeSharedApplied(applied) {
  if (!applied) return { text: "", error: false };

  (applied.logs || []).forEach((line) => appendConsole(`[shared] ${line}`));
  (applied.errors || []).forEach((line) => appendConsole(`[shared] ${line}`));

  const parts = [];

  if (applied.errors?.length) {
    parts.push(`Some folders could not be linked:\n${applied.errors.join("\n")}`);
  }

  if (applied.skipped) {
    parts.push(
      `${applied.skipped} running installation${applied.skipped === 1 ? "" : "s"} will be updated on next launch.`
    );
  }

  return { text: parts.join("\n"), error: Boolean(applied.errors?.length) };
}

function reportSharedFoldersApplied(applied) {
  const { text, error } = describeSharedApplied(applied);
  setSharedFoldersStatus(text, error);
}

function renderSharedFoldersSummary() {
  const summary = $("#sharedFoldersSummary");
  const state = sharedFoldersUi.state;
  if (!summary || !state) return;

  if (!state.enabled) {
    summary.textContent = "Off. Every installation has its own folders.";
    return;
  }

  const on = state.folders.filter((folder) => folder.enabled).map((folder) => folder.label);
  summary.textContent = on.length
    ? `Sharing: ${on.join(", ")}`
    : "On, but no folders are selected.";
}

function renderSharedFolders() {
  renderSharedFoldersSummary();

  const state = sharedFoldersUi.state;
  const list = $("#sharedFoldersList");
  const template = $("#sharedFolderRowTemplate");
  if (!state || !list || !template) return;

  const toggle = $("#settingSharedFolders");
  if (toggle) {
    toggle.checked = Boolean(state.enabled);
    toggle.disabled = sharedFoldersUi.busy;
  }

  const root = $("#sharedFoldersRoot");
  if (root) root.textContent = state.root;

  $("#sharedFoldersResetRootBtn")?.classList.toggle("hidden", !state.customRoot);
  ["#sharedFoldersChooseRootBtn", "#sharedFoldersResetRootBtn", "#sharedFoldersAddBtn"].forEach(
    (selector) => {
      const button = $(selector);
      if (button) button.disabled = sharedFoldersUi.busy;
    }
  );

  list.classList.toggle("off", !state.enabled);

  const focusedId = document.activeElement?.closest?.(".shared-folder-row")?.dataset.folder;
  const fragment = document.createDocumentFragment();

  for (const folder of state.folders) {
    const row = template.content.firstElementChild.cloneNode(true);
    const input = row.querySelector('input[type="checkbox"]');
    const label = row.querySelector('[data-field="label"]');

    row.dataset.folder = folder.id;
    row.classList.toggle("disabled-folder", !folder.enabled);

    label.value = folder.label;
    row.querySelector('[data-field="id"]').textContent = `/${folder.id}`;
    row.querySelector('[data-field="custom"]').classList.toggle("hidden", !folder.custom);
    row.querySelector('[data-field="description"]').textContent = folder.description;
    row.querySelector('[data-field="path"]').textContent = folder.path;
    row.querySelector('[data-action="reset"]').classList.toggle("hidden", !folder.customPath);
    row.querySelector('[data-action="remove"]').classList.toggle("hidden", !folder.custom);

    input.checked = folder.enabled;
    input.disabled = sharedFoldersUi.busy;

    input.addEventListener("change", () => {
      updateSharedFolders({ folder: { id: folder.id, enabled: input.checked } });
    });

    const commitLabel = () => {
      const value = label.value.trim();
      if (!value) {
        label.value = folder.label;
        return;
      }
      if (value === folder.label) return;
      updateSharedFolders({ folder: { id: folder.id, label: value } }, { quiet: true });
    };

    label.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        label.blur();
      }
      if (event.key === "Escape") {
        event.stopPropagation();
        label.value = folder.label;
        label.blur();
      }
    });
    label.addEventListener("blur", commitLabel);

    row.addEventListener("click", (event) => {
      if (event.target.closest("button, input, label.block-switch")) return;
      if (input.disabled) return;
      input.checked = !input.checked;
      input.dispatchEvent(new Event("change"));
    });

    row.querySelectorAll("[data-action]").forEach((button) => {
      button.disabled = sharedFoldersUi.busy;

      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const action = button.dataset.action;

        if (action === "open") openSharedFolderPath(folder.path);
        if (action === "choose") chooseSharedFolder(folder.id);
        if (action === "reset") resetSharedFolder(folder.id);
        if (action === "remove") removeSharedFolder(folder);
      });
    });

    fragment.appendChild(row);
  }

  list.replaceChildren(fragment);

  if (focusedId) {
    list
      .querySelector(
        `.shared-folder-row[data-folder="${CSS.escape(focusedId)}"] .shared-folder-label`
      )
      ?.focus();
  }
}

async function runSharedFoldersAction(action, busyText, options = {}) {
  if (sharedFoldersUi.busy) return false;

  sharedFoldersUi.busy = true;
  if (!options.quiet) setSharedFoldersStatus(busyText);
  renderSharedFolders();

  let success = false;

  try {
    const result = await action();

    if (result && !result.canceled) {
      sharedFoldersUi.state = result;
      sharedFoldersUi.busy = false;
      renderSharedFolders();
      reportSharedFoldersApplied(result.applied);
      return true;
    }

    if (result?.canceled) setSharedFoldersStatus("");
  } catch (error) {
    setSharedFoldersStatus(friendlyErrorMessage(error, "Could not update shared folders."), true);
  }

  sharedFoldersUi.busy = false;
  renderSharedFolders();
  return success;
}

function updateSharedFolders(patch, options = {}) {
  return runSharedFoldersAction(
    () => window.launcherAPI.sharedFolders.update(patch),
    "Linking folders...",
    options
  );
}

function chooseSharedFolder(folderId = "") {
  return runSharedFoldersAction(
    () => window.launcherAPI.sharedFolders.choose(folderId),
    "Choose a folder..."
  );
}

function resetSharedFolder(folderId = "") {
  return runSharedFoldersAction(
    () => window.launcherAPI.sharedFolders.reset(folderId),
    "Linking folders..."
  );
}

async function removeSharedFolder(folder) {
  const confirmed = await showConfirm(
    `Stop sharing "${folder.label}" (/${folder.id})?\n\nEvery installation gets its own empty ${folder.id} folder again. The files stay in the shared folder.`,
    { title: "Remove shared folder", confirmText: "Remove", danger: true }
  );

  if (!confirmed) return;

  await runSharedFoldersAction(
    () => window.launcherAPI.sharedFolders.remove(folder.id),
    "Removing..."
  );
}

async function addSharedFolder() {
  const nameInput = $("#sharedFoldersAddName");
  const labelInput = $("#sharedFoldersAddLabel");
  const name = nameInput?.value.trim() || "";

  if (!name) {
    setSharedFoldersStatus("Type the folder name as it appears in the game folder.", true);
    nameInput?.focus();
    return;
  }

  const added = await runSharedFoldersAction(
    () => window.launcherAPI.sharedFolders.add(name, labelInput?.value.trim() || ""),
    "Adding folder..."
  );

  if (added) {
    if (nameInput) nameInput.value = "";
    if (labelInput) labelInput.value = "";
    $("#sharedFoldersList")?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }
}

async function openSharedFolderPath(folderPath) {
  try {
    await window.launcherAPI.folders.openPath(folderPath);
  } catch (error) {
    showError(friendlyErrorMessage(error, "Could not open the folder."));
  }
}

async function refreshSharedFoldersState() {
  try {
    sharedFoldersUi.state = await window.launcherAPI.sharedFolders.get();
    renderSharedFolders();
  } catch (error) {
    setSharedFoldersStatus(friendlyErrorMessage(error, "Could not load shared folders."), true);
  }
}

async function openSharedFoldersMenu() {
  sharedFoldersUi.open = true;
  setSharedFoldersStatus("");
  $("#sharedFoldersBackdrop")?.classList.remove("hidden");
  await refreshSharedFoldersState();
}

function closeSharedFoldersMenu() {
  if (!sharedFoldersUi.open) return;

  document.activeElement?.blur?.();
  sharedFoldersUi.open = false;
  $("#sharedFoldersBackdrop")?.classList.add("hidden");

  if (state.installationEditor?.tab === "folders") {
    renderEditorFolders();
  }
}

async function initSharedFoldersSetting() {
  if (!window.launcherAPI.sharedFolders) return;

  $("#openSharedFoldersBtn")?.addEventListener("click", openSharedFoldersMenu);
  $("#editorManageSharedBtn")?.addEventListener("click", openSharedFoldersMenu);
  $("#sharedFoldersCloseBtn")?.addEventListener("click", closeSharedFoldersMenu);

  $("#sharedFoldersBackdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeSharedFoldersMenu();
  });

  $("#settingSharedFolders")?.addEventListener("change", (event) => {
    updateSharedFolders({ enabled: event.target.checked });
  });

  $("#sharedFoldersChooseRootBtn")?.addEventListener("click", () => chooseSharedFolder(""));
  $("#sharedFoldersResetRootBtn")?.addEventListener("click", () => resetSharedFolder(""));
  $("#sharedFoldersOpenRootBtn")?.addEventListener("click", () => {
    if (sharedFoldersUi.state?.root) openSharedFolderPath(sharedFoldersUi.state.root);
  });

  $("#sharedFoldersAddForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    addSharedFolder();
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (!sharedFoldersUi.open || event.key !== "Escape") return;
      if (!$("#appDialogBackdrop")?.classList.contains("hidden")) return;
      if (mcSelectState.open) return;

      event.stopPropagation();
      closeSharedFoldersMenu();
    },
    true
  );

  $("#editorUseSharedFolders")?.addEventListener("change", (event) => {
    setEditorFolders({ useShared: event.target.checked }, event.target);
  });

  await refreshSharedFoldersState();
}

const editorFoldersUi = {
  busy: false,
  requestId: 0,
};

function setEditorFoldersNote(text, isError = false) {
  const note = $("#editorFoldersNote");
  if (!note) return;
  note.textContent = text || "";
  note.classList.toggle("error", Boolean(isError));
}

function renderEditorFolderState(profileState) {
  const list = $("#editorFoldersList");
  const template = $("#editorFolderRowTemplate");
  const master = $("#editorUseSharedFolders");
  if (!list || !template || !profileState) return;

  if (master) {
    master.checked = profileState.useShared;
    master.disabled = editorFoldersUi.busy;
  }

  list.classList.toggle("off", !profileState.useShared || !profileState.globalEnabled);

  const fragment = document.createDocumentFragment();

  for (const folder of profileState.folders) {
    const row = template.content.firstElementChild.cloneNode(true);
    const input = row.querySelector("input");

    input.id = `editorFolderToggle-${folder.id}`;
    row.htmlFor = input.id;
    row.classList.toggle("inactive", !folder.active);

    row.querySelector('[data-field="label"]').textContent = `${folder.label}  /${folder.id}`;

    let sub;
    if (!profileState.globalEnabled) sub = "Shared folders are turned off in Settings.";
    else if (!folder.enabled) sub = "Not shared globally. Turn it on in Manage shared folders.";
    else if (!profileState.useShared) sub = "Separate: this installation uses its own folder.";
    else if (folder.shared) sub = `Shared: ${folder.path}`;
    else sub = "Separate: this installation uses its own folder.";

    row.querySelector('[data-field="sub"]').textContent = sub;

    input.checked = folder.shared;
    input.disabled = editorFoldersUi.busy || !profileState.useShared;

    input.addEventListener("change", () => {
      setEditorFolders({ folder: { id: folder.id, shared: input.checked } }, input);
    });

    fragment.appendChild(row);
  }

  list.replaceChildren(fragment);
}

async function renderEditorFolders() {
  const profileId = state.installationEditor?.profileId;
  const list = $("#editorFoldersList");
  if (!list) return;

  if (!profileId || !window.launcherAPI.sharedFolders?.getProfile) {
    list.replaceChildren();
    setEditorFoldersNote("Save this installation first to choose its folders.");
    return;
  }

  const requestId = ++editorFoldersUi.requestId;

  try {
    const profileState = await window.launcherAPI.sharedFolders.getProfile(profileId);
    if (requestId !== editorFoldersUi.requestId) return;
    setEditorFoldersNote("");
    renderEditorFolderState(profileState);
  } catch (error) {
    setEditorFoldersNote(friendlyErrorMessage(error, "Could not load folders."), true);
  }
}

async function setEditorFolders(patch, control) {
  const profileId = state.installationEditor?.profileId;
  if (!profileId || editorFoldersUi.busy) return;

  const goingSeparate =
    patch.useShared === false || (patch.folder && patch.folder.shared === false);

  let copy = false;

  if (goingSeparate) {
    copy = await showConfirm(
      "This installation will get its own folder. Copy the shared files into it so it starts with the same worlds and packs, or start empty?",
      { title: "Use separate folders", confirmText: "Copy files", cancelText: "Start empty" }
    );
  }

  editorFoldersUi.busy = true;
  setEditorFoldersNote(copy ? "Copying files..." : "Updating folders...");

  try {
    const result = await window.launcherAPI.sharedFolders.setProfile(profileId, patch, { copy });
    editorFoldersUi.busy = false;
    renderEditorFolderState(result);

    const { text, error } = describeSharedApplied(result.applied);
    setEditorFoldersNote(text, error);
  } catch (error) {
    editorFoldersUi.busy = false;
    if (control) control.checked = !control.checked;
    setEditorFoldersNote(friendlyErrorMessage(error, "Could not change folders."), true);
    renderEditorFolders();
  }
}

function initDataFolderSetting() {
  $("#openDataFolderBtn")?.addEventListener("click", async () => {
    const dir = homeWidgets.appInfo?.dataDir;
    if (!dir) return;

    try {
      await window.launcherAPI.folders.openPath(dir);
    } catch (error) {
      showError(friendlyErrorMessage(error, "Could not open the data folder."));
    }
  });

  renderDataFolderSetting();
}

function playWelcomeBackWhenReady(account) {
  const head = $("#playerHead");
  let played = false;

  const play = () => {
    if (played) return;
    played = true;
    playWelcomeAnimation(account, { returning: true });
  };

  if (!head || (head.complete && head.naturalWidth > 0)) {
    play();
    return;
  }

  head.addEventListener("load", play, { once: true });
  head.addEventListener("error", play, { once: true });
  setTimeout(play, 1200);
}

function initOnboardingEvents() {
  $("#onboardingNextBtn")?.addEventListener("click", onboardingNext);
  $("#onboardingBackBtn")?.addEventListener("click", onboardingBack);

  $("#onboardingSkipBtn")?.addEventListener("click", () => {
    closeOnboarding();
    setStatus("Setup skipped. You can run it again from Settings.");
  });

  $("#onboardingLoginBtn")?.addEventListener("click", async () => {
    const button = $("#onboardingLoginBtn");

    if (button) {
      button.disabled = true;
      button.textContent = "Opening login...";
    }

    try {
      await handleLogin();
    } finally {
      if (button) button.disabled = false;
      renderOnboardingStep();
    }
  });

  $("#onboardingKeepOpen")?.addEventListener("change", (event) => {
    writeBooleanSetting(LAUNCHER_SETTING_KEYS.keepLauncherOpenOnLaunch, event.target.checked);
  });

  $("#onboardingOpenConsole")?.addEventListener("change", (event) => {
    writeBooleanSetting(LAUNCHER_SETTING_KEYS.openConsoleOnLaunch, event.target.checked);
  });

  $("#reopenOnboardingBtn")?.addEventListener("click", openOnboarding);

  document.addEventListener("keydown", (event) => {
    const backdrop = $("#onboardingBackdrop");
    if (!backdrop || backdrop.classList.contains("hidden")) return;

    if (event.key === "Escape") {
      closeOnboarding();
    }
  });
}

function formatMegabytes(bytes) {
  return `${Math.max(1, Math.round(Number(bytes || 0) / 1048576))} MB`;
}

function showJavaInstallPrompt(profile, check) {
  const backdrop = $("#javaPromptBackdrop");
  const installBtn = $("#javaPromptInstallBtn");
  const cancelBtn = $("#javaPromptCancelBtn");
  const progress = $("#javaPromptProgress");
  const bar = $("#javaPromptBar");
  const progressText = $("#javaPromptProgressText");
  const errorText = $("#javaPromptError");

  const major = check.required?.majorVersion || "";
  const component = check.required?.component || "";

  $("#javaPromptText").textContent =
    `${profile.name} runs Minecraft ${profile.minecraftVersion}, which needs Java ${major}. ` +
    `No Java ${major} was found on this PC.`;

  installBtn.textContent = "Install Java";
  installBtn.disabled = false;
  cancelBtn.disabled = false;
  progress.classList.add("hidden");
  errorText.classList.add("hidden");
  bar.style.width = "0%";
  backdrop.classList.remove("hidden");
  installBtn.focus();

  return new Promise((resolve) => {
    let installing = false;

    const finish = (value) => {
      backdrop.classList.add("hidden");
      installBtn.removeEventListener("click", onInstall);
      cancelBtn.removeEventListener("click", onCancel);
      document.removeEventListener("keydown", onKey, true);
      resolve(value);
    };

    const onCancel = () => {
      if (!installing) finish(false);
    };

    const onKey = (event) => {
      if (event.key === "Escape" && !installing) {
        event.stopPropagation();
        finish(false);
      }
    };

    const onInstall = async () => {
      installing = true;
      installBtn.disabled = true;
      cancelBtn.disabled = true;
      installBtn.textContent = "Installing...";
      errorText.classList.add("hidden");
      progress.classList.remove("hidden");
      progressText.textContent = `Preparing Java ${major}...`;

      try {
        await window.launcherAPI.java.install(component);

        bar.style.width = "100%";
        progressText.textContent = `Java ${major} installed. Starting ${profile.name}...`;
        setStatus(`Java ${major} installed.`);

        setTimeout(() => finish(true), 1000);
      } catch (error) {
        installing = false;
        installBtn.disabled = false;
        cancelBtn.disabled = false;
        installBtn.textContent = "Try again";
        errorText.textContent = friendlyErrorMessage(error, "Java could not be installed.");
        errorText.classList.remove("hidden");
      }
    };

    installBtn.addEventListener("click", onInstall);
    cancelBtn.addEventListener("click", onCancel);
    document.addEventListener("keydown", onKey, true);
  });
}

async function ensureJavaBeforeLaunch(profile) {
  let check;

  try {
    check = await window.launcherAPI.java.checkForProfile(profile.id);
  } catch (error) {
    appendConsole(`[java] Java check failed: ${friendlyErrorMessage(error)}`);
    return true;
  }

  if (check?.ok) return true;

  if (check?.reason === "custom-missing") {
    showError(check.message);
    return false;
  }

  appendConsole(`[java] ${check?.message || "Java not detected."}`);

  return showJavaInstallPrompt(profile, check || {});
}

function initJavaInstallProgress() {
  window.launcherAPI.java.onInstallProgress?.((data) => {
    const bar = $("#javaPromptBar");
    const text = $("#javaPromptProgressText");

    if (bar) bar.style.width = `${Math.min(100, Math.max(0, data.percent || 0))}%`;

    if (text && data.totalBytes) {
      text.textContent = `Downloading Java ${data.version || ""}: ${formatMegabytes(data.doneBytes)} of ${formatMegabytes(
        data.totalBytes
      )} (${data.percent || 0}%)`;
    }
  });
}

function onAccountChanged(account, options = {}) {
  state.skins.loaded = false;
  state.skins.minecraftProfile = null;
  remountWidget("skin");
  refreshWidget("pvphq");

  if ($("#home-tab-skin")?.classList.contains("active")) {
    loadSkinPageData(true);
  }

  if (options.welcome && account?.username) {
    playWelcomeAnimation(account, { returning: true });
  }
}

function closeAccountMenu() {
  $("#accountMenu")?.classList.add("hidden");
  $("#accountSwitchBtn")?.setAttribute("aria-expanded", "false");
  $(".account-box")?.classList.remove("menu-open");
}

async function openAccountMenu() {
  const menu = $("#accountMenu");
  if (!menu) return;

  let accounts = [];

  try {
    accounts = await window.launcherAPI.auth.listAccounts();
  } catch (error) {
    showError(error, { title: "Could not load accounts" });
    return;
  }

  menu.innerHTML = "";

  for (const account of accounts) {
    const item = cloneTemplate("accountMenuItemTemplate");
    const pick = item.querySelector('[data-action="pick"]');
    const head = item.querySelector(".account-menu-head");

    item.classList.toggle("active", account.active);
    pick.classList.toggle("selected", account.active);
    item.querySelector(".account-menu-name").textContent = account.username;
    item.querySelector(".account-menu-sub").textContent =
      account.type === "offline" ? "Offline" : account.expired ? "Sign in again" : "Microsoft";

    if (account.type !== "offline" && account.uuid) {
      head.onerror = () => {
        head.onerror = null;
        head.src = DEFAULT_PLAYER_HEAD;
      };
      head.src = playerFaceUrl(account.uuid);
    }

    pick.addEventListener("click", () => switchToAccount(account));
    item
      .querySelector('[data-action="remove"]')
      .addEventListener("click", () => removeSavedAccount(account));

    menu.appendChild(item);
  }

  const footer = cloneTemplate("accountMenuFooterTemplate");
  footer.querySelector('[data-action="add"]').addEventListener("click", async () => {
    closeAccountMenu();
    await handleLogin();
  });
  menu.appendChild(footer);

  menu.classList.remove("hidden");
  $("#accountSwitchBtn")?.setAttribute("aria-expanded", "true");
  $(".account-box")?.classList.add("menu-open");
}

async function switchToAccount(account) {
  closeAccountMenu();

  if (account.active) return;

  setStatus(`Switching to ${account.username}...`);

  const result = await window.launcherAPI.auth.switchAccount(account.uuid);

  if (!result?.ok) {
    if (result?.needsLogin) {
      const signIn = await showConfirm(`${result.error}\n\nSign in now?`, {
        title: "Session expired",
        confirmText: "Sign in",
      });

      if (signIn) await handleLogin();
      return;
    }

    showError(result?.error || "Could not switch account.", { title: "Switch failed" });
    return;
  }

  const active = await loadAccount();
  setStatus(`Switched to ${active?.username || account.username}.`);
  appendConsole(`[auth] Switched to ${active?.username || account.username}.`);
  onAccountChanged(active, { welcome: true });
}

async function removeSavedAccount(account) {
  const confirmed = await showConfirm(
    `Remove ${account.username} from this launcher?\n\nYou can add it again later by signing in.`,
    { title: "Remove account", confirmText: "Remove", danger: true }
  );

  if (!confirmed) return;

  await window.launcherAPI.auth.removeAccount(account.uuid);
  const active = await loadAccount();

  appendConsole(`[auth] Removed ${account.username}.`);
  setStatus(active?.username ? `Now using ${active.username}.` : "Signed out.");
  onAccountChanged(active);

  if (!$("#accountMenu")?.classList.contains("hidden")) openAccountMenu();
  else closeAccountMenu();
}

function initAccountSwitcher() {
  $("#accountSwitchBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();

    if ($("#accountMenu")?.classList.contains("hidden")) openAccountMenu();
    else closeAccountMenu();
  });

  document.addEventListener("mousedown", (event) => {
    if (!event.target.closest?.(".account-box")) closeAccountMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAccountMenu();
  });
}

const launcherUpdatePrompt = {
  open: false,
  mode: "ask",
  version: "",
  dismissedVersion: "",
  manual: false,
};

function launcherUpdateEls() {
  return {
    backdrop: $("#launcherUpdateBackdrop"),
    title: $("#launcherUpdateTitle"),
    text: $("#launcherUpdateText"),
    question: $("#launcherUpdateQuestion"),
    progress: $("#launcherUpdateProgress"),
    bar: $("#launcherUpdateBar"),
    progressText: $("#launcherUpdateProgressText"),
    error: $("#launcherUpdateError"),
    yes: $("#launcherUpdateYesBtn"),
    no: $("#launcherUpdateNoBtn"),
  };
}

function setLauncherUpdateMode(mode, info = {}) {
  const el = launcherUpdateEls();
  const version = info.version || launcherUpdatePrompt.version || "";
  const current = homeWidgets.appInfo?.version || info.currentVersion || "";

  launcherUpdatePrompt.mode = mode;
  launcherUpdatePrompt.version = version;

  el.error.classList.add("hidden");
  el.yes.disabled = false;
  el.no.disabled = false;
  el.no.classList.remove("hidden");

  if (mode === "ask") {
    el.title.textContent = "Update available";
    el.text.textContent = `Eclipse Launcher ${version} is out${current ? ` (you have ${current})` : ""}.`;
    el.question.textContent = "Would you like to update now?";
    el.question.classList.remove("hidden");
    el.progress.classList.add("hidden");
    el.yes.textContent = "Yes, update";
    el.no.textContent = "No";
  }

  if (mode === "ready") {
    el.title.textContent = "Update ready";
    el.text.textContent = `Eclipse Launcher ${version} is downloaded.`;
    el.question.textContent = "Restart the launcher to install it now?";
    el.question.classList.remove("hidden");
    el.progress.classList.add("hidden");
    el.yes.textContent = "Restart & update";
    el.no.textContent = "Later";
  }

  if (mode === "downloading") {
    el.title.textContent = `Updating to ${version}`;
    el.text.textContent = "Downloading the update. The launcher restarts when it's done.";
    el.question.classList.add("hidden");
    el.progress.classList.remove("hidden");
    el.bar.style.width = "0%";
    el.progressText.textContent = "Starting download...";
    el.yes.disabled = true;
    el.no.disabled = true;
    el.yes.textContent = "Updating...";
  }

  if (mode === "installing") {
    el.title.textContent = `Installing ${version}`;
    el.text.textContent = "The launcher will close and start again in a moment.";
    el.question.classList.add("hidden");
    el.progress.classList.remove("hidden");
    el.bar.style.width = "100%";
    el.progressText.textContent = "Download complete. Installing...";
    el.yes.disabled = true;
    el.no.classList.add("hidden");
    el.yes.textContent = "Restarting...";
  }
}

function showLauncherUpdatePrompt(mode, info) {
  const el = launcherUpdateEls();
  if (!el.backdrop) return;

  launcherUpdatePrompt.open = true;
  setLauncherUpdateMode(mode, info);
  el.backdrop.classList.remove("hidden");
  el.yes.focus();
}

function closeLauncherUpdatePrompt() {
  launcherUpdatePrompt.open = false;
  launcherUpdateEls().backdrop?.classList.add("hidden");
}

async function installLauncherUpdateNow() {
  setLauncherUpdateMode("installing");
  appendConsole(`[launcher updater] Installing ${launcherUpdatePrompt.version} and restarting.`);

  setTimeout(() => {
    window.launcherAPI.updater.install();
  }, 1100);
}

function handleLauncherUpdateStatus(data) {
  const type = data?.type;

  if (type === "checking" || type === "manual-check-started") return;

  if (type === "available") {
    const version = data.info?.version || "";
    const ask = launcherUpdatePrompt.manual || version !== launcherUpdatePrompt.dismissedVersion;

    launcherUpdatePrompt.manual = false;

    if (ask && !(launcherUpdatePrompt.open && launcherUpdatePrompt.mode !== "ask")) {
      showLauncherUpdatePrompt("ask", data.info || {});
    }

    return;
  }

  if (type === "download-progress") {
    if (!launcherUpdatePrompt.open || launcherUpdatePrompt.mode !== "downloading") return;

    const el = launcherUpdateEls();
    const progress = data.progress || {};
    const percent = Math.max(0, Math.min(100, Math.round(progress.percent || 0)));

    el.bar.style.width = `${percent}%`;
    el.progressText.textContent = progress.total
      ? `${formatMegabytes(progress.transferred)} of ${formatMegabytes(progress.total)} (${percent}%)`
      : `${percent}%`;
    return;
  }

  if (type === "downloaded") {
    launcherUpdatePrompt.manual = false;

    if (launcherUpdatePrompt.open && launcherUpdatePrompt.mode === "downloading") {
      installLauncherUpdateNow();
      return;
    }

    if (
      data.info?.version !== launcherUpdatePrompt.dismissedVersion ||
      launcherUpdatePrompt.manual
    ) {
      showLauncherUpdatePrompt("ready", data.info || {});
    }

    return;
  }

  if (
    type === "error" &&
    launcherUpdatePrompt.open &&
    launcherUpdatePrompt.mode === "downloading"
  ) {
    const el = launcherUpdateEls();

    setLauncherUpdateMode("ask");
    el.title.textContent = "Update failed";
    el.question.textContent = "Try again?";
    el.yes.textContent = "Try again";
    el.no.textContent = "Close";
    el.error.textContent = friendlyErrorMessage(
      data.message,
      "The update could not be downloaded."
    );
    el.error.classList.remove("hidden");
    return;
  }

  if (type === "not-available" || type === "error" || type === "disabled" || type === "dev-mode") {
    launcherUpdatePrompt.manual = false;
  }
}

function initLauncherUpdatePrompt() {
  const el = launcherUpdateEls();

  el.no?.addEventListener("click", () => {
    launcherUpdatePrompt.dismissedVersion = launcherUpdatePrompt.version;
    closeLauncherUpdatePrompt();
    setStatus("Update skipped. Use Check for updates in Settings when you want it.");
  });

  el.yes?.addEventListener("click", async () => {
    if (launcherUpdatePrompt.mode === "ready") {
      installLauncherUpdateNow();
      return;
    }

    setLauncherUpdateMode("downloading");
    appendConsole(`[launcher updater] Downloading ${launcherUpdatePrompt.version}...`);

    const result = await window.launcherAPI.updater.download();

    if (result && result.ok === false && launcherUpdatePrompt.mode === "downloading") {
      handleLauncherUpdateStatus({ type: "error", message: result.error });
    }
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (!launcherUpdatePrompt.open || event.key !== "Escape") return;
      if (launcherUpdatePrompt.mode === "downloading" || launcherUpdatePrompt.mode === "installing")
        return;

      event.stopPropagation();
      el.no?.click();
    },
    true
  );
}

const modrinthBrowser = {
  mode: "mods",
  open: false,
  profileId: "",
  query: "",
  sort: "relevance",
  offset: 0,
  limit: 20,
  total: 0,
  requestId: 0,
  searchTimer: null,
  installing: new Set(),
  changed: false,
};

function formatCompactNumber(value) {
  const number = Number(value) || 0;
  if (number >= 1e9) return `${(number / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (number >= 1e6) return `${(number / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (number >= 1e3) return `${(number / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return String(number);
}

function setModrinthStatus(text, isError = false) {
  const status = $("#modrinthStatus");
  if (!status) return;
  status.textContent = text || "";
  status.classList.toggle("error", Boolean(isError));
}

function updateModrinthPager() {
  const prev = $("#modrinthPrevBtn");
  const next = $("#modrinthNextBtn");
  const label = $("#modrinthPageLabel");
  const pages = Math.max(1, Math.ceil(modrinthBrowser.total / modrinthBrowser.limit));
  const page = Math.floor(modrinthBrowser.offset / modrinthBrowser.limit) + 1;

  if (prev) prev.disabled = modrinthBrowser.offset <= 0;
  if (next) next.disabled = modrinthBrowser.offset + modrinthBrowser.limit >= modrinthBrowser.total;
  if (label) label.textContent = modrinthBrowser.total ? `Page ${page} of ${pages}` : "";
}

function setModrinthResultState(row, mode, text) {
  const button = row.querySelector(".modrinth-install-btn");
  const bar = row.querySelector(".modrinth-install-bar");
  const fill = bar?.querySelector("span");

  row.classList.toggle("installed", mode === "installed");
  row.classList.toggle("failed", mode === "failed");

  if (button) {
    button.disabled = mode === "installing" || mode === "installed";
    button.textContent =
      text ||
      (mode === "installing"
        ? "Installing..."
        : mode === "installed"
          ? "Installed"
          : mode === "failed"
            ? "Retry"
            : "Install");
  }

  if (bar) bar.classList.toggle("hidden", mode !== "installing" && mode !== "finishing");
  if (fill && mode === "idle") fill.style.width = "0%";
}

const MODRINTH_BLANK_ICON =
  "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

function setModrinthIcon(img, url) {
  if (!img) return;
  img.onerror = () => {
    img.onerror = null;
    img.src = MODRINTH_BLANK_ICON;
  };
  img.src = url && /^https:\/\/cdn\.modrinth\.com\//.test(url) ? url : MODRINTH_BLANK_ICON;
}

function askModrinthDependencies(hit, plan) {
  return new Promise((resolve) => {
    const backdrop = $("#modrinthDepsBackdrop");
    const list = $("#modrinthDepsList");
    const template = $("#modrinthDepRowTemplate");
    const installBtn = $("#modrinthDepsInstallBtn");
    const cancelBtn = $("#modrinthDepsCancelBtn");
    const note = $("#modrinthDepsNote");

    if (!backdrop || !list || !template || !installBtn || !cancelBtn) {
      resolve(null);
      return;
    }

    $("#modrinthDepsTitle").textContent = `Install ${hit.title}`;
    $("#modrinthDepsText").textContent =
      plan.dependencies.length === 1
        ? `${hit.title} needs 1 other mod. Tick it to install it too.`
        : `${hit.title} needs ${plan.dependencies.length} other mods. Tick the ones you want to install too.`;

    const fragment = document.createDocumentFragment();

    for (const dependency of plan.dependencies) {
      const row = template.content.firstElementChild.cloneNode(true);
      const check = row.querySelector("input");
      const badge = row.querySelector('[data-field="badge"]');

      check.value = dependency.projectId;
      setModrinthIcon(row.querySelector(".modrinth-dep-icon"), dependency.iconUrl);
      row.querySelector('[data-field="title"]').textContent = dependency.title;

      const parts = [];
      if (dependency.requiredBy !== plan.projectId)
        parts.push(`needed by ${dependency.requiredByTitle}`);
      if (dependency.installed) parts.push(dependency.installed.filename);
      else if (dependency.versionNumber) parts.push(`v${dependency.versionNumber}`);
      row.querySelector('[data-field="sub"]').textContent = parts.join(" · ") || "Required";

      if (!dependency.compatible && !dependency.installed) {
        row.classList.add("unavailable");
        check.disabled = true;
        badge.textContent = `No ${plan.loader} ${plan.minecraftVersion} version`;
        badge.classList.add("missing");
      } else if (dependency.installed) {
        check.checked = false;
        badge.textContent = dependency.installed.enabled ? "Installed" : "Installed (off)";
        badge.classList.add("installed");
      } else {
        check.checked = true;
      }

      fragment.appendChild(row);
    }

    list.replaceChildren(fragment);

    const updateButton = () => {
      const count = list.querySelectorAll("input:checked").length;
      installBtn.textContent = count ? `Install + ${count} required` : `Install ${hit.title} only`;

      const missing = plan.dependencies.filter((dependency) => {
        const box = list.querySelector(`input[value="${CSS.escape(dependency.projectId)}"]`);
        return !dependency.installed && !box?.checked;
      });

      note.textContent = missing.length
        ? `Without ${missing.map((dependency) => dependency.title).join(", ")}, ${hit.title} may not start.`
        : "";
    };

    list.addEventListener("change", updateButton);
    updateButton();

    const finish = (value) => {
      backdrop.classList.add("hidden");
      list.removeEventListener("change", updateButton);
      installBtn.removeEventListener("click", onInstall);
      cancelBtn.removeEventListener("click", onCancel);
      document.removeEventListener("keydown", onKey, true);
      modrinthBrowser.depsOpen = false;
      resolve(value);
    };

    const onInstall = () =>
      finish([...list.querySelectorAll("input:checked")].map((input) => input.value));
    const onCancel = () => finish(null);
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      onCancel();
    };

    installBtn.addEventListener("click", onInstall);
    cancelBtn.addEventListener("click", onCancel);
    document.addEventListener("keydown", onKey, true);

    modrinthBrowser.depsOpen = true;
    backdrop.classList.remove("hidden");
    installBtn.focus();
  });
}

async function installModrinthResult(row, hit) {
  const profileId = modrinthBrowser.profileId;
  if (!profileId || modrinthBrowser.installing.has(hit.projectId)) return;

  modrinthBrowser.installing.add(hit.projectId);
  setModrinthResultState(row, "installing", "Checking...");
  row.querySelector(".modrinth-install-bar")?.classList.add("hidden");

  let dependencies = [];

  try {
    const plan = await window.launcherAPI.mods.modrinthPlan(profileId, hit.projectId);

    if (!plan.compatible) {
      throw new Error(`${hit.title} has no version for ${plan.loader} ${plan.minecraftVersion}.`);
    }

    if (plan.dependencies.length) {
      const picked = await askModrinthDependencies(hit, plan);

      if (!picked) {
        modrinthBrowser.installing.delete(hit.projectId);
        setModrinthResultState(row, "idle");
        setModrinthStatus("");
        return;
      }

      dependencies = picked;
    }
  } catch (error) {
    modrinthBrowser.installing.delete(hit.projectId);
    setModrinthResultState(row, "failed");
    setModrinthStatus(friendlyErrorMessage(error) || `Failed to install ${hit.title}.`, true);
    return;
  }

  setModrinthResultState(row, "installing");

  const fill = row.querySelector(".modrinth-install-bar span");
  let progress = 0;
  if (fill) fill.style.width = "0%";

  const timer = setInterval(() => {
    progress = Math.min(90, progress + Math.max(1, (90 - progress) * 0.12));
    if (fill) fill.style.width = `${progress}%`;
  }, 160);

  try {
    const result = await window.launcherAPI.mods.installModrinth(profileId, hit.projectId, {
      dependencies,
    });
    clearInterval(timer);

    if (!result?.ok) {
      throw new Error(result?.error || "Install failed.");
    }

    modrinthBrowser.changed = true;

    if (fill) fill.style.width = "100%";
    setModrinthResultState(row, "finishing", "Installing...");

    const extra = Math.max(0, (result.stats?.downloaded || 0) - 1);
    const depFailures = (result.failedMods || []).filter((id) => id !== hit.projectId).length;

    setModrinthStatus(
      `Installed ${hit.title}${extra ? ` + ${extra} required ${extra === 1 ? "mod" : "mods"}` : ""}.${
        depFailures
          ? ` ${depFailures} required mod${depFailures === 1 ? "" : "s"} failed, see Console.`
          : ""
      }`,
      depFailures > 0
    );

    if (Array.isArray(result.logs)) {
      result.logs.forEach((line) => appendConsole(`[modrinth] ${line}`));
    }

    for (const id of dependencies) {
      const other = $(`#modrinthResults .modrinth-result[data-project="${CSS.escape(id)}"]`);
      if (other && !(result.failedMods || []).includes(id))
        setModrinthResultState(other, "installed");
    }

    await new Promise((resolve) => setTimeout(resolve, 650));
    setModrinthResultState(row, "installed");
  } catch (error) {
    clearInterval(timer);
    setModrinthResultState(row, "failed");
    setModrinthStatus(friendlyErrorMessage(error) || `Failed to install ${hit.title}.`, true);
  } finally {
    modrinthBrowser.installing.delete(hit.projectId);
  }
}

function renderModrinthResults(hits) {
  const root = $("#modrinthResults");
  const template = $("#modrinthResultTemplate");
  if (!root || !template) return;

  const fragment = document.createDocumentFragment();

  for (const hit of hits) {
    const row = template.content.firstElementChild.cloneNode(true);
    const icon = row.querySelector(".modrinth-icon");

    row.dataset.project = hit.projectId;
    setModrinthIcon(icon, hit.iconUrl);

    row.querySelector('[data-field="title"]').textContent = hit.title;
    row.querySelector('[data-field="author"]').textContent = hit.author ? `by ${hit.author}` : "";
    row.querySelector('[data-field="description"]').textContent = hit.description;
    row.querySelector('[data-field="downloads"]').textContent =
      `${formatCompactNumber(hit.downloads)} downloads`;
    row.querySelector('[data-field="categories"]').textContent = (hit.categories || [])
      .slice(0, 4)
      .join(", ");

    if (modrinthBrowser.mode === "modpacks") {
      const versions = (hit.gameVersions || []).filter((version) => /^\d/.test(version));
      const newest = versions[versions.length - 1];
      if (newest) {
        row.querySelector('[data-field="categories"]').textContent = [
          `MC ${newest}`,
          ...(hit.categories || []).slice(0, 3),
        ].join(", ");
      }
      setModrinthResultState(row, "idle", "Install");
      row
        .querySelector(".modrinth-install-btn")
        .addEventListener("click", () => openModpackInstall(hit));
      fragment.appendChild(row);
      continue;
    }

    if (modrinthBrowser.installing.has(hit.projectId)) {
      setModrinthResultState(row, "installing");
    } else if (hit.installed) {
      setModrinthResultState(
        row,
        "installed",
        hit.installedEnabled ? "Installed" : "Installed (off)"
      );
    } else {
      setModrinthResultState(row, "idle");
    }

    row.querySelector(".modrinth-install-btn").addEventListener("click", () => {
      installModrinthResult(row, hit);
    });

    fragment.appendChild(row);
  }

  root.replaceChildren(fragment);
  root.scrollTop = 0;
}

async function searchModrinthMods() {
  const requestId = ++modrinthBrowser.requestId;
  const root = $("#modrinthResults");

  setModrinthStatus("Searching Modrinth...");

  try {
    const searchOptions = {
      query: modrinthBrowser.query,
      sort: modrinthBrowser.sort,
      offset: modrinthBrowser.offset,
      limit: modrinthBrowser.limit,
    };

    const isModpacks = modrinthBrowser.mode === "modpacks";
    const result = isModpacks
      ? await window.launcherAPI.modpacks.search(searchOptions)
      : await window.launcherAPI.mods.searchModrinth(modrinthBrowser.profileId, searchOptions);

    if (requestId !== modrinthBrowser.requestId || !modrinthBrowser.open) return;

    modrinthBrowser.total = result.total || 0;

    const target = $("#modrinthTarget");
    if (target && !isModpacks)
      target.textContent = `Minecraft ${result.minecraftVersion} · ${result.loader}`;

    renderModrinthResults(result.hits || []);
    updateModrinthPager();

    if (!result.hits?.length) {
      const noun = isModpacks ? "modpacks" : "mods";
      setModrinthStatus(
        modrinthBrowser.query
          ? `No ${noun} found for "${modrinthBrowser.query}".`
          : `No compatible ${noun} found.`
      );
    } else {
      setModrinthStatus(
        isModpacks
          ? `${formatCompactNumber(modrinthBrowser.total)} modpacks`
          : `${formatCompactNumber(modrinthBrowser.total)} compatible mods`
      );
    }
  } catch (error) {
    if (requestId !== modrinthBrowser.requestId) return;

    if (root) root.replaceChildren();
    modrinthBrowser.total = 0;
    updateModrinthPager();
    setModrinthStatus(friendlyErrorMessage(error) || "Could not reach Modrinth.", true);
  }
}

function showModrinthBrowser(mode) {
  modrinthBrowser.mode = mode;
  modrinthBrowser.open = true;
  modrinthBrowser.offset = 0;
  modrinthBrowser.total = 0;
  modrinthBrowser.changed = false;

  const isModpacks = mode === "modpacks";
  const title = $("#modrinthTitle");
  if (title) title.textContent = isModpacks ? "Modrinth Modpacks" : "Modrinth";

  $("#modrinthImportFileBtn")?.classList.toggle("hidden", !isModpacks);

  const input = $("#modrinthSearchInput");
  if (input) {
    input.placeholder = isModpacks ? "Search modpacks..." : "Search mods...";
    input.value = modrinthBrowser.query;
    setTimeout(() => input.focus(), 30);
  }

  $("#modrinthResults")?.replaceChildren();
  $("#modrinthBackdrop")?.classList.remove("hidden");

  searchModrinthMods();
}

function openModrinthBrowser() {
  const profile = getEditorProfile();

  if (!profile) {
    showAlert("Open an installation first.");
    return;
  }

  const loader = String(profile.loaderType || "").toLowerCase();

  if (!loader || loader === "vanilla") {
    showAlert(
      "Modrinth mods need a mod loader. Switch this installation to Fabric, Forge, Quilt or NeoForge first.",
      {
        title: "Mod loader required",
      }
    );
    return;
  }

  modrinthBrowser.profileId = profile.id;

  const target = $("#modrinthTarget");
  if (target)
    target.textContent = `${profile.name} · Minecraft ${profile.minecraftVersion} · ${loader}`;

  if (modrinthBrowser.mode !== "mods") modrinthBrowser.query = "";
  showModrinthBrowser("mods");
}

function openModpackBrowser() {
  modrinthBrowser.profileId = "";

  const target = $("#modrinthTarget");
  if (target)
    target.textContent = "Pick a modpack. It becomes a new installation with its loader and mods.";

  if (modrinthBrowser.mode !== "modpacks") modrinthBrowser.query = "";
  showModrinthBrowser("modpacks");
}

async function closeModrinthBrowser() {
  if (!modrinthBrowser.open) return;

  modrinthBrowser.open = false;
  modrinthBrowser.requestId += 1;
  clearTimeout(modrinthBrowser.searchTimer);
  $("#modrinthBackdrop")?.classList.add("hidden");

  if (
    modrinthBrowser.mode === "mods" &&
    (modrinthBrowser.changed || modrinthBrowser.installing.size)
  ) {
    await renderEditorMods();
  }
}

function initModrinthBrowser() {
  $("#browseModrinthBtn")?.addEventListener("click", () => openModrinthBrowser());
  $("#newModpackBtn")?.addEventListener("click", () => openModpackBrowser());
  $("#modrinthImportFileBtn")?.addEventListener("click", async () => {
    const filePath = await window.launcherAPI.modpacks.pickFile();
    if (filePath) openModpackInstall(null, filePath);
  });
  $("#modrinthCloseBtn")?.addEventListener("click", closeModrinthBrowser);

  $("#modrinthBackdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeModrinthBrowser();
  });

  $("#modrinthSearchInput")?.addEventListener("input", (event) => {
    modrinthBrowser.query = event.target.value.trim();
    modrinthBrowser.offset = 0;
    clearTimeout(modrinthBrowser.searchTimer);
    modrinthBrowser.searchTimer = setTimeout(searchModrinthMods, 350);
  });

  $("#modrinthSearchInput")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    clearTimeout(modrinthBrowser.searchTimer);
    modrinthBrowser.query = event.target.value.trim();
    modrinthBrowser.offset = 0;
    searchModrinthMods();
  });

  $("#modrinthSortSelect")?.addEventListener("change", (event) => {
    modrinthBrowser.sort = event.target.value;
    modrinthBrowser.offset = 0;
    searchModrinthMods();
  });

  $("#modrinthPrevBtn")?.addEventListener("click", () => {
    modrinthBrowser.offset = Math.max(0, modrinthBrowser.offset - modrinthBrowser.limit);
    searchModrinthMods();
  });

  $("#modrinthNextBtn")?.addEventListener("click", () => {
    modrinthBrowser.offset += modrinthBrowser.limit;
    searchModrinthMods();
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        !modrinthBrowser.open ||
        modrinthBrowser.depsOpen ||
        modpackInstall.open ||
        event.key !== "Escape"
      )
        return;
      if (!$("#appDialogBackdrop")?.classList.contains("hidden")) return;
      if (mcSelectState.open) return;

      event.stopPropagation();
      closeModrinthBrowser();
    },
    true
  );
}

const modpackInstall = {
  open: false,
  busy: false,
  hit: null,
  filePath: "",
  versions: [],
  unsubscribe: null,
};

function modpackEls() {
  return {
    backdrop: $("#modpackInstallBackdrop"),
    title: $("#modpackInstallTitle"),
    text: $("#modpackInstallText"),
    versionField: $("#modpackVersionField"),
    versionSelect: $("#modpackVersionSelect"),
    name: $("#modpackNameInput"),
    progress: $("#modpackInstallProgress"),
    bar: $("#modpackInstallBar"),
    progressText: $("#modpackInstallProgressText"),
    error: $("#modpackInstallError"),
    cancel: $("#modpackInstallCancelBtn"),
    install: $("#modpackInstallBtn"),
  };
}

function setModpackError(text) {
  const el = modpackEls();
  el.error.textContent = text || "";
  el.error.classList.toggle("hidden", !text);
}

function setModpackBusy(busy) {
  const el = modpackEls();
  modpackInstall.busy = busy;
  el.install.disabled = busy;
  el.cancel.disabled = busy;
  el.name.disabled = busy;
  el.versionSelect.disabled = busy || !modpackInstall.versions.length;
  syncMcSelect(el.versionSelect);
  el.progress.classList.toggle("hidden", !busy && el.bar.style.width !== "100%");
}

function describeModpackVersion(version) {
  const mc = (version.gameVersions || []).join(", ");
  const loaders = (version.loaders || []).join(", ");
  const tag = version.type && version.type !== "release" ? ` (${version.type})` : "";
  return `${version.versionNumber || version.name}${tag} · MC ${mc}${loaders ? ` · ${loaders}` : ""}`;
}

async function openModpackInstall(hit, filePath = "") {
  const el = modpackEls();
  if (!el.backdrop) return;

  modpackInstall.open = true;
  modpackInstall.hit = hit;
  modpackInstall.filePath = filePath;
  modpackInstall.versions = [];

  el.title.textContent = hit ? `Install ${hit.title}` : "Import modpack file";
  el.text.textContent = hit
    ? "A new installation is made with the modpack's Minecraft version, mod loader, mods and configs."
    : `File: ${filePath.split(/[\\/]/).pop()}`;
  el.name.value = hit
    ? hit.title
    : filePath
        .split(/[\\/]/)
        .pop()
        .replace(/\.mrpack$/i, "");
  el.bar.style.width = "0%";
  el.progressText.textContent = "";
  el.progress.classList.add("hidden");
  el.install.textContent = "Install";
  setModpackError("");

  el.versionField.classList.toggle("hidden", !hit);
  el.versionSelect.replaceChildren();

  el.backdrop.classList.remove("hidden");
  setModpackBusy(false);

  if (!hit) {
    el.install.focus();
    return;
  }

  el.install.disabled = true;
  const loading = document.createElement("option");
  loading.textContent = "Loading versions...";
  el.versionSelect.appendChild(loading);
  syncMcSelect(el.versionSelect);

  try {
    const versions = await window.launcherAPI.modpacks.versions(hit.projectId);
    if (!modpackInstall.open || modpackInstall.hit !== hit) return;

    modpackInstall.versions = versions;
    el.versionSelect.replaceChildren();

    for (const version of versions) {
      const option = document.createElement("option");
      option.value = version.id;
      option.textContent = describeModpackVersion(version);
      el.versionSelect.appendChild(option);
    }

    if (!versions.length) {
      const none = document.createElement("option");
      none.textContent = "No installable versions";
      el.versionSelect.appendChild(none);
      setModpackError("This modpack has no .mrpack versions to install.");
    }

    syncMcSelect(el.versionSelect);
    setModpackBusy(false);
    el.install.disabled = !versions.length;
    el.install.focus();
  } catch (error) {
    setModpackError(friendlyErrorMessage(error, "Could not load versions."));
  }
}

function closeModpackInstall() {
  if (modpackInstall.busy) return;
  modpackInstall.open = false;
  modpackEls().backdrop?.classList.add("hidden");
}

async function runModpackInstall() {
  const el = modpackEls();
  if (modpackInstall.busy) return;

  const source = modpackInstall.hit
    ? { versionId: el.versionSelect.value, name: el.name.value.trim() }
    : { filePath: modpackInstall.filePath, name: el.name.value.trim() };

  if (modpackInstall.hit && !source.versionId) return;

  setModpackError("");
  el.bar.style.width = "0%";
  el.progress.classList.remove("hidden");
  el.progressText.textContent = "Starting...";
  setModpackBusy(true);

  const stageBase = { reading: 3, fetching: 5, loader: 12, files: 18, overrides: 94, done: 100 };

  const unsubscribe = window.launcherAPI.modpacks.onProgress?.((data) => {
    let percent = stageBase[data.stage] ?? 0;

    if (data.stage === "files" && data.total) {
      percent = 18 + Math.round((data.done / data.total) * 75);
    }

    if (data.stage !== "done") el.bar.style.width = `${Math.min(percent, 97)}%`;
    if (data.message) el.progressText.textContent = data.message;
  });

  try {
    const result = await window.launcherAPI.modpacks.install(source);

    el.bar.style.width = "100%";
    el.progressText.textContent = `Installed ${result.profile.name}: Minecraft ${result.minecraftVersion}, ${result.loaderType}${result.loaderVersion ? ` ${result.loaderVersion}` : ""}, ${result.files} files.`;
    appendConsole(`[modpack] ${el.progressText.textContent}`);

    await new Promise((resolve) => setTimeout(resolve, 900));

    modpackInstall.busy = false;
    closeModpackInstall();
    await closeModrinthBrowser();

    await loadProfiles();
    await selectProfile(result.profile.id);
    showPage("installations");
    setStatus(`Modpack installed: ${result.profile.name}`);
  } catch (error) {
    el.bar.style.width = "0%";
    el.progress.classList.add("hidden");
    setModpackBusy(false);
    el.install.textContent = "Try again";
    setModpackError(friendlyErrorMessage(error, "The modpack could not be installed."));
  } finally {
    unsubscribe?.();
  }
}

function initModpackInstall() {
  const el = modpackEls();
  if (!el.backdrop) return;

  el.cancel.addEventListener("click", closeModpackInstall);
  el.install.addEventListener("click", runModpackInstall);

  el.name.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runModpackInstall();
    }
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (!modpackInstall.open || event.key !== "Escape") return;
      if (mcSelectState.open) return;
      event.stopPropagation();
      closeModpackInstall();
    },
    true
  );
}

const shareUi = {
  open: false,
  profileId: "",
  requestId: 0,
};

async function generateShareCode() {
  const profileId = shareUi.profileId;
  const requestId = ++shareUi.requestId;
  const textarea = $("#shareCodeText");
  const summary = $("#shareSummary");
  const missing = $("#shareMissing");
  const error = $("#shareError");
  const copy = $("#shareCopyBtn");

  textarea.value = "Making the code... (mods are looked up on Modrinth)";
  summary.replaceChildren();
  missing.textContent = "";
  error.classList.add("hidden");
  copy.disabled = true;

  try {
    const result = await window.launcherAPI.share.exportProfile(profileId, {
      includeConfigs: $("#shareIncludeConfigs").checked,
    });

    if (requestId !== shareUi.requestId || !shareUi.open) return;

    textarea.value = result.code;
    copy.disabled = false;

    const info = result.summary;
    const lines = [
      `Minecraft ${info.minecraftVersion} · ${info.loaderType}${info.loaderVersion ? ` ${info.loaderVersion}` : ""} · memory ${info.memory}`,
      `${info.modrinthMods} of ${info.mods} mods will be downloaded from Modrinth${info.disabledMods ? ` (${info.disabledMods} disabled)` : ""}`,
      info.hasOptions
        ? "Game options (video, controls, sound) included"
        : "No options.txt yet (start the game once to make one)",
      `${info.configFiles} config file${info.configFiles === 1 ? "" : "s"}${info.configSkipped ? ` (${info.configSkipped} too big or binary, skipped)` : ""}`,
      `Code length: ${info.length.toLocaleString()} characters`,
    ];

    summary.replaceChildren(
      ...lines.map((line) => {
        const item = document.createElement("li");
        item.textContent = line;
        return item;
      })
    );

    if (info.missingMods.length) {
      missing.textContent = `Not on Modrinth, send these yourself: ${info.missingMods.join(", ")}`;
    }
  } catch (caught) {
    if (requestId !== shareUi.requestId) return;
    textarea.value = "";
    error.textContent = friendlyErrorMessage(caught, "Could not make the share code.");
    error.classList.remove("hidden");
  }
}

function openShareDialog() {
  const profile = getEditorProfile();

  if (!profile) {
    showAlert("Open an installation first.");
    return;
  }

  shareUi.open = true;
  shareUi.profileId = profile.id;
  $("#shareTitle").textContent = `Share ${profile.name}`;
  $("#shareCopyBtn").textContent = "Copy code";
  $("#shareBackdrop").classList.remove("hidden");

  generateShareCode();
}

function closeShareDialog() {
  shareUi.open = false;
  shareUi.requestId += 1;
  $("#shareBackdrop")?.classList.add("hidden");
}

async function copyShareCode() {
  const textarea = $("#shareCodeText");
  const button = $("#shareCopyBtn");
  if (!textarea.value) return;

  try {
    await navigator.clipboard.writeText(textarea.value);
  } catch {
    textarea.select();
    document.execCommand("copy");
  }

  button.textContent = "Copied!";
  setTimeout(() => {
    if (shareUi.open) button.textContent = "Copy code";
  }, 1600);
}

const importShareUi = {
  open: false,
  busy: false,
  timer: null,
  requestId: 0,
  valid: false,
};

function importShareEls() {
  return {
    backdrop: $("#importShareBackdrop"),
    text: $("#importShareText"),
    summary: $("#importShareSummary"),
    nameField: $("#importShareNameField"),
    name: $("#importShareName"),
    progress: $("#importShareProgress"),
    bar: $("#importShareBar"),
    progressText: $("#importShareProgressText"),
    note: $("#importShareNote"),
    error: $("#importShareError"),
    cancel: $("#importShareCancelBtn"),
    import: $("#importShareBtn"),
  };
}

function setImportShareError(text) {
  const el = importShareEls();
  el.error.textContent = text || "";
  el.error.classList.toggle("hidden", !text);
}

async function previewImportCode() {
  const el = importShareEls();
  const code = el.text.value.trim();
  const requestId = ++importShareUi.requestId;

  importShareUi.valid = false;
  el.import.disabled = true;
  el.summary.replaceChildren();
  el.note.textContent = "";
  setImportShareError("");

  if (!code) {
    el.nameField.classList.add("hidden");
    return;
  }

  try {
    const info = await window.launcherAPI.share.preview(code);
    if (requestId !== importShareUi.requestId) return;

    const lines = [
      `${info.name}: Minecraft ${info.minecraftVersion} · ${info.loaderType}${info.loaderVersion ? ` ${info.loaderVersion}` : ""}`,
      `${info.modrinthMods} mods to download from Modrinth${info.disabledMods ? ` (${info.disabledMods} disabled)` : ""}`,
      `Memory ${info.memory}${info.hasOptions ? " · game options included" : ""}${info.configFiles ? ` · ${info.configFiles} config files` : ""}`,
    ];

    el.summary.replaceChildren(
      ...lines.map((line) => {
        const item = document.createElement("li");
        item.textContent = line;
        return item;
      })
    );

    if (info.missingMods.length) {
      el.note.textContent = `Not included (not on Modrinth): ${info.missingMods.join(", ")}`;
    }

    if (!el.name.value || el.name.dataset.auto === "true") {
      el.name.value = info.name;
      el.name.dataset.auto = "true";
    }

    el.nameField.classList.remove("hidden");
    importShareUi.valid = true;
    el.import.disabled = importShareUi.busy;
  } catch (error) {
    if (requestId !== importShareUi.requestId) return;
    el.nameField.classList.add("hidden");
    setImportShareError(friendlyErrorMessage(error, "That code could not be read."));
  }
}

function openImportShare() {
  const el = importShareEls();
  if (!el.backdrop) return;

  importShareUi.open = true;
  importShareUi.valid = false;
  el.text.value = "";
  el.name.value = "";
  el.name.dataset.auto = "true";
  el.summary.replaceChildren();
  el.note.textContent = "";
  el.nameField.classList.add("hidden");
  el.progress.classList.add("hidden");
  el.bar.style.width = "0%";
  el.import.disabled = true;
  el.import.textContent = "Import";
  setImportShareError("");

  el.backdrop.classList.remove("hidden");
  setTimeout(() => el.text.focus(), 30);
}

function closeImportShare() {
  if (importShareUi.busy) return;
  importShareUi.open = false;
  importShareUi.requestId += 1;
  importShareEls().backdrop?.classList.add("hidden");
}

async function runImportShare() {
  const el = importShareEls();
  if (importShareUi.busy || !importShareUi.valid) return;

  importShareUi.busy = true;
  el.import.disabled = true;
  el.cancel.disabled = true;
  el.text.disabled = true;
  el.name.disabled = true;
  setImportShareError("");
  el.progress.classList.remove("hidden");
  el.bar.style.width = "3%";
  el.progressText.textContent = "Starting...";

  const unsubscribe = window.launcherAPI.share.onProgress?.((data) => {
    let percent = { loader: 8, mods: 15, files: 95 }[data.stage] ?? null;
    if (data.stage === "mods" && data.total)
      percent = 15 + Math.round((data.done / data.total) * 78);
    if (percent !== null) el.bar.style.width = `${Math.min(percent, 97)}%`;
    if (data.message) el.progressText.textContent = data.message;
  });

  const finishUi = () => {
    importShareUi.busy = false;
    el.cancel.disabled = false;
    el.text.disabled = false;
    el.name.disabled = false;
  };

  try {
    const result = await window.launcherAPI.share.importCode(el.text.value.trim(), {
      name: el.name.value.trim(),
    });

    el.bar.style.width = "100%";
    el.progressText.textContent = `Imported ${result.profile.name} with ${result.downloaded} mods.`;
    result.failed.forEach((line) => appendConsole(`[share] ${line}`));

    await new Promise((resolve) => setTimeout(resolve, 900));

    finishUi();
    closeImportShare();

    await loadProfiles();
    await selectProfile(result.profile.id);
    showPage("installations");

    const problems = [];
    if (result.failed.length)
      problems.push(
        `${result.failed.length} mod${result.failed.length === 1 ? "" : "s"} could not be downloaded (see Console).`
      );
    if (result.missingMods.length)
      problems.push(`Not on Modrinth, get these yourself:\n${result.missingMods.join("\n")}`);

    if (problems.length) {
      showAlert(`${result.profile.name} was imported.\n\n${problems.join("\n\n")}`, {
        title: "Imported with notes",
      });
    } else {
      setStatus(`Imported ${result.profile.name}.`);
    }
  } catch (error) {
    finishUi();
    el.bar.style.width = "0%";
    el.progress.classList.add("hidden");
    el.import.disabled = false;
    el.import.textContent = "Try again";
    setImportShareError(friendlyErrorMessage(error, "The installation could not be imported."));
  } finally {
    unsubscribe?.();
  }
}

function initShareFeatures() {
  $("#shareInstallationBtn")?.addEventListener("click", openShareDialog);
  $("#shareCloseBtn")?.addEventListener("click", closeShareDialog);
  $("#shareCopyBtn")?.addEventListener("click", copyShareCode);
  $("#shareIncludeConfigs")?.addEventListener("change", generateShareCode);
  $("#shareCodeText")?.addEventListener("focus", (event) => event.target.select());

  $("#importShareCodeBtn")?.addEventListener("click", openImportShare);
  $("#importShareCancelBtn")?.addEventListener("click", closeImportShare);
  $("#importShareBtn")?.addEventListener("click", runImportShare);

  $("#importShareText")?.addEventListener("input", () => {
    clearTimeout(importShareUi.timer);
    importShareUi.timer = setTimeout(previewImportCode, 250);
  });

  $("#importShareName")?.addEventListener("input", (event) => {
    event.target.dataset.auto = "false";
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;

      if (shareUi.open) {
        event.stopPropagation();
        closeShareDialog();
      } else if (importShareUi.open) {
        event.stopPropagation();
        closeImportShare();
      }
    },
    true
  );
}

async function checkLauncherUpdateManually() {
  launcherUpdatePrompt.manual = true;
  return window.launcherAPI.updater.check();
}

async function boot() {
  initSimpleMode();
  initMcSelects();
  await loadSystemMemoryInfo();
  await initEvents();
  await loadAccount();
  await loadProfiles();

  initHomeWidgets();
  initAccountSwitcher();
  initLauncherUpdatePrompt();
  initModrinthBrowser();
  initModpackInstall();
  initShareFeatures();
  initJavaInstallProgress();
  initDataFolderSetting();
  await initSharedFoldersSetting();
  await initUpdateSettings();
  initDeveloperScreen();
  initOnboardingEvents();

  if (!isOnboardingComplete()) {
    openOnboarding();
  } else if (state.account?.username) {
    playWelcomeBackWhenReady(state.account);
  }

  await loadDiscordStatus();
  await loadEditorVersionData();

  loadJavaInstallations();

  try {
    syncConsoleInstances(await window.launcherAPI.launcher.listInstances());
  } catch {
    renderConsoleInstanceSelect();
  }

  setInterval(loadServerStatuses, 60000);
  await checkDefaultClientInfoManually();
  setStatus("Ready.");
  appendConsole("[launcher] Renderer loaded.");
}

boot().catch((error) => {
  console.error(error);
  setStatus(error.message || "Launcher failed to start.");
  showError(error.message || "Launcher failed to start.");
});
