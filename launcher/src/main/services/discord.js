const RPC = require("discord-rpc");

const DISCORD_CLIENT_ID = "1498346593693466745";

let rpc = null;
let connected = false;
let connecting = false;
let startedAt = Date.now();
let lastActivity = null;
let retryTimer = null;

function isConfigured() {
  return Boolean(
    DISCORD_CLIENT_ID &&
      DISCORD_CLIENT_ID !== "YOUR_DISCORD_CLIENT_ID" &&
      DISCORD_CLIENT_ID.trim().length > 0
  );
}

function getStatus() {
  return {
    configured: isConfigured(),
    connected,
    connecting
  };
}

function clearRetryTimer() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleReconnect(delayMs = 10000) {
  if (retryTimer || connected || connecting || !isConfigured()) return;

  retryTimer = setTimeout(async () => {
    retryTimer = null;

    if (!connected && !connecting) {
      await init();
    }
  }, delayMs);
}

async function safeDestroyClient(client) {
  if (!client) return;

  try {
    if (client.transport && client.transport.socket) {
      await client.destroy();
    }
  } catch (error) {
    console.warn("[discord] RPC destroy ignored:", error.message || error);
  }
}

async function init() {
  if (!isConfigured()) {
    console.log("[discord] Discord Rich Presence disabled. Set DISCORD_CLIENT_ID in src/main/services/discord.js.");

    return {
      ok: false,
      disabled: true,
      reason: "Discord client ID is not configured."
    };
  }

  if (connected) {
    return {
      ok: true
    };
  }

  if (connecting) {
    return {
      ok: false,
      connecting: true
    };
  }

  connecting = true;
  clearRetryTimer();

  try {
    RPC.register(DISCORD_CLIENT_ID);

    const client = new RPC.Client({
      transport: "ipc"
    });

    rpc = client;

    client.on("ready", () => {
      connected = true;
      connecting = false;

      console.log("[discord] Rich Presence connected.");

      if (lastActivity) {
        setActivity(lastActivity).catch(error => {
          console.warn("[discord] Failed to restore activity:", error.message || error);
        });
      } else {
        setLauncherActivity().catch(error => {
          console.warn("[discord] Failed to set launcher activity:", error.message || error);
        });
      }
    });

    client.on("disconnected", () => {
      connected = false;
      connecting = false;
      rpc = null;

      console.log("[discord] Rich Presence disconnected.");
      scheduleReconnect();
    });

    client.on("error", error => {
      connected = false;
      connecting = false;

      console.warn("[discord] Rich Presence error:", error.message || error);
      scheduleReconnect();
    });

    await client.login({
      clientId: DISCORD_CLIENT_ID
    });

    connecting = false;

    return {
      ok: true
    };
  } catch (error) {
    connected = false;
    connecting = false;

    const failedRpc = rpc;
    rpc = null;

    await safeDestroyClient(failedRpc);

    scheduleReconnect();

    return {
      ok: false,
      error: error.message || String(error)
    };
  }
}

async function setActivity(activity) {
  lastActivity = activity;

  if (!rpc || !connected) {
    scheduleReconnect();

    return {
      ok: false,
      connected: false
    };
  }

  try {
    await rpc.setActivity({
      ...activity,
      startTimestamp: activity.startTimestamp || startedAt,
      instance: false
    });

    return {
      ok: true
    };
  } catch (error) {
    connected = false;

    console.warn("[discord] Failed to set activity:", error.message || error);
    scheduleReconnect();

    return {
      ok: false,
      error: error.message || String(error)
    };
  }
}

async function setLauncherActivity(profileName = "No installation selected") {
  return setActivity({
    details: "In the launcher",
    state: profileName,
    largeImageKey: "knoe24_avatar_drops",
    largeImageText: "Eclipse Client",
    smallImageKey: "minecraft",
    smallImageText: "Minecraft"
  });
}

async function setPlayingActivity(profileName, versionId) {
  startedAt = Date.now();

  return setActivity({
    details: `Playing ${profileName || "Minecraft"}`,
    state: versionId ? `Version: ${versionId}` : "Minecraft",
    largeImageKey: "knoe24_avatar_drops",
    largeImageText: "Eclipse Client",
    smallImageKey: "minecraft",
    smallImageText: "Minecraft"
  });
}

async function setUpdatingActivity() {
  return setActivity({
    details: "Updating client",
    state: "Syncing files",
    largeImageKey: "knoe24_avatar_drops",
    largeImageText: "Eclipse Client",
    smallImageKey: "minecraft",
    smallImageText: "Minecraft"
  });
}

async function clear() {
  if (!rpc || !connected) {
    return {
      ok: false,
      connected: false
    };
  }

  try {
    await rpc.clearActivity();

    return {
      ok: true
    };
  } catch (error) {
    connected = false;
    scheduleReconnect();

    return {
      ok: false,
      error: error.message || String(error)
    };
  }
}

async function destroy() {
  clearRetryTimer();

  const currentRpc = rpc;

  rpc = null;
  connected = false;
  connecting = false;

  await safeDestroyClient(currentRpc);
}

module.exports = {
  init,
  setLauncherActivity,
  setPlayingActivity,
  setUpdatingActivity,
  clear,
  destroy,
  getStatus
};