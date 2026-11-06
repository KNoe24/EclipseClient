const { app } = require("electron");

const RANKED_URL = "https://pvphq.com/api/ranked/";
const OVERALL_URL = "https://pvphq.com/api/v1/leaderboard/ranked/overall?page=0&size=100";
const OVERALL_CACHE_MS = 5 * 60 * 1000;
const TOTAL_LADDERS = 11;
const MOJANG_PROFILE_URL = "https://api.mojang.com/users/profiles/minecraft/";
const CACHE_MS = 60 * 1000;
const TIMEOUT_MS = 6000;

const LADDER_NAMES = {
  SWORD: "Sword",
  AXE: "Axe",
  UHC: "UHC",
  VANILLA: "Vanilla",
  CRYSTAL: "Vanilla",
  MACE: "Mace",
  SPEAR_MACE: "Spear Mace",
  SPEAR: "Spear Mace",
  SPEARMACE: "Spear Mace",
  CART: "Cart",
  HT_CART: "Cart",
  CARTS: "Cart",
  MINECART: "Cart",
  POT: "Pot",
  DIAMOND_POT: "Pot",
  NETHERITE_POT: "NethPot",
  NETHERITE_OP: "NethPot",
  SMP: "SMP",
  NETHERITE_SMP: "SMP",
  DIAMOND_SMP: "DiamondSMP",
};

const LADDER_KEYS = {
  CRYSTAL: "VANILLA",
  SPEAR: "SPEAR_MACE",
  SPEARMACE: "SPEAR_MACE",
  HT_CART: "CART",
  CARTS: "CART",
  MINECART: "CART",
  DIAMOND_POT: "POT",
  NETHERITE_OP: "NETHERITE_POT",
  NETHERITE_SMP: "SMP",
};

const TIER_ORDER = [
  "LT5",
  "MT5",
  "HT5",
  "LT4",
  "MT4",
  "HT4",
  "LT3",
  "MT3",
  "HT3",
  "LT2",
  "MT2",
  "HT2",
  "LT1",
  "MT1",
  "HT1",
];

const TIER_COLORS = {
  LT5: "#4C3822",
  MT5: "#705332",
  HT5: "#936D42",
  LT4: "#64686B",
  MT4: "#83888C",
  HT4: "#A2A9AD",
  LT3: "#9E5A32",
  MT3: "#BF6C3D",
  HT3: "#DD7E46",
  LT2: "#64728C",
  MT2: "#7C8DAD",
  HT2: "#92A5CC",
  LT1: "#BF942F",
  MT1: "#DDAB37",
  HT1: "#FFC53F",
};

const cache = new Map();
let overallCache = null;
let rateLimitedUntil = 0;

function userAgent() {
  return `EclipseClient/${app.getVersion()} (launcher)`;
}

function normalizeUuid(value) {
  const hex = String(value || "")
    .replace(/-/g, "")
    .toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return "";
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": userAgent() },
      signal: controller.signal,
    });

    const text = await response.text();

    return {
      status: response.status,
      retryAfter: Number(response.headers.get("retry-after")) || 0,
      body: text ? JSON.parse(text) : null,
    };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("PvPHQ did not respond in time.");
    if (error instanceof SyntaxError) throw new Error("PvPHQ sent an invalid response.");
    throw new Error("Could not reach PvPHQ. Check your internet connection.");
  } finally {
    clearTimeout(timer);
  }
}

async function resolvePlayer(nameOrUuid) {
  const asUuid = normalizeUuid(nameOrUuid);
  if (asUuid) return { uuid: asUuid, name: "" };

  const name = String(nameOrUuid || "").trim();

  if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) {
    throw new Error("Enter a valid Minecraft name.");
  }

  const result = await getJson(`${MOJANG_PROFILE_URL}${encodeURIComponent(name)}`);

  if (result.status === 404 || result.status === 204 || !result.body?.id) {
    return null;
  }

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Could not look up ${name} (HTTP ${result.status}).`);
  }

  return { uuid: normalizeUuid(result.body.id), name: result.body.name || name };
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function tierRank(tier) {
  const compact = String(tier || "")
    .toUpperCase()
    .replace(/LOW[_ ]?TIER[_ ]?/g, "LT")
    .replace(/MID[_ ]?TIER[_ ]?/g, "MT")
    .replace(/HIGH[_ ]?TIER[_ ]?/g, "HT")
    .replace(/[^A-Z0-9]/g, "");

  return TIER_ORDER.indexOf(compact);
}

function parseLadder(apiKey, entry) {
  const raw = String(apiKey || "")
    .trim()
    .toUpperCase()
    .replace(/[-\s]/g, "_");
  const key = LADDER_KEYS[raw] || raw;

  const wins = number(entry.wins);
  const losses = number(entry.losses);
  const rating = number(entry.rating, 1000);
  const placementGames = number(entry.placementGames);
  const placementTarget = number(entry.placementTarget, 10);
  const rawPosition = number(entry.leaderboardPosition, -1);
  const tier = entry.grantedTier ? String(entry.grantedTier) : "";
  const placed = placementGames >= placementTarget;
  const compactTier = TIER_ORDER[tierRank(tier)] || "";

  return {
    key,
    name: LADDER_NAMES[key] || LADDER_NAMES[raw] || raw.charAt(0) + raw.slice(1).toLowerCase(),
    rating,
    tr: number(entry.tr, rating),
    peak: number(entry.peakRating, rating),
    wins,
    losses,
    games: Math.max(number(entry.gamesPlayed), wins + losses),
    winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
    tier: placed && tier && tier.toLowerCase() !== "unranked" ? tier : "",
    tierColor: entry.tierColor || TIER_COLORS[compactTier] || "",
    tierRank: placed ? tierRank(tier) : -1,
    placementGames,
    placementTarget,
    placed,
    position: rawPosition < 0 ? 0 : rawPosition + 1,
  };
}

function parseRanked(body) {
  const data = body && typeof body.data === "object" && body.data ? body.data : {};
  const byKey = new Map();

  for (const [apiKey, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== "object") continue;

    const ladder = parseLadder(apiKey, entry);
    const existing = byKey.get(ladder.key);

    if (!existing || ladder.games > existing.games) {
      byKey.set(ladder.key, ladder);
    }
  }

  const ladders = Array.from(byKey.values())
    .filter((ladder) => ladder.games > 0 || ladder.placed)
    .sort((a, b) => b.tierRank - a.tierRank || b.rating - a.rating);

  const wins = ladders.reduce((sum, ladder) => sum + ladder.wins, 0);
  const losses = ladders.reduce((sum, ladder) => sum + ladder.losses, 0);
  const globalPosition = number(body?.globalPosition, -1);

  return {
    globalRank: body?.rank ? String(body.rank) : "",
    globalPosition: globalPosition < 0 ? 0 : globalPosition + 1,
    wins,
    losses,
    games: ladders.reduce((sum, ladder) => sum + ladder.games, 0),
    ladders,
  };
}

async function getOverallEntry(uuid) {
  if (!overallCache || Date.now() - overallCache.at > OVERALL_CACHE_MS) {
    try {
      const result = await getJson(OVERALL_URL);
      const entries = Array.isArray(result.body?.entries) ? result.body.entries : [];
      overallCache = { at: Date.now(), entries };
    } catch {
      overallCache = { at: Date.now(), entries: [] };
    }
  }

  const id = normalizeUuid(uuid);
  const entry = overallCache.entries.find((item) => normalizeUuid(item.uuid) === id);

  return entry
    ? { overallPoints: number(entry.points, 0), overallRank: number(entry.rank, 0) }
    : {};
}

async function getStats(player) {
  const query = String(player || "").trim();
  if (!query) throw new Error("Sign in or set a player name in the widget options.");

  const cacheKey = query.toLowerCase();
  const cached = cache.get(cacheKey);

  if (cached?.value && Date.now() - cached.at < CACHE_MS) return cached.value;
  if (cached?.promise) return cached.promise;

  if (Date.now() < rateLimitedUntil) {
    if (cached?.value) return cached.value;
    throw new Error("PvPHQ is busy. Trying again shortly.");
  }

  const promise = (async () => {
    const resolved = await resolvePlayer(query);

    if (!resolved) {
      return { found: false, reason: "player", player: query };
    }

    const result = await getJson(`${RANKED_URL}${resolved.uuid}`);

    if (result.status === 429) {
      rateLimitedUntil = Date.now() + Math.max(result.retryAfter * 1000, 30000);
      throw new Error("PvPHQ is busy. Trying again shortly.");
    }

    if (result.status === 404 || !result.body) {
      return { found: false, reason: "ranked", uuid: resolved.uuid, name: resolved.name || query };
    }

    if (result.status < 200 || result.status >= 300) {
      throw new Error(`PvPHQ returned an error (HTTP ${result.status}).`);
    }

    const parsed = parseRanked(result.body);

    return {
      found: true,
      uuid: resolved.uuid,
      name:
        resolved.name ||
        String(result.body?.name || result.body?.username || "") ||
        (normalizeUuid(query) ? "" : query),
      fetchedAt: Date.now(),
      totalLadders: TOTAL_LADDERS,
      kitsRanked: parsed.ladders.filter((ladder) => ladder.placed).length,
      ...parsed,
      ...(await getOverallEntry(resolved.uuid)),
    };
  })();

  cache.set(cacheKey, { ...(cached || {}), promise });

  try {
    const value = await promise;
    cache.set(cacheKey, { at: Date.now(), value });
    return value;
  } catch (error) {
    cache.set(cacheKey, cached?.value ? { at: cached.at, value: cached.value } : {});
    throw error;
  }
}

module.exports = {
  getStats,
  parseRanked,
  normalizeUuid,
};
