const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const config = {
  discordToken: required("DISCORD_BOT_TOKEN"),
  clientId: required("DISCORD_CLIENT_ID"),
  guildId: process.env.DISCORD_GUILD_ID || "",
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  gameStatusUrl: process.env.GAME_STATUS_URL || "",
  brandName: process.env.BOT_BRAND_NAME || "Warhex.io",
  dashboardPort: Number(process.env.BOT_DASHBOARD_PORT || 8787),
  dashboardHost: process.env.BOT_DASHBOARD_HOST || "127.0.0.1",
  enableGuildMembersIntent: String(process.env.BOT_ENABLE_GUILD_MEMBERS_INTENT || "").toLowerCase() === "true",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  aiWelcomeEnabled: String(process.env.BOT_AI_WELCOME_ENABLED || "true").toLowerCase() !== "false"
};

module.exports = { config };
