const { Client, GatewayIntentBits, Events, Partials } = require("discord.js");
const { config } = require("./config");
const { commandMap } = require("./commands");
const { createDashboardServer } = require("./dashboard/server");
const { getGuildSettings } = require("./dashboard/store");
const { generateAiWelcomeTemplate, generateAiDiscordReply, isAiWelcomeEnabled } = require("./openai");
const PREFIX = "w!rank";
const aiChatMemory = new Map();
const aiAmbientCooldowns = new Map();
const aiAmbientActiveWindows = new Map();

const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.DirectMessages
];
if (config.enableGuildMembersIntent) intents.push(GatewayIntentBits.GuildMembers);

const client = new Client({
  intents,
  partials: [Partials.Channel]
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[Discord Bot] Logged in as ${readyClient.user.tag}`);
  console.log(`[Discord Bot] Prefix command enabled: ${PREFIX}`);
  console.log("[Discord Bot] If prefix commands do not respond, enable 'Message Content Intent' in Discord Developer Portal > Bot.");
  if (!config.enableGuildMembersIntent) {
    console.log("[Discord Bot] Welcome on join is OFF (set BOT_ENABLE_GUILD_MEMBERS_INTENT=true and enable 'Server Members Intent' in Discord Portal).");
  }
  if (isAiWelcomeEnabled()) {
    console.log("[Discord Bot] AI welcome messages: ON (OpenAI enabled).");
  } else {
    console.log("[Discord Bot] AI welcome messages: OFF (using local templates).");
  }
  createDashboardServer(readyClient);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commandMap.get(interaction.commandName);
  if (!command) {
    await interaction.reply({ content: "Comando nao encontrado.", ephemeral: true }).catch(() => {});
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Command /${interaction.commandName} failed:`, error);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("Erro ao executar o comando.").catch(() => {});
    } else {
      await interaction.reply({ content: "Erro ao executar o comando.", ephemeral: true }).catch(() => {});
    }
  }
});

function createTextCommandContext(message, commandName, args) {
  let deferred = false;
  let replied = false;
  const optionMap = new Map();

  if (commandName === "rank") {
    const modeRaw = (args[0] || "").toLowerCase();
    if (["atual", "global"].includes(modeRaw)) optionMap.set("modo", modeRaw);
  }

  return {
    client,
    commandName,
    deferred,
    replied,
    options: {
      getString(name, required = false) {
        const value = optionMap.get(name) ?? null;
        if (required && (!value || !String(value).trim())) {
          throw new Error(`missing_required_option:${name}`);
        }
        return value;
      }
    },
    async deferReply() {
      deferred = true;
      this.deferred = true;
    },
    async reply(payload) {
      replied = true;
      this.replied = true;
      const content = typeof payload === "string" ? payload : (payload?.content || "");
      return message.reply(content || "OK");
    },
    async editReply(payload) {
      replied = true;
      this.replied = true;
      if (typeof payload === "string") return message.reply(payload);
      if (payload?.embeds?.length) return message.reply({ embeds: payload.embeds });
      return message.reply(payload?.content || "OK");
    }
  };
}

function getAiMemoryKey(message) {
  return `${message.guildId || "dm"}:${message.channelId}:${message.author?.id || "unknown"}`;
}

function pushAiMemory(message, role, content) {
  const key = getAiMemoryKey(message);
  const list = aiChatMemory.get(key) || [];
  list.push({ role, content: String(content || "").slice(0, 500) });
  aiChatMemory.set(key, list.slice(-8));
}

async function tryAiConversationReply(message, userText) {
  if (!isAiWelcomeEnabled()) return false;
  const promptText = String(userText || "").trim();
  if (!promptText) return false;
  try {
    const recentMessages = aiChatMemory.get(getAiMemoryKey(message)) || [];
    const reply = await generateAiDiscordReply({
      guildName: message.guild?.name || "Warhex.io",
      username: message.author?.username || message.member?.displayName || "jogador",
      messageText: promptText,
      recentMessages
    });
    if (!reply) return false;
    pushAiMemory(message, "user", promptText);
    pushAiMemory(message, "assistant", reply);
    await message.reply(reply);
    if (message.guildId && message.channelId) {
      const guildKey = `${message.guildId}:${message.channelId}`;
      aiAmbientActiveWindows.set(guildKey, Date.now() + 3 * 60_000);
    }
    return true;
  } catch (error) {
    console.error("AI discord reply failed:", error.message || error);
    return false;
  }
}

function shouldUseAmbientAiReply(message, settings) {
  if (!message.guildId) return false;
  if (!isAiWelcomeEnabled()) return false;
  if (!settings?.modules?.aiAutoChat) return false;
  const targetChannelId = String(settings?.channels?.aiChatChannelId || "").trim();
  if (!targetChannelId || String(message.channelId) !== targetChannelId) return false;
  const content = String(message.content || "").trim();
  if (!content || content.length < 6) return false;
  if (content.startsWith(PREFIX)) return false;

  const now = Date.now();
  const guildKey = `${message.guildId}:${message.channelId}`;
  const activeUntil = aiAmbientActiveWindows.get(guildKey) || 0;
  const isConversationActive = now < activeUntil;
  const isReplyMessage = !!message.reference?.messageId;
  const lastTs = aiAmbientCooldowns.get(guildKey) || 0;
  const minCooldownMs = (isConversationActive || isReplyMessage) ? 8_000 : 45_000;
  if (now - lastTs < minCooldownMs) return false;

  const lower = content.toLowerCase();
  const triggerWords = ["warhex", "base", "power", "defesa", "troop", "tropa", "rank", "upgrade", "ajuda", "como"];
  const hasTrigger = triggerWords.some((w) => lower.includes(w));
  const chance = isReplyMessage ? 0.95 : (isConversationActive ? 0.75 : (hasTrigger ? 0.45 : 0.14));
  if (Math.random() > chance) return false;

  aiAmbientCooldowns.set(guildKey, now);
  return true;
}

async function sendAiChatTestMessage({ guild, channel, userId = "" } = {}) {
  if (!guild || !channel) return { ok: false, reason: "missing_target" };
  try {
    let prompt = "Mande uma mensagem curta para movimentar o chat do servidor de Warhex.io e puxar assunto sobre início de jogo/base.";
    if (userId) prompt = `<@${userId}> ${prompt}`;
    prompt = "[TOPICO_ALEATORIO] Mande uma mensagem curta para movimentar o chat com um assunto aleatorio, leve e facil de responder. Nao fale sobre Warhex.io, jogo, gameplay, base, rank ou dicas de jogo.";
    if (userId) prompt = `<@${userId}> ${prompt}`;
    const fakeMessage = {
      guild,
      guildId: guild.id,
      channelId: channel.id,
      channel,
      author: { id: "dashboard-test", username: "Dashboard" },
      member: null,
      reply: async (text) => channel.send(typeof text === "string" ? { content: text } : text)
    };
    const ok = await tryAiConversationReply(fakeMessage, prompt);
    if (!ok) {
      await channel.send({ content: `${userId ? `<@${userId}> ` : ""}Pergunta aleatoria para movimentar o chat: qual comida voces conseguem comer varios dias seguidos sem enjoar?` });
      return { ok: true, channelId: channel.id };
    }
    return { ok: true, channelId: channel.id };
  } catch (error) {
    console.error("AI chat test failed:", error);
    return { ok: false, reason: "ai_test_failed" };
  }
}

async function buildWelcomeMessage(guild, member, settings) {
  let template = String(settings?.messages?.welcomeText || "").trim();
  if (!template) {
    try {
      template = await generateAiWelcomeTemplate({ mode: "channel", guildName: guild?.name || "" });
    } catch (error) {
      console.error("AI channel welcome generation failed:", error.message || error);
    }
  }
  template = template ||
    [
      "Bem-vindo {user} ao **{server}**!",
      "Aqui a comunidade joga Warhex.io e ajuda quem esta começando.",
      "No jogo, o foco é montar/proteger sua base, evoluir tropas e subir no rank.",
      "Dica inicial: entre em Play e cuide primeiro de power + defesa.",
      "Se quiser ajuda, chama no chat.",
      "Voce ja jogou jogo de estrategia/base antes?"
    ].join("\n");
  return template
    .replaceAll("{user}", `<@${member.id}>`)
    .replaceAll("{username}", member.user?.username || member.displayName || "jogador")
    .replaceAll("{server}", guild.name || "servidor");
}

async function buildWelcomeDmMessage(guild, member, settings) {
  let template = String(settings?.messages?.welcomeDmText || "").trim();
  if (!template) {
    try {
      template = await generateAiWelcomeTemplate({ mode: "dm", guildName: guild?.name || "" });
    } catch (error) {
      console.error("AI DM welcome generation failed:", error.message || error);
    }
  }
  template = template ||
    [
      "Bem-vindo ao **{server}**, {username}!",
      "No Warhex.io voce monta/protege sua base, gerencia power e evolui tropas.",
      "Dica inicial: fortaleca defesa e economia antes de avancar.",
      "Se quiser, eu posso te passar um comeco simples de base em 3 passos. Quer?"
    ].join("\n");
  return template
    .replaceAll("{user}", `<@${member.id}>`)
    .replaceAll("{username}", member.user?.username || member.displayName || "jogador")
    .replaceAll("{server}", guild.name || "servidor");
}

async function sendWelcomeToConfiguredChannel(member, { isTest = false, requestedBy = null, overrideChannelId = "" } = {}) {
  const guild = member.guild;
  if (!guild) return { ok: false, reason: "no_guild" };

  const settings = getGuildSettings(guild.id);
  if (!isTest && !settings?.modules?.welcomeOnJoin) {
    return { ok: false, reason: "welcome_disabled" };
  }

  const channelId = String(overrideChannelId || settings?.channels?.welcomeChannelId || "").trim();
  if (!channelId) return { ok: false, reason: "welcome_channel_missing" };

  let channel = guild.channels.cache.get(channelId);
  if (!channel) {
    try {
      channel = await guild.channels.fetch(channelId);
    } catch {
      channel = null;
    }
  }
  if (!channel || typeof channel.send !== "function") {
    return { ok: false, reason: "invalid_channel" };
  }

  const content = await buildWelcomeMessage(guild, member, settings);
  const suffix = isTest && requestedBy ? `\n\n_(Teste enviado por <@${requestedBy.id}>)_` : (isTest ? "\n\n_(Mensagem de teste)_" : "");
  await channel.send({ content: `${content}${suffix}` });
  return { ok: true, channelId };
}

async function sendWelcomeDmToMember(member, { isTest = false } = {}) {
  const guild = member.guild;
  if (!guild) return { ok: false, reason: "no_guild" };
  const settings = getGuildSettings(guild.id);
  if (!isTest && !settings?.modules?.welcomeDmOnJoin) return { ok: false, reason: "welcome_dm_disabled" };

  try {
    const content = await buildWelcomeDmMessage(guild, member, settings);
    await member.send({ content: isTest ? `${content}\n\n_(Mensagem privada de teste)_` : content });
    return { ok: true };
  } catch (error) {
    console.error("Failed to send welcome DM:", error);
    return { ok: false, reason: "dm_failed" };
  }
}

client.__warhexBotHelpers = { sendWelcomeToConfiguredChannel, sendWelcomeDmToMember, sendAiChatTestMessage };

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    await sendWelcomeToConfiguredChannel(member);
    await sendWelcomeDmToMember(member);
  } catch (error) {
    console.error("Welcome on join failed:", error);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (!message || message.author?.bot) return;
  // Debug: confirms the gateway is delivering messages to the bot.
  console.log(`[MSG] ${message.guild?.name || "DM"} | ${message.author?.tag || "unknown"} | ${String(message.content || "").slice(0, 120)}`);
  const content = String(message.content || "").trim();
  const settings = message.guildId ? getGuildSettings(message.guildId) : null;
  const botId = client.user?.id;
  const mentionRegex = botId ? new RegExp(`^<@!?${botId}>\\s*`) : null;
  const startsWithMention = mentionRegex ? mentionRegex.test(content) : false;
  const isDm = !message.guildId;

  if ((isDm || startsWithMention) && content) {
    const cleaned = startsWithMention ? content.replace(mentionRegex, "").trim() : content;
    if (cleaned && !cleaned.toLowerCase().startsWith(PREFIX)) {
      const handled = await tryAiConversationReply(message, cleaned);
      if (handled) return;
    }
  }

  if (!startsWithMention && !isDm && shouldUseAmbientAiReply(message, settings)) {
    const handled = await tryAiConversationReply(message, content);
    if (handled) return;
  }

  const prefixMatch = content.match(/^w!rank(?:\s+(.+))?$/i);
  if (!prefixMatch) return;

  const raw = String(prefixMatch[1] || "").trim();
  const args = raw ? raw.split(/\s+/) : [];
  const command = commandMap.get("rank");
  if (!command) return;

  try {
    const ctx = createTextCommandContext(message, "rank", args);
    await command.execute(ctx);
  } catch (error) {
    console.error(`Prefix command ${PREFIX} failed:`, error);
    await message.reply("Erro ao executar comando.");
  }
});

client.login(config.discordToken).catch((error) => {
  console.error("Discord login failed:", error);
  process.exit(1);
});

