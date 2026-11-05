const crypto = require("crypto");
const { Auth, wrapError } = require("msmc");
const storage = require("./storage");

const ACCOUNT_FILE = "account.json";

const LICENSE_FILE = "license.json";
const OFFLINE_NAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

let loginInProgress = null;

function safeAccount(account) {
  if (!account) return null;

  return {
    username: account.username || account.name || "Unknown",
    uuid: account.uuid || account.id || null,
    type: account.type === "offline" ? "offline" : "microsoft",
    savedAt: account.savedAt || new Date().toISOString(),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableNetworkError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  const code = String(error?.code || error?.errno || "").toUpperCase();

  return (
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND" ||
    message.includes("timedout") ||
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("socket hang up")
  );
}

async function retryAsync(label, fn, retries = 3, delayMs = 2500) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isRetryableNetworkError(error) || attempt === retries) {
        throw error;
      }

      console.warn(
        `[auth] ${label} failed, retrying ${attempt}/${retries - 1}:`,
        error.message || error
      );

      await sleep(delayMs * attempt);
    }
  }

  throw lastError;
}

function getReadableError(error) {
  try {
    if (typeof wrapError === "function") {
      const wrapped = wrapError(error);

      if (wrapped && wrapped.message) {
        return wrapped.message;
      }
    }
  } catch {
    // Ignore wrapError failure.
  }

  const message = String(error?.message || error || "");

  if (error && error.code === "ETIMEDOUT") {
    return "Minecraft Services timed out. Check your internet connection and try again.";
  }

  if (message.toLowerCase().includes("child")) {
    return "This Microsoft account appears to be a child account. It may need Xbox/Microsoft family permissions before it can log in.";
  }

  if (message.toLowerCase().includes("minecraft")) {
    return message;
  }

  if (message) return message;

  return "Microsoft login failed.";
}

function getMclcAuth(minecraftToken) {
  if (!minecraftToken || typeof minecraftToken.mclc !== "function") {
    console.log("[auth] Minecraft token object:", minecraftToken);

    throw new Error(
      "Minecraft token did not include mclc(). Make sure msmc is installed correctly."
    );
  }

  try {
    return minecraftToken.mclc(true);
  } catch {
    return minecraftToken.mclc();
  }
}

function normalizeMclcAuth(mclcAuth) {
  if (!mclcAuth) {
    throw new Error("Minecraft auth result was empty.");
  }

  const username = mclcAuth.name || mclcAuth.username;
  const uuid = mclcAuth.uuid || mclcAuth.id;
  const accessToken = mclcAuth.access_token || mclcAuth.accessToken;

  if (!username || !uuid || !accessToken) {
    console.log("[auth] Incomplete MCLC auth object:", mclcAuth);

    throw new Error(
      "Microsoft login worked, but Minecraft launch auth was incomplete. Make sure this account owns Minecraft Java Edition."
    );
  }

  return {
    ...mclcAuth,
    type: "microsoft",
    username,
    name: username,
    uuid,
    access_token: accessToken,
    accessToken,
    client_token: mclcAuth.client_token || mclcAuth.clientToken || "",
    clientToken: mclcAuth.client_token || mclcAuth.clientToken || "",
    user_properties: mclcAuth.user_properties || {},
    meta: mclcAuth.meta || { type: "msa" },
    savedAt: new Date().toISOString(),
  };
}

async function runMicrosoftLogin() {
  console.log("[auth] Login button reached backend.");
  console.log("[auth] Starting Electron Microsoft login flow...");

  const authManager = new Auth("select_account");

  authManager.on("load", (asset, message) => {
    console.log("[auth] MSMC:", asset, message);
  });

  const xboxManager = await authManager.launch("electron", {
    width: 900,
    height: 700,
    resizable: true,
  });

  console.log("[auth] Xbox login complete. Getting Minecraft token...");

  const minecraftToken = await retryAsync(
    "Minecraft Services authentication",
    () => xboxManager.getMinecraft(),
    4,
    2500
  );

  const mclcAuth = getMclcAuth(minecraftToken);
  const account = normalizeMclcAuth(mclcAuth);

  storage.writeJson(ACCOUNT_FILE, account);
  recordVerifiedOwnership(account);

  console.log("[auth] Login saved for:", account.username);

  return {
    ok: true,
    account: safeAccount(account),
  };
}

async function loginMicrosoft() {
  if (loginInProgress) {
    return loginInProgress;
  }

  loginInProgress = runMicrosoftLogin()
    .catch((error) => {
      const message = getReadableError(error);

      console.error("[auth] Microsoft login failed:", error);

      return {
        ok: false,
        error: message,
      };
    })
    .finally(() => {
      loginInProgress = null;
    });

  return loginInProgress;
}

function recordVerifiedOwnership(account) {
  storage.writeJson(LICENSE_FILE, {
    verifiedAt: new Date().toISOString(),
    username: account.username,
    uuid: account.uuid,
  });
}

function hasVerifiedOwnership() {
  const license = storage.readJson(LICENSE_FILE, null);
  if (license?.verifiedAt) return true;

  const account = storage.readJson(ACCOUNT_FILE, null);

  if (account && account.type !== "offline" && account.access_token && account.uuid) {
    recordVerifiedOwnership(account);
    return true;
  }

  return false;
}

function offlineUuid(username) {
  const hash = crypto.createHash("md5").update(`OfflinePlayer:${username}`, "utf8").digest();

  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;

  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getOfflineEligibility() {
  const license = storage.readJson(LICENSE_FILE, null);

  return {
    allowed: hasVerifiedOwnership(),
    verifiedUsername: license?.username || null,
  };
}

async function loginOffline(username) {
  const name = String(username || "").trim();

  if (!hasVerifiedOwnership()) {
    return {
      ok: false,
      error:
        "Offline accounts unlock after you sign in once with a Microsoft account that owns Minecraft: Java Edition.",
    };
  }

  if (!OFFLINE_NAME_PATTERN.test(name)) {
    return {
      ok: false,
      error: "Use 3-16 characters: letters, numbers and underscores only.",
    };
  }

  const uuid = offlineUuid(name);

  const account = {
    type: "offline",
    username: name,
    name,
    uuid,
    access_token: uuid,
    accessToken: uuid,
    client_token: uuid,
    clientToken: uuid,
    user_properties: {},
    meta: { type: "mojang" },
    savedAt: new Date().toISOString(),
  };

  storage.writeJson(ACCOUNT_FILE, account);

  console.log("[auth] Offline account saved for:", name);

  return {
    ok: true,
    account: safeAccount(account),
  };
}

async function getAccount() {
  const account = storage.readJson(ACCOUNT_FILE, null);
  return safeAccount(account);
}

function getStoredAccount() {
  return storage.readJson(ACCOUNT_FILE, null);
}

function getMinecraftAccessToken() {
  const account = storage.readJson(ACCOUNT_FILE, null);

  if (account?.type === "offline") {
    throw new Error("Offline accounts can't use skins or capes. Please login with Microsoft first.");
  }

  const token = account?.access_token || account?.accessToken || "";

  if (!token) {
    throw new Error("Not logged in. Please login with Microsoft first.");
  }

  return token;
}
async function getMinecraftProfile() {
  const accessToken = getMinecraftAccessToken();

  const response = await fetch("https://api.minecraftservices.com/minecraft/profile", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();

  let profile = null;
  try {
    profile = text ? JSON.parse(text) : null;
  } catch {
    profile = null;
  }

  if (!response.ok) {
    const message =
      profile?.errorMessage ||
      profile?.error ||
      `Minecraft profile request failed with status ${response.status}`;

    throw new Error(message);
  }

  return {
    id: profile?.id || "",
    name: profile?.name || "",
    skins: Array.isArray(profile?.skins) ? profile.skins : [],
    capes: Array.isArray(profile?.capes) ? profile.capes : [],
  };
}
function getLaunchAuth() {
  const account = storage.readJson(ACCOUNT_FILE, null);

  if (!account || !account.access_token || !account.uuid || !account.username) {
    throw new Error("Not logged in. Please login with Microsoft first.");
  }

  return {
    access_token: account.access_token,
    client_token: account.client_token || "",
    uuid: account.uuid,
    name: account.username,
    user_properties: account.user_properties || {},
    meta: account.meta || { type: account.type === "offline" ? "mojang" : "msa" },
  };
}

async function logout() {
  storage.writeJson(ACCOUNT_FILE, null);

  return {
    ok: true,
  };
}

module.exports = {
  loginMicrosoft,
  loginOffline,
  getOfflineEligibility,
  getAccount,
  getStoredAccount,
  getMinecraftAccessToken,
  getMinecraftProfile,
  getLaunchAuth,
  logout,
};
