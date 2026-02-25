const { createClient } = require("@supabase/supabase-js");
const { config } = require("./config");

const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function safeJsonParse(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeUserStats(row = {}) {
  const statistics = safeJsonParse(row.statistics) || {};
  const highscore = Number(row.highscore ?? statistics.highscore ?? 0) || 0;
  const playtime = Number(row.playtime ?? statistics.playtime ?? 0) || 0;
  const kills = Number(row.total_kills ?? row.kills ?? statistics.total_kills ?? statistics.kills ?? 0) || 0;
  const xp = Number(row.xp ?? statistics.xp ?? 0) || 0;
  const level = Number(row.level ?? statistics.level ?? 0) || 0;
  const name = String(row.nickname || row.username || row.email || "Unknown");
  return {
    ...row,
    displayName: name,
    highscore,
    playtime,
    kills,
    xp,
    level
  };
}

async function fetchUsersRaw(limit = 200) {
  const selects = [
    "id,nickname,username,email,highscore,playtime,total_kills,xp,level,statistics",
    "id,nickname,username,email,highscore,playtime,total_kills,statistics",
    "id,nickname,username,email,statistics",
    "*"
  ];

  let lastError = null;
  for (const select of selects) {
    const { data, error } = await supabase.from("users").select(select).limit(limit);
    if (!error && Array.isArray(data)) return data;
    lastError = error;
  }
  throw lastError || new Error("Failed to fetch users");
}

async function fetchGlobalTop(limit = 10) {
  const rows = await fetchUsersRaw(250);
  return rows
    .map(normalizeUserStats)
    .sort((a, b) => {
      if (b.highscore !== a.highscore) return b.highscore - a.highscore;
      if (b.kills !== a.kills) return b.kills - a.kills;
      return b.playtime - a.playtime;
    })
    .slice(0, limit);
}

async function findProfileByQuery(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return null;

  const rows = await fetchUsersRaw(500);
  const users = rows.map(normalizeUserStats);

  const exact = users.find((u) =>
    [u.nickname, u.username, u.email].some((v) => String(v || "").toLowerCase() === q)
  );
  if (exact) return exact;

  const partial = users.find((u) =>
    [u.nickname, u.username, u.email].some((v) => String(v || "").toLowerCase().includes(q))
  );
  return partial || null;
}

module.exports = {
  supabase,
  normalizeUserStats,
  fetchGlobalTop,
  findProfileByQuery
};
