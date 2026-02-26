const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { config } = require("../config");
const { getGuildSettings, saveGuildSettings } = require("./store");

const PUBLIC_DIR = path.join(__dirname, "public");

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("payload_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function sanitizeGuild(guild) {
  return {
    id: guild.id,
    name: guild.name,
    memberCount: guild.memberCount ?? null,
    iconURL: guild.iconURL?.({ size: 64 }) || null
  };
}

function createDashboardServer(discordClient) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

      if (req.method === "GET" && url.pathname === "/api/guilds") {
        const guilds = [...discordClient.guilds.cache.values()]
          .map(sanitizeGuild)
          .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
        return sendJson(res, 200, { ok: true, guilds });
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/guilds/")) {
        const parts = url.pathname.split("/").filter(Boolean); // api,guilds,id,settings?
        if (parts.length >= 3) {
          const guildId = parts[2];
          const guild = discordClient.guilds.cache.get(guildId);
          if (!guild) return sendJson(res, 404, { ok: false, error: "guild_not_found" });

          if (parts[3] === "channels") {
            let fullGuild = guild;
            try {
              fullGuild = await guild.fetch();
              await fullGuild.channels.fetch();
            } catch {}
            const channels = [...(fullGuild.channels?.cache?.values?.() || [])]
              .filter((ch) => ch && (ch.type === 0 || ch.type === 5))
              .map((ch) => ({ id: ch.id, name: ch.name, type: ch.type }))
              .sort((a, b) => a.name.localeCompare(b.name));
            return sendJson(res, 200, { ok: true, channels });
          }

          const settings = getGuildSettings(guildId);
          return sendJson(res, 200, {
            ok: true,
            guild: sanitizeGuild(guild),
            settings
          });
        }
      }

      if ((req.method === "POST" || req.method === "PUT") && url.pathname.startsWith("/api/guilds/")) {
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length >= 4 && parts[3] === "settings") {
          const guildId = parts[2];
          const guild = discordClient.guilds.cache.get(guildId);
          if (!guild) return sendJson(res, 404, { ok: false, error: "guild_not_found" });

          const raw = await readBody(req);
          let payload = {};
          try {
            payload = raw ? JSON.parse(raw) : {};
          } catch {
            return sendJson(res, 400, { ok: false, error: "invalid_json" });
          }
          const settings = saveGuildSettings(guildId, payload);
          return sendJson(res, 200, { ok: true, settings });
        }
        if (parts.length >= 4 && parts[3] === "test-welcome") {
          const guildId = parts[2];
          const guild = discordClient.guilds.cache.get(guildId);
          if (!guild) return sendJson(res, 404, { ok: false, error: "guild_not_found" });

          const raw = await readBody(req);
          let payload = {};
          try {
            payload = raw ? JSON.parse(raw) : {};
          } catch {
            return sendJson(res, 400, { ok: false, error: "invalid_json" });
          }

          const userId = String(payload.userId || "").trim();
          const type = String(payload.type || "channel");
          if (!userId) return sendJson(res, 400, { ok: false, error: "user_id_required" });

          let member = guild.members.cache.get(userId);
          if (!member) {
            try {
              member = await guild.members.fetch(userId);
            } catch {}
          }
          if (!member) return sendJson(res, 404, { ok: false, error: "member_not_found" });

          const helpers = discordClient.__warhexBotHelpers || {};
          let result;
          if (type === "dm") {
            result = await helpers.sendWelcomeDmToMember?.(member, { isTest: true });
          } else {
            result = await helpers.sendWelcomeToConfiguredChannel?.(member, { isTest: true });
          }
          return sendJson(res, 200, { ok: true, result: result || { ok: false, reason: "helper_missing" } });
        }
        if (parts.length >= 4 && parts[3] === "test-channel-message") {
          const guildId = parts[2];
          const guild = discordClient.guilds.cache.get(guildId);
          if (!guild) return sendJson(res, 404, { ok: false, error: "guild_not_found" });

          const raw = await readBody(req);
          let payload = {};
          try {
            payload = raw ? JSON.parse(raw) : {};
          } catch {
            return sendJson(res, 400, { ok: false, error: "invalid_json" });
          }

          const channelKey = String(payload.channelKey || "").trim();
          const requestedChannelId = String(payload.channelId || "").trim();
          const userId = String(payload.userId || "").trim();
          const settings = getGuildSettings(guildId);
          const channelMap = {
            ai_chat: settings?.channels?.aiChatChannelId,
            welcome: settings?.channels?.welcomeChannelId,
            announcements: settings?.channels?.announcementsChannelId,
            logs: settings?.channels?.logsChannelId,
            status: settings?.channels?.statusChannelId
          };
          const targetChannelId = requestedChannelId || channelMap[channelKey];
          if (!channelKey || !targetChannelId) {
            return sendJson(res, 400, { ok: false, error: "channel_not_configured" });
          }

          let channel = guild.channels.cache.get(targetChannelId);
          if (!channel) {
            try {
              channel = await guild.channels.fetch(targetChannelId);
            } catch {}
          }
          if (!channel || typeof channel.send !== "function") {
            return sendJson(res, 400, { ok: false, error: "invalid_channel" });
          }

          if (channelKey === "welcome") {
            if (!userId) return sendJson(res, 400, { ok: false, error: "user_id_required" });
            let member = guild.members.cache.get(userId);
            if (!member) {
              try {
                member = await guild.members.fetch(userId);
              } catch {}
            }
            if (!member) return sendJson(res, 404, { ok: false, error: "member_not_found" });
            const helpers = discordClient.__warhexBotHelpers || {};
            const result = await helpers.sendWelcomeToConfiguredChannel?.(member, {
              isTest: true,
              overrideChannelId: targetChannelId
            }) || { ok: false, reason: "helper_missing" };
            return sendJson(res, 200, { ok: true, result });
          }

          if (channelKey === "ai_chat") {
            const helpers = discordClient.__warhexBotHelpers || {};
            let result = null;
            if (helpers.sendAiChatTestMessage) {
              result = await helpers.sendAiChatTestMessage({
                guild,
                channel,
                userId
              });
            }
            if (!result) {
              await channel.send({ content: `${userId ? `<@${userId}> ` : ""}Teste da IA de conversa do servidor. Como voces costumam começar a base no Warhex.io?` });
              result = { ok: true, channelId: targetChannelId };
            }
            return sendJson(res, 200, { ok: true, result });
          }

          const mention = userId ? `<@${userId}> ` : "";
          const templates = {
            announcements: `${mention}Teste de anuncio do Warhex.io dashboard.`,
            logs: `${mention}Teste de log do Warhex.io dashboard.`,
            status: `${mention}Teste de status: bot online e painel conectado.`
          };
          await channel.send({ content: templates[channelKey] || `${mention}Teste de mensagem.` });
          return sendJson(res, 200, { ok: true, result: { ok: true, channelId: targetChannelId } });
        }
      }

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
        return sendText(res, 200, html, "text/html; charset=utf-8");
      }

      return sendJson(res, 404, { ok: false, error: "not_found" });
    } catch (error) {
      console.error("[dashboard] error:", error);
      return sendJson(res, 500, { ok: false, error: "internal_error" });
    }
  });

  server.listen(config.dashboardPort, config.dashboardHost, () => {
    console.log(`[Discord Bot Dashboard] http://${config.dashboardHost}:${config.dashboardPort}`);
  });

  return server;
}

module.exports = { createDashboardServer };
