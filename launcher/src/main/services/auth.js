const { Auth, wrapError } = require("msmc");
const storage = require("./storage");

const ACCOUNT_FILE = "account.json";

let loginInProgress = null;

function safeAccount(account) {
  if (!account) return null;

  return {
    username: account.username || account.name || "Unknown",
    uuid: account.uuid || account.id || null,
    type: account.type || "microsoft",
    savedAt: account.savedAt || new Date().toISOString()
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    savedAt: new Date().toISOString()
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
    resizable: true
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

  console.log("[auth] Login saved for:", account.username);

  return {
    ok: true,
    account: safeAccount(account)
  };
}

async function loginMicrosoft() {
  if (loginInProgress) {
    return loginInProgress;
  }

  loginInProgress = runMicrosoftLogin()
    .catch(error => {
      const message = getReadableError(error);

      console.error("[auth] Microsoft login failed:", error);

      return {
        ok: false,
        error: message
      };
    })
    .finally(() => {
      loginInProgress = null;
    });

  return loginInProgress;
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
      Accept: "application/json"
    }
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
    capes: Array.isArray(profile?.capes) ? profile.capes : []
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
    meta: account.meta || { type: "msa" }
  };
}

async function logout() {
  storage.writeJson(ACCOUNT_FILE, null);

  return {
    ok: true
  };
}

module.exports = {
  loginMicrosoft,
  getAccount,
  getStoredAccount,
  getMinecraftAccessToken,
  getMinecraftProfile,
  getLaunchAuth,
  logout
};