const { config } = require("./config");

const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

function isEnabled() {
  return !!config.openaiApiKey && config.aiWelcomeEnabled;
}

function getCacheKey(mode, guildName) {
  return `${mode}:${String(guildName || "").trim().toLowerCase()}`;
}

function getCached(mode, guildName) {
  const key = getCacheKey(mode, guildName);
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function setCached(mode, guildName, value) {
  cache.set(getCacheKey(mode, guildName), { value, ts: Date.now() });
}

function buildPrompt(mode, guildName) {
  const isDm = mode === "dm";
  const audience = isDm ? "mensagem privada (DM) de boas-vindas" : "mensagem no canal de boas-vindas";
  const maxLines = isDm ? 7 : 6;
  return [
    `Escreva uma ${audience} em PT-BR para novos jogadores de Warhex.io no servidor Discord ${guildName || "{server}"}.`,
    "Contexto do jogo (Warhex.io): jogo de estrategia/acao com base, power, defesa, tropas e evolucao; o jogador constroi e protege o core, melhora tropas/torres e tenta dominar/subir no rank.",
    "A mensagem deve dar onboarding de 2 coisas: servidor Discord e jogo.",
    "",
    "Inclua de forma curta e natural:",
    "1) boas-vindas ao servidor Discord (curta)",
    "2) objetivo principal do jogo",
    "3) como comecar (entrar em Play e iniciar base/defesa)",
    "4) dica pratica inicial (power/defesa/evolucao)",
    "5) incentivo para pedir ajuda no chat/comunidade do servidor",
    "6) uma pergunta final curta para incentivar resposta (ex.: se ja jogou antes, qual estilo gosta, se quer ajuda para comecar)",
    "",
    "Use placeholders exatamente assim quando fizer sentido: {user}, {username}, {server}.",
    "Nao invente comandos ou links especificos.",
    "Nao use emojis.",
    "Tom amigavel, claro, util e direto.",
    "A mensagem deve soar humana e acolhedora, sem parecer automatica demais.",
    "Termine com UMA pergunta direta e facil de responder.",
    `Maximo de ${maxLines} linhas.`,
    "Formato: texto pronto para enviar no Discord, com quebras de linha curtas.",
    "Retorne apenas o texto final da mensagem."
  ].join("\n");
}

async function callOpenAI(prompt) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.openaiApiKey}`
    },
    body: JSON.stringify({
      model: config.openaiModel,
      temperature: 0.6,
      messages: [
        { role: "system", content: "Você escreve mensagens de onboarding curtas e úteis para jogadores." },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`openai_http_${res.status}:${String(text).slice(0, 180)}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") throw new Error("openai_empty_content");
  return content.trim();
}

async function callOpenAIChat(messages, { system, temperature = 0.8, maxTokens = 220 } = {}) {
  const payloadMessages = [];
  if (system) payloadMessages.push({ role: "system", content: system });
  payloadMessages.push(...messages);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.openaiApiKey}`
    },
    body: JSON.stringify({
      model: config.openaiModel,
      temperature,
      max_tokens: maxTokens,
      messages: payloadMessages
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`openai_http_${res.status}:${String(text).slice(0, 180)}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") throw new Error("openai_empty_content");
  return content.trim();
}

function sanitizeMessage(text, mode) {
  const maxChars = mode === "dm" ? 1200 : 1400;
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}

async function generateAiWelcomeTemplate({ mode = "channel", guildName = "" } = {}) {
  if (!isEnabled()) return null;
  const cached = getCached(mode, guildName);
  if (cached) return cached;

  const prompt = buildPrompt(mode, guildName);
  const text = sanitizeMessage(await callOpenAI(prompt), mode);
  if (!text) return null;
  setCached(mode, guildName, text);
  return text;
}

async function generateAiDiscordReply({ guildName = "", username = "", messageText = "", recentMessages = [] } = {}) {
  if (!isEnabled()) return null;
  const safeMessage = String(messageText || "").trim();
  if (!safeMessage) return null;

  const conversation = [];
  for (const item of recentMessages.slice(-6)) {
    const role = item?.role === "assistant" ? "assistant" : "user";
    const text = String(item?.content || "").trim();
    if (!text) continue;
    conversation.push({ role, content: text.slice(0, 400) });
  }
  conversation.push({ role: "user", content: safeMessage.slice(0, 700) });

  const system = [
    "Você é o bot do servidor Discord de Warhex.io.",
    "Fale em PT-BR de forma natural, amigável e curta.",
    "Objetivo: responder e puxar assunto de forma leve sobre o jogo/comunidade.",
    "Quando fizer sentido, faça 1 pergunta curta no final para continuar a conversa.",
    "Não force assunto em toda resposta; seja natural.",
    "Se perguntarem sobre o jogo, explique de forma prática (base, power, defesa, tropas, rank).",
    "Não invente features/comandos/links.",
    "Evite respostas longas (máx 6 linhas).",
    `Servidor atual: ${guildName || "Warhex.io"}. Usuário: ${username || "jogador"}.`
  ].join(" ");

  const text = await callOpenAIChat(conversation, { system, temperature: 0.9, maxTokens: 220 });
  return sanitizeMessage(text, "chat");
}

async function generateAiDiscordReply({ guildName = "", username = "", messageText = "", recentMessages = [] } = {}) {
  if (!isEnabled()) return null;
  const rawMessage = String(messageText || "").trim();
  if (!rawMessage) return null;

  const randomTopicMode = rawMessage.includes("[TOPICO_ALEATORIO]");
  const safeMessage = rawMessage.replace("[TOPICO_ALEATORIO]", "").trim();
  if (!safeMessage) return null;

  const conversation = [];
  for (const item of recentMessages.slice(-6)) {
    const role = item?.role === "assistant" ? "assistant" : "user";
    const text = String(item?.content || "").trim();
    if (!text) continue;
    conversation.push({ role, content: text.slice(0, 400) });
  }
  conversation.push({ role: "user", content: safeMessage.slice(0, 700) });

  const system = randomTopicMode
    ? [
        "Voce e o bot do servidor Discord de Warhex.io.",
        "Fale em PT-BR de forma natural, amigavel e curta.",
        "Objetivo: movimentar o chat com assuntos aleatorios e leves, sem falar do jogo.",
        "Nao fale sobre Warhex.io, gameplay, base, power, defesa, tropas, rank, upgrade ou dicas de jogo.",
        "Crie uma mensagem curta com 1 pergunta facil de responder para incentivar participacao.",
        "Nao invente links/comandos.",
        "Evite respostas longas (max 4 linhas).",
        `Servidor atual: ${guildName || "Warhex.io"}. Usuario: ${username || "membro"}.`
      ].join(" ")
    : [
        "Voce e o bot do servidor Discord de Warhex.io.",
        "Fale em PT-BR de forma natural, amigavel e curta.",
        "Objetivo: responder e puxar assunto de forma leve sobre o jogo/comunidade.",
        "Quando fizer sentido, faca 1 pergunta curta no final para continuar a conversa.",
        "Nao force assunto em toda resposta; seja natural.",
        "Se perguntarem sobre o jogo, explique de forma pratica (base, power, defesa, tropas, rank).",
        "Nao invente features/comandos/links.",
        "Evite respostas longas (max 6 linhas).",
        `Servidor atual: ${guildName || "Warhex.io"}. Usuario: ${username || "jogador"}.`
      ].join(" ");

  let text = await callOpenAIChat(conversation, { system, temperature: 0.9, maxTokens: 220 });
  text = sanitizeMessage(text, "chat");

  if (randomTopicMode) {
    const forbiddenTerms = ["warhex", "jogo", "gameplay", "base", "power", "defesa", "tropa", "troop", "rank", "upgrade"];
    const lower = text.toLowerCase();
    if (forbiddenTerms.some((term) => lower.includes(term))) {
      return "Pergunta aleatoria para movimentar o chat: se voce pudesse aprender qualquer habilidade hoje, qual escolheria?";
    }
  }

  return text;
}

module.exports = {
  generateAiWelcomeTemplate,
  generateAiDiscordReply,
  isAiWelcomeEnabled: isEnabled
};
