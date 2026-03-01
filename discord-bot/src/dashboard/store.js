const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(process.cwd(), "data");
const SETTINGS_FILE = path.join(DATA_DIR, "guild-settings.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readAll() {
  ensureDir();
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) || {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  ensureDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), "utf8");
}

function getDefaultGuildSettings(guildId) {
  return {
    guildId,
    modules: {
      rankCommand: true,
      profileCommand: false,
      statusCommand: false,
      welcomeOnJoin: false,
      welcomeDmOnJoin: false,
      aiAutoChat: false,
      announcements: false,
      autoStatusPost: false
    },
    channels: {
      welcomeChannelId: "",
      aiChatChannelId: "",
      announcementsChannelId: "",
      logsChannelId: "",
      statusChannelId: ""
    },
    messages: {
      welcomeText: "",
      welcomeDmText: "",
      footerText: "Warhex.io"
    },
    features: {
      allowPublicProfileLookup: false,
      allowGlobalRank: true
    },
    updatedAt: null
  };
}

function getGuildSettings(guildId) {
  const all = readAll();
  const merged = {
    ...getDefaultGuildSettings(guildId),
    ...(all[guildId] || {}),
    modules: {
      ...getDefaultGuildSettings(guildId).modules,
      ...((all[guildId] || {}).modules || {})
    },
    channels: {
      ...getDefaultGuildSettings(guildId).channels,
      ...((all[guildId] || {}).channels || {})
    },
    messages: {
      ...getDefaultGuildSettings(guildId).messages,
      ...((all[guildId] || {}).messages || {})
    },
    features: {
      ...getDefaultGuildSettings(guildId).features,
      ...((all[guildId] || {}).features || {})
    }
  };

  // Bot simplificado: manter apenas rank.
  merged.modules.profileCommand = false;
  merged.modules.statusCommand = false;
  merged.modules.welcomeOnJoin = false;
  merged.modules.welcomeDmOnJoin = false;
  merged.modules.aiAutoChat = false;
  merged.modules.announcements = false;
  merged.modules.autoStatusPost = false;
  merged.features.allowPublicProfileLookup = false;
  merged.features.allowGlobalRank = true;

  return merged;
}

function saveGuildSettings(guildId, incoming) {
  const all = readAll();
  const current = getGuildSettings(guildId);
  const merged = {
    ...current,
    ...incoming,
    modules: { ...current.modules, ...(incoming.modules || {}) },
    channels: { ...current.channels, ...(incoming.channels || {}) },
    messages: { ...current.messages, ...(incoming.messages || {}) },
    features: { ...current.features, ...(incoming.features || {}) },
    updatedAt: new Date().toISOString()
  };
  all[guildId] = merged;
  writeAll(all);
  return merged;
}

module.exports = {
  getGuildSettings,
  saveGuildSettings
};
