const { EmbedBuilder } = require("discord.js");
const { fetchGlobalTop } = require("../supabase");
const { formatScore, formatPlaytime } = require("../utils/format");
const { config } = require("../config");

const data = {
  name: "rank",
  description: "Mostra o Top 10 atual ou global",
  options: [
    {
      type: 3,
      name: "modo",
      description: "Ranking atual (ao vivo) ou global",
      required: false,
      choices: [
        { name: "Atual", value: "atual" },
        { name: "Global", value: "global" }
      ]
    }
  ]
};

async function fetchLiveTopFromStatusEndpoint() {
  if (!config.gameStatusUrl) throw new Error("missing_status_endpoint");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(config.gameStatusUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`status_http_${response.status}`);
    const json = await response.json();

    const raw = Array.isArray(json?.leaderboard) ? json.leaderboard : [];
    const top = raw
      .map((entry) => ({
        displayName: String(entry.name || entry.nickname || entry.username || "Unknown"),
        highscore: Number(entry.score ?? entry.highscore ?? 0) || 0,
        playtime: Number(entry.playtime ?? 0) || 0,
        kills: Number(entry.kills ?? entry.total_kills ?? 0) || 0
      }))
      .sort((a, b) => b.highscore - a.highscore)
      .slice(0, 10);

    if (!top.length) throw new Error("live_leaderboard_unavailable");
    return top;
  } finally {
    clearTimeout(timeout);
  }
}

function shortName(value, max = 14) {
  const str = String(value || "Unknown");
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

function buildRankingTable(top) {
  const rows = top.map((u, i) => {
    const pos = String(i + 1).padStart(2, " ");
    const name = shortName(u.displayName, 14).padEnd(14, " ");
    const score = formatScore(u.highscore).padStart(6, " ");
    const play = formatPlaytime(u.playtime).padStart(6, " ");
    const kills = String(u.kills).padStart(4, " ");
    return `${pos} ${name} ${score} ${play} ${kills}`;
  });

  return [
    "```",
    " # Nome           Score   Play Kills",
    ...rows,
    "```"
  ].join("\n");
}

function buildPodium(top) {
  const medals = ["🥇", "🥈", "🥉"];
  return top.slice(0, 3).map((u, i) =>
    `${medals[i]} **${u.displayName}**  •  \`${formatScore(u.highscore)}\`  •  \`${u.kills} kills\``
  ).join("\n");
}

async function execute(interaction) {
  const mode = interaction.options.getString("modo") || "atual";
  await interaction.deferReply();

  try {
    let top = [];
    let titleSuffix = "Global Rank";
    let notice = null;

    if (mode === "atual") {
      try {
        top = await fetchLiveTopFromStatusEndpoint();
        titleSuffix = "Top Atual";
      } catch (error) {
        console.warn("/rank atual indisponivel, fallback para global:", error.message);
        top = await fetchGlobalTop(10);
        titleSuffix = "Global Rank";
        notice = "Top atual indisponivel agora. Mostrando global.";
      }
    } else {
      top = await fetchGlobalTop(10);
    }

    if (!top.length) {
      await interaction.editReply(mode === "atual"
        ? "Nao consegui obter o top atual agora."
        : "Nenhum jogador encontrado no ranking global ainda.");
      return;
    }

    const totalScore = top.reduce((sum, p) => sum + (Number(p.highscore) || 0), 0);
    const totalKills = top.reduce((sum, p) => sum + (Number(p.kills) || 0), 0);

    const embed = new EmbedBuilder()
      .setColor(mode === "atual" ? 0x22d3ee : 0x8b5cf6)
      .setTitle(`${config.brandName} • ${titleSuffix}`)
      .setDescription([
        notice ? `> ${notice}` : null,
        "",
        buildPodium(top),
        "",
        buildRankingTable(top)
      ].filter(Boolean).join("\n"))
      .addFields(
        { name: "Jogadores listados", value: String(top.length), inline: true },
        { name: "Score somado", value: formatScore(totalScore), inline: true },
        { name: "Kills somadas", value: String(totalKills), inline: true }
      )
      .setFooter({ text: mode === "atual" ? "Atualize novamente para ranking em tempo real" : "Ranking global por conta" })
      .setTimestamp();

    const avatar = interaction?.client?.user?.displayAvatarURL?.();
    if (avatar) embed.setThumbnail(avatar);

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("/rank error:", error);
    await interaction.editReply("Erro ao buscar o ranking.");
  }
}

module.exports = { data, execute };
