const DEFAULT_PLAYER_HEAD = "./static/img/default_logged_out_head.png";
const INSTALLATION_ICON_BASE_PATH = "./static/img/installation-icons/";
const DEFAULT_STEVE_SKIN = "./static/img/steve.png";

const MAX_CONSOLE_LINES = 1200;
const DEFAULT_MEMORY_TOTAL_GB = 8;

let detectedTotalMemoryGb = DEFAULT_MEMORY_TOTAL_GB;
let launchProgressTimer = null;
let clientUpdateProgressValue = 0;
let playerHeadRefreshToken = Date.now();
let wrongJavaVersionCrashDetected = false;

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
  "#b54838"
];

const LAUNCHER_SETTING_KEYS = {
  keepLauncherOpenOnLaunch: "launcher.keepLauncherOpenOnLaunch",
  openConsoleOnLaunch: "launcher.openConsoleOnLaunch"
};

const DEFAULT_INSTALLATION_ICONS = [
  { id: "grass", label: "Grass" },
  { id: "dirt", label: "Dirt" },
  { id: "stone", label: "Stone" },
  { id: "diamond", label: "Diamond" },
  { id: "crafting", label: "Crafting Table" },
  { id: "furnace", label: "Furnace" }
];

let consoleLines = [];
let pendingConsoleLines = [];
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
  installationBackdropMouseDownOnBackdrop: false,
  installationEditor: {
    profileId: null,
    tab: "settings"
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
    animationFrame: null
  }
};

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

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
    openConsoleOnLaunch: readBooleanSetting(
      LAUNCHER_SETTING_KEYS.openConsoleOnLaunch,
      false
    )
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
    writeBooleanSetting(
      LAUNCHER_SETTING_KEYS.keepLauncherOpenOnLaunch,
      keepOpen.checked
    );
  }

  if (openConsole) {
    writeBooleanSetting(
      LAUNCHER_SETTING_KEYS.openConsoleOnLaunch,
      openConsole.checked
    );
  }

  setStatus("Launcher settings saved.");
  appendConsole("[settings] Saved launcher settings.");
}

function initLauncherSettingsEvents() {
  const keepOpen = $("#settingKeepLauncherOpenOnLaunch");
  if (keepOpen) {
    keepOpen.addEventListener("change", () => {
      writeBooleanSetting(
        LAUNCHER_SETTING_KEYS.keepLauncherOpenOnLaunch,
        keepOpen.checked
      );
    });
  }

  const openConsole = $("#settingOpenConsoleOnLaunch");
  if (openConsole) {
    openConsole.addEventListener("change", () => {
      writeBooleanSetting(
        LAUNCHER_SETTING_KEYS.openConsoleOnLaunch,
        openConsole.checked
      );
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

  if (account && account.uuid) {
    const uuid = encodeURIComponent(String(account.uuid));

    head.src =
      `https://api.mineatar.io/face/${uuid}` +
      `?scale=4&overlay=true&format=png&refresh=${playerHeadRefreshToken}`;

    head.onerror = () => {
      head.onerror = null;
      head.src = DEFAULT_PLAYER_HEAD;
    };

    return;
  }

  head.src = DEFAULT_PLAYER_HEAD;
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
function renderConsole() {
  consoleRenderScheduled = false;

  if (pendingConsoleLines.length > 0) {
    consoleLines.push(...pendingConsoleLines);
    pendingConsoleLines = [];

    if (consoleLines.length > MAX_CONSOLE_LINES) {
      consoleLines = consoleLines.slice(consoleLines.length - MAX_CONSOLE_LINES);
    }
  }

  const output = $("#consoleOutput");
  if (!output) return;

  output.textContent = consoleLines.join("\n") + (consoleLines.length > 0 ? "\n" : "");
  output.scrollTop = output.scrollHeight;
}

function scheduleConsoleRender() {
  if (consoleRenderScheduled) return;

  consoleRenderScheduled = true;

  requestAnimationFrame(() => {
    renderConsole();
  });
}

function appendConsole(line) {
  pendingConsoleLines.push(String(line ?? ""));

  if (pendingConsoleLines.length > 200) {
    renderConsole();
    return;
  }

  scheduleConsoleRender();
}

function refreshConsole() {
  renderConsole();
}

function clearConsole() {
  consoleLines = [];
  pendingConsoleLines = [];

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
  $$(".home-subpage").forEach(page => {
    page.classList.toggle("active", page.dataset.homePage === name);
  });

  $$(".home-top-btn").forEach(button => {
    button.classList.toggle("active", button.dataset.homeTab === name);
  });

  closeProfileDropup();

  if (name === "skin") {
    loadSkinPageData();
  }
}

function initHomeTabs() {
  $$(".home-top-btn").forEach(button => {
    button.addEventListener("click", () => {
      showHomeTab(button.dataset.homeTab);
    });
  });
}

function showPage(name) {
  state.currentPage = name;

  $$(".page").forEach(page => page.classList.remove("active"));

  const page = $(`#page-${name}`);
  if (page) page.classList.add("active");

  $$(".nav-btn").forEach(button => {
    button.classList.toggle("active", button.dataset.page === name);
  });

  closeProfileDropup();

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
  return state.profilesData?.profiles.find(profile => profile.id === id) || null;
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
  const found = DEFAULT_INSTALLATION_ICONS.find(icon => icon.id === value);
  return found ? found.id : "grass";
}

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
      accountSubtext.textContent = "Logged in";
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
      includeSnapshots: true
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
  await Promise.all([
    loadInstalledVersions(),
    loadMinecraftVersions()
  ]);

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
    button.textContent = profile.name;

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

function renderProfilesList() {
  const root = $("#installations-list");
  if (!root || !state.profilesData) return;

  root.innerHTML = "";

  for (const profile of state.profilesData.profiles) {
    const selected = profile.id === selectedProfileId();

    const card = document.createElement("div");
    card.className = "installations-cubed mcsection";

    if (selected) {
      card.classList.add("selected");
    }

    card.innerHTML = `
      ${renderInstallationIconHtml(profile)}

      <div class="installation-info">
        <span class="whitetext mct installation-name">${escapeHtml(profile.name)}</span>
        <span class="whitetext mcr installation-version">
          ${escapeHtml(profile.loaderType)}
          · ${escapeHtml(profile.customVersionId || profile.minecraftVersion)}
        </span>
        ${selected ? `<span class="installation-selected-badge mcr">Selected</span>` : ""}
      </div>

      <div class="installation-hover-panel">
        <button class="mcbtn installation-action-btn green" data-action="select" type="button">Select</button>
        <button class="mcbtn installation-action-btn" data-action="edit" type="button">Edit</button>
        <button class="mcbtn installation-action-btn danger" data-action="delete" type="button">Delete</button>
      </div>
    `;

    card.querySelector('[data-action="select"]').addEventListener("click", async event => {
      event.stopPropagation();
      await selectProfile(profile.id);
    });

    card.querySelector('[data-action="edit"]').addEventListener("click", event => {
      event.stopPropagation();
      openInstallationEditor(profile.id);
    });

    card.querySelector('[data-action="delete"]').addEventListener("click", async event => {
      event.stopPropagation();

      const profiles = state.profilesData?.profiles || [];

      if (profiles.length <= 1) {
        alert("You must keep at least one installation.");
        return;
      }

      const confirmed = confirm(
        `Delete installation "${profile.name}"?\n\nThis will also delete its game folder if no other installation uses it.`
      );

      if (!confirmed) return;

      try {
        const result = await window.launcherAPI.profiles.delete(profile.id);

        await loadProfiles();

        if (result?.folderDeleteError) {
          alert(
            `Installation deleted, but the folder could not be deleted:\n${result.folderDeleteError}`
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
        alert(error.message || "Failed to delete installation.");
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

  root.querySelectorAll("button[data-filename]").forEach(button => {
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
    "#settingMcArgs": profile.extraMcArgs || ""
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
    extraMcArgs: $("#settingMcArgs")?.value.trim() || ""
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

  detectedTotalMemoryGb = Math.max(
    1,
    Number(navigator.deviceMemory || DEFAULT_MEMORY_TOTAL_GB)
  );
}

function parseMemoryGb(value, fallbackGb) {
  const text = String(value || "").trim().toUpperCase();
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

  const minGb = Math.min(
    totalGb,
    parseMemoryGb(profile?.minMemory, 2)
  );

  const maxGb = Math.min(
    totalGb,
    Math.max(minGb, parseMemoryGb(profile?.maxMemory, 4))
  );

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
        ${DEFAULT_INSTALLATION_ICONS.map(icon => `<option value="${icon.id}">${escapeHtml(icon.label)}</option>`).join("")}
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

  $$(".editor-subpage").forEach(page => {
    page.classList.toggle("active", page.id === `editor-tab-${tab}`);
  });

  $$(".editor-tab-btn").forEach(button => {
    button.classList.toggle("active", button.dataset.editorTab === tab);
  });

  if (tab === "mods") {
    renderEditorMods();
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

    const dataUrl = profile?.customIconDataUrl && iconPathInput?.value === profile.iconPath
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
  return String(value || "vanilla").trim().toLowerCase() || "vanilla";
}

function getOfficialVersionInfo(versionId) {
  const id = String(versionId || "");
  return state.minecraftVersions.find(version => version.id === id) || null;
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

function addEditorVersionOption(select, {
  value,
  label,
  minecraftVersion,
  versionType = "release",
  loaderType = "vanilla",
  customVersionId = "",
  selected = false
}) {
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
    const versions = state.minecraftVersions.filter(version => {
      if (version.type === "release") return true;
      return showSnapshots && version.type === "snapshot";
    });

    for (const version of versions) {
      const selected =
        !currentCustomVersionId &&
        version.id === currentMinecraftVersion;

      hasSelectedOption = hasSelectedOption || selected;

      addEditorVersionOption(select, {
        value: version.id,
        label: version.type === "snapshot" ? `${version.id} (snapshot)` : version.id,
        minecraftVersion: version.id,
        versionType: version.type,
        loaderType: "vanilla",
        customVersionId: "",
        selected
      });
    }

    if (currentMinecraftVersion && !versions.some(version => version.id === currentMinecraftVersion)) {
      addEditorVersionOption(select, {
        value: currentMinecraftVersion,
        label: `${currentMinecraftVersion} (current / not in list)`,
        minecraftVersion: currentMinecraftVersion,
        versionType: $("#editorSettingVersionType")?.value || profile?.versionType || "release",
        loaderType: "vanilla",
        customVersionId: "",
        selected: true
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
        selected: true
      });

      hasSelectedOption = true;
    }
  } else {
    const versions = state.installedVersions.filter(version => {
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
        selected
      });
    }

    if (currentCustomVersionId && !versions.some(version => version.id === currentCustomVersionId)) {
      addEditorVersionOption(select, {
        value: currentCustomVersionId,
        label: `${currentMinecraftVersion} · ${currentCustomVersionId} (current / not in list)`,
        minecraftVersion: currentMinecraftVersion,
        versionType: $("#editorSettingVersionType")?.value || profile?.versionType || "release",
        loaderType: loader,
        customVersionId: currentCustomVersionId,
        selected: true
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
      customVersionId: selectedOption.dataset.customVersionId || ""
    };
  }

  return {
    minecraftVersion: select?.dataset.selectedMinecraftVersion || select?.value || getEditorProfile()?.minecraftVersion || "1.21.1",
    versionType: $("#editorSettingVersionType")?.value || getEditorProfile()?.versionType || "release",
    loaderType: getEditorSelectedLoader(),
    customVersionId: $("#editorSettingCustomVersionId")?.value.trim() || getEditorProfile()?.customVersionId || ""
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

  if (currentJavaPath && !state.javaInstallations.some(java => java.path === currentJavaPath)) {
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
    "#editorSettingIconPath": profile.iconPath || ""
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
    customVersionId: versionSelection.customVersionId || $("#editorSettingCustomVersionId")?.value.trim() || "",
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
    iconPath: $("#editorSettingIconPath")?.value.trim() || ""
  };
}

async function saveEditorSettings() {
  const profileId = state.installationEditor.profileId;
  if (!profileId) return;

  try {
    const updated = await window.launcherAPI.profiles.update(
      profileId,
      getEditorSettingsPatch()
    );

    await loadProfiles();
    await selectProfile(updated.id);

    state.installationEditor.profileId = updated.id;

    fillEditorSettings();
    renderEditorMods();

    setStatus("Installation saved.");
    appendConsole(`[profiles] Saved installation ${updated.name}.`);
  } catch (error) {
    alert(error.message || "Failed to save installation.");
  }
}

async function renderEditorMods() {
  const root = $("#editorModsList");
  const profileId = state.installationEditor.profileId;

  if (!root || !profileId) return;

  root.innerHTML = `<div class="whitetext mcr">Loading mods...</div>`;

  try {
    const mods = await window.launcherAPI.mods.list(profileId);

    root.innerHTML = "";

    if (!mods || mods.length === 0) {
      root.innerHTML = `<div class="whitetext mcr">No mods installed for this installation.</div>`;
      return;
    }

    for (const mod of mods) {
      const row = document.createElement("div");
      row.className = `editor-mod-row ${mod.enabled ? "" : "disabled"}`;

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

      row.querySelector('[data-action="toggle"]').addEventListener("click", async () => {
        try {
          await window.launcherAPI.mods.setEnabled(
            profileId,
            mod.filename,
            !mod.enabled
          );

          await renderEditorMods();
        } catch (error) {
          alert(error.message || "Failed to toggle mod.");
        }
      });

      row.querySelector('[data-action="remove"]').addEventListener("click", async () => {
        const confirmed = confirm(`Delete mod "${mod.displayName || mod.filename}"?`);
        if (!confirmed) return;

        try {
          await window.launcherAPI.mods.remove(profileId, mod.filename);
          await renderEditorMods();
        } catch (error) {
          alert(error.message || "Failed to delete mod.");
        }
      });

      root.appendChild(row);
    }
  } catch (error) {
    root.innerHTML = `<div class="whitetext mcr">Failed to load mods.</div>`;
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
    alert(error.message || "Failed to add mods.");
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
    `Failed: ${stats.failed ?? 0}`
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
    alert("Open an installation first.");
    return;
  }

  const collectionInput = input?.value.trim() || "";

  if (!collectionInput) {
    alert("Paste a Modrinth collection URL or ID first.");
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
      collection: collectionInput
    });

    setEditorModrinthUpdateStatus(summarizeModrinthUpdateResult(result));
    appendModrinthUpdateConsoleResult(result);

    await renderEditorMods();
  } catch (error) {
    const message = error.message || "Failed to update mods from Modrinth.";
    setEditorModrinthUpdateStatus(message);
    appendConsole(`[modrinth error] ${message}`);
    alert(message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Update Version";
    }
  }
}

/* ----------------------------- Skin changer ----------------------------- */

function imageToDataUrl(url) {
  return new Promise(resolve => {
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
  const active = skins.find(skin => skin.state === "ACTIVE") || skins[0] || null;

  if (active?.url) {
    return {
      ...active,
      url: active.url.replace(/^http:\/\//i, "https://")
    };
  }

  const sessionSkinUrl = state.skins.minecraftProfile?.sessionTextures?.skinUrl || "";

  if (sessionSkinUrl) {
    return {
      id: "session-active-skin",
      state: "ACTIVE",
      url: sessionSkinUrl.replace(/^http:\/\//i, "https://"),
      variant: state.skins.minecraftProfile?.sessionTextures?.model || "CLASSIC"
    };
  }

  return {
    id: "default-steve",
    state: "ACTIVE",
    url: DEFAULT_STEVE_SKIN,
    variant: "CLASSIC"
  };
}

function getActiveCapeFromMinecraftProfile() {
  const capes = state.skins.minecraftProfile?.capes || [];
  const active = capes.find(cape => cape.state === "ACTIVE") || null;

  if (active?.url) {
    return {
      ...active,
      url: active.url.replace(/^http:\/\//i, "https://")
    };
  }

  const sessionCapeUrl = state.skins.minecraftProfile?.sessionTextures?.capeUrl || "";

  if (sessionCapeUrl) {
    return {
      id: `session:${sessionCapeUrl}`,
      state: "ACTIVE",
      url: sessionCapeUrl.replace(/^http:\/\//i, "https://"),
      alias: "Mojang Cape"
    };
  }

  return null;
}

function getAvailableCapes() {
  const capes = Array.isArray(state.skins.minecraftProfile?.capes)
    ? state.skins.minecraftProfile.capes
    : [];

  const normalized = capes
    .filter(cape => cape?.url)
    .map(cape => ({
      id: cape.id || cape.alias || cape.url || "",
      name: cape.alias || cape.id || "Cape",
      url: String(cape.url || "").replace(/^http:\/\//i, "https://"),
      state: cape.state || "",
      source: "minecraft-services"
    }));

  const sessionCapeUrl = state.skins.minecraftProfile?.sessionTextures?.capeUrl || "";

  if (sessionCapeUrl) {
    const httpsSessionCapeUrl = sessionCapeUrl.replace(/^http:\/\//i, "https://");

    const alreadyListed = normalized.some(cape => cape.url === httpsSessionCapeUrl);

    if (!alreadyListed) {
      normalized.unshift({
        id: `session:${httpsSessionCapeUrl}`,
        name: "Active Cape",
        url: httpsSessionCapeUrl,
        state: "ACTIVE",
        source: "sessionserver"
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

    const rotation = ((options.rotation || 0) % 360 + 360) % 360;
    const isBack = rotation > 90 && rotation < 270;

    const slim = options.model === "slim";
    const armWidth = slim ? 3 : 4;

    const originX = Math.floor(width / 2 - 10 * unit);
    const originY = Math.floor(height / 2 - 24 * unit);

    const face = isBack
      ? { x: 24, y: 8, w: 8, h: 8 }
      : { x: 8, y: 8, w: 8, h: 8 };

    const headOverlay = isBack
      ? { x: 56, y: 8, w: 8, h: 8 }
      : { x: 40, y: 8, w: 8, h: 8 };

    const body = isBack
      ? { x: 32, y: 20, w: 8, h: 12 }
      : { x: 20, y: 20, w: 8, h: 12 };

    const rightArm = isBack
      ? { x: 52, y: 20, w: armWidth, h: 12 }
      : { x: 44, y: 20, w: armWidth, h: 12 };

    const leftArm = isBack
      ? { x: 44, y: 52, w: armWidth, h: 12 }
      : { x: 36, y: 52, w: armWidth, h: 12 };

    const rightLeg = isBack
      ? { x: 12, y: 20, w: 4, h: 12 }
      : { x: 4, y: 20, w: 4, h: 12 };

    const leftLeg = isBack
      ? { x: 28, y: 52, w: 4, h: 12 }
      : { x: 20, y: 52, w: 4, h: 12 };

    drawSkinPart(context, image, face, {
      x: originX + 6 * unit,
      y: originY,
      w: 8 * unit,
      h: 8 * unit
    });

    drawSkinPart(context, image, headOverlay, {
      x: originX + 6 * unit,
      y: originY,
      w: 8 * unit,
      h: 8 * unit
    });

    drawSkinPart(context, image, body, {
      x: originX + 6 * unit,
      y: originY + 8 * unit,
      w: 8 * unit,
      h: 12 * unit
    });

    drawSkinPart(context, image, rightArm, {
      x: originX + (6 - armWidth) * unit,
      y: originY + 8 * unit,
      w: armWidth * unit,
      h: 12 * unit
    });

    drawSkinPart(context, image, leftArm, {
      x: originX + 14 * unit,
      y: originY + 8 * unit,
      w: armWidth * unit,
      h: 12 * unit
    });

    drawSkinPart(context, image, rightLeg, {
      x: originX + 6 * unit,
      y: originY + 20 * unit,
      w: 4 * unit,
      h: 12 * unit
    });

    drawSkinPart(context, image, leftLeg, {
      x: originX + 10 * unit,
      y: originY + 20 * unit,
      w: 4 * unit,
      h: 12 * unit
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
    cape: capeSource || undefined
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
  const cape = getAvailableCapes().find(item => item.id === capeId);
  const capeUrl = cape?.url || "";

  skinEditorViewer = setupSkinViewerCanvas(
    canvas,
    state.skins.editorImageDataUrl || DEFAULT_STEVE_SKIN,
    capeUrl,
    {
      model: selectedSkinEditorModel()
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
      model: currentSkin?.variant === "SLIM" || currentSkin?.variant === "slim" ? "slim" : "wide"
    }
  );
}

function getSelectedLibrarySkin() {
  return state.skins.library.find(skin => skin.id === state.skins.selectedSkinId) || null;
}

function updateSelectedSkinViewer() {
  const canvas = $("#selectedSkinCanvas");
  if (!canvas) return;

  destroySkinViewer(selectedSkinViewer);
  selectedSkinViewer = null;

  const selectedSkin = getSelectedLibrarySkin();
  const selectedCape = getAvailableCapes().find(cape => cape.id === selectedSkin?.capeId);

  selectedSkinViewer = setupSkinViewerCanvas(
    canvas,
    getSkinSourceFromEntry(selectedSkin) || DEFAULT_STEVE_SKIN,
    selectedCape?.url || "",
    {
      model: selectedSkin?.model || "wide"
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

    const scale = Math.floor(Math.min(
      canvas.width / sourceWidth,
      canvas.height / sourceHeight
    ));

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
  $$("[data-cape-url]").forEach(canvas => {
    drawCapeTextureFront(
      canvas,
      canvas.dataset.capeUrl || "",
      canvas.dataset.selected === "true"
    );
  });

  $$("[data-cape-preview]").forEach(canvas => {
    drawCapePlaceholder(
      canvas,
      canvas.dataset.capeName || "",
      canvas.dataset.selected === "true"
    );
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

          ${library.map(skin => `
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
          `).join("")}
        </div>
      </section>
    </div>
  `;

  updateCurrentSkinViewer();

  const currentCanvas = $("#currentSkinCanvas");

  if (currentCanvas) {
    currentCanvas.addEventListener("mousedown", event => {
      state.skins.previewDragging = true;
      state.skins.previewDragStartX = event.clientX;
      state.skins.previewDragStartRotation = state.skins.previewRotation;
    });
  }

  document.addEventListener("mousemove", handleSkinPreviewMouseMove);
  document.addEventListener("mouseup", handleSkinPreviewMouseUp);

  $$(".skin-library-card[data-skin-id]").forEach(card => {
    const skinId = card.dataset.skinId;
    const skin = library.find(item => item.id === skinId);
    const canvas = card.querySelector(".skin-card-canvas");

    if (canvas) {
      requestAnimationFrame(() => {
        drawMinecraftSkin(canvas, getSkinPreviewSource(skin), {
          model: skin?.model || "wide",
          rotation: 0,
          animate: false
        });
      });
    }

    card.querySelector('[data-action="use"]')?.addEventListener("click", async event => {
      event.stopPropagation();
      await useSkinFromLibrary(skinId);
    });

    card.querySelector('[data-action="edit"]')?.addEventListener("click", event => {
      event.stopPropagation();
      openSkinEditor(skinId);
    });

    card.querySelector('[data-action="duplicate"]')?.addEventListener("click", async event => {
      event.stopPropagation();
      await duplicateSkinInLibrary(skinId);
    });

    card.querySelector('[data-action="delete"]')?.addEventListener("click", async event => {
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
  if (root) {
    root.innerHTML = `<div class="skin-loading whitetext mcr">Loading skins...</div>`;
  }

  try {
    const [minecraftProfile, library] = await Promise.all([
      window.launcherAPI.skins.getMinecraftProfile(),
      window.launcherAPI.skins.list()
    ]);

    state.skins.minecraftProfile = minecraftProfile;
    state.skins.library = library?.skins || [];
    state.skins.loaded = true;

    renderSkinPage();
  } catch (error) {
    if (root) {
      root.innerHTML = `
        <div class="skin-loading whitetext mcr">
          ${escapeHtml(error.message || "Failed to load skins. Login first.")}
        </div>
      `;
    }
  }
}

async function addCurrentSkinToLibrary() {
  const currentSkin = getCurrentSkinFromMinecraftProfile();

  if (!currentSkin?.url || currentSkin.url === DEFAULT_STEVE_SKIN) {
    alert("No uploaded Minecraft skin was found.");
    return;
  }

  try {
    const dataUrl = await imageToDataUrl(currentSkin.url);

    await window.launcherAPI.skins.create({
      name: "Current Skin",
      model: currentSkin.variant === "SLIM" || currentSkin.variant === "slim" ? "slim" : "wide",
      skinDataUrl: dataUrl || "",
      sourceUrl: currentSkin.url || "",
      capeId: getActiveCapeFromMinecraftProfile()?.id || ""
    });

    await loadSkinPageData(true);
  } catch (error) {
    alert(error.message || "Failed to add current skin.");
  }
}

function openSkinEditor(skinId = null) {
  const existing = state.skins.library.find(skin => skin.id === skinId) || null;

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

    ${capes.map(cape => `
      <label class="skin-cape-option">
        <input type="radio" name="skinEditorCape" value="${escapeHtml(cape.id)}" ${cape.id === selectedCapeId ? "checked" : ""} />
        ${renderCapePreviewHtml(cape, selectedCapeId)}
        <span class="whitetext mcr">${escapeHtml(cape.name)}</span>
      </label>
    `).join("")}
  `;

  root.querySelectorAll('input[name="skinEditorCape"]').forEach(input => {
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
    alert(error.message || "Failed to pick skin file.");
  }
}

function openBasicSkinPainter() {
  const canvas = $("#skinPaintCanvas");
  const source = state.skins.editorImageDataUrl;

  if (!canvas || !source) {
    alert("Browse a skin file first.");
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

  canvas.addEventListener("mousedown", event => {
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
    alert("Choose a skin PNG first.");
    return;
  }

  try {
    let saved;

    if (state.skins.editorSkinId) {
      saved = await window.launcherAPI.skins.update(state.skins.editorSkinId, {
        name,
        model,
        capeId,
        skinDataUrl: state.skins.editorImageDataUrl
      });
    } else {
      saved = await window.launcherAPI.skins.create({
        name,
        model,
        capeId,
        skinDataUrl: state.skins.editorImageDataUrl
      });
    }

    if (useAfterSave) {
      await window.launcherAPI.skins.use(saved.id, {
        capeId
      });

      refreshLoginCardHeadAfterSkinChange();
    }

    closeSkinEditor();
    await loadSkinPageData(true);
  } catch (error) {
    alert(error.message || "Failed to save skin.");
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
      alert(result.capeResult.warning);
    }
  } catch (error) {
    alert(error.message || "Failed to use skin.");
  } finally {
    skinUseInProgress = false;
  }
}

async function duplicateSkinInLibrary(skinId) {
  try {
    await window.launcherAPI.skins.duplicate(skinId);
    await loadSkinPageData(true);
  } catch (error) {
    alert(error.message || "Failed to duplicate skin.");
  }
}

async function deleteSkinFromLibrary(skinId) {
  const skin = state.skins.library.find(item => item.id === skinId);
  const confirmed = confirm(`Delete skin "${skin?.name || "Skin"}"?`);

  if (!confirmed) return;

  try {
    await window.launcherAPI.skins.delete(skinId);
    await loadSkinPageData(true);
  } catch (error) {
    alert(error.message || "Failed to delete skin.");
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
    backdrop.addEventListener("click", event => {
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
      .filter(filePath => filePath.toLowerCase().endsWith(".jar"));
  }

  return files
    .filter(file => file.name.toLowerCase().endsWith(".jar"))
    .map(file => file.path)
    .filter(Boolean);
}

async function loadSingleServerStatus(element) {
  const prefix = "server:";
  const address = element.id.slice(prefix.length).trim();

  if (!address) {
    element.textContent = "Offline";
    element.classList.add("offline");
    return;
  }

  element.textContent = "Loading...";
  element.classList.remove("offline");

  try {
    const response = await fetch(
      `https://api.mcsrvstat.us/3/${encodeURIComponent(address)}`
    );

    if (!response.ok) {
      throw new Error(`Server status API returned ${response.status}`);
    }

    const data = await response.json();

    if (!data.online) {
      element.textContent = "Offline";
      element.classList.add("offline");
      return;
    }

    const onlinePlayers = data.players?.online ?? 0;
    const maxPlayers = data.players?.max ?? 0;

    element.textContent = `${onlinePlayers}/${maxPlayers}`;
    element.classList.remove("offline");
  } catch {
    element.textContent = "Offline";
    element.classList.add("offline");
  }
}

async function loadServerStatuses() {
  const serverElements = $$('[id^="server:"]');

  await Promise.all(
    serverElements.map(element => loadSingleServerStatus(element))
  );
}

async function syncDefaultClient(mode, force = true) {
  try {
    if (mode === "delete") {
      const confirmed = confirm(
        "This will delete the old Default installation folder before downloading the new one. Continue?"
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
      force
    });

    await loadProfiles();
  } catch (error) {
    setStatus(error.message || "Default client update failed.");
    appendConsole(`[client updater error] ${error.message || error}`);
    alert(error.message || "Default client update failed.");
  }
}

async function checkDefaultClientInfoManually() {
  try {
    const info = await window.launcherAPI.clientUpdater.getDefaultInfo();

    if (!info.updateAvailable) {
      setUpdateStatus(`Default client is up to date. Version: ${info.remoteClientVersion || "unknown"}`);
      setStatus("Default client is already up to date.");
      return;
    }

    setUpdateStatus(
      `Default client update available: ${info.localClientVersion || "none"} → ${info.remoteClientVersion || "new"}. ` +
        `Server mode: ${info.updateMode || "keep"}.`
    );

    setStatus("Default client update available.");
  } catch (error) {
    setUpdateStatus(`Default client check failed: ${error.message || error}`);
    setStatus("Default client check failed.");
    alert(error.message || "Default client check failed.");
  }
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
      setStatus(message);
      appendConsole(`[auth error] ${message}`);
      alert(message);
      return;
    }

    state.account = result.account;
    renderAccountBox(result.account);

    const refreshedAccount = await loadAccount();

    if (!refreshedAccount || !refreshedAccount.username) {
      setStatus("Login saved, but the UI could not reload the account.");
      appendConsole("[auth warning] Login saved, but getAccount returned empty.");
      alert("Login saved, but the UI could not reload the account. Restart the launcher.");
      return;
    }

    setStatus(`Logged in as ${refreshedAccount.username}.`);
    appendConsole(`[auth] Logged in as ${refreshedAccount.username}.`);
  } catch (error) {
    const message = error.message || String(error);
    setStatus(message);
    appendConsole(`[auth error] ${message}`);
    alert(message);
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
    alert(message);
  }
}

async function openEditorInstallationFolder() {
  const inputPath = $("#editorSettingGameDir")?.value.trim();
  const profile = getEditorProfile();
  const folderPath = inputPath || profile?.gameDir || "";

  if (!folderPath) {
    alert("No game directory is set for this installation.");
    return;
  }

  try {
    if (!window.launcherAPI.folders?.openPath) {
      throw new Error("folders.openPath is not exposed in preload.");
    }

    await window.launcherAPI.folders.openPath(folderPath);
  } catch (error) {
    appendConsole(`[folder error] ${error.message || error}`);
    alert(error.message || "Failed to open installation folder.");
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

  newsTabButtons.forEach(button => {
    button.addEventListener("click", () => {
      const tab = button.dataset.newsTab;

      newsTabButtons.forEach(btn => {
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

function startFakeLaunchProgress() {
  hideLaunchProgress();

  let value = 4;
  setLaunchProgress(value);

  launchProgressTimer = setInterval(() => {
    value = Math.min(88, value + Math.max(1, Math.floor((92 - value) / 8)));
    setLaunchProgress(value);
  }, 450);
}

function finishLaunchProgress() {
  setLaunchProgress(100);

  setTimeout(() => {
    hideLaunchProgress();
  }, 700);
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

  const overlay = $("#clientUpdateOverlay");
  const messageElement = $("#clientUpdateOverlayMessage");

  if (messageElement) {
    messageElement.textContent = message;
  }

  if (overlay) {
    overlay.classList.add("active");
  }
}

function hideClientUpdateOverlay() {
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

  document.addEventListener("click", event => {
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
    profileDropupButton.addEventListener("click", event => {
      event.stopPropagation();
      toggleProfileDropup();
    });
  }

  $$(".nav-btn").forEach(button => {
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
    installationEditorBackdrop.addEventListener("mousedown", event => {
      state.installationBackdropMouseDownOnBackdrop = event.target === installationEditorBackdrop;
    });

    installationEditorBackdrop.addEventListener("click", event => {
      if (state.installationBackdropMouseDownOnBackdrop && event.target === installationEditorBackdrop) {
        closeInstallationEditor();
      }

      state.installationBackdropMouseDownOnBackdrop = false;
    });
  }

  $$(".editor-tab-btn").forEach(button => {
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
        alert(error.message || "Failed to import icon.");
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
    ["dragenter", "dragover"].forEach(eventName => {
      editorModsDropZone.addEventListener(eventName, event => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
        editorModsDropZone.classList.add("drag-over");
      });
    });

    ["dragleave", "dragend"].forEach(eventName => {
      editorModsDropZone.addEventListener(eventName, event => {
        event.preventDefault();
        event.stopPropagation();
        editorModsDropZone.classList.remove("drag-over");
      });
    });

    editorModsDropZone.addEventListener("drop", async event => {
      event.preventDefault();
      event.stopPropagation();
      editorModsDropZone.classList.remove("drag-over");

      const paths = [...new Set(getDroppedJarPaths(event))];

      if (paths.length === 0) {
        alert("Drop one or more .jar files from your file manager.");
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
      await window.launcherAPI.auth.logout();
      await loadAccount();
      setStatus("Logged out.");
      appendConsole("[auth] Logged out.");
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
          alert("Please login with Microsoft first.");
          return;
        }

        const selectedProfile = getSelectedProfile();

        if (!selectedProfile) {
          setStatus("Select an installation first.");
          alert("Select an installation first.");
          return;
        }

        const launcherSettings = getLauncherSettings();

        flyRocket();
        startFakeLaunchProgress();

        setStatus(`Launching ${selectedProfile.name}...`);
        appendConsole(`[launcher] Launching ${selectedProfile.name}...`);

        if (launcherSettings.openConsoleOnLaunch) {
          setTimeout(() => {
            showPage("console");
          }, 650);
        }
wrongJavaVersionCrashDetected = false;
        const result = await window.launcherAPI.launcher.launch(selectedProfile.id);

        finishLaunchProgress();

        setStatus(`Launched ${result.profileName}.`);
        appendConsole(`[launcher] Started version ${result.versionId}.`);

        if (!launcherSettings.keepLauncherOpenOnLaunch) {
          setTimeout(() => {
            window.close();
          }, 900);
        }
      } catch (error) {
        hideLaunchProgress();
        setStatus(error.message || "Launch failed.");
        appendConsole(`[launcher error] ${error.message || error}`);
        alert(error.message || "Launch failed.");
      }
    });
  }

  const killBtn = $("#killBtn");
  if (killBtn) {
    killBtn.addEventListener("click", async () => {
      await window.launcherAPI.launcher.kill();
      setStatus("Stop signal sent.");
    });
  }

  const newProfileBtn = $("#newProfileBtn");
  if (newProfileBtn) {
    newProfileBtn.addEventListener("click", async () => {
      const latestRelease = state.minecraftVersions.find(version => version.type === "release")?.id || "1.21.1";

      const created = await window.launcherAPI.profiles.create({
        name: "New Custom Installation",
        minecraftVersion: latestRelease,
        versionType: "release",
        loaderType: "vanilla",
        minMemory: "2G",
        maxMemory: "4G",
        icon: "grass"
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

  window.launcherAPI.events.onGameLog(line => {
    appendConsole(line);

    if (isWrongJavaVersionCrashLine(line)) {
      wrongJavaVersionCrashDetected = true;
    }
  });

  window.launcherAPI.events.onGameClose(data => {
    setStatus(`Minecraft closed with code ${data.code}.`);
    appendConsole(`[launcher] Minecraft closed with code ${data.code}.`);

    if (Number(data.code) !== 0 && wrongJavaVersionCrashDetected) {
      wrongJavaVersionCrashDetected = false;

      alert("Wrong Java version was used. Change it in Installations.");
      setStatus("Wrong Java version was used. Change it in Installations.");
    }

    loadDiscordStatus();
});

  window.launcherAPI.events.onUpdaterStatus(data => {
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

  window.launcherAPI.events.onClientUpdaterStatus(data => {
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

    if (data.type === "done") {
      setClientUpdateOverlayProgress(100);

      setTimeout(() => {
        hideClientUpdateOverlay();
      }, 700);

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

window.addEventListener("dragover", event => {
  event.preventDefault();
});

window.addEventListener("drop", event => {
  event.preventDefault();
});
async function boot() {
  await loadSystemMemoryInfo();
  await initEvents();
  await loadAccount();
  await loadProfiles();
  await loadDiscordStatus();
  await loadEditorVersionData();

  loadJavaInstallations();

  await loadServerStatuses();
  setInterval(loadServerStatuses, 60000);

  setStatus("Ready.");
  appendConsole("[launcher] Renderer loaded.");
}

boot().catch(error => {
  console.error(error);
  setStatus(error.message || "Launcher failed to start.");
  alert(error.message || "Launcher failed to start.");
});