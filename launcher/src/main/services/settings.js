const storage = require("./storage");

const SETTINGS_FILE = "launcher-settings.json";

const DEFAULTS = {
  autoUpdateLauncher: true,
  autoUpdateClient: true,
};

let cached = null;

function getSettings() {
  if (!cached) {
    const saved = storage.readJson(SETTINGS_FILE, null) || {};
    cached = { ...DEFAULTS };

    for (const key of Object.keys(DEFAULTS)) {
      if (typeof saved[key] === typeof DEFAULTS[key]) cached[key] = saved[key];
    }
  }

  return { ...cached };
}

function setSetting(key, value) {
  if (!(key in DEFAULTS)) {
    throw new Error(`Unknown setting: ${key}`);
  }

  if (typeof value !== typeof DEFAULTS[key]) {
    throw new Error(`Invalid value for ${key}.`);
  }

  cached = { ...getSettings(), [key]: value };
  storage.writeJson(SETTINGS_FILE, cached);

  return getSettings();
}

module.exports = {
  getSettings,
  setSetting,
};
